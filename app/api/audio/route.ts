import { NextRequest, NextResponse } from "next/server";

const ANALYSIS_MODEL = "google/gemma-4-26b-a4b-it";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

const ALLOWED_AUDIO_TYPES = [
  "audio/mpeg", "audio/mp3", "audio/wav", "audio/wave",
  "audio/x-wav", "audio/mp4", "audio/m4a", "audio/x-m4a",
  "audio/ogg", "audio/webm", "audio/flac", "audio/aac",
];

const MIME_TO_FORMAT: Record<string, string> = {
  "audio/mpeg": "mp3", "audio/mp3": "mp3",
  "audio/wav": "wav", "audio/wave": "wav", "audio/x-wav": "wav",
  "audio/mp4": "mp4", "audio/m4a": "mp4", "audio/x-m4a": "mp4",
  "audio/ogg": "ogg",
  "audio/webm": "webm",
  "audio/flac": "flac",
  "audio/aac": "aac",
};

const HEADERS = (apiKey: string) => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${apiKey}`,
  "HTTP-Referer": process.env.NEXT_PUBLIC_SITE_URL || "https://localhost:3000",
  "X-Title": process.env.NEXT_PUBLIC_SITE_NAME || "Audio Agent",
});

export async function POST(req: NextRequest) {
  try {
    // ── 1. Parse form data ──────────────────────────────────────────────────
    const form = await req.formData();
    const file = form.get("file") as File | null;

    if (!file)
      return NextResponse.json({ error: "No audio file provided." }, { status: 400 });

    if (file.size > 20 * 1024 * 1024)
      return NextResponse.json({ error: "File terlalu besar. Maksimal 20MB." }, { status: 400 });

    const mimeType = file.type || "audio/mpeg";
    if (!ALLOWED_AUDIO_TYPES.includes(mimeType))
      return NextResponse.json(
        { error: `Format tidak didukung: ${mimeType}` },
        { status: 400 }
      );

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey)
      return NextResponse.json({ error: "OPENROUTER_API_KEY tidak ditemukan." }, { status: 500 });

    // ── 2. Encode audio ke base64 ───────────────────────────────────────────
    const arrayBuffer = await file.arrayBuffer();
    const base64Audio = Buffer.from(arrayBuffer).toString("base64");
    const audioFormat = MIME_TO_FORMAT[mimeType] ?? "mp3";

    // ── 3. Transkripsi via Whisper — pakai /chat/completions + input_audio ──
    //    Model audio-capable yang support input_audio: openai/gpt-4o-audio-preview
    //    Whisper-1 di OpenRouter hanya tersedia lewat /audio/transcriptions (multipart),
    //    fallback ke gpt-4o-audio-preview yang support input_audio content block.
    const whisperRes = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: HEADERS(apiKey),
      body: JSON.stringify({
        model: "openai/gpt-4o-audio-preview",
        max_tokens: 4096,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Please transcribe this audio file accurately. Return ONLY the transcription text, nothing else.",
              },
              {
                type: "input_audio",
                input_audio: {
                  data: base64Audio,
                  format: audioFormat,
                },
              },
            ],
          },
        ],
      }),
    });

    if (!whisperRes.ok) {
      const errData = await whisperRes.json().catch(() => ({}));
      console.error("Whisper/transcription error:", errData);
      return NextResponse.json(
        { error: errData?.error?.message || "Gagal mentranskripsi audio." },
        { status: whisperRes.status }
      );
    }

    const whisperData = await whisperRes.json();
    const transcript: string =
      whisperData?.choices?.[0]?.message?.content?.trim() ?? "";

    if (!transcript)
      return NextResponse.json(
        { error: "Transkripsi kosong. Pastikan audio berisi percakapan." },
        { status: 422 }
      );

    // ── 4. Analisis transkrip via Gemma 4 (model inti hackathon) ────────────
    const analysisRes = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: HEADERS(apiKey),
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

    // ── 5. Parse response Gemma 4 ───────────────────────────────────────────
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

    // ── 6. Normalize ────────────────────────────────────────────────────────
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
