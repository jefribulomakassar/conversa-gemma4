import { NextRequest, NextResponse } from "next/server";

const MODEL = "google/gemma-4-26b-a4b-it";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

const ALLOWED_AUDIO_TYPES = [
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/wave",
  "audio/x-wav",
  "audio/mp4",
  "audio/m4a",
  "audio/x-m4a",
  "audio/ogg",
  "audio/webm",
  "audio/flac",
  "audio/aac",
];

export async function POST(req: NextRequest) {
  try {
    // ── 1. Parse form data ──────────────────────────────────────────────────
    const form = await req.formData();
    const file = form.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No audio file provided." }, { status: 400 });
    }

    const maxSize = 20 * 1024 * 1024; // 20MB
    if (file.size > maxSize) {
      return NextResponse.json(
        { error: "File terlalu besar. Maksimal 20MB." },
        { status: 400 }
      );
    }

    const mimeType = file.type || "audio/mpeg";
    if (!ALLOWED_AUDIO_TYPES.includes(mimeType)) {
      return NextResponse.json(
        { error: `Format audio tidak didukung: ${mimeType}. Gunakan MP3, WAV, M4A, OGG, atau FLAC.` },
        { status: 400 }
      );
    }

    // ── 2. Check API key ────────────────────────────────────────────────────
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "OPENROUTER_API_KEY tidak ditemukan." },
        { status: 500 }
      );
    }

    // ── 3. Convert to base64 data URL ───────────────────────────────────────
    const arrayBuffer = await file.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");
    const dataUrl = `data:${mimeType};base64,${base64}`;

    // ── 4. Build OpenRouter request ─────────────────────────────────────────
    const payload = {
      model: MODEL,
      temperature: 0.2,
      max_tokens: 4096,
      messages: [
        {
          role: "system",
          content:
            "You are an enterprise meeting intelligence assistant. " +
            "Always respond with ONLY a valid JSON object — no markdown, no backticks, no explanation.",
        },
        {
          role: "user",
          content: [
            {
              type: "image_url", // OpenRouter uses image_url for audio data URLs too
              image_url: { url: dataUrl },
            },
            {
              type: "text",
              text: `Analyze this audio recording carefully and return a valid JSON object with EXACTLY this structure:
{
  "transcript": "Full verbatim transcript of the audio",
  "keyPoints": ["Key point 1", "Key point 2", "Key point 3"],
  "actionItems": ["Action item with owner 1", "Action item with owner 2"],
  "followUpQuestions": ["Follow-up question 1", "Follow-up question 2"]
}

Rules:
- transcript: complete word-for-word transcription of everything spoken
- keyPoints: 3-6 most important discussion points from the audio
- actionItems: concrete tasks with responsible person if mentioned
- followUpQuestions: 2-4 questions that should be addressed after this meeting
- Return ONLY the JSON object — no preamble, no markdown fences`,
            },
          ],
        },
      ],
    };

    // ── 5. Call OpenRouter ──────────────────────────────────────────────────
    const response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": process.env.NEXT_PUBLIC_SITE_URL || "https://localhost:3000",
        "X-Title": process.env.NEXT_PUBLIC_SITE_NAME || "Audio Agent",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      const msg = errData?.error?.message || `OpenRouter error ${response.status}`;
      console.error("OpenRouter API error:", errData);

      if (response.status === 401) {
        return NextResponse.json(
          { error: "API key tidak valid. Periksa OPENROUTER_API_KEY Anda." },
          { status: 401 }
        );
      }
      if (response.status === 402) {
        return NextResponse.json(
          { error: "Kredit OpenRouter habis. Silakan top up akun Anda." },
          { status: 402 }
        );
      }
      if (response.status === 429) {
        return NextResponse.json(
          { error: "Rate limit tercapai. Coba lagi sebentar." },
          { status: 429 }
        );
      }

      return NextResponse.json({ error: msg }, { status: response.status });
    }

    // ── 6. Parse model response ─────────────────────────────────────────────
    const data = await response.json();
    const raw: string | undefined = data?.choices?.[0]?.message?.content;

    if (!raw) {
      console.error("Empty model response:", data);
      return NextResponse.json(
        { error: "Tidak ada respons dari model." },
        { status: 500 }
      );
    }

    // Strip markdown fences if model disobeys system prompt
    const clean = raw
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();

    const jsonMatch = clean.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error("No JSON in model response:", clean.slice(0, 300));
      return NextResponse.json(
        { error: "Model tidak menghasilkan JSON yang valid. Coba lagi." },
        { status: 500 }
      );
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch (parseErr) {
      console.error("JSON parse failed:", parseErr, jsonMatch[0].slice(0, 300));
      return NextResponse.json(
        { error: "Gagal mem-parse JSON dari model. Coba lagi." },
        { status: 500 }
      );
    }

    // ── 7. Validate & normalize fields ──────────────────────────────────────
    if (!parsed.transcript) parsed.transcript = "Transkrip tidak tersedia.";
    if (!Array.isArray(parsed.keyPoints)) parsed.keyPoints = [];
    if (!Array.isArray(parsed.actionItems)) parsed.actionItems = [];
    if (!Array.isArray(parsed.followUpQuestions)) parsed.followUpQuestions = [];

    return NextResponse.json(parsed);
  } catch (err) {
    console.error("Audio route error:", err);
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}
