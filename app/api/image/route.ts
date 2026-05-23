import { NextRequest } from "next/server";

const MODEL = "google/gemma-4-26b-a4b-it";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── Main handler ─────────────────────────────────────────────────────────────

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

        if (!file) { emit("error", { message: "No image file provided." }); controller.close(); return; }
        if (file.size > 4.5 * 1024 * 1024) { emit("error", { message: "The file is too large. Maximum 10MB." }); controller.close(); return; }
        if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
          emit("error", { message: "Unsupported format. Use JPG, PNG, or WEBP." });
          controller.close(); return;
        }

        const apiKey = process.env.OPENROUTER_API_KEY;
        if (!apiKey) { emit("error", { message: "OPENROUTER_API_KEY not found." }); controller.close(); return; }

        // 2. Convert to base64
        emit("status", { step: "reading" });
        const arrayBuffer = await file.arrayBuffer();
        const base64 = Buffer.from(arrayBuffer).toString("base64");
        const dataUrl = `data:${file.type};base64,${base64}`;

        // 3. Call OpenRouter
        emit("status", { step: "analyzing" });

        const payload = {
          model: MODEL,
          temperature: 0.2,
          max_tokens: 3000,
          messages: [
            {
              role: "system",
              content: "You are an enterprise whiteboard and document image analyst. Always respond with ONLY a valid JSON object — no markdown, no backticks, no explanation.",
            },
            {
              role: "user",
              content: [
                { type: "image_url", image_url: { url: dataUrl } },
                {
                  type: "text",
                  text: `Carefully examine this image and return a valid JSON object with EXACTLY this structure:
{
  "extractedText": "All text visible in the image, transcribed verbatim and in order",
  "diagramDescription": "Description of any diagrams, charts, arrows, boxes, drawings, or visual structures. Write 'No diagrams detected.' if none.",
  "structuredSummary": "A clear professional summary of what this whiteboard or image contains (2-4 sentences)",
  "nextSteps": ["Actionable step 1", "Actionable step 2", "Actionable step 3"]
}

Rules:
- extractedText: transcribe every visible word, preserve bullets/numbered lists/columns
- diagramDescription: describe shapes, flows, connections and their meaning
- structuredSummary: synthesize full content into 2-4 sentences
- nextSteps: 3-5 actionable recommendations based on the content
- Return ONLY the JSON object — no preamble, no markdown fences`,
                },
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
            "X-Title": process.env.NEXT_PUBLIC_SITE_NAME || "Whiteboard Analyzer",
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
          emit("error", { message: statusMessages[response.status] || errData?.error?.message || `OpenRouter error ${response.status}` });
          controller.close(); return;
        }

        // 4. Parse response
        emit("status", { step: "parsing" });

        const data = await response.json();
        const raw: string | undefined = data?.choices?.[0]?.message?.content;

        if (!raw) { emit("error", { message: "No response from the model." }); controller.close(); return; }

        const parsed = extractJSON(raw);
        if (!parsed) { emit("error", { message: "The model did not produce valid JSON. Please try again." }); controller.close(); return; }

        // Normalize
        const requiredFields = ["extractedText", "diagramDescription", "structuredSummary", "nextSteps"];
        for (const field of requiredFields) {
          if (!(field in parsed)) parsed[field] = field === "nextSteps" ? [] : "Not available.";
        }
        if (!Array.isArray(parsed.nextSteps)) parsed.nextSteps = [String(parsed.nextSteps)];

        // 5. Stream field by field
        emit("extractedText", { text: parsed.extractedText as string });
        await sleep(100);

        emit("diagramDescription", { text: parsed.diagramDescription as string });
        await sleep(100);

        emit("structuredSummary", { text: parsed.structuredSummary as string });
        await sleep(100);

        emit("nextSteps", { items: parsed.nextSteps as string[] });
        await sleep(100);

        emit("done", {});
        controller.close();
      } catch (err) {
        console.error("Image route error:", err);
        encodeEvent(controller, encoder, "error", { message: err instanceof Error ? err.message : "Internal server error." });
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

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '5mb', // sedikit di atas 4.5MB untuk toleransi
    },
  },
};
