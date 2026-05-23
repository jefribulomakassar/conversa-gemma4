import { NextRequest, NextResponse } from "next/server";

// Gemma 4 = model inti hackathon (analisis)
const ANALYSIS_MODEL = "google/gemma-4-26b-a4b-it:free";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

// Groq Whisper = transkripsi GRATIS
const GROQ_WHISPER_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const GROQ_WHISPER_MODEL = "whisper-large-v3-turbo"; // paling cepat & gratis

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
        { error: `Format tidak didukung: ${mimeType}` },
        { status: 400 }
      );

    const groqKey = process.env.GROQ_API_KEY;
    if (!groqKey)
      return NextResponse.json({ error: "GROQ_API_KEY tidak ditemukan." }, { status: 500 });

    const openrouterKey = process.env.OPENROUTER_API_KEY;
    if (!openrouterKey)
      return NextResponse.json({ error: "OPENROUTER_API_KEY tidak ditemukan." }, { status: 500 });

    // ── 2. Transkripsi via Groq Whisper (gratis, multipart FormData) ────────
    const whisperForm = new FormData();
    whisperForm.append("file", file);
    whisperForm.append("model", GROQ_WHISPER_MODEL);
    whisperForm.append("response_format", "json");
    // opsional: tambah language hint untuk akurasi lebih baik
    // whisperForm.append("language", "id"); // uncomment jika audio dominan Bahasa Indonesia

    const whisperRes = await fetch(GROQ_WHISPER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${groqKey}`,
      },
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

    // ── 3. Analisis transkrip via Gemma 4 (model inti hackathon) ────────────
    const analysisRes = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openrouterKey}`,
        "HTTP-Referer": process.env.NEXT_PUBLIC_SITE_URL || "https://localhost:3000",
        "X-Title": process.env.NEXT_PUBLIC_SITE_NAME || "Audio Agent",
      },
      body: JSON.stringify({
        model: ANALYSIS_MODEL,
        temperature: 0.2,
        max_tokens: 4096,
        stream: false,
        messages: [
          {
            role: "system",
            content:
              "You are an enterprise meeting intelligence assistant. " +
              "Always respond with ONLY a valid JSON object — no markdown, no backticks, no explanation.",
          },
          {
            role: "user",
            content: `Here is the transcript of an audio recording:

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
- Return ONLY the JSON object — no preamble, no markdown fences`,
          },
        ],
      }),
    });

    if (!analysisRes.ok) {
      const errData = await analysisRes.json().catch(() => ({}));
      const msg = errData?.error?.message || `OpenRouter error ${analysisRes.status}`;
      console.error("Gemma analysis error:", errData);

      if (analysisRes.status === 401)
        return NextResponse.json({ error: "API key tidak valid." }, { status: 401 });
      if (analysisRes.status === 402)
        return NextResponse.json({ error: "Kredit OpenRouter habis." }, { status: 402 });
      if (analysisRes.status === 429)
        return NextResponse.json({ error: "Rate limit. Coba lagi sebentar." }, { status: 429 });

      return NextResponse.json({ error: msg }, { status: analysisRes.status });
    }

    // ── 4. Parse response Gemma 4 ───────────────────────────────────────────
    const data = await analysisRes.json();
    const raw: string | undefined = data?.choices?.[0]?.message?.content;

    if (!raw) {
      console.error("Empty Gemma response:", data);
      return NextResponse.json({ error: "Tidak ada respons dari model." }, { status: 500 });
    }

    const clean = raw
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();

    const jsonMatch = clean.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error("No JSON in Gemma response:", clean.slice(0, 300));
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

    // ── 5. Normalize ────────────────────────────────────────────────────────
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
