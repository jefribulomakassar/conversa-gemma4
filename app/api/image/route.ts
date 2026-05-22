import { NextRequest, NextResponse } from "next/server";

const MODEL = "google/gemma-4-26b-a4b-it";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export async function POST(req: NextRequest) {
  try {
    // ── 1. Parse form data ──────────────────────────────────────────────────
    const form = await req.formData();
    const file = form.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No image file provided." }, { status: 400 });
    }

    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
      return NextResponse.json(
        { error: "File terlalu besar. Maksimal 10MB." },
        { status: 400 }
      );
    }

    const allowed = ["image/jpeg", "image/png", "image/webp"];
    if (!allowed.includes(file.type)) {
      return NextResponse.json(
        { error: "Format tidak didukung. Gunakan JPG, PNG, atau WEBP." },
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
    const dataUrl = `data:${file.type};base64,${base64}`;

    // ── 4. Build OpenRouter request (OpenAI-compatible format) ──────────────
    const payload = {
      model: MODEL,
      temperature: 0.2,
      max_tokens: 3000,
      messages: [
        {
          role: "system",
          content:
            "You are an enterprise whiteboard and document image analyst. " +
            "Always respond with ONLY a valid JSON object — no markdown, no backticks, no explanation.",
        },
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: dataUrl },
            },
            {
              type: "text",
              text: `Carefully examine this image and return a valid JSON object with EXACTLY this structure:
{
  "extractedText": "All text visible in the image, transcribed verbatim and in order",
  "diagramDescription": "Description of any diagrams, charts, arrows, boxes, drawings, or visual structures. Write 'No diagrams detected.' if none.",
  "structuredSummary": "A clear professional summary of what this whiteboard or image contains (2-4 sentences)",
  "nextSteps": ["Actionable step 1", "Actionable step 2", "Actionable step 3"]
}

Rules:
- extractedText: transcribe every visible word, preserve bullets/numbered lists/columns
- diagramDescription: describe shapes, flows, connections and their meaning
- structuredSummary: synthesize full content into 2-4 sentences
- nextSteps: 3-5 actionable recommendations based on the content
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
        "X-Title": process.env.NEXT_PUBLIC_SITE_NAME || "Whiteboard Analyzer",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      const msg = errData?.error?.message || `OpenRouter error ${response.status}`;
      console.error("OpenRouter API error:", errData);

      // Surface actionable messages
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

    // Extract JSON object even if there's surrounding text
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

    // ── 7. Validate expected fields ─────────────────────────────────────────
    const requiredFields = ["extractedText", "diagramDescription", "structuredSummary", "nextSteps"];
    for (const field of requiredFields) {
      if (!(field in parsed)) {
        parsed[field] = field === "nextSteps" ? [] : "Tidak tersedia.";
      }
    }

    // Ensure nextSteps is always an array
    if (!Array.isArray(parsed.nextSteps)) {
      parsed.nextSteps = [String(parsed.nextSteps)];
    }

    return NextResponse.json(parsed);

  } catch (err) {
    console.error("Image route error:", err);
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}
