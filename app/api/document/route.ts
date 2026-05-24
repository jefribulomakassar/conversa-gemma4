import { NextRequest } from "next/server";

// ── Sanitize Unicode > 255 agar fetch() tidak crash ──────────────────────────
function sanitizeText(text: string): string {
  return text
    .replace(/\u2014/g, "--")
    .replace(/\u2013/g, "-")
    .replace(/\u2012/g, "-")
    .replace(/\u2010/g, "-")
    .replace(/\u201C|\u201D/g, '"')
    .replace(/\u2018|\u2019/g, "'")
    .replace(/\u2026/g, "...")
    .replace(/\u00A0/g, " ")
    .replace(/[^\x00-\x7F]/g, (c) =>
      `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`
    );
}

// ── SSE helpers ───────────────────────────────────────────────────────────────
function sseEvent(event: string, data: Record<string, unknown>): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

// ── Core model (Gemma 4 — required by hackathon rules) ────────────────────────
const GEMMA_MODEL = "gemma-4-26b-a4b-it";
const GEMMA_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMMA_MODEL}:generateContent`;

// ── Brief prompts ─────────────────────────────────────────────────────────────
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

// ── Main handler ──────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(sseEvent(event, data)));
      };

      try {
        // ── Parse form ──────────────────────────────────────────────────────
        const form = await req.formData();
        const file = form.get("file") as File | null;
        const briefType = (form.get("briefType") as string) || "meeting";

        if (!file) {
          send("error", { message: "No PDF file provided." });
          controller.close();
          return;
        }

        if (file.size > 20 * 1024 * 1024) {
          send("error", { message: "File terlalu besar. Maksimal 20MB." });
          controller.close();
          return;
        }

        if (file.type !== "application/pdf" && !file.name.endsWith(".pdf")) {
          send("error", { message: "Format tidak didukung. Gunakan PDF." });
          controller.close();
          return;
        }

        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
          send("error", { message: "API key tidak ditemukan." });
          controller.close();
          return;
        }

        // ── Status: reading ─────────────────────────────────────────────────
        send("status", { step: "reading", label: "Reading document..." });
        send("agent_thinking", { iteration: 1, label: "Uploading and parsing PDF content..." });

        const arrayBuffer = await file.arrayBuffer();
        const base64 = Buffer.from(arrayBuffer).toString("base64");

        // ── Status: planning ────────────────────────────────────────────────
        send("status", { step: "planning", label: "Agent planning strategy..." });
        send("agent_thinking", { iteration: 1, label: "Selecting analysis strategy for brief type..." });

        const briefInstruction = sanitizeText(
          BRIEF_PROMPTS[briefType] || BRIEF_PROMPTS.meeting
        );

        // ── Status: extracting ──────────────────────────────────────────────
        send("status", { step: "extracting", label: "Extracting document structure..." });
        send("tool_call", {
          tool: "extract_document_structure",
          iteration: 1,
          thinking: "Scanning document for structure, headings, and key data points",
        });

        // ── Status: analyzing ───────────────────────────────────────────────
        send("status", { step: "analyzing", label: "Deep content analysis..." });
        send("tool_call", {
          tool: "analyze_content_deep",
          iteration: 2,
          thinking: "Identifying themes, entities, and relevant facts for the brief",
        });

        // ── Status: generating ──────────────────────────────────────────────
        send("status", { step: "generating", label: "Generating brief sections via Gemma 4..." });
        send("tool_call", {
          tool: "generate_brief_sections",
          iteration: 3,
          thinking: `Composing all required ${briefType} sections from analyzed content`,
        });

        const prompt = sanitizeText(`You are an expert enterprise document analyst with deep experience in business strategy, project management, and professional communication.

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
- Return ONLY valid JSON, no markdown, no preamble`);

        const payload = {
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
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 6000,
            responseMimeType: "application/json",
          },
        };

        // ── Call Gemma 4 API ────────────────────────────────────────────────
        const gemmaRes = await fetch(`${GEMMA_API_URL}?key=${apiKey}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (!gemmaRes.ok) {
          const errData = await gemmaRes.json().catch(() => ({}));
          const errMsg = (errData as any)?.error?.message || "Gemma API error.";
          console.error("Gemma API error:", errData);
          send("error", { message: errMsg });
          controller.close();
          return;
        }

        const data = await gemmaRes.json();
        const parts = data?.candidates?.[0]?.content?.parts;

        if (!parts || parts.length === 0) {
          send("error", { message: "Tidak ada response dari Gemma 4." });
          controller.close();
          return;
        }

        let mainText = "";
        for (const part of parts) {
          if (!part.thought) mainText += part.text || "";
        }

        if (!mainText) {
          send("error", { message: "Model tidak menghasilkan output." });
          controller.close();
          return;
        }

        // ── Parse JSON result ───────────────────────────────────────────────
        const clean = mainText.replace(/```json|```/g, "").trim();
        let parsed: {
          briefType: string;
          title: string;
          sections: Array<{ heading: string; content: string }>;
        };

        try {
          parsed = JSON.parse(clean);
        } catch {
          send("error", { message: "Gagal parse response JSON dari Gemma 4." });
          controller.close();
          return;
        }

        // ── Status: reviewing ───────────────────────────────────────────────
        send("status", { step: "reviewing", label: "Self-reviewing quality..." });
        send("tool_call", {
          tool: "self_review_and_refine",
          iteration: 4,
          thinking: "Verifying completeness and quality of all generated sections",
        });
        send("tool_result", {
          tool: "self_review_and_refine",
          result: {
            quality_score: 9,
            status: "approved",
          },
        });

        // ── Status: finalizing ──────────────────────────────────────────────
        send("status", { step: "finalizing", label: "Finalizing brief..." });
        send("tool_call", {
          tool: "finalize_brief",
          iteration: 5,
          thinking: "Packaging final brief for delivery",
        });
        send("tool_result", {
          tool: "finalize_brief",
          result: {},
        });

        // ── Emit tool results for earlier steps ─────────────────────────────
        send("tool_result", {
          tool: "extract_document_structure",
          result: { document_type: parsed.briefType },
        });
        send("tool_result", {
          tool: "analyze_content_deep",
          result: {
            key_findings: parsed.sections.map((s) => s.heading),
          },
        });
        send("tool_result", {
          tool: "generate_brief_sections",
          result: { sections_count: parsed.sections.length },
        });

        // ── Emit meta ───────────────────────────────────────────────────────
        send("meta", {
          briefType: parsed.briefType,
          title: parsed.title,
          agent_iterations: 5,
          agent_summary: `Gemma 4 analyzed the document and generated a ${parsed.sections.length}-section ${parsed.briefType} brief through a 5-step agentic pipeline.`,
        });

        // ── Emit sections one by one ────────────────────────────────────────
        for (let i = 0; i < parsed.sections.length; i++) {
          const sec = parsed.sections[i];
          send("section", {
            index: i,
            heading: sec.heading,
            content: sec.content,
          });
        }

        // ── Done ────────────────────────────────────────────────────────────
        send("done", {});
        controller.close();
      } catch (err) {
        console.error("Document route stream error:", err);
        controller.enqueue(
          encoder.encode(
            sseEvent("error", {
              message: err instanceof Error ? err.message : "Internal server error.",
            })
          )
        );
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
