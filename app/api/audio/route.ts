import { NextRequest, NextResponse } from "next/server";

const GOOGLE_AI_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const GEMMA_MODELS = [
  "gemma-4-26b-a4b-it",
  "gemma-4-31b-it",
];

const GROQ_WHISPER_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const GROQ_WHISPER_MODEL = "whisper-large-v3-turbo";

const ALLOWED_AUDIO_TYPES = [
  "audio/mpeg", "audio/mp3", "audio/wav", "audio/wave",
  "audio/x-wav", "audio/mp4", "audio/m4a", "audio/x-m4a",
  "audio/ogg", "audio/webm", "audio/flac", "audio/aac",
];

// ── Robust JSON extractor ────────────────────────────────────────────────────
function extractJSON(raw: string): Record<string, unknown> | null {
  // 1. Strip markdown fences
  let text = raw
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/gi, "")
    .trim();

  // 2. Strip control characters kecuali newline & tab
  text = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");

  // 3. Cari posisi { pertama dan } terakhir (bukan greedy match)
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;

  const candidate = text.slice(start, end + 1);

  try {
    return JSON.parse(candidate);
  } catch {
    // 4. Fallback: coba repair JSON — truncate di } terakhir yang valid
    try {
      // Cari posisi } valid dari kanan, coba parse bertahap
      let pos = candidate.lastIndexOf("}");
      while (pos > 0) {
        try {
          const partial = candidate.slice(0, pos + 1);
          const parsed = JSON.parse(partial);
          console.warn("JSON repaired by truncation at pos:", pos);
          return parsed;
        } catch {
          pos = candidate.lastIndexOf("}", pos - 1);
        }
      }
    } catch { /* ignore */ }
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file") as File | null;

    if (!file)
      return NextResponse.json({ error: "No audio file provided." }, { status: 400 });

    if (file.size > 25 * 1024 * 1024)
      return NextResponse.json({ error: "File terlalu besar. Maksimal 25MB." }, { status: 400 });

    const mimeType = file.type || "audio/mpeg";
    if (!ALLOWED_AUDIO_TYPES.includes(mimeType))
      return NextResponse.json(
        { error: `Format tidak didukung: ${mimeType}. Gunakan MP3, WAV, M4A, OGG, atau FLAC.` },
        { status: 400 }
      );

    const groqKey = process.env.GROQ_API_KEY;
    if (!groqKey)
      return NextResponse.json({ error: "GROQ_API_KEY tidak ditemukan." }, { status: 500 });

    const googleKey = process.env.GOOGLE_AI_KEY;
    if (!googleKey)
      return NextResponse.json({ error: "GOOGLE_AI_KEY tidak ditemukan." }, { status: 500 });

    // ── Transkripsi via Groq Whisper ─────────────────────────────────────────
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

    // ── Analisis via Gemma 4 ─────────────────────────────────────────────────
    const prompt = `You are an enterprise meeting intelligence assistant.
Respond with ONLY a raw JSON object. No markdown, no backticks, no explanation, no preamble.
Start your response with { and end with }.

Transcript:
---
${transcript}
---

Return this exact JSON structure:
{
  "transcript": "full transcript verbatim",
  "keyPoints": ["point 1", "point 2", "point 3"],
  "actionItems": ["action with owner 1", "action with owner 2"],
  "followUpQuestions": ["question 1", "question 2"]
}

Rules:
- keyPoints: 3-6 most important discussion points
- actionItems: concrete tasks with responsible person if mentioned
- followUpQuestions: 2-4 questions to address after this meeting
- Output ONLY the JSON object. First character must be {`;

    let analysisRes: Response | null = null;
    let usedModel = "";

    for (const model of GEMMA_MODELS) {
      const url = `${GOOGLE_AI_URL}/${model}:generateContent?key=${googleKey}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.1,       // turunkan dari 0.2 → lebih deterministik
            maxOutputTokens: 4096,
            stopSequences: [],
          },
        }),
      });

      if (res.status === 429) {
        console.warn(`Rate limit on ${model}, trying next...`);
        continue;
      }

      analysisRes = res;
      usedModel = model;
      break;
    }

    if (!analysisRes)
      return NextResponse.json(
        { error: "Semua model Gemma 4 sedang rate limit. Coba lagi dalam 1 menit." },
        { status: 429 }
      );

    if (!analysisRes.ok) {
      const errData = await analysisRes.json().catch(() => ({}));
      return NextResponse.json(
        { error: errData?.error?.message || `Google AI error ${analysisRes.status}` },
        { status: analysisRes.status }
      );
    }

    const data = await analysisRes.json();
    const raw: string | undefined =
      data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!raw) {
      console.error(`Empty Gemma response (${usedModel}):`, data);
      return NextResponse.json({ error: "Tidak ada respons dari model." }, { status: 500 });
    }

    // ── Parse dengan robust extractor ───────────────────────────────────────
    const parsed = extractJSON(raw);

    if (!parsed) {
      console.error(`JSON extraction failed (${usedModel}). Raw (500 chars):`, raw.slice(0, 500));
      // Fallback: kembalikan transcript saja dengan array kosong
      return NextResponse.json({
        transcript,
        keyPoints: [],
        actionItems: [],
        followUpQuestions: [],
        _warning: "Model tidak menghasilkan JSON valid. Hanya transcript yang tersedia.",
      });
    }

    // ── Normalize fields ─────────────────────────────────────────────────────
    if (!parsed.transcript) parsed.transcript = transcript;
    if (!Array.isArray(parsed.keyPoints)) parsed.keyPoints = [];
    if (!Array.isArray(parsed.actionItems)) parsed.actionItems = [];
    if (!Array.isArray(parsed.followUpQuestions)) parsed.followUpQuestions = [];

    return NextResponse.json(parsed);

  } catch (err) {
    console.error("Audio route error:", err);
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}
