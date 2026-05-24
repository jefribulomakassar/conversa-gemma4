import { NextRequest, NextResponse } from "next/server";

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

// ── Helpers ──────────────────────────────────────────────────────────────────
function sseEvent(
  controller: ReadableStreamDefaultController,
  event: string,
  payload: Record<string, unknown>
) {
  const chunk = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  controller.enqueue(new TextEncoder().encode(chunk));
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

// ── Step 1 prompt: classify ───────────────────────────────────────────────────
const CLASSIFY_PROMPT = `You are an image classification agent. Examine this image and classify it.

Return ONLY a valid JSON object with exactly this structure:
{
  "type": "whiteboard" | "diagram" | "screenshot" | "document" | "chart" | "photo",
  "label": "Human-readable label, e.g. 'System Architecture Diagram'",
  "icon": "Single emoji representing this type",
  "reasoning": "One sentence explaining why you chose this type",
  "confidence": 0.0 to 1.0
}

Rules:
- type MUST be one of: whiteboard, diagram, screenshot, document, chart, photo
- Return ONLY valid JSON, no markdown, no preamble`;

// ── Step 2 prompt: adaptive analysis ─────────────────────────────────────────
function buildAnalysisPrompt(type: ClassificationType): string {
  const fields = TYPE_FIELDS[type];
  const fieldDocs = fields
    .map((f) => {
      const valueDesc = f.isList
        ? `array of strings (list items)`
        : `string`;
      return `  "${f.key}": ${valueDesc}  // ${f.heading}`;
    })
    .join(",\n");

  return `You are an expert image analyst. This image has been classified as: ${type}.

Analyze it and return ONLY a valid JSON object with exactly this structure:
{
${fieldDocs}
}

Rules:
- Be thorough and specific to what you see in this image
- For list fields, provide 3-6 meaningful items as an array of strings
- For string fields, write clear, professional prose (2-5 sentences)
- Return ONLY valid JSON, no markdown, no preamble, no extra keys`;
}

// ── Gemini API call ───────────────────────────────────────────────────────────
async function callGemini(
  apiKey: string,
  base64: string,
  mimeType: string,
  textPrompt: string
): Promise<string> {
  const payload = {
    model: "gemma-4-26b-a4b-it",
    contents: [
      {
        role: "user",
        parts: [
          {
            inline_data: { mime_type: mimeType, data: base64 },
          },
          { text: textPrompt },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 3000,
      responseMimeType: "application/json",
    },
  };

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemma-4-26b-a4b-it:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Gemini API error ${res.status}`);
  }

  const data = await res.json();
  const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!raw) throw new Error("Empty response from model.");
  return raw.replace(/```json|```/g, "").trim();
}

// ── Route handler ─────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  // Validate file
  const form = await req.formData();
  const file = form.get("file") as File | null;
  if (!file) {
    return NextResponse.json({ error: "No image file provided." }, { status: 400 });
  }
  if (file.size > 10 * 1024 * 1024) {
    return NextResponse.json({ error: "File terlalu besar. Maksimal 10MB." }, { status: 400 });
  }
  const allowed = ["image/jpeg", "image/png", "image/webp"];
  if (!allowed.includes(file.type)) {
    return NextResponse.json(
      { error: "Format tidak didukung. Gunakan JPG, PNG, atau WEBP." },
      { status: 400 }
    );
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "API key tidak ditemukan." }, { status: 500 });
  }

  // Convert to base64 once
  const arrayBuffer = await file.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString("base64");
  const mimeType = file.type;

  // Build SSE stream
  const stream = new ReadableStream({
    async start(controller) {
      try {
        // ── Status: reading ───────────────────────────────────────────────
        sseEvent(controller, "status", { step: "reading", label: "Reading image…" });

        // ── Status: classifying ───────────────────────────────────────────
        sseEvent(controller, "status", { step: "classifying", label: "Agent classifying image type…" });
        sseEvent(controller, "tool_call", {
          tool: "classify_image",
          label: "Classify Image",
          status: "running",
        });

        const classifyRaw = await callGemini(apiKey, base64, mimeType, CLASSIFY_PROMPT);
        const classification: ClassificationResult = JSON.parse(classifyRaw);

        sseEvent(controller, "tool_result", {
          tool: "classify_image",
          result: {
            label: classification.label,
            confidence: classification.confidence,
          },
        });

        sseEvent(controller, "classification", {
          type:      classification.type,
          label:     classification.label,
          icon:      classification.icon,
          reasoning: classification.reasoning,
        });

        // ── Status: analyzing ─────────────────────────────────────────────
        sseEvent(controller, "status", { step: "analyzing", label: "Adaptive analysis running…" });
        sseEvent(controller, "tool_call", {
          tool: "analyze_adaptive",
          label: `Adaptive Analysis · ${classification.label}`,
          status: "running",
        });

        const analysisPrompt = buildAnalysisPrompt(classification.type);
        const analysisRaw = await callGemini(apiKey, base64, mimeType, analysisPrompt);
        const analysisData: Record<string, string | string[]> = JSON.parse(analysisRaw);

        const fieldDefs = TYPE_FIELDS[classification.type] ?? [];
        let fieldsPopulated = 0;

        for (const def of fieldDefs) {
          const value = analysisData[def.key];
          if (value === undefined || value === null) continue;

          const field: FieldResult = {
            key:     def.key,
            heading: def.heading,
            icon:    def.icon,
            isList:  def.isList,
            value:   value,
          };

          sseEvent(controller, "field", field as unknown as Record<string, unknown>);
          fieldsPopulated++;
        }

        sseEvent(controller, "tool_result", {
          tool: "analyze_adaptive",
          result: {
            fields_populated: fieldsPopulated,
            total_fields:     fieldDefs.length,
          },
        });

        // ── Done ──────────────────────────────────────────────────────────
        sseEvent(controller, "status", { step: "done", label: "Complete." });
        sseEvent(controller, "done", {});
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Internal server error.";
        sseEvent(controller, "error", { message });
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
