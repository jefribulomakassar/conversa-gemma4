import { NextRequest, NextResponse } from "next/server";

// ── Model config ─────────────────────────────────────────────────────────────
const GOOGLE_AI_URL = "https://generativelanguage.googleapis.com/v1beta/models";

// Gemma 4 = model INTI (wajib hackathon)
const GEMMA_MODELS = [
  "gemma-4-26b-a4b-it",
  "gemma-4-31b-it",
];

// Gemini Flash = model PENDUKUNG (fallback jika Gemma 4 gagal semua retry)
const FALLBACK_MODEL = "gemini-2.5-flash";

const GROQ_WHISPER_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const GROQ_WHISPER_MODEL = "whisper-large-v3-turbo";

const ALLOWED_AUDIO_TYPES = [
  "audio/mpeg", "audio/mp3", "audio/wav", "audio/wave",
  "audio/x-wav", "audio/mp4", "audio/m4a", "audio/x-m4a",
  "audio/ogg", "audio/webm", "audio/flac", "audio/aac",
];

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Delay helper */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Exponential backoff retry untuk Google AI — handle 500 & 503 */
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

    // 429 = rate limit → coba model berikutnya (handled di caller)
    if (res.status === 429) return res;

    // 200 = sukses
    if (res.ok) return res;

    // 500 / 503 = transient server error → retry dengan backoff
    if (res.status === 500 || res.status === 503) {
      lastRes = res;
      if (attempt < maxRetries - 1) {
        // jitter: 1s, 2s, 4s + random 0-1s
        const wait = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
        console.warn(`Gemma ${res.status} on attempt ${attempt + 1}, retry in ${Math.round(wait)}ms`);
        await sleep(wait);
        continue;
      }
      return res; // kembalikan response terakhir setelah semua retry habis
    }

    // Error lain (400, 403, dll) → langsung kembalikan
    return res;
  }

  return lastRes!;
}

/** Robust JSON extractor — tidak pakai greedy regex */
function extractJSON(raw: string): Record<string, unknown> | null {
  // 1. Strip markdown fences
  let text = raw
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/gi, "")
    .trim();

  // 2. Strip karakter kontrol yang bikin JSON.parse crash
  text = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");

  // 3. Cari { pertama dan } terakhir (bukan greedy)
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;

  const candidate = text.slice(start, end + 1);

  try {
    return JSON.parse(candidate);
  } catch {
    // 4. Repair: mundur dari } terakhir sampai ketemu JSON valid
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

/** Build prompt — PENDEK agar tidak trigger 500 dari sisi input panjang */
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

/** Call Google AI — returns { data, usedModel, isFallback } */
async function callGoogleAI(
  prompt: string,
  googleKey: string
): Promise<{ raw: string; usedModel: string; isFallback: boolean }> {
  const generationConfig = {
    temperature: 0.1,
    maxOutputTokens: 4096,
  };

  // ── 1. Coba semua Gemma 4 model (model INTI) ──────────────────────────────
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
      // Lanjut ke model Gemma berikutnya
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

  // ── 2. Semua Gemma 4 gagal → fallback ke Gemini Flash (model PENDUKUNG) ───
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

  if (!fallbackRaw) throw new Error("Tidak ada respons dari fallback model.");

  return { raw: fallbackRaw, usedModel: FALLBACK_MODEL, isFallback: true };
}

// ── Main handler ─────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    // 1. Parse form
    const form = await req.formData();
    const file = form.get("file") as File | null;

    if (!file)
      return NextResponse.json({ error: "No audio file provided." }, { status: 400 });

    if (file.size > 25 * 1024 * 1024)
      return NextResponse.json({ error: "File terlalu besar. Maksimal 25MB." }, { status: 400 });

    const mimeType = file.type || "audio/mpeg";
    if (!ALLOWED_AUDIO_TYPES.includes(mimeType))
      return NextResponse.json(
        { error: `Format tidak didukung: ${mimeType}.` },
        { status: 400 }
      );

    const groqKey = process.env.GROQ_API_KEY;
    if (!groqKey)
      return NextResponse.json({ error: "GROQ_API_KEY tidak ditemukan." }, { status: 500 });

    const googleKey = process.env.GOOGLE_AI_KEY;
    if (!googleKey)
      return NextResponse.json({ error: "GOOGLE_AI_KEY tidak ditemukan." }, { status: 500 });

    // 2. Transkripsi via Groq Whisper
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
      return NextResponse.json(
        { error: errData?.error?.message || "Gagal mentranskripsi audio." },
        { status: whisperRes.status }
      );
    }

    const whisperData = await whisperRes.json();
    const transcript: string = whisperData?.text?.trim() ?? "";

    if (!transcript)
      return NextResponse.json(
        { error: "Transkripsi kosong. Pastikan audio berisi percakapan." },
        { status: 422 }
      );

    // 3. Analisis via Google AI (Gemma 4 utama, Gemini Flash fallback)
    const prompt = buildPrompt(transcript);
    const { raw, usedModel, isFallback } = await callGoogleAI(prompt, googleKey);

    // 4. Parse JSON
    const parsed = extractJSON(raw);

    if (!parsed) {
      console.error(`JSON extraction failed (${usedModel}). Raw:`, raw.slice(0, 500));
      // Graceful fallback: kembalikan transcript saja
      return NextResponse.json({
        transcript,
        keyPoints: [],
        actionItems: [],
        followUpQuestions: [],
        _meta: { model: usedModel, isFallback, warning: "JSON tidak valid dari model." },
      });
    }

    // 5. Normalize
    if (!parsed.transcript) parsed.transcript = transcript;
    if (!Array.isArray(parsed.keyPoints)) parsed.keyPoints = [];
    if (!Array.isArray(parsed.actionItems)) parsed.actionItems = [];
    if (!Array.isArray(parsed.followUpQuestions)) parsed.followUpQuestions = [];

    // Tambah metadata model (berguna untuk debug & presentasi hackathon)
    parsed._meta = { model: usedModel, isFallback };

    return NextResponse.json(parsed);

  } catch (err) {
    console.error("Audio route error:", err);
    const msg = err instanceof Error ? err.message : "Internal server error.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
