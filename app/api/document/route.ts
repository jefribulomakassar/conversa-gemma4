import { NextRequest, NextResponse } from "next/server";

const BRIEF_PROMPTS: Record<string, string> = {
  meeting: `Generate a Meeting Brief with these sections:
- Meeting Objective
- Agenda Items
- Key Discussion Points
- Critical Questions to Address
- Pre-meeting Preparation`,

  kickoff: `Generate a Project Kickoff Brief with these sections:
- Project Overview & Goals
- Scope & Deliverables
- Roles & Responsibilities
- Milestones & Timeline
- Risks & Dependencies`,

  proposal: `Generate a Client Proposal Draft with these sections:
- Executive Summary
- Problem Statement
- Proposed Solution
- Pricing Overview
- Next Steps & Call to Action`,

  interview: `Generate an Interview Prep Sheet with these sections:
- Role Overview
- Key Competencies to Assess
- Interview Questions
- Scoring Criteria
- Red Flags to Watch`,

  sop: `Generate a Standard Operating Procedure (SOP) with these sections:
- Purpose & Scope
- Prerequisites & Requirements
- Step-by-Step Procedures
- Quality Checkpoints
- Troubleshooting & Escalation`,
};

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file") as File | null;
    const briefType = (form.get("briefType") as string) || "meeting";
    const thinking = form.get("thinking") === "true";

    if (!file) {
      return NextResponse.json({ error: "No PDF file provided." }, { status: 400 });
    }

    const maxSize = 20 * 1024 * 1024; // 20MB
    if (file.size > maxSize) {
      return NextResponse.json({ error: "File terlalu besar. Maksimal 20MB." }, { status: 400 });
    }

    if (file.type !== "application/pdf" && !file.name.endsWith(".pdf")) {
      return NextResponse.json({ error: "Format tidak didukung. Gunakan PDF." }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "API key tidak ditemukan." }, { status: 500 });
    }

    // Convert PDF to base64
    const arrayBuffer = await file.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");

    const briefInstruction = BRIEF_PROMPTS[briefType] || BRIEF_PROMPTS.meeting;

    const prompt = `You are an expert enterprise document analyst with deep experience in business strategy, project management, and professional communication.

Carefully read and analyze the entire document provided.

${briefInstruction}

Return your response as a valid JSON object with exactly this structure:
{
  "briefType": "${briefType}",
  "title": "A concise, descriptive title for this brief based on the document content",
  "sections": [
    {
      "heading": "Section Heading",
      "content": "Full content for this section, well-written and professional"
    }
  ]
}

Rules:
- title: specific and descriptive, not generic (e.g. "Q3 Product Roadmap Kickoff" not just "Kickoff Brief")
- sections: include ALL sections listed above, in order
- content: each section should be detailed, actionable, and based strictly on the document
- Write in clear professional English
- Return ONLY valid JSON, no markdown, no preamble`;

    const generationConfig: Record<string, unknown> = {
      temperature: thinking ? 0.1 : 0.3,
      maxOutputTokens: 6000,
      responseMimeType: "application/json",
    };

    if (thinking) {
      generationConfig.thinkingConfig = {
        thinkingBudget: -1, // dynamic thinking
        includeThoughts: true,
      };
    }

    const payload = {
      model: "gemini-2.5-flash",
      contents: [
        {
          role: "user",
          parts: [
            {
              inline_data: {
                mime_type: "application/pdf",
                data: base64,
              },
            },
            { text: prompt },
          ],
        },
      ],
      generationConfig,
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
    const parts = data?.candidates?.[0]?.content?.parts;

    if (!parts || parts.length === 0) {
      return NextResponse.json({ error: "Tidak ada response dari model." }, { status: 500 });
    }

    // Separate thinking trace from main response
    let thinkingText = "";
    let mainText = "";

    for (const part of parts) {
      if (part.thought === true) {
        thinkingText += part.text || "";
      } else {
        mainText += part.text || "";
      }
    }

    if (!mainText) {
      return NextResponse.json({ error: "Model tidak menghasilkan output." }, { status: 500 });
    }

    const clean = mainText.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);

    // Attach thinking trace if available
    if (thinkingText) {
      parsed.thinking = thinkingText;
    }

    return NextResponse.json(parsed);
  } catch (err) {
    console.error("Document route error:", err);
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}
