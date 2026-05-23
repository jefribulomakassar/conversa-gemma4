import { NextRequest } from "next/server";

// ── Model config ─────────────────────────────────────────────────────────────
const GOOGLE_AI_URL = "https://generativelanguage.googleapis.com/v1beta/models";

const GEMMA_MODELS = [
  "gemma-4-26b-a4b-it",
  "gemma-4-31b-it",
];

const FALLBACK_MODEL = "gemini-2.5-flash";

const GROQ_WHISPER_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const GROQ_WHISPER_MODEL = "whisper-large-v3-turbo";

const ALLOWED_AUDIO_TYPES = [
  "audio/mpeg", "audio/mp3", "audio/wav", "audio/wave",
  "audio/x-wav", "audio/mp4", "audio/m4a", "audio/x-m4a",
  "audio/ogg", "audio/webm", "audio/flac", "audio/aac",
];

// ── Helpers ──────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchWithRetry(
  url: string,
  body: object,
  maxRetries = 4
): Promise<Response> {
  let lastRes: Response | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (res.status === 429) return res;
    if (res.ok) return res;

    if (res.status === 500 || res.status === 503) {
      lastRes = res;
      if (attempt < maxRetries - 1) {
        const wait = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
        console.warn(`Gemma ${res.status} on attempt ${attempt + 1}, retry in ${Math.round(wait)}ms`);
        await sleep(wait);
        continue;
      }
      return res;
    }

    return res;
  }

  return lastRes!;
}

function extractJSON(raw: string): Record<string, unknown> | null {
  let text = raw
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/gi, "")
    .trim();

  text = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;

  const candidate = text.slice(start, end + 1);

  try {
    return JSON.parse(candidate);
  } catch {
    let pos = candidate.lastIndexOf("}");
    while (pos > 0) {
      try {
        const parsed = JSON.parse(candidate.slice(0, pos + 1));
        console.warn("JSON repaired by truncation at pos:", pos);
        return parsed;
      } catch {
        pos = candidate.lastIndexOf("}", pos - 1);
      }
    }
    return null;
  }
}

function buildPrompt(transcript: string): string {
  return `Analyze this meeting transcript and return ONLY a JSON object.
Start with { and end with }. No markdown, no explanation.

Transcript:
${transcript}

JSON structure required:
{
  "transcript": "full transcript verbatim",
  "keyPoints": ["3-6 key discussion points"],
  "actionItems": ["concrete tasks with owner if mentioned"],
  "followUpQuestions": ["2-4 follow-up questions"]
}`;
}

