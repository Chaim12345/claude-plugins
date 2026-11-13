// Runs a list of model requests one after another at the provider's pace: a gap between requests
// (free tiers allow a few a minute), a retry after a "too many requests" or a server error, and a stop
// on anything else (a bad key, a wrong model). Shared by the deal checks and the catalog curation.
import { dlog } from "./debuglog.ts";
import { LlmError, chat, parseJsonLoose, presetOf, type ChatMessage, type LlmConfig } from "./llm.ts";

export type RunOpts = {
  signal: AbortSignal;
  onProgress?: (done: number) => void;
  maxTokens?: number;
  timeoutMs?: number;
  tag?: string; // for the diagnostic log
  chatFn?: typeof chat; // tests
  sleepFn?: (ms: number, signal: AbortSignal) => Promise<void>;
};

export const sleep = (ms: number, signal: AbortSignal) => new Promise<void>(res => {
  const t = setTimeout(res, ms);
  signal.addEventListener("abort", () => { clearTimeout(t); res(); });
});

/** Returns an error message when it stopped early, otherwise undefined. */
export async function runBatches(cfg: LlmConfig, n: number, ask: (i: number) => ChatMessage[], onAnswer: (i: number, json: unknown) => void, o: RunOpts): Promise<string | undefined> {
  const call = o.chatFn ?? chat, wait = o.sleepFn ?? sleep;
  const gap = Math.ceil(60_000 / presetOf(cfg).rpm);
  const tag = o.tag ?? "ai";
  for (let i = 0; i < n && !o.signal.aborted; i++) {
    if (i) await wait(gap, o.signal);
    for (let tries = 0; ; tries++) {
      try {
        const r = await call(cfg, ask(i), { signal: o.signal, maxTokens: o.maxTokens ?? 8192, timeoutMs: o.timeoutMs ?? 120_000 });
        const json = parseJsonLoose(r.text);
        if (!json) dlog(tag, "answer was not JSON", r.text.slice(0, 200));
        onAnswer(i, json);
        dlog(tag, `request ${i + 1}/${n}`, { in: r.tokensIn, out: r.tokensOut });
        break;
      } catch (e) {
        if (o.signal.aborted) return undefined;
        const err = e as LlmError;
        if ((err.kind === "quota" || err.kind === "network") && tries < 2 && err.retryAfterMs) {
          dlog(tag, `retry in ${Math.round(err.retryAfterMs / 1000)} s`, err.message);
          await wait(Math.min(err.retryAfterMs, 65_000), o.signal);
          continue;
        }
        dlog(tag, "stopped", err.message);
        return err.message ?? String(e);
      }
    }
    o.onProgress?.(i + 1);
  }
  return undefined;
}
