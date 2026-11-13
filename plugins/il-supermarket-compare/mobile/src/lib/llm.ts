// A minimal client for any OpenAI-compatible chat API, with a key the user enters in settings.
// Gemini (free tier from Google AI Studio) speaks this protocol at /v1beta/openai, and so do
// OpenRouter, Groq, Together, Mistral, a local Ollama or LM Studio, and many others.
//
// Requests go straight from the phone to the provider the user chose. The app sends only promotion
// texts and product names (public data from the price files), never the cart, the location or the key
// to anyone else. The key is kept in the phone's secure storage (ai.tsx).

export type PresetId = "gemini" | "openrouter" | "groq" | "custom";

export type LlmConfig = {
  on: boolean;
  preset: PresetId;
  baseUrl: string; // e.g. https://generativelanguage.googleapis.com/v1beta/openai
  model: string;
  key: string;
};

export type Preset = {
  label: string;
  baseUrl: string;
  model: string; // a sensible default; the user can load the provider's list
  keyUrl?: string; // where to get a key
  rpm: number; // requests per minute to stay under (free tiers are tight)
  modelHint?: RegExp; // models worth showing first in the list
};

export const PRESETS: Record<PresetId, Preset> = {
  // "-latest" aliases follow Google's current Flash-Lite, the free model with the most requests per day.
  gemini: { label: "Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-flash-lite-latest", keyUrl: "https://aistudio.google.com/apikey", rpm: 10, modelHint: /flash/i },
  openrouter: { label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", model: "", keyUrl: "https://openrouter.ai/keys", rpm: 15, modelHint: /:free$/ },
  groq: { label: "Groq", baseUrl: "https://api.groq.com/openai/v1", model: "", keyUrl: "https://console.groq.com/keys", rpm: 25 },
  custom: { label: "אחר (תואם OpenAI)", baseUrl: "", model: "", rpm: 20 },
};

export const DEFAULT_CONFIG: LlmConfig = { on: false, preset: "gemini", baseUrl: PRESETS.gemini.baseUrl, model: PRESETS.gemini.model, key: "" };

export function presetOf(cfg: LlmConfig): Preset {
  return PRESETS[cfg.preset] ?? PRESETS.custom;
}

/** Ready to call: switched on, with a key (local servers may not need one), an https base URL and a model. */
export function usable(cfg: LlmConfig): boolean {
  return cfg.on && !!cfg.model.trim() && validBaseUrl(cfg.baseUrl) && (!!cfg.key.trim() || cfg.preset === "custom");
}

export function validBaseUrl(u: string): boolean {
  return /^https:\/\/[^\s/]+/i.test(u.trim()) || /^http:\/\/(localhost|127\.0\.0\.1|10\.0\.2\.2)(:\d+)?(\/|$)/i.test(u.trim());
}

export function endpoint(base: string, path: string): string {
  return base.trim().replace(/\/+$/, "") + path;
}

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type LlmErrorKind = "auth" | "quota" | "model" | "network" | "bad";
export class LlmError extends Error {
  readonly status: number;
  readonly retryAfterMs: number;
  readonly kind: LlmErrorKind;
  constructor(message: string, status = 0, retryAfterMs = 0, kind: LlmErrorKind = "bad") {
    super(message);
    this.status = status; this.retryAfterMs = retryAfterMs; this.kind = kind;
  }
}

type Fetch = typeof fetch;
type CallOpts = { fetch?: Fetch; timeoutMs?: number; signal?: AbortSignal };

async function request(cfg: LlmConfig, path: string, init: RequestInit, o: CallOpts): Promise<unknown> {
  const f = o.fetch ?? fetch;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), o.timeoutMs ?? 60_000);
  const onAbort = () => ctl.abort();
  o.signal?.addEventListener?.("abort", onAbort);
  let res: Response;
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (cfg.key.trim()) headers.Authorization = `Bearer ${cfg.key.trim()}`;
    if (cfg.preset === "openrouter") headers["X-Title"] = "Salzol";
    res = await f(endpoint(cfg.baseUrl, path), { ...init, headers, signal: ctl.signal });
  } catch (e) {
    throw new LlmError(o.signal?.aborted ? "בוטל" : `אין חיבור לשרת (${String((e as Error)?.message ?? e)})`, 0, 0, "network");
  } finally {
    clearTimeout(timer);
    o.signal?.removeEventListener?.("abort", onAbort);
  }
  const text = await res.text().catch(() => "");
  if (!res.ok) throw errorOf(res.status, text, res.headers?.get?.("retry-after") ?? null);
  try { return JSON.parse(text); } catch { throw new LlmError("תשובה לא תקינה מהשרת", res.status); }
}

