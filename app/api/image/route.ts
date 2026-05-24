import { NextRequest } from "next/server";

// ── Types ────────────────────────────────────────────────────────────────────
type ClassificationType =
  | "whiteboard"
  | "diagram"
  | "screenshot"
  | "document"
  | "chart"
  | "photo";

interface ClassificationResult {
  type: ClassificationType;
  label: string;
  icon: string;
  reasoning: string;
  confidence: number;
}

interface FieldResult {
  key: string;
  heading: string;
  icon: string;
  isList: boolean;
  value: string | string[];
}

// ── Model config ──────────────────────────────────────────────────────────────
const GOOGLE_AI_URL = "https://generativelanguage.googleapis.com/v1beta/models";

const GEMMA_MODELS = [
  "gemma-4-26b-a4b-it",
  "gemma-4-31b-it",
];

// ── Helpers ───────────────────────────────────────────────────────────────────
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function sseEvent(
  controller: ReadableStreamDefaultController,
  event: string,
  payload: Record<string, unknown>
) {
  const chunk = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  controller.enqueue(new TextEncoder().encode(chunk));
}

function extractJSON(raw: string): Record<string, unknown> | null {
  let text = raw
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/gi, "")
    .trim();

  // Strip control chars that break JSON.parse
  text = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;

  const candidate = text.slice(start, end + 1);

  try {
    return JSON.parse(candidate);
  } catch {
    // Try progressively truncating to find a valid prefix
    let pos = candidate.lastIndexOf("}");
    while (pos > 0) {
      try {
        const parsed = JSON.parse(candidate.slice(0, pos + 1));
        console.warn("JSON repaired by truncation at pos:", pos);
        return parsed;
      } catch {
        pos = candidate.lastIndexOf("}", pos - 1);
      }
    }
    return null;
  }
}

// ── Gemma multimodal call with retry across models ────────────────────────────
async function callGemmaVision(
  apiKey: string,
  base64: string,
  mimeType: string,
  prompt: string,
  maxRetries = 3
): Promise<{ raw: string; usedModel: string }> {
  for (const model of GEMMA_MODELS) {
    const url = `${GOOGLE_AI_URL}/${model}:generateContent?key=${apiKey}`;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const body = {
        contents: [
          {
            role: "user",
            parts: [
              { inline_data: { mime_type: mimeType, data: base64 } },
              { text: prompt },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 4096,
          // responseMimeType intentionally omitted:
          // Gemma 4 ignores it and returns empty text when set
        },
      };

      let res: Response;
      try {
        res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      } catch (networkErr) {
        console.error(`Network error on ${model} attempt ${attempt + 1}:`, networkErr);
        if (attempt < maxRetries - 1) {
          await sleep(Math.pow(2, attempt) * 1000);
          continue;
        }
        break;
      }

      // Rate limited — try next model immediately
      if (res.status === 429) {
        console.warn(`Rate limit on ${model}, switching model…`);
        break;
      }

      // Transient server error — retry with backoff
      if (res.status === 500 || res.status === 503) {
        if (attempt < maxRetries - 1) {
          const wait = Math.pow(2, attempt) * 1000 + Math.random() * 500;
          console.warn(`${res.status} on ${model} attempt ${attempt + 1}, retry in ${Math.round(wait)}ms`);
          await sleep(wait);
          continue;
        }
        break;
      }

      // Other non-OK — try next model
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.error(`Gemma error (${model}) ${res.status}:`, err);
        break;
      }

      const data = await res.json();

      // Safety filter or other blocking
      const finishReason = data?.candidates?.[0]?.finishReason;
      if (finishReason && finishReason !== "STOP" && finishReason !== "MAX_TOKENS") {
        console.warn(`${model} blocked with finishReason: ${finishReason}`);
        break;
      }

      const raw: string | undefined =
        data?.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!raw || raw.trim() === "") {
        console.warn(`Empty text from ${model} attempt ${attempt + 1}, retrying…`);
        if (attempt < maxRetries - 1) {
          await sleep(1200);
          continue;
        }
        break; // try next model
      }

      return { raw, usedModel: model };
    }
  }

  throw new Error(
    "All Gemma models returned empty responses. The image may be too large or unsupported. Please try a smaller image."
  );
}

