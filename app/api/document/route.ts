import { NextRequest, NextResponse } from "next/server";

const MODEL = "google/gemma-4-26b-a4b-it";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

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
    // ── 1. Parse form data ──────────────────────────────────────────────────
    const form = await req.formData();
    const file = form.get("file") as File | null;
    const briefType = (form.get("briefType") as string) || "meeting";
    // NOTE: "thinking" mode removed — thinkingConfig is Gemini-only, not supported by Gemma 4

    if (!file) {
      return NextResponse.json({ error: "No PDF file provided." }, { status: 400 });
    }

    const maxSize = 20 * 1024 * 1024; // 20MB
    if (file.size > maxSize) {
      return NextResponse.json(
        { error: "File terlalu besar. Maksimal 20MB." },
        { status: 400 }
      );
    }

    if (file.type !== "application/pdf" && !file.name.endsWith(".pdf")) {
      return NextResponse.json(
        { error: "Format tidak didukung. Gunakan PDF." },
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

    // ── 3. Convert PDF to base64 ────────────────────────────────────────────
    const arrayBuffer = await file.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");

    const briefInstruction = BRIEF_PROMPTS[briefType] || BRIEF_PROMPTS.meeting;

    const promptText = `You are an expert enterprise document analyst with deep experience in business strategy, project management, and professional communication.

Carefully read and analyze the entire PDF document provided.

${briefInstruction}

Return a valid JSON object with EXACTLY this structure:
{
  "briefType": "${briefType}",
  "title": "A concise descriptive title based on the document content",
  "sections": [
    {
      "heading": "Section Heading",
      "content": "Full professional content for this section"
    }
  ]
}

Rules:
- title: specific and descriptive (e.g. "Q3 Product Roadmap Kickoff" not just "Kickoff Brief")
- sections: include ALL sections listed above, in order
- content: detailed, actionable, and based strictly on the document
- Write in clear professional English
- Return ONLY the JSON object — no preamble, no markdown fences`;

    // ── 4. Build OpenRouter request ─────────────────────────────────────────
    // OpenRouter supports PDF via base64 document type in content array
    const payload = {
      model: MODEL,
      temperature: 0.3,
      max_tokens: 6000,
      messages: [
        {
          role: "system",
          content:
            "You are an expert enterprise document analyst. " +
            "Always respond with ONLY a valid JSON object — no markdown, no backticks, no explanation.",
        },
        {
          role: "user",
          content: [
            {
              // OpenRouter: PDF as base64 document
              type: "image_url",
              image_url: {
                url: `data:application/pdf;base64,${base64}`,
              },
            },
            {
              type: "text",
              text: promptText,
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
        "X-Title": process.env.NEXT_PUBLIC_SITE_NAME || "Document Agent",
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
    if (!parsed.briefType) parsed.briefType = briefType;
    if (!parsed.title) parsed.title = "Document Brief";
    if (!Array.isArray(parsed.sections)) parsed.sections = [];

    return NextResponse.json(parsed);
  } catch (err) {
    console.error("Document route error:", err);
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}
