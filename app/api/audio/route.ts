import { NextRequest, NextResponse } from "next/server";

// Gemma 4 via Google AI Studio (free, stabil)
const GOOGLE_AI_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const GEMMA_MODELS = [
  "gemma-4-27b-it",   // Gemma 4 31B (nama model di AI Studio)
  "gemma-4-12b-it",   // fallback lebih kecil, faster
];

// Groq Whisper — transkripsi gratis
const GROQ_WHISPER_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const GROQ_WHISPER_MODEL = "whisper-large-v3-turbo";

const ALLOWED_AUDIO_TYPES = [
  "audio/mpeg", "audio/mp3", "audio/wav", "audio/wave",
  "audio/x-wav", "audio/mp4", "audio/m4a", "audio/x-m4a",
  "audio/ogg", "audio/webm", "audio/flac", "audio/aac",
];

export async function POST(req: NextRequest) {
  try {
    // ── 1. Parse form data ──────────────────────────────────────────────────
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

    // ── 2. Transkripsi via Groq Whisper (gratis) ────────────────────────────
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
      console.error("Groq Whisper error:", errData);
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

    // ── 3. Analisis via Gemma 4 — Google AI Studio (fallback antar model) ───
    const prompt = `You are an enterprise meeting intelligence assistant.
Always respond with ONLY a valid JSON object — no markdown, no backticks, no explanation.

Here is the transcript of an audio recording:

---
${transcript}
---

Analyze this transcript and return a valid JSON object with EXACTLY this structure:
{
  "transcript": "The full transcript as provided above",
  "keyPoints": ["Key point 1", "Key point 2", "Key point 3"],
  "actionItems": ["Action item with owner 1", "Action item with owner 2"],
  "followUpQuestions": ["Follow-up question 1", "Follow-up question 2"]
}

Rules:
- transcript: copy the full transcript verbatim
- keyPoints: 3-6 most important discussion points
- actionItems: concrete tasks with responsible person if mentioned
- followUpQuestions: 2-4 questions to address after this meeting
- Return ONLY the JSON object — no preamble, no markdown fences`;

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
            temperature: 0.2,
            maxOutputTokens: 4096,
          },
        }),
      });

      // 429 = rate limit, coba model berikutnya
      if (res.status === 429) {
        console.warn(`Rate limit on ${model}, trying next...`);
        continue;
      }

      analysisRes = res;
      usedModel = model;
      break;
    }

    if (!analysisRes) {
      return NextResponse.json(
        { error: "Semua model Gemma 4 sedang rate limit. Coba lagi dalam 1 menit." },
        { status: 429 }
      );
    }

    if (!analysisRes.ok) {
      const errData = await analysisRes.json().catch(() => ({}));
      const msg = errData?.error?.message || `Google AI error ${analysisRes.status}`;
      console.error(`Gemma error (${usedModel}):`, errData);
      return NextResponse.json({ error: msg }, { status: analysisRes.status });
    }

    // ── 4. Parse response Google AI Studio ─────────────────────────────────
    const data = await analysisRes.json();
    const raw: string | undefined =
      data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!raw) {
      console.error(`Empty Gemma response (${usedModel}):`, data);
      return NextResponse.json({ error: "Tidak ada respons dari model." }, { status: 500 });
    }

    const clean = raw
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();

    const jsonMatch = clean.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error(`No JSON in response (${usedModel}):`, clean.slice(0, 300));
      return NextResponse.json(
        { error: "Model tidak menghasilkan JSON valid. Coba lagi." },
        { status: 500 }
      );
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      return NextResponse.json({ error: "Gagal parse JSON dari model." }, { status: 500 });
    }

    // ── 5. Normalize fields ─────────────────────────────────────────────────
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