async function callGoogleAI(
  prompt: string,
  googleKey: string
): Promise<{ raw: string; usedModel: string; isFallback: boolean }> {
  const generationConfig = {
    temperature: 0.1,
    maxOutputTokens: 4096,
  };

  for (const model of GEMMA_MODELS) {
    const url = `${GOOGLE_AI_URL}/${model}:generateContent?key=${googleKey}`;
    const body = {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig,
    };

    const res = await fetchWithRetry(url, body);

    if (res.status === 429) {
      console.warn(`Rate limit on ${model}, trying next Gemma model...`);
      continue;
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error(`Gemma error (${model}) ${res.status}:`, err);
      continue;
    }

    const data = await res.json();
    const raw: string | undefined = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!raw) {
      console.error(`Empty response from ${model}`);
      continue;
    }

    return { raw, usedModel: model, isFallback: false };
  }

  console.warn("All Gemma 4 models failed, falling back to Gemini Flash...");
  const fallbackUrl = `${GOOGLE_AI_URL}/${FALLBACK_MODEL}:generateContent?key=${googleKey}`;
  const fallbackBody = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig,
  };

  const fallbackRes = await fetchWithRetry(fallbackUrl, fallbackBody, 2);

  if (!fallbackRes.ok) {
    const err = await fallbackRes.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Fallback model error ${fallbackRes.status}`);
  }

  const fallbackData = await fallbackRes.json();
  const fallbackRaw: string | undefined =
    fallbackData?.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!fallbackRaw) throw new Error("No response from fallback model.");

  return { raw: fallbackRaw, usedModel: FALLBACK_MODEL, isFallback: true };
}

// ── Helper: tulis satu event SSE ke encoder ──────────────────────────────────
function encodeEvent(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  event: string,
  data: unknown
) {
  const line = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  controller.enqueue(encoder.encode(line));
}

// ── Main handler ─────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: string, data: unknown) =>
        encodeEvent(controller, encoder, event, data);

      try {
        // 1. Parse form
        const form = await req.formData();
        const file = form.get("file") as File | null;

        if (!file) {
          emit("error", { message: "No audio file provided." });
          controller.close();
          return;
        }

        if (file.size > 25 * 1024 * 1024) {
          emit("error", { message: "The file is too large. Maximum 25MB." });
          controller.close();
          return;
        }

        const mimeType = file.type || "audio/mpeg";
        if (!ALLOWED_AUDIO_TYPES.includes(mimeType)) {
          emit("error", { message: `Unsupported formats: ${mimeType}.` });
          controller.close();
          return;
        }

        const groqKey = process.env.GROQ_API_KEY;
        if (!groqKey) {
          emit("error", { message: "GROQ_API_KEY not found." });
          controller.close();
          return;
        }

        const googleKey = process.env.GOOGLE_AI_KEY;
        if (!googleKey) {
          emit("error", { message: "GOOGLE_AI_KEY not found." });
          controller.close();
          return;
        }

        // 2. Transkripsi via Groq Whisper
        emit("status", { step: "transcribing" });

        const whisperForm = new FormData();
        whisperForm.append("file", file);
        whisperForm.append("model", GROQ_WHISPER_MODEL);
        whisperForm.append("response_format", "json");

        const whisperRes = await fetch(GROQ_WHISPER_URL, {
          method: "POST",
          headers: { Authorization: `Bearer ${groqKey}` },
          body: whisperForm,
        });

        if (!whisperRes.ok) {
          const errData = await whisperRes.json().catch(() => ({}));
          emit("error", { message: errData?.error?.message || "Failed to transcribe audio." });
          controller.close();
          return;
        }

        const whisperData = await whisperRes.json();
        const transcript: string = whisperData?.text?.trim() ?? "";

        if (!transcript) {
          emit("error", { message: "Transcription is empty. Make sure the audio contains conversation." });
          controller.close();
          return;
        }

        // Stream transcript segera setelah selesai
        emit("transcript", { text: transcript });

        // 3. Analisis via Google AI
        emit("status", { step: "analyzing" });

        const prompt = buildPrompt(transcript);
        const { raw, usedModel, isFallback } = await callGoogleAI(prompt, googleKey);

        // 4. Parse JSON
        const parsed = extractJSON(raw);

        const keyPoints: string[] = Array.isArray(parsed?.keyPoints) ? parsed.keyPoints as string[] : [];
        const actionItems: string[] = Array.isArray(parsed?.actionItems) ? parsed.actionItems as string[] : [];
        const followUpQuestions: string[] = Array.isArray(parsed?.followUpQuestions) ? parsed.followUpQuestions as string[] : [];

        if (!parsed) {
          console.error(`JSON extraction failed (${usedModel}). Raw:`, raw.slice(0, 500));
        }

        // 5. Stream setiap section dengan jeda kecil agar efek streaming terasa di UI
        emit("keyPoints", { items: keyPoints });
        await sleep(120);

        emit("actionItems", { items: actionItems });
        await sleep(120);

        emit("followUpQuestions", { items: followUpQuestions });
        await sleep(120);

        // 6. Done
        emit("done", {
          _meta: {
            model: usedModel,
            isFallback,
            warning: !parsed ? "Invalid JSON from model." : undefined,
          },
        });

        controller.close();
      } catch (err) {
        console.error("Audio route error:", err);
        const msg = err instanceof Error ? err.message : "Internal server error.";
        encodeEvent(controller, encoder, "error", { message: msg });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