/** Turns an HTTP error into a short Hebrew message and a kind the caller can act on. Never echoes the key. */
export function errorOf(status: number, body: string, retryAfter: string | null): LlmError {
  let detail = "";
  try {
    const j = JSON.parse(body);
    const e = Array.isArray(j) ? j[0]?.error : j?.error;
    detail = String(e?.message ?? j?.message ?? "").slice(0, 160);
  } catch { detail = body.slice(0, 160); }
  detail = detail.replace(/(key|token)[=:]\s*\S+/gi, "$1=…");
  const secs = Number(retryAfter);
  const wait = Number.isFinite(secs) && secs > 0 ? secs * 1000 : 0;
  if (status === 401 || status === 403) return new LlmError(`המפתח לא התקבל (${status})${detail ? `: ${detail}` : ""}`, status, 0, "auth");
  if (status === 429) return new LlmError(`הגעתם למגבלת הבקשות של הספק${detail ? `: ${detail}` : ""}`, status, wait || 20_000, "quota");
  if (status === 404) return new LlmError(`המודל או הכתובת לא נמצאו (404)${detail ? `: ${detail}` : ""}`, status, 0, "model");
  if (status === 400 && /model/i.test(detail)) return new LlmError(`בעיה בשם המודל: ${detail}`, status, 0, "model");
  if (status >= 500) return new LlmError(`שגיאת שרת אצל הספק (${status})`, status, wait || 10_000, "network");
  return new LlmError(`שגיאה ${status}${detail ? `: ${detail}` : ""}`, status);
}

export type ChatResult = { text: string; tokensIn?: number; tokensOut?: number };

/** One chat completion. Low temperature: the app asks factual yes/no questions. */
export async function chat(cfg: LlmConfig, messages: ChatMessage[], o: CallOpts & { maxTokens?: number } = {}): Promise<ChatResult> {
  const body = { model: cfg.model.trim(), messages, temperature: 0, max_tokens: o.maxTokens ?? 2048 };
  const j = (await request(cfg, "/chat/completions", { method: "POST", body: JSON.stringify(body) }, o)) as {
    choices?: { message?: { content?: unknown } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const c = j?.choices?.[0]?.message?.content;
  // content is a string in the OpenAI shape; a few servers send an array of parts
  const text = typeof c === "string" ? c : Array.isArray(c) ? c.map(x => (typeof x === "string" ? x : x?.text ?? "")).join("") : "";
  if (!text) throw new LlmError("התשובה הגיעה ריקה", 200);
  return { text, tokensIn: j.usage?.prompt_tokens, tokensOut: j.usage?.completion_tokens };
}

/** The provider's model list (GET /models), names only, "models/" prefix dropped, preferred ones first. */
export async function listModels(cfg: LlmConfig, o: CallOpts = {}): Promise<string[]> {
  const j = (await request(cfg, "/models", { method: "GET" }, { timeoutMs: 20_000, ...o })) as { data?: { id?: string }[] };
  const ids = [...new Set((j?.data ?? []).map(m => String(m?.id ?? "").replace(/^models\//, "")).filter(Boolean))];
  const hint = presetOf(cfg).modelHint;
  // drop models that can't chat (embeddings, speech, images)
  const chatty = ids.filter(id => !/embed|tts|whisper|audio|image|imagen|veo|aqa|guard|moderation/i.test(id));
  return chatty.sort((a, b) => Number(!!hint?.test(b)) - Number(!!hint?.test(a)) || a.localeCompare(b));
}

/** Reads a JSON object out of a model's answer: tolerates code fences and text around it. */
export function parseJsonLoose(text: string): unknown {
  const t = text.replace(/```(?:json)?/gi, "").trim();
  try { return JSON.parse(t); } catch { /* fall through */ }
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a >= 0 && b > a) {
    try { return JSON.parse(t.slice(a, b + 1)); } catch { /* fall through */ }
  }
  return null;
}
