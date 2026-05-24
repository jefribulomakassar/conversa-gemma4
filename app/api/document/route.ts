import { NextRequest } from "next/server";

// ── Model & Endpoint ─────────────────────────────────────────────────────────
const MODEL = "google/gemma-4-26b-a4b-it";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MAX_AGENT_ITERATIONS = 5;

// ── Tool Definitions ─────────────────────────────────────────────────────────
const AGENT_TOOLS = [
  {
    name: "extract_document_structure",
    description:
      "Extract the high-level structure of the document: title, document type, main topics, and approximate length. Always call this FIRST before any other tool.",
    parameters: {
      type: "object",
      properties: {
        reasoning: {
          type: "string",
          description: "Why you are calling this tool and what you expect to learn.",
        },
      },
      required: ["reasoning"],
    },
  },
  {
    name: "analyze_content_deep",
    description:
      "Perform a deep content analysis on the document to extract key facts, data, decisions, stakeholders, risks, and action items relevant to the requested brief type.",
    parameters: {
      type: "object",
      properties: {
        focus_areas: {
          type: "array",
          items: { type: "string" },
          description:
            "Specific aspects to focus on (e.g. ['timeline', 'budget', 'risks', 'stakeholders']).",
        },
        reasoning: {
          type: "string",
          description: "Why these focus areas are important for the brief.",
        },
      },
      required: ["focus_areas", "reasoning"],
    },
  },
  {
    name: "generate_brief_sections",
    description:
      "Generate the final structured brief based on document analysis findings. Call this after you have gathered enough context from previous tools.",
    parameters: {
      type: "object",
      properties: {
        brief_type: {
          type: "string",
          enum: ["meeting", "kickoff", "proposal", "interview", "sop"],
          description: "The type of brief to generate.",
        },
        sections_to_generate: {
          type: "array",
          items: {
            type: "object",
            properties: {
              heading: { type: "string" },
              instruction: {
                type: "string",
                description: "Specific instruction for what this section should contain.",
              },
            },
            required: ["heading", "instruction"],
          },
        },
        reasoning: {
          type: "string",
          description: "Why you chose these sections and this structure.",
        },
      },
      required: ["brief_type", "sections_to_generate", "reasoning"],
    },
  },
  {
    name: "self_review_and_refine",
    description:
      "Review the generated brief sections for quality, completeness, and accuracy. Identify any sections that need improvement and provide refined versions.",
    parameters: {
      type: "object",
      properties: {
        quality_check: {
          type: "object",
          properties: {
            is_complete: { type: "boolean" },
            missing_information: { type: "array", items: { type: "string" } },
            sections_needing_refinement: { type: "array", items: { type: "string" } },
            overall_quality_score: {
              type: "number",
              description: "Score from 0 to 10.",
            },
          },
          required: ["is_complete", "missing_information", "sections_needing_refinement", "overall_quality_score"],
        },
        refined_sections: {
          type: "array",
          items: {
            type: "object",
            properties: {
              heading: { type: "string" },
              content: { type: "string" },
            },
            required: ["heading", "content"],
          },
          description: "Refined or new sections to replace/add.",
        },
      },
      required: ["quality_check", "refined_sections"],
    },
  },
  {
    name: "finalize_brief",
    description:
      "Finalize and output the complete brief. Call this as the LAST tool when you are satisfied with the quality of all sections.",
    parameters: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "A concise, descriptive title for the brief.",
        },
        brief_type: { type: "string" },
        sections: {
          type: "array",
          items: {
            type: "object",
            properties: {
              heading: { type: "string" },
              content: { type: "string" },
            },
            required: ["heading", "content"],
          },
        },
        agent_summary: {
          type: "string",
          description: "A 1-2 sentence summary of how the agent processed this document and what it found most significant.",
        },
      },
      required: ["title", "brief_type", "sections", "agent_summary"],
    },
  },
];

