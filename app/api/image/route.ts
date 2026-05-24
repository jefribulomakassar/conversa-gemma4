import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = "google/gemma-4-26b-a4b-it";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

// ── Image type configs — output fields adapt per type ────────────────────────
const IMAGE_TYPE_CONFIGS: Record<string, {
  label: string;
  icon: string;
  fields: { key: string; heading: string; icon: string; instruction: string }[];
}> = {
  whiteboard: {
    label: "Whiteboard / Blackboard",
    icon: "🖊️",
    fields: [
      { key: "extractedText",      heading: "Extracted Text",           icon: "🔤", instruction: "Transcribe ALL text visible, preserve bullets/lists/columns." },
      { key: "diagramDescription", heading: "Diagrams & Visual Flow",   icon: "📐", instruction: "Describe all drawn shapes, arrows, boxes, connections and their meaning." },
      { key: "structuredSummary",  heading: "Structured Summary",       icon: "📋", instruction: "Synthesize the full whiteboard content into 3-5 clear sentences." },
      { key: "nextSteps",          heading: "Suggested Next Steps",     icon: "🚀", instruction: "Provide 3-5 concrete actionable steps based on what's written.", isList: true },
    ],
  },
  diagram: {
    label: "Diagram / Flowchart / Architecture",
    icon: "🗂️",
    fields: [
      { key: "diagramType",        heading: "Diagram Type & Purpose",   icon: "🗂️", instruction: "Identify the type of diagram (flowchart, ERD, architecture, etc.) and its purpose." },
      { key: "componentsAndFlow",  heading: "Components & Flow",        icon: "🔗", instruction: "List all components, nodes, entities and describe how they connect or flow." },
      { key: "extractedText",      heading: "Labels & Text",            icon: "🔤", instruction: "Extract all labels, annotations, and text visible in the diagram." },
      { key: "structuredSummary",  heading: "What This Diagram Shows",  icon: "📋", instruction: "Explain in plain language what this diagram represents overall." },
      { key: "nextSteps",          heading: "Observations & Recommendations", icon: "💡", instruction: "Provide 3-4 observations or improvement suggestions for this diagram.", isList: true },
    ],
  },
  screenshot: {
    label: "Screenshot / UI / App",
    icon: "🖥️",
    fields: [
      { key: "uiDescription",      heading: "UI Description",           icon: "🖥️", instruction: "Describe what application/website this is and what the screen shows." },
      { key: "extractedText",      heading: "Visible Text & Data",      icon: "🔤", instruction: "Extract all visible text, labels, values, and data on screen." },
      { key: "userFlowContext",    heading: "User Flow & Context",      icon: "🔄", instruction: "Explain what the user is doing or what state the app is in." },
      { key: "nextSteps",          heading: "Issues & Recommendations", icon: "🚀", instruction: "List any visible errors, UX issues, or suggested improvements.", isList: true },
    ],
  },
  document: {
    label: "Document / Form / Report",
    icon: "📄",
    fields: [
      { key: "documentType",       heading: "Document Type",            icon: "📄", instruction: "Identify what kind of document this is (invoice, form, report, letter, etc.)." },
      { key: "extractedText",      heading: "Full Text Content",        icon: "🔤", instruction: "Transcribe all text content as completely as possible." },
      { key: "keyInformation",     heading: "Key Information",          icon: "🗝️", instruction: "Extract the most important facts, figures, dates, names, or values." },
      { key: "structuredSummary",  heading: "Document Summary",         icon: "📋", instruction: "Summarize what this document is about and its purpose in 2-3 sentences." },
    ],
  },
  photo: {
    label: "Photo / Real-world Scene",
    icon: "📷",
    fields: [
      { key: "sceneDescription",   heading: "Scene Description",        icon: "🌄", instruction: "Describe what is visible in this photo: people, objects, setting, context." },
      { key: "extractedText",      heading: "Text in Photo",            icon: "🔤", instruction: "Extract any text visible in the image (signs, labels, writing). Write 'No text detected.' if none." },
      { key: "structuredSummary",  heading: "Key Observations",         icon: "📋", instruction: "Summarize the most significant or relevant aspects of this image." },
      { key: "nextSteps",          heading: "Actionable Insights",      icon: "💡", instruction: "Provide 2-3 insights or actions relevant to this image.", isList: true },
    ],
  },
  chart: {
    label: "Chart / Graph / Data Visualization",
    icon: "📊",
    fields: [
      { key: "chartType",          heading: "Chart Type & Data",        icon: "📊", instruction: "Identify the chart type (bar, line, pie, etc.) and what data it shows." },
      { key: "extractedText",      heading: "Labels, Axes & Values",    icon: "🔤", instruction: "Extract all axis labels, legend entries, data point values, and title." },
      { key: "dataInsights",       heading: "Key Data Insights",        icon: "🔍", instruction: "Identify the most significant trends, peaks, drops, or patterns in the data." },
      { key: "structuredSummary",  heading: "Data Summary",             icon: "📋", instruction: "Summarize what story this chart tells in 2-3 sentences." },
      { key: "nextSteps",          heading: "Recommended Actions",      icon: "🚀", instruction: "Based on the data, suggest 2-4 actions or further analyses.", isList: true },
    ],
  },
};

