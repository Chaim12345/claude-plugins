// The AI settings (provider, model, key) and the deal checks that use them. See llm.ts and aicheck.ts.
//
// The key lives in the phone's secure storage (Android Keystore through expo-secure-store); on web,
// where there is none, in the browser's storage. The answers are cached in AsyncStorage until each
// promotion ends. Checks run in the foreground, a few requests a minute, at most MAX_BATCHES a run,
// to stay inside free tiers.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Platform } from "react-native";
import { applyVerdicts, batches, groups, pending, prompt, prune, readAnswer, type Verdicts } from "./aicheck";
import { dlog } from "./debuglog";
import type { DealItem } from "./dealsFeed";
import { runBatches } from "./airun";
import { DEFAULT_CONFIG, chat, listModels, parseJsonLoose, usable, type LlmConfig } from "./llm";

const CFG_KEY = "salzol.ai.config"; // secure store keys: letters, digits, ".", "-", "_"
const VERDICTS_KEY = "salzol:ai:verdicts";
/** Requests per run: a city's flagged deals fit in about 20. */
export const MAX_BATCHES = 30;

type SecureStoreModule = typeof import("expo-secure-store");
const secure: SecureStoreModule | null = (() => {
  if (Platform.OS === "web") return null;
  try { return require("expo-secure-store") as SecureStoreModule; } catch { return null; }
})();