// ── Brief Type Configs ────────────────────────────────────────────────────────
const BRIEF_CONFIGS: Record<string, { label: string; default_sections: string[] }> = {
  meeting: {
    label: "Meeting Brief",
    default_sections: [
      "Meeting Objective",
      "Agenda Items",
      "Key Discussion Points",
      "Critical Questions to Address",
      "Pre-meeting Preparation",
    ],
  },
  kickoff: {
    label: "Project Kickoff",
    default_sections: [
      "Project Overview & Goals",
      "Scope & Deliverables",
      "Roles & Responsibilities",
      "Milestones & Timeline",
      "Risks & Dependencies",
    ],
  },
  proposal: {
    label: "Client Proposal",
    default_sections: [
      "Executive Summary",
      "Problem Statement",
      "Proposed Solution",
      "Pricing Overview",
      "Next Steps & Call to Action",
    ],
  },
  interview: {
    label: "Interview Prep",
    default_sections: [
      "Role Overview",
      "Key Competencies to Assess",
      "Interview Questions",
      "Scoring Criteria",
      "Red Flags to Watch",
    ],
  },
  sop: {
    label: "SOP Generator",
    default_sections: [
      "Purpose & Scope",
      "Prerequisites & Requirements",
      "Step-by-Step Procedures",
      "Quality Checkpoints",
      "Troubleshooting & Escalation",
    ],
  },
};

// ── Utilities ────────────────────────────────────────────────────────────────
function encodeEvent(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  event: string,
  data: unknown
) {
  const line = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  controller.enqueue(encoder.encode(line));
}

function safeParseJSON(raw: string): Record<string, unknown> | null {
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

// ── Agent System Prompt ──────────────────────────────────────────────────────
function buildSystemPrompt(briefType: string): string {
  const config = BRIEF_CONFIGS[briefType] || BRIEF_CONFIGS.meeting;

  return `You are an elite AI Document Analysis Agent with deep expertise in enterprise communication, project management, and strategic analysis.

Your mission: Analyze a PDF document and produce a high-quality ${config.label} by autonomously using your available tools in a deliberate, multi-step reasoning process.

## Your Agentic Workflow (MANDATORY ORDER)

You MUST follow this exact sequence:
1. FIRST — Call \`extract_document_structure\` to understand what the document is about
2. SECOND — Call \`analyze_content_deep\` with relevant focus areas based on what you found
3. THIRD — Call \`generate_brief_sections\` to draft the brief based on your findings
4. FOURTH — Call \`self_review_and_refine\` to check quality and refine weak sections
5. FIFTH — Call \`finalize_brief\` ONLY when quality score >= 7

## Quality Standards

For ${config.label}, the expected sections are:
${config.default_sections.map((s, i) => `${i + 1}. ${s}`).join("\n")}

However, you may ADD sections if the document contains critical information that doesn't fit the defaults. You are an AGENT, not a template filler.

## Critical Rules
- NEVER skip the planning steps. Always call tools in order.
- Each tool call must have clear reasoning explaining WHY you are calling it.
- Content must be SPECIFIC to the document — no generic filler.
- If quality score < 7, you MUST refine before finalizing.
- Use professional, actionable language throughout.`;
}

// ── Gemma Tool-Call Executor (simulated via structured prompting) ──────────────
// OpenRouter/Gemma supports tool_choice natively, but for reliability
// we use structured JSON with explicit tool routing per iteration.
async function callAgentIteration(
  apiKey: string,
  messages: { role: string; content: unknown }[],
  base64PDF: string,
  siteUrl: string,
  siteName: string,
  iteration: number
): Promise<{ tool_name: string; tool_args: Record<string, unknown>; raw_text: string } | null> {
  // On first message, inject the PDF. On subsequent calls, reference it.
  const userContent =
    iteration === 0
      ? [
          {
            type: "image_url",
            image_url: { url: `data:application/pdf;base64,${base64PDF}` },
          },
          {
            type: "text",
            text: messages[messages.length - 1].content as string,
          },
        ]
      : messages[messages.length - 1].content;

  const augmentedMessages = [
    ...messages.slice(0, -1),
    { role: "user", content: userContent },
  ];

  // Build tool descriptions as JSON schema for the model
  const toolSchemaText = JSON.stringify(AGENT_TOOLS, null, 2);

  // Inject tool schema into system instruction for models that don't natively support tools
  const systemSuffix = `

## Available Tools (JSON Schema)
${toolSchemaText}

## RESPONSE FORMAT
Respond ONLY with a JSON object in exactly this format — no preamble, no explanation:
{
  "tool_call": {
    "name": "<tool_name>",
    "arguments": { <tool_arguments> }
  },
  "thinking": "<brief internal reasoning about why you chose this tool>"
}`;

  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": siteUrl,
      "X-Title": siteName,
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.3,
      max_tokens: 4000,
      messages: [
        {
          role: "system",
          content: augmentedMessages[0]?.role === "system"
            ? (augmentedMessages[0].content as string) + systemSuffix
            : systemSuffix,
        },
        ...augmentedMessages.filter((m) => m.role !== "system"),
      ],
    }),
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(
      errData?.error?.message || `OpenRouter error ${response.status}`
    );
  }

  const data = await response.json();
  const raw: string = data?.choices?.[0]?.message?.content || "";

  if (!raw) return null;

  const parsed = safeParseJSON(raw);
  if (!parsed || !parsed.tool_call) return null;

  const tc = parsed.tool_call as { name: string; arguments: Record<string, unknown> };
  return {
    tool_name: tc.name,
    tool_args: tc.arguments || {},
    raw_text: raw,
  };
}