// ── Field definitions per image type ─────────────────────────────────────────
const TYPE_FIELDS: Record<
  ClassificationType,
  { key: string; heading: string; icon: string; isList: boolean }[]
> = {
  whiteboard: [
    { key: "extractedText",      heading: "Extracted Text",      icon: "📝", isList: false },
    { key: "diagramDescription", heading: "Diagrams & Structure", icon: "🔷", isList: false },
    { key: "structuredSummary",  heading: "Summary",             icon: "📋", isList: false },
    { key: "nextSteps",          heading: "Next Steps",          icon: "🚀", isList: true  },
  ],
  diagram: [
    { key: "diagramType",        heading: "Diagram Type",        icon: "📊", isList: false },
    { key: "components",         heading: "Key Components",      icon: "🔷", isList: true  },
    { key: "flowDescription",    heading: "Flow / Logic",        icon: "➡️", isList: false },
    { key: "summary",            heading: "Summary",             icon: "📋", isList: false },
  ],
  screenshot: [
    { key: "appOrPage",          heading: "App / Page",          icon: "🖥️", isList: false },
    { key: "uiElements",         heading: "UI Elements",         icon: "🧩", isList: true  },
    { key: "visibleText",        heading: "Visible Text",        icon: "📝", isList: false },
    { key: "summary",            heading: "Summary",             icon: "📋", isList: false },
  ],
  document: [
    { key: "documentType",       heading: "Document Type",       icon: "📄", isList: false },
    { key: "extractedText",      heading: "Extracted Text",      icon: "📝", isList: false },
    { key: "keyPoints",          heading: "Key Points",          icon: "✅", isList: true  },
    { key: "summary",            heading: "Summary",             icon: "📋", isList: false },
  ],
  chart: [
    { key: "chartType",          heading: "Chart Type",          icon: "📈", isList: false },
    { key: "dataHighlights",     heading: "Data Highlights",     icon: "🔑", isList: true  },
    { key: "trend",              heading: "Trend / Insight",     icon: "💡", isList: false },
    { key: "summary",            heading: "Summary",             icon: "📋", isList: false },
  ],
  photo: [
    { key: "subjects",           heading: "Subjects",            icon: "👁️", isList: true  },
    { key: "setting",            heading: "Setting / Context",   icon: "🌍", isList: false },
    { key: "details",            heading: "Notable Details",     icon: "🔍", isList: false },
    { key: "summary",            heading: "Summary",             icon: "📋", isList: false },
  ],
};

// ── Prompts ───────────────────────────────────────────────────────────────────
const CLASSIFY_PROMPT = `You are an image classification agent. Examine this image carefully.

Return a JSON object with exactly this structure. Start your response with { and end with }. No markdown, no explanation:
{
  "type": "whiteboard",
  "label": "Human-readable label e.g. System Architecture Diagram",
  "icon": "single emoji",
  "reasoning": "one sentence why you chose this type",
  "confidence": 0.95
}

The type field must be exactly one of: whiteboard, diagram, screenshot, document, chart, photo`;

function buildAnalysisPrompt(type: ClassificationType): string {
  const fields = TYPE_FIELDS[type];
  const fieldDocs = fields
    .map((f) => {
      const valueDesc = f.isList ? "array of strings" : "string";
      return `  "${f.key}": ${valueDesc}  // ${f.heading}`;
    })
    .join(",\n");

  return `You are an expert image analyst. This image is classified as: ${type}.

Analyze the image and return a JSON object. Start your response with { and end with }. No markdown, no explanation:
{
${fieldDocs}
}

Rules:
- Be specific to what you actually see in the image
- For array fields: 3-6 meaningful string items
- For string fields: 2-5 sentences of clear professional prose`;
}

