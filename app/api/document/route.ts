import { NextRequest } from "next/server";

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

function encodeEvent(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  event: string,
  data: unknown
) {
  const line = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  controller.enqueue(encoder.encode(line));
}

function extractJSON(raw: string): Record<string, unknown> | null {
  const clean = raw
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/gi, "")
    .trim();

  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;

  const candidate = clean.slice(start, end + 1);

  try {
    return JSON.parse(candidate);
  } catch {
    let pos = candidate.lastIndexOf("}");
    while (pos > 0) {
      try {
        return JSON.parse(candidate.slice(0, pos + 1));
      } catch {
        pos = candidate.lastIndexOf("}", pos - 1);
      }
    }
    return null;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function POST(req: NextRequest) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: string, data: unknown) =>
        encodeEvent(controller, encoder, event, data);

      try {
        const form = await req.formData();
        const file = form.get("file") as File | null;
        const briefType = (form.get("briefType") as string) || "meeting";

        if (!file) {
          emit("error", { message: "No file provided." });
          controller.close();
          return;
        }

        // Validasi ukuran — kompresi/konversi sudah dilakukan di client
        // sehingga file yang tiba di sini selalu PDF dan sudah di bawah batas
        if (file.size > 20 * 1024 * 1024) {
          emit("error", { message: "File still too large after compression. Maximum 20MB." });
          controller.close();
          return;
        }

        const apiKey = process.env.OPENROUTER_API_KEY;
        if (!apiKey) {
          emit("error", { message: "OPENROUTER_API_KEY not found." });
          controller.close();
          return;
        }

        emit("status", { step: "reading" });
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

        emit("status", { step: "analyzing" });

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
                  type: "image_url",
                  image_url: { url: `data:application/pdf;base64,${base64}` },
                },
                { type: "text", text: promptText },
              ],
            },
          ],
        };

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
          const statusMessages: Record<number, string> = {
            401: "Invalid API key. Check your OPENROUTER_API_KEY.",
            402: "OpenRouter credit is depleted. Please top up your account.",
            429: "Rate limit reached. Please try again shortly.",
          };
          const msg =
            statusMessages[response.status] ||
            errData?.error?.message ||
            `OpenRouter error ${response.status}`;
          emit("error", { message: msg });
          controller.close();
          return;
        }

        emit("status", { step: "parsing" });

        const data = await response.json();
        const raw: string | undefined = data?.choices?.[0]?.message?.content;

        if (!raw) {
          emit("error", { message: "No response from the model." });
          controller.close();
          return;
        }

        const parsed = extractJSON(raw);

        if (!parsed) {
          console.error("JSON extraction failed. Raw:", raw.slice(0, 300));
          emit("error", { message: "The model did not produce valid JSON. Please try again." });
          controller.close();
          return;
        }

        if (!parsed.briefType) parsed.briefType = briefType;
        if (!parsed.title) parsed.title = "Document Brief";
        if (!Array.isArray(parsed.sections)) parsed.sections = [];

        emit("meta", { briefType: parsed.briefType, title: parsed.title });
        await sleep(80);

        const sections = parsed.sections as { heading: string; content: string }[];
        for (const section of sections) {
          emit("section", { heading: section.heading, content: section.content });
          await sleep(100);
        }

        emit("done", {});
        controller.close();
      } catch (err) {
        console.error("Document route error:", err);
        const msg = err instanceof Error ? err.message : "Internal server error.";
        encodeEvent(controller, encoder, "error", { message: msg });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