// ── Main POST Handler ────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: string, data: unknown) =>
        encodeEvent(controller, encoder, event, data);

      try {
        // ── Parse form ──
        const form = await req.formData();
        const file = form.get("file") as File | null;
        const briefType = (form.get("briefType") as string) || "meeting";

        if (!file) {
          emit("error", { message: "No file provided." });
          controller.close();
          return;
        }

        if (file.size > 20 * 1024 * 1024) {
          emit("error", { message: "File too large. Maximum 20MB." });
          controller.close();
          return;
        }

        const apiKey = process.env.OPENROUTER_API_KEY;
        if (!apiKey) {
          emit("error", { message: "OPENROUTER_API_KEY not found." });
          controller.close();
          return;
        }

        const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://localhost:3000";
        const siteName = process.env.NEXT_PUBLIC_SITE_NAME || "Conversa AI — Document Agent";

        // ── Read file ──
        emit("status", { step: "reading", label: "Reading document…" });
        const arrayBuffer = await file.arrayBuffer();
        const base64 = Buffer.from(arrayBuffer).toString("base64");

        // ── Agent State ──
        const systemPrompt = buildSystemPrompt(briefType);
        const agentMessages: { role: string; content: unknown }[] = [
          { role: "system", content: systemPrompt },
        ];

        let draftSections: { heading: string; content: string }[] = [];
        let briefTitle = "Document Brief";
        let agentSummary = "";
        let finalBriefReady = false;
        let iterationCount = 0;

        // Initial user message
        const config = BRIEF_CONFIGS[briefType] || BRIEF_CONFIGS.meeting;
        agentMessages.push({
          role: "user",
          content: `Analyze the attached PDF document and generate a comprehensive ${config.label}. Follow your agentic workflow strictly. Start by extracting the document structure.`,
        });

        // ── AGENTIC LOOP ────────────────────────────────────────────────────
        emit("status", { step: "planning", label: "Agent planning analysis strategy…" });

        while (iterationCount < MAX_AGENT_ITERATIONS && !finalBriefReady) {
          iterationCount++;

          emit("agent_thinking", {
            iteration: iterationCount,
            label: `Agent iteration ${iterationCount}/${MAX_AGENT_ITERATIONS}…`,
          });

          await sleep(200);

          // Call agent for next tool decision
          let toolCall: {
            tool_name: string;
            tool_args: Record<string, unknown>;
            raw_text: string;
          } | null = null;

          try {
            toolCall = await callAgentIteration(
              apiKey,
              agentMessages,
              base64,
              siteUrl,
              siteName,
              iterationCount - 1
            );
          } catch (err) {
            const msg = err instanceof Error ? err.message : "Agent call failed";
            // Retry once
            await sleep(1000);
            try {
              toolCall = await callAgentIteration(
                apiKey,
                agentMessages,
                base64,
                siteUrl,
                siteName,
                iterationCount - 1
              );
            } catch {
              emit("error", { message: `Agent error on iteration ${iterationCount}: ${msg}` });
              controller.close();
              return;
            }
          }

          if (!toolCall) {
            // Agent didn't return a valid tool call — skip this iteration
            agentMessages.push({
              role: "assistant",
              content: "I need to continue my analysis.",
            });
            agentMessages.push({
              role: "user",
              content:
                "Continue with the next step in your workflow. Remember to return ONLY valid JSON with a tool_call.",
            });
            continue;
          }

          // Emit tool call event so frontend can show progress
          emit("tool_call", {
            tool: toolCall.tool_name,
            iteration: iterationCount,
            thinking: (safeParseJSON(toolCall.raw_text) as any)?.thinking || "",
          });

          // ── Tool Execution (simulated — agent processes its own PDF) ──────
          // Since Gemma 4 has vision + 256K context, the "tool result" is
          // the agent's next response after seeing the tool invocation.
          // We simulate tool execution by feeding the result back.

          let toolResult: Record<string, unknown> = {};

          switch (toolCall.tool_name) {
            case "extract_document_structure": {
              emit("status", {
                step: "extracting",
                label: "Extracting document structure…",
              });

              // Ask agent to actually do the extraction with the PDF in context
              const extractResponse = await fetch(OPENROUTER_URL, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${apiKey}`,
                  "HTTP-Referer": siteUrl,
                  "X-Title": siteName,
                },
                body: JSON.stringify({
                  model: MODEL,
                  temperature: 0.2,
                  max_tokens: 2000,
                  messages: [
                    {
                      role: "system",
                      content:
                        "You are a document structure extractor. Respond ONLY with valid JSON, no markdown.",
                    },
                    {
                      role: "user",
                      content: [
                        {
                          type: "image_url",
                          image_url: {
                            url: `data:application/pdf;base64,${base64}`,
                          },
                        },
                        {
                          type: "text",
                          text: `Extract the structure of this document and return a JSON with:
{
  "document_title": "...",
  "document_type": "...",
  "main_topics": ["..."],
  "estimated_pages": 0,
  "language": "...",
  "key_entities": ["people, companies, products mentioned"],
  "document_summary": "2-3 sentence summary"
}`,
                        },
                      ],
                    },
                  ],
                }),
              });

              const extractData = await extractResponse.json();
              const extractRaw =
                extractData?.choices?.[0]?.message?.content || "{}";
              toolResult = safeParseJSON(extractRaw) || {
                document_title: "Unknown",
                document_type: "General",
                main_topics: [],
                document_summary: "Document analyzed.",
              };

              emit("tool_result", {
                tool: "extract_document_structure",
                result: toolResult,
              });
              break;
            }

            case "analyze_content_deep": {
              const focusAreas = (toolCall.tool_args.focus_areas as string[]) || [];
              emit("status", {
                step: "analyzing",
                label: `Deep analysis: ${focusAreas.slice(0, 3).join(", ")}…`,
              });

              const analyzeResponse = await fetch(OPENROUTER_URL, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${apiKey}`,
                  "HTTP-Referer": siteUrl,
                  "X-Title": siteName,
                },
                body: JSON.stringify({
                  model: MODEL,
                  temperature: 0.2,
                  max_tokens: 3000,
                  messages: [
                    {
                      role: "system",
                      content:
                        "You are a deep content analyst. Respond ONLY with valid JSON, no markdown.",
                    },
                    {
                      role: "user",
                      content: [
                        {
                          type: "image_url",
                          image_url: {
                            url: `data:application/pdf;base64,${base64}`,
                          },
                        },
                        {
                          type: "text",
                          text: `Perform a deep analysis of this document focusing on: ${focusAreas.join(", ")}.

Return a JSON with:
{
  "key_findings": ["specific findings from the document"],
  "data_points": ["specific numbers, dates, metrics found"],
  "stakeholders": ["people/organizations involved"],
  "action_items": ["concrete next steps or tasks identified"],
  "risks": ["risks or challenges identified"],
  "decisions": ["decisions made or required"],
  "context": "additional relevant context"
}`,
                        },
                      ],
                    },
                  ],
                }),
              });

              const analyzeData = await analyzeResponse.json();
              const analyzeRaw =
                analyzeData?.choices?.[0]?.message?.content || "{}";
              toolResult = safeParseJSON(analyzeRaw) || {
                key_findings: [],
                action_items: [],
                context: "Analysis complete.",
              };

              emit("tool_result", {
                tool: "analyze_content_deep",
                result: toolResult,
              });
              break;
            }

            case "generate_brief_sections": {
              const sectionsToGen =
                (toolCall.tool_args.sections_to_generate as Array<{
                  heading: string;
                  instruction: string;
                }>) || [];

              emit("status", {
                step: "generating",
                label: "Generating brief sections…",
              });

              // Generate all sections in a single call for efficiency
              const sectionPrompts = sectionsToGen
                .map(
                  (s, i) =>
                    `Section ${i + 1}: "${s.heading}" — ${s.instruction}`
                )
                .join("\n");

              const generateResponse = await fetch(OPENROUTER_URL, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${apiKey}`,
                  "HTTP-Referer": siteUrl,
                  "X-Title": siteName,
                },
                body: JSON.stringify({
                  model: MODEL,
                  temperature: 0.4,
                  max_tokens: 5000,
                  messages: [
                    {
                      role: "system",
                      content:
                        "You are an expert brief writer. Respond ONLY with valid JSON, no markdown.",
                    },
                    {
                      role: "user",
                      content: [
                        {
                          type: "image_url",
                          image_url: {
                            url: `data:application/pdf;base64,${base64}`,
                          },
                        },
                        {
                          type: "text",
                          text: `Based on the document, generate the following brief sections with detailed, document-specific content:

${sectionPrompts}

Return a JSON with:
{
  "sections": [
    { "heading": "...", "content": "detailed content here..." }
  ]
}

Each section must be specific to the document content — no generic filler.`,
                        },
                      ],
                    },
                  ],
                }),
              });

              const generateData = await generateResponse.json();
              const generateRaw =
                generateData?.choices?.[0]?.message?.content || "{}";
              const generateParsed = safeParseJSON(generateRaw) as {
                sections?: { heading: string; content: string }[];
              } | null;

              draftSections = generateParsed?.sections || [];
              toolResult = { sections_count: draftSections.length, status: "draft_ready" };

              // Stream sections progressively as they're ready
              emit("meta", {
                briefType: toolCall.tool_args.brief_type || briefType,
                title: briefTitle,
              });

              for (let i = 0; i < draftSections.length; i++) {
                emit("section_draft", {
                  index: i,
                  heading: draftSections[i].heading,
                  content: draftSections[i].content,
                });
                await sleep(80);
              }

              emit("tool_result", {
                tool: "generate_brief_sections",
                result: toolResult,
              });
              break;
            }

            case "self_review_and_refine": {
              emit("status", {
                step: "reviewing",
                label: "Agent self-reviewing brief quality…",
              });

              const qc = toolCall.tool_args.quality_check as {
                is_complete: boolean;
                quality_score?: number;
                overall_quality_score?: number;
                sections_needing_refinement?: string[];
                missing_information?: string[];
              };

              const qualityScore =
                qc?.overall_quality_score || qc?.quality_score || 7;
              const refinedSections =
                (toolCall.tool_args.refined_sections as {
                  heading: string;
                  content: string;
                }[]) || [];

              // Merge refined sections into draft
              if (refinedSections.length > 0) {
                for (const refined of refinedSections) {
                  const idx = draftSections.findIndex(
                    (s) =>
                      s.heading.toLowerCase() === refined.heading.toLowerCase()
                  );
                  if (idx >= 0) {
                    draftSections[idx] = refined;
                  } else {
                    draftSections.push(refined);
                  }
                }
              }

              toolResult = {
                quality_score: qualityScore,
                refined_count: refinedSections.length,
                status: qualityScore >= 7 ? "quality_approved" : "needs_improvement",
              };

              emit("tool_result", {
                tool: "self_review_and_refine",
                result: toolResult,
              });
              break;
            }

            case "finalize_brief": {
              emit("status", {
                step: "finalizing",
                label: "Finalizing brief…",
              });

              const finalSections =
                (toolCall.tool_args.sections as {
                  heading: string;
                  content: string;
                }[]) || draftSections;

              briefTitle =
                (toolCall.tool_args.title as string) || "Document Brief";
              agentSummary =
                (toolCall.tool_args.agent_summary as string) || "";

              // Use finalize sections if better than draft
              if (finalSections.length > 0) {
                draftSections = finalSections;
              }

              toolResult = { status: "finalized" };
              finalBriefReady = true;

              emit("tool_result", {
                tool: "finalize_brief",
                result: toolResult,
              });
              break;
            }

            default:
              toolResult = { error: "Unknown tool" };
          }

          // Feed tool result back into agent conversation
          agentMessages.push({
            role: "assistant",
            content: JSON.stringify({ tool_call: { name: toolCall.tool_name, arguments: toolCall.tool_args } }),
          });
          agentMessages.push({
            role: "user",
            content: `Tool "${toolCall.tool_name}" executed successfully. Result: ${JSON.stringify(toolResult)}. 
            
Continue with the next step in your workflow. ${
              finalBriefReady
                ? ""
                : `Remember to eventually call "finalize_brief" when quality is good enough.`
            }`,
          });

          await sleep(150);
        }

        // ── Emit Final Result ────────────────────────────────────────────────
        if (draftSections.length === 0) {
          emit("error", { message: "Agent could not generate brief sections. Please try again." });
          controller.close();
          return;
        }

        emit("meta", {
          briefType,
          title: briefTitle,
          agent_iterations: iterationCount,
          agent_summary: agentSummary,
        });

        for (let i = 0; i < draftSections.length; i++) {
          emit("section", {
            index: i,
            heading: draftSections[i].heading,
            content: draftSections[i].content,
          });
          await sleep(100);
        }

        emit("done", {
          iterations: iterationCount,
          sections_count: draftSections.length,
        });

        controller.close();
      } catch (err) {
        console.error("Document Agent error:", err);
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
