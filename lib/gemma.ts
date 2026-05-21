/**
 * lib/gemma.ts
 * Gemma 4 client wrapper for Conversa AI Platform
 * Model: gemma-4-26b-a4b-it via Google AI Studio Gemini API
 */

const GEMMA_MODEL = "gemma-4-26b-a4b-it";
const GEMMA_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

// ── Types ──────────────────────────────────────────────────────────────────

export type GemmaMimeType =
  | "audio/mpeg"
  | "audio/wav"
  | "audio/x-wav"
  | "audio/mp4"
  | "audio/m4a"
  | "audio/x-m4a"
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "application/pdf";

export interface GemmaInlineData {
  mime_type: GemmaMimeType;
  data: string; // base64
}

export interface GemmaPart {
  text?: string;
  inline_data?: GemmaInlineData;
}

export interface GemmaMessage {
  role: "user" | "model";
  parts: GemmaPart[];
}

export interface GemmaThinkingConfig {
  thinkingBudget?: number; // -1 = dynamic
  includeThoughts?: boolean;
}

export interface GemmaGenerationConfig {
  temperature?: number;
  maxOutputTokens?: number;
  responseMimeType?: "application/json" | "text/plain";
  thinkingConfig?: GemmaThinkingConfig;
}

export interface GemmaRequestOptions {
  messages: GemmaMessage[];
  generationConfig?: GemmaGenerationConfig;
  apiKey?: string;
}

export interface GemmaResponsePart {
  text: string;
  thought?: boolean;
}

export interface GemmaResponse {
  text: string;
  thinking?: string;
  raw: unknown;
}

// ── Core request function ──────────────────────────────────────────────────

export async function gemmaGenerate(options: GemmaRequestOptions): Promise<GemmaResponse> {
  const apiKey = options.apiKey || process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set.");
  }

  const payload = {
    model: GEMMA_MODEL,
    contents: options.messages,
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 4096,
      responseMimeType: "application/json",
      ...options.generationConfig,
    },
  };

  const url = `${GEMMA_BASE_URL}/${GEMMA_MODEL}:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(
      (err as { error?: { message?: string } })?.error?.message ||
        `Gemma API error: ${response.status}`
    );
  }

  const data = await response.json();
  const parts: GemmaResponsePart[] = data?.candidates?.[0]?.content?.parts ?? [];

  if (parts.length === 0) {
    throw new Error("Gemma returned no content.");
  }

  let text = "";
  let thinking = "";

  for (const part of parts) {
    if (part.thought === true) {
      thinking += part.text || "";
    } else {
      text += part.text || "";
    }
  }

  return {
    text: text.trim(),
    thinking: thinking || undefined,
    raw: data,
  };
}

// ── JSON helper ────────────────────────────────────────────────────────────

export async function gemmaJSON<T = unknown>(options: GemmaRequestOptions): Promise<{ data: T; thinking?: string }> {
  const result = await gemmaGenerate({
    ...options,
    generationConfig: {
      responseMimeType: "application/json",
      ...options.generationConfig,
    },
  });

  const clean = result.text.replace(/```json|```/g, "").trim();

  try {
    const data = JSON.parse(clean) as T;
    return { data, thinking: result.thinking };
  } catch {
    throw new Error(`Failed to parse Gemma JSON response: ${clean.slice(0, 200)}`);
  }
}

// ── File → base64 helper ───────────────────────────────────────────────────

export async function fileToBase64(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  return Buffer.from(arrayBuffer).toString("base64");
}

// ── Builder helpers ────────────────────────────────────────────────────────

export function buildUserMessage(parts: GemmaPart[]): GemmaMessage {
  return { role: "user", parts };
}

export function textPart(text: string): GemmaPart {
  return { text };
}

export function inlineDataPart(data: string, mimeType: GemmaMimeType): GemmaPart {
  return { inline_data: { mime_type: mimeType, data } };
}

// ── Thinking config presets ────────────────────────────────────────────────

export const ThinkingMode = {
  OFF: undefined,
  HIGH: {
    thinkingConfig: {
      thinkingBudget: -1,
      includeThoughts: true,
    },
  } satisfies Pick<GemmaGenerationConfig, "thinkingConfig">,
} as const;

// ── Model info ─────────────────────────────────────────────────────────────

export const GEMMA_INFO = {
  model: GEMMA_MODEL,
  contextWindow: "256K tokens",
  capabilities: ["audio", "image", "pdf", "text", "thinking"],
  provider: "Google AI Studio",
} as const;
