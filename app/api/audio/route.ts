import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No audio file provided." }, { status: 400 });
    }

    const maxSize = 20 * 1024 * 1024; // 20MB
    if (file.size > maxSize) {
      return NextResponse.json({ error: "File terlalu besar. Maksimal 20MB." }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "API key tidak ditemukan." }, { status: 500 });
    }

    // Convert file to base64
    const arrayBuffer = await file.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");
    const mimeType = file.type || "audio/mpeg";

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
              text: `You are an enterprise meeting intelligence assistant. Analyze this audio recording carefully.

Return your response as a valid JSON object with exactly this structure:
{
  "transcript": "Full verbatim transcript of the audio",
  "keyPoints": ["Key point 1", "Key point 2", "Key point 3"],
  "actionItems": ["Action item with owner 1", "Action item with owner 2"],
  "followUpQuestions": ["Follow-up question 1", "Follow-up question 2"]
}

Rules:
- transcript: complete word-for-word transcription
- keyPoints: 3-6 most important discussion points
- actionItems: concrete tasks with responsible person if mentioned
- followUpQuestions: 2-4 questions that should be addressed after this meeting
- Return ONLY valid JSON, no markdown, no preamble`,
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 4096,
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

    // Strip markdown fences if any
    const clean = raw.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);

    return NextResponse.json(parsed);
  } catch (err) {
    console.error("Audio route error:", err);
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}