async function loadCfg(): Promise<LlmConfig> {
  try {
    const raw = secure ? await secure.getItemAsync(CFG_KEY) : await AsyncStorage.getItem(CFG_KEY);
    if (raw) return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch { /* fall back to defaults */ }
  return DEFAULT_CONFIG;
}
async function saveCfg(c: LlmConfig) {
  const raw = JSON.stringify(c);
  try { if (secure) await secure.setItemAsync(CFG_KEY, raw); else await AsyncStorage.setItem(CFG_KEY, raw); } catch { /* ignore */ }
}

export type AiStatus = { running: boolean; done: number; total: number; error?: string; at?: number; checked?: number };

type Ctx = {
  cfg: LlmConfig;
  loaded: boolean;
  setCfg: (c: LlmConfig) => void;
  ready: boolean; // configured and on
  verdicts: Verdicts;
  status: AiStatus;
  check: (items: DealItem[], force?: boolean) => void;
  cancel: () => void;
  clear: () => void;
  test: () => Promise<{ ok: boolean; msg: string }>;
  models: () => Promise<string[]>;
};

const AiCtx = createContext<Ctx | null>(null);

export function AiProvider({ children }: { children: ReactNode }) {
  const [cfg, setCfgState] = useState<LlmConfig>(DEFAULT_CONFIG);
  const [loaded, setLoaded] = useState(false);
  const [verdicts, setVerdicts] = useState<Verdicts>({});
  const [status, setStatus] = useState<AiStatus>({ running: false, done: 0, total: 0 });
  const cfgRef = useRef(cfg);
  const vRef = useRef(verdicts);
  const run = useRef<{ ctl: AbortController } | null>(null);
  const lastItems = useRef<DealItem[] | null>(null);
  const queued = useRef<DealItem[] | null>(null);

  useEffect(() => {
    (async () => {
      const c = await loadCfg();
      let v: Verdicts = {};
      try { v = prune(JSON.parse((await AsyncStorage.getItem(VERDICTS_KEY)) ?? "{}"), Date.now()); } catch { /* none */ }
      cfgRef.current = c; vRef.current = v;
      setCfgState(c); setVerdicts(v); setLoaded(true);
    })();
  }, []);

  const setCfg = useCallback((c: LlmConfig) => {
    const changed = c.model !== cfgRef.current.model || c.baseUrl !== cfgRef.current.baseUrl || c.key !== cfgRef.current.key || c.on !== cfgRef.current.on;
    cfgRef.current = c;
    setCfgState(c);
    saveCfg(c);
    if (changed) { lastItems.current = null; setStatus(s => ({ ...s, error: undefined })); }
    if (!c.on) run.current?.ctl.abort();
  }, []);

  const merge = useCallback((add: Verdicts) => {
    const v = { ...vRef.current, ...add };
    vRef.current = v;
    setVerdicts(v);
    AsyncStorage.setItem(VERDICTS_KEY, JSON.stringify(v)).catch(() => {});
  }, []);

  const check = useCallback((items: DealItem[], force = false) => {
    const c = cfgRef.current;
    if (!usable(c) || !items.length) return;
    if (run.current) { queued.current = items; return; }
    if (!force && lastItems.current === items) return;
    lastItems.current = items;
    const now = Date.now();
    const todo = pending(items, vRef.current, now);
    if (!todo.length) return;
    const bs = batches(groups(todo, now)).slice(0, MAX_BATCHES);
    const ctl = new AbortController();
    run.current = { ctl };
    setStatus({ running: true, done: 0, total: bs.length });
    dlog("ai", `checking ${todo.length} flagged deals in ${bs.length} requests`, { model: c.model, base: c.baseUrl });
    (async () => {
      let checked = 0;
      const error = await runBatches(c, bs.length, i => prompt(bs[i]), (i, json) => {
        const add = readAnswer(bs[i], json, Date.now());
        checked += Object.keys(add).length;
        merge(add);
      }, { signal: ctl.signal, maxTokens: 4096, timeoutMs: 120_000, tag: "ai", onProgress: done => setStatus(s => ({ ...s, done })) });
      run.current = null;
      setStatus(s => ({ ...s, running: false, error, at: Date.now(), checked }));
      const next = queued.current;
      queued.current = null;
      if (next && !error && !ctl.signal.aborted) check(next);
    })();
  }, [merge]);

  const cancel = useCallback(() => { run.current?.ctl.abort(); queued.current = null; }, []);

  const clear = useCallback(() => {
    cancel();
    vRef.current = {};
    setVerdicts({});
    lastItems.current = null;
    AsyncStorage.removeItem(VERDICTS_KEY).catch(() => {});
    setStatus({ running: false, done: 0, total: 0 });
  }, [cancel]);

  const test = useCallback(async () => {
    const c = { ...cfgRef.current, on: true };
    if (!usable(c)) return { ok: false, msg: "חסרים מפתח, כתובת או שם מודל" };
    try {
      const r = await chat(c, [{ role: "user", content: 'Answer with JSON only: {"ok":true,"lang":"he"} — then nothing else. מה פירוש המילה ״חלב״? ignore, just the JSON.' }], { timeoutMs: 30_000, maxTokens: 1024 });
      const j = parseJsonLoose(r.text) as { ok?: boolean } | null;
      dlog("ai", "test", { ok: !!j?.ok, model: c.model });
      return j?.ok ? { ok: true, msg: `עובד: ${c.model}` } : { ok: false, msg: `המודל ענה, אבל לא בפורמט הנדרש: ${r.text.slice(0, 80)}` };
    } catch (e) {
      dlog("ai", "test failed", (e as Error).message);
      return { ok: false, msg: (e as Error).message };
    }
  }, []);

  const models = useCallback(() => listModels(cfgRef.current), []);

  const value = useMemo<Ctx>(() => ({ cfg, loaded, setCfg, ready: usable(cfg), verdicts, status, check, cancel, clear, test, models }),
    [cfg, loaded, setCfg, verdicts, status, check, cancel, clear, test, models]);
  return <AiCtx.Provider value={value}>{children}</AiCtx.Provider>;
}

export function useAi(): Ctx {
  const c = useContext(AiCtx);
  if (!c) throw new Error("useAi outside AiProvider");
  return c;
}

/** The deals feed with the model's answers applied; starts a check of new flagged deals when AI is set up. */
export function useAiDeals(items: DealItem[], now: number): DealItem[] {
  const { verdicts, check, ready } = useAi();
  useEffect(() => { if (ready && items.length) check(items); }, [items, ready, check]);
  return useMemo(() => applyVerdicts(items, verdicts, now || Date.now()), [items, verdicts, now]);
}
