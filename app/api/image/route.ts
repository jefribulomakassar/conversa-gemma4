import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No image file provided." }, { status: 400 });
    }

    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
      return NextResponse.json({ error: "File terlalu besar. Maksimal 10MB." }, { status: 400 });
    }

    const allowed = ["image/jpeg", "image/png", "image/webp"];
    if (!allowed.includes(file.type)) {
      return NextResponse.json({ error: "Format tidak didukung. Gunakan JPG, PNG, atau WEBP." }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "API key tidak ditemukan." }, { status: 500 });
    }

    // Convert file to base64
    const arrayBuffer = await file.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");
    const mimeType = file.type;

    const payload = {
      model: "gemini-2.5-flash",
      contents: [
        {
          role: "user",
          parts: [
            {
              inline_data: {
                mime_type: mimeType,
                data: base64,
              },
            },
            {
              text: `You are an enterprise whiteboard and document image analyst. Carefully examine this image.

Return your response as a valid JSON object with exactly this structure:
{
  "extractedText": "All text visible in the image, transcribed verbatim and in order",
  "diagramDescription": "Description of any diagrams, charts, arrows, boxes, drawings, or visual structures present. Write 'No diagrams detected.' if none.",
  "structuredSummary": "A clear, professional summary of what this whiteboard or image contains and what topic or meeting it relates to",
  "nextSteps": ["Suggested next step 1", "Suggested next step 2", "Suggested next step 3"]
}

Rules:
- extractedText: transcribe every word visible, preserve structure (bullets, numbered lists, columns)
- diagramDescription: describe shapes, flows, connections, and their meaning
- structuredSummary: 2-4 sentences synthesizing the full content
- nextSteps: 3-5 actionable recommendations based on the content
- Return ONLY valid JSON, no markdown, no preamble`,
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 3000,
        responseMimeType: "application/json",
      },
    };

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );

    if (!response.ok) {
      const errData = await response.json();
      console.error("Gemma API error:", errData);
      return NextResponse.json(
        { error: errData?.error?.message || "Gemma API error." },
        { status: response.status }
      );
    }

    const data = await response.json();
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!raw) {
      return NextResponse.json({ error: "Tidak ada response dari model." }, { status: 500 });
    }

    const clean = raw.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);

    return NextResponse.json(parsed);
  } catch (err) {
    console.error("Image route error:", err);
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}
