import { NextRequest } from "next/server";

// ── Types ─────────────────────────────────────────────────────────────────────
type ClassificationType =
  | "whiteboard" | "diagram" | "screenshot"
  | "document"  | "chart"   | "photo";

interface ClassificationResult {
  type:       ClassificationType;
  label:      string;
  icon:       string;
  reasoning:  string;
  confidence: number;
}

interface FieldResult {
  key:     string;
  heading: string;
  icon:    string;
  isList:  boolean;
  value:   string | string[];
}

// ── Model config ──────────────────────────────────────────────────────────────
const GOOGLE_AI_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const GEMMA_MODELS  = ["gemma-4-26b-a4b-it", "gemma-4-31b-it"];

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
  const text = raw
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/gi, "")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .trim();

  const start = text.indexOf("{");
  const end   = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;

  const candidate = text.slice(start, end + 1);
  try { return JSON.parse(candidate); } catch { /* fall through */ }

  // repair: try progressively shorter substrings
  let pos = candidate.lastIndexOf("}");
  while (pos > 0) {
    try { return JSON.parse(candidate.slice(0, pos + 1)); } catch { /* */ }
    pos = candidate.lastIndexOf("}", pos - 1);
  }
  return null;
}

// If Gemma refuses to produce JSON, infer type from its plain-text reply
function inferTypeFromText(raw: string): ClassificationType {
  const lower = raw.toLowerCase();
  if (lower.includes("whiteboard"))  return "whiteboard";
  if (lower.includes("diagram"))     return "diagram";
  if (lower.includes("screenshot"))  return "screenshot";
  if (lower.includes("document"))    return "document";
  if (lower.includes("chart") || lower.includes("graph")) return "chart";
  return "photo";
}

// ── Gemma vision call with retry ──────────────────────────────────────────────
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
        contents: [{
          role: "user",
          parts: [
            { inline_data: { mime_type: mimeType, data: base64 } },
            { text: prompt },
          ],
        }],
        generationConfig: {
          temperature:     0.1,
          maxOutputTokens: 4096,
          // NOTE: responseMimeType intentionally omitted — causes empty text in Gemma 4
        },
      };

      let res: Response;
      try {
        res = await fetch(url, {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify(body),
        });
      } catch {
        if (attempt < maxRetries - 1) { await sleep(1000 * (attempt + 1)); continue; }
        break;
      }

      if (res.status === 429) { console.warn(`Rate limit ${model}`); break; }

      if (res.status === 500 || res.status === 503) {
        if (attempt < maxRetries - 1) { await sleep(1200 * Math.pow(2, attempt)); continue; }
        break;
      }

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.error(`Gemma ${model} ${res.status}:`, err);
        break;
      }

      const data        = await res.json();
      const finishReason = data?.candidates?.[0]?.finishReason;
      if (finishReason && finishReason !== "STOP" && finishReason !== "MAX_TOKENS") {
        console.warn(`${model} blocked: ${finishReason}`);
        break;
      }

      const raw: string | undefined = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!raw || raw.trim() === "") {
        console.warn(`Empty text ${model} attempt ${attempt + 1}`);
        if (attempt < maxRetries - 1) { await sleep(1200); continue; }
        break;
      }

      return { raw, usedModel: model };
    }
  }

  throw new Error("All Gemma models returned empty responses. Try a smaller or different image.");
}

// ── Field definitions ─────────────────────────────────────────────────────────
const TYPE_FIELDS: Record<ClassificationType,
  { key: string; heading: string; icon: string; isList: boolean }[]> = {
  whiteboard: [
    { key: "extractedText",      heading: "Extracted Text",      icon: "📝", isList: false },
    { key: "diagramDescription", heading: "Diagrams & Structure", icon: "🔷", isList: false },
    { key: "structuredSummary",  heading: "Summary",             icon: "📋", isList: false },
    { key: "nextSteps",          heading: "Next Steps",          icon: "🚀", isList: true  },
  ],
  diagram: [
    { key: "diagramType",     heading: "Diagram Type",   icon: "📊", isList: false },
    { key: "components",      heading: "Key Components", icon: "🔷", isList: true  },
    { key: "flowDescription", heading: "Flow / Logic",   icon: "➡️", isList: false },
    { key: "summary",         heading: "Summary",        icon: "📋", isList: false },
  ],
  screenshot: [
    { key: "appOrPage",   heading: "App / Page",   icon: "🖥️", isList: false },
    { key: "uiElements",  heading: "UI Elements",  icon: "🧩", isList: true  },
    { key: "visibleText", heading: "Visible Text", icon: "📝", isList: false },
    { key: "summary",     heading: "Summary",      icon: "📋", isList: false },
  ],
  document: [
    { key: "documentType",  heading: "Document Type",  icon: "📄", isList: false },
    { key: "extractedText", heading: "Extracted Text", icon: "📝", isList: false },
    { key: "keyPoints",     heading: "Key Points",     icon: "✅", isList: true  },
    { key: "summary",       heading: "Summary",        icon: "📋", isList: false },
  ],
  chart: [
    { key: "chartType",      heading: "Chart Type",      icon: "📈", isList: false },
    { key: "dataHighlights", heading: "Data Highlights", icon: "🔑", isList: true  },
    { key: "trend",          heading: "Trend / Insight", icon: "💡", isList: false },
    { key: "summary",        heading: "Summary",         icon: "📋", isList: false },
  ],
  photo: [
    { key: "subjects", heading: "Subjects",           icon: "👁️", isList: true  },
    { key: "setting",  heading: "Setting / Context",  icon: "🌍", isList: false },
    { key: "details",  heading: "Notable Details",    icon: "🔍", isList: false },
    { key: "summary",  heading: "Summary",            icon: "📋", isList: false },
  ],
};