// ── Route handler ─────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get("file") as File | null;

  const sseError = (message: string) =>
    new Response(`event: error\ndata: ${JSON.stringify({ message })}\n\n`, {
      headers: { "Content-Type": "text/event-stream" },
    });

  if (!file) return sseError("No image file provided.");
  if (file.size > 10 * 1024 * 1024) return sseError("File too large. Maximum 10MB.");

  const allowed = ["image/jpeg", "image/png", "image/webp"];
  if (!allowed.includes(file.type))
    return sseError("Unsupported format. Use JPG, PNG, or WEBP.");

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return sseError("API key not configured.");

  const arrayBuffer = await file.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString("base64");
  const mimeType = file.type;

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: string, payload: Record<string, unknown>) =>
        sseEvent(controller, event, payload);

      try {
        // ── Step 1: Classify ──────────────────────────────────────────────
        emit("status", { step: "reading",     label: "Reading image…" });
        emit("status", { step: "classifying", label: "Agent classifying image type…" });
        emit("tool_call", { tool: "classify_image", label: "Classify Image", status: "running" });

        const { raw: classifyRaw, usedModel: classifyModel } =
          await callGemmaVision(apiKey, base64, mimeType, CLASSIFY_PROMPT);

        console.log(`[classify] model=${classifyModel} raw=`, classifyRaw.slice(0, 300));

        const classifyParsed = extractJSON(classifyRaw);
        if (!classifyParsed) {
          throw new Error("Could not parse classification response. Please try again.");
        }

        const classification = classifyParsed as unknown as ClassificationResult;

        const validTypes: ClassificationType[] = [
          "whiteboard", "diagram", "screenshot", "document", "chart", "photo",
        ];
        if (!validTypes.includes(classification.type)) {
          classification.type = "photo";
        }

        emit("tool_result", {
          tool: "classify_image",
          result: {
            label:      classification.label      ?? "Unknown",
            confidence: classification.confidence ?? 0.8,
          },
        });
        emit("classification", {
          type:      classification.type,
          label:     classification.label     ?? classification.type,
          icon:      classification.icon      ?? "🖼️",
          reasoning: classification.reasoning ?? "",
        });

        // ── Step 2: Adaptive analysis ─────────────────────────────────────
        emit("status", { step: "analyzing", label: "Adaptive analysis running…" });
        emit("tool_call", {
          tool:   "analyze_adaptive",
          label:  `Adaptive Analysis · ${classification.label ?? classification.type}`,
          status: "running",
        });

        const analysisPrompt = buildAnalysisPrompt(classification.type);
        const { raw: analysisRaw, usedModel: analysisModel } =
          await callGemmaVision(apiKey, base64, mimeType, analysisPrompt);

        console.log(`[analyze] model=${analysisModel} raw=`, analysisRaw.slice(0, 300));

        const analysisParsed = extractJSON(analysisRaw);
        const fieldDefs = TYPE_FIELDS[classification.type] ?? [];
        let fieldsPopulated = 0;

        if (analysisParsed) {
          for (const def of fieldDefs) {
            const value = (analysisParsed as Record<string, unknown>)[def.key];
            if (value === undefined || value === null) continue;

            const field: FieldResult = {
              key:     def.key,
              heading: def.heading,
              icon:    def.icon,
              isList:  def.isList,
              value:   value as string | string[],
            };
            emit("field", field as unknown as Record<string, unknown>);
            fieldsPopulated++;
          }
        }

        emit("tool_result", {
          tool: "analyze_adaptive",
          result: {
            fields_populated: fieldsPopulated,
            total_fields:     fieldDefs.length,
          },
        });

        emit("status", { step: "done", label: "Complete." });
        emit("done", {});
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Internal server error.";
        console.error("Image route error:", err);
        emit("error", { message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type":  "text/event-stream",
      "Cache-Control": "no-cache",
      Connection:      "keep-alive",
    },
  });
}