// ── Helpers ──────────────────────────────────────────────────────────────────
function encodeEvent(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  event: string,
  data: unknown
) {
  controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
}

function extractJSON(raw: string): Record<string, unknown> | null {
  const clean = raw.replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  const candidate = clean.slice(start, end + 1);
  try {
    return JSON.parse(candidate);
  } catch {
    let pos = candidate.lastIndexOf("}");
    while (pos > 0) {
      try { return JSON.parse(candidate.slice(0, pos + 1)); } catch { pos = candidate.lastIndexOf("}", pos - 1); }
    }
    return null;
  }
}

async function callOpenRouter(
  apiKey: string,
  siteUrl: string,
  siteName: string,
  systemPrompt: string,
  userContent: unknown[],
  maxTokens = 2000,
  temperature = 0.2
): Promise<string> {
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
      temperature,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
    }),
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    const statusMessages: Record<number, string> = {
      401: "Invalid API key. Check your OPENROUTER_API_KEY.",
      402: "OpenRouter credit is depleted. Please top up your account.",
      429: "Rate limit reached. Please try again shortly.",
    };
    throw new Error(
      statusMessages[response.status] ||
      errData?.error?.message ||
      `OpenRouter error ${response.status}`
    );
  }

  const data = await response.json();
  return data?.choices?.[0]?.message?.content || "";
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── Main POST Handler ────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: string, data: unknown) =>
        encodeEvent(controller, encoder, event, data);

      try {
        // 1. Parse form
        const form = await req.formData();
        const file = form.get("file") as File | null;

        if (!file) {
          emit("error", { message: "No image file provided." });
          controller.close();
          return;
        }

        if (file.size > 4.5 * 1024 * 1024) {
          emit("error", { message: "File too large. Maximum 4.5MB." });
          controller.close();
          return;
        }

        if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
          emit("error", { message: "Unsupported format. Use JPG, PNG, or WEBP." });
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
        const siteName = process.env.NEXT_PUBLIC_SITE_NAME || "Conversa AI — Image Agent";

        // 2. Convert to base64
        emit("status", { step: "reading", label: "Reading image…" });
        const arrayBuffer = await file.arrayBuffer();
        const base64 = Buffer.from(arrayBuffer).toString("base64");
        const dataUrl = `data:${file.type};base64,${base64}`;

        // ── TOOL 1: classify_image ──────────────────────────────────────────
        emit("status", { step: "classifying", label: "Agent classifying image type…" });
        emit("tool_call", { tool: "classify_image", label: "Classify Image" });

        const classifyRaw = await callOpenRouter(
          apiKey, siteUrl, siteName,
          "You are an image classification agent. Respond ONLY with valid JSON, no markdown.",
          [
            { type: "image_url", image_url: { url: dataUrl } },
            {
              type: "text",
              text: `Classify this image into exactly ONE of these types:
- "whiteboard" — whiteboard, blackboard, flipchart with handwritten content
- "diagram" — flowchart, architecture diagram, UML, ERD, mind map, network diagram
- "screenshot" — screenshot of software, website, app, or digital interface
- "document" — photo of a physical or digital document, form, report, invoice, letter
- "chart" — bar chart, line graph, pie chart, data visualization, infographic
- "photo" — real-world photo, scene, object, person (anything not in the above categories)

Return ONLY this JSON:
{
  "type": "<one of the types above>",
  "confidence": <0.0 to 1.0>,
  "reasoning": "<1 sentence why you chose this type>",
  "dominant_colors": ["<color1>", "<color2>"],
  "has_text": <true|false>,
  "has_diagrams": <true|false>
}`,
            },
          ],
          500, 0.1
        );

        const classifyParsed = extractJSON(classifyRaw);
        const imageType = (classifyParsed?.type as string) || "photo";
        const validTypes = Object.keys(IMAGE_TYPE_CONFIGS);
        const resolvedType = validTypes.includes(imageType) ? imageType : "photo";
        const typeConfig = IMAGE_TYPE_CONFIGS[resolvedType];

        emit("tool_result", {
          tool: "classify_image",
          result: {
            type: resolvedType,
            label: typeConfig.label,
            confidence: classifyParsed?.confidence,
            reasoning: classifyParsed?.reasoning,
            has_text: classifyParsed?.has_text,
            has_diagrams: classifyParsed?.has_diagrams,
          },
        });

        emit("classification", {
          type: resolvedType,
          label: typeConfig.label,
          icon: typeConfig.icon,
          reasoning: classifyParsed?.reasoning || "",
        });

        await sleep(150);

        // ── TOOL 2: analyze_adaptive ────────────────────────────────────────
        emit("status", { step: "analyzing", label: `Analyzing as ${typeConfig.label}…` });
        emit("tool_call", { tool: "analyze_adaptive", label: "Adaptive Analysis", imageType: resolvedType });

        // Build adaptive prompt based on image type
        const fieldInstructions = typeConfig.fields
          .map((f, i) => `${i + 1}. "${f.key}": ${f.instruction}${f.isList ? " Return as JSON array of strings." : ""}`)
          .join("\n");

        const outputShape = typeConfig.fields.reduce((acc, f) => {
          acc[f.key] = f.isList ? ["item 1", "item 2"] : "content here";
          return acc;
        }, {} as Record<string, unknown>);

        const analyzeRaw = await callOpenRouter(
          apiKey, siteUrl, siteName,
          "You are an expert image analyst. Respond ONLY with valid JSON, no markdown, no backticks.",
          [
            { type: "image_url", image_url: { url: dataUrl } },
            {
              type: "text",
              text: `This image has been classified as: ${typeConfig.label}

Perform a thorough analysis and populate ALL fields below:

${fieldInstructions}

Return ONLY this JSON structure:
${JSON.stringify(outputShape, null, 2)}

Rules:
- Be specific and detailed — no generic filler
- Base everything strictly on what's actually visible in the image
- For list fields, provide at least 3 items`,
            },
          ],
          3000, 0.25
        );

        const analyzeParsed = extractJSON(analyzeRaw);

        if (!analyzeParsed) {
          emit("error", { message: "Agent could not analyze the image. Please try again." });
          controller.close();
          return;
        }

        emit("tool_result", {
          tool: "analyze_adaptive",
          result: {
            fields_populated: typeConfig.fields.filter(f => analyzeParsed[f.key]).length,
            total_fields: typeConfig.fields.length,
          },
        });

        await sleep(100);

        // Stream fields progressively
        for (const field of typeConfig.fields) {
          const value = analyzeParsed[field.key];
          if (!value) continue;

          emit("field", {
            key: field.key,
            heading: field.heading,
            icon: field.icon,
            isList: field.isList || false,
            value: Array.isArray(value) ? value : String(value),
          });

          await sleep(90);
        }

        emit("done", {
          imageType: resolvedType,
          imageTypeLabel: typeConfig.label,
          fieldsCount: typeConfig.fields.length,
        });

        controller.close();
      } catch (err) {
        console.error("Image Agent error:", err);
        encodeEvent(controller, encoder, "error", {
          message: err instanceof Error ? err.message : "Internal server error.",
        });
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