// ── Prompts ───────────────────────────────────────────────────────────────────
// Kept to one line of JSON so Gemma 4 has the least opportunity to add prose
const CLASSIFY_PROMPT =
`Classify this image. Reply with ONLY valid JSON on a single line, nothing else:
{"type":"photo","label":"brief label","icon":"emoji","reasoning":"one sentence","confidence":0.9}
type must be exactly one of: whiteboard, diagram, screenshot, document, chart, photo`;

function buildAnalysisPrompt(type: ClassificationType): string {
  const lines = TYPE_FIELDS[type]
    .map((f) => `  "${f.key}": ${f.isList ? "[]" : '""'}  // ${f.heading}`)
    .join(",\n");
  return (
`Analyze this ${type} image. Reply with ONLY valid JSON, nothing else:
{
${lines}
}
For string fields write 2-5 sentences. For array fields provide 3-6 string items.`
  );
}

// ── Route handler ─────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get("file") as File | null;

  const sseError = (msg: string) =>
    new Response(`event: error\ndata: ${JSON.stringify({ message: msg })}\n\n`, {
      headers: { "Content-Type": "text/event-stream" },
    });

  if (!file)                          return sseError("No image file provided.");
  if (file.size > 10 * 1024 * 1024)  return sseError("File too large. Maximum 10MB.");

  const allowed = ["image/jpeg", "image/png", "image/webp"];
  if (!allowed.includes(file.type))   return sseError("Unsupported format. Use JPG, PNG, or WEBP.");

  // Accept both key names used across Gemma/Gemini hackathon projects
  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_AI_KEY;
  if (!apiKey) return sseError("API key not configured (set GEMINI_API_KEY or GOOGLE_AI_KEY).");

  const base64   = Buffer.from(await file.arrayBuffer()).toString("base64");
  const mimeType = file.type;

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: string, payload: Record<string, unknown>) =>
        sseEvent(controller, event, payload);

      try {
        // ── 1. Classify ───────────────────────────────────────────────────
        emit("status",    { step: "reading",     label: "Reading image…" });
        emit("status",    { step: "classifying", label: "Agent classifying image type…" });
        emit("tool_call", { tool: "classify_image", label: "Classify Image", status: "running" });

        const { raw: classifyRaw, usedModel: cm } =
          await callGemmaVision(apiKey, base64, mimeType, CLASSIFY_PROMPT);

        console.log(`[classify] model=${cm}`, classifyRaw.slice(0, 200));

        // Try JSON parse — if it fails, infer type from the text itself
        const classifyParsed = extractJSON(classifyRaw);

        const validTypes: ClassificationType[] =
          ["whiteboard", "diagram", "screenshot", "document", "chart", "photo"];

        let classification: ClassificationResult;
        if (classifyParsed && validTypes.includes(classifyParsed.type as ClassificationType)) {
          classification = classifyParsed as unknown as ClassificationResult;
        } else {
          // Graceful fallback: build a synthetic classification from the raw text
          const inferredType = classifyParsed
            ? (validTypes.includes(classifyParsed.type as ClassificationType)
                ? classifyParsed.type as ClassificationType
                : inferTypeFromText(classifyRaw))
            : inferTypeFromText(classifyRaw);

          classification = {
            type:       inferredType,
            label:      (classifyParsed?.label as string)     ?? inferredType,
            icon:       (classifyParsed?.icon as string)      ?? "🖼️",
            reasoning:  (classifyParsed?.reasoning as string) ?? "Classified by content.",
            confidence: (classifyParsed?.confidence as number) ?? 0.75,
          };
          console.warn(`[classify] JSON parse failed, inferred type="${inferredType}"`);
        }

        emit("tool_result", {
          tool:   "classify_image",
          result: { label: classification.label, confidence: classification.confidence },
        });
        emit("classification", {
          type:      classification.type,
          label:     classification.label,
          icon:      classification.icon,
          reasoning: classification.reasoning,
        });

        // ── 2. Adaptive analysis ──────────────────────────────────────────
        emit("status",    { step: "analyzing", label: "Adaptive analysis running…" });
        emit("tool_call", {
          tool:   "analyze_adaptive",
          label:  `Adaptive Analysis · ${classification.label}`,
          status: "running",
        });

        const { raw: analysisRaw, usedModel: am } =
          await callGemmaVision(apiKey, base64, mimeType, buildAnalysisPrompt(classification.type));

        console.log(`[analyze] model=${am}`, analysisRaw.slice(0, 200));

        const analysisParsed = extractJSON(analysisRaw);
        const fieldDefs      = TYPE_FIELDS[classification.type] ?? [];
        let fieldsPopulated  = 0;

        if (analysisParsed) {
          for (const def of fieldDefs) {
            const value = (analysisParsed as Record<string, unknown>)[def.key];
            if (value === undefined || value === null) continue;
            const field: FieldResult = {
              key: def.key, heading: def.heading,
              icon: def.icon, isList: def.isList,
              value: value as string | string[],
            };
            emit("field", field as unknown as Record<string, unknown>);
            fieldsPopulated++;
          }
        }

        emit("tool_result", {
          tool:   "analyze_adaptive",
          result: { fields_populated: fieldsPopulated, total_fields: fieldDefs.length },
        });

        emit("status", { step: "done", label: "Complete." });
        emit("done",   {});

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
