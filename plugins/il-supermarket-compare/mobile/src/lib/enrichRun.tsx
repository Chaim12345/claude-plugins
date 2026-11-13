// The background classification job: on start-up and after every price update, the products with no
// record (the delta) are sent to the model a batch at a time, most-sold first, up to the daily cap.
// Each batch is written to the database as soon as it is answered, so a closed app loses nothing and
// the next start carries on where it stopped.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAi } from "./ai";
import { runBatches } from "./airun";
import { dlog } from "./debuglog";
import { delta, ENRICH_BATCH, enrichPrompt, readEnrich } from "./enrich";
import { addRows, countRequest, getEnrich, requestsLeft, useEnrich } from "./enrichState";
import { PRESETS, usable, type LlmConfig } from "./llm";
import { useData } from "./store";

/** The classification model when the user hasn't chosen one: the most accurate Gemini on a Gemini key. */
export function enrichModel(cfg: LlmConfig, chosen: string): string {
  if (chosen.trim()) return chosen.trim();
  return cfg.preset === "gemini" && cfg.baseUrl === PRESETS.gemini.baseUrl ? "gemini-4-hydrogen" : cfg.model;
}

export type EnrichStatus = { running: boolean; done: number; total: number; added: number; error?: string; at?: number; stopped?: boolean; capped?: boolean };

type Ctx = { status: EnrichStatus; pending: number; total: number; run: () => void; stop: () => void; model: string };
const C = createContext<Ctx | null>(null);

export function EnrichProvider({ children }: { children: ReactNode }) {
  const { cfg } = useAi();
  const { rawCatalog } = useData();
  const enr = useEnrich();
  const [status, setStatus] = useState<EnrichStatus>({ running: false, done: 0, total: 0, added: 0 });
  const ctl = useRef<AbortController | null>(null);
  const model = enrichModel(cfg, enr.settings.model);
  const mcfg = useMemo(() => ({ ...cfg, model }), [cfg, model]);

  const have = useMemo(() => new Map([...enr.rows.values()].map(r => [r.code, r.h])), [enr.rows]);
  const todo = useMemo(() => (rawCatalog ? delta(rawCatalog, have) : []), [rawCatalog, have]);

  const run = useCallback(() => {
    if (!rawCatalog || !usable(mcfg) || ctl.current) return;
    const items = delta(rawCatalog, new Map([...getEnrich().rows.values()].map(r => [r.code, r.h])));
    const n = Math.min(Math.ceil(items.length / ENRICH_BATCH), requestsLeft());
    if (!items.length) return;
    if (!n) { setStatus(s => ({ ...s, capped: true })); return; }
    const c = new AbortController();
    ctl.current = c;
    const cats = rawCatalog.categories;
    setStatus({ running: true, done: 0, total: n, added: 0 });
    dlog("enrich", `${items.length} products to classify, ${n} requests now`, { model });
    let added = 0;
    (async () => {
      const batch = (i: number) => items.slice(i * ENRICH_BATCH, (i + 1) * ENRICH_BATCH);
      const error = await runBatches(mcfg, n, i => { countRequest(); return enrichPrompt(batch(i), cats); }, (i, json) => {
        const rows = readEnrich(batch(i), json, cats, model, Date.now());
        added += rows.length;
        void addRows(rows);
      }, { signal: c.signal, tag: "enrich", maxTokens: 32_000, timeoutMs: 300_000, onProgress: done => setStatus(s => ({ ...s, done, added })) });
      ctl.current = null;
      const capped = !error && !c.signal.aborted && n * ENRICH_BATCH < items.length;
      setStatus(s => ({ ...s, running: false, added, error, at: Date.now(), stopped: c.signal.aborted, capped }));
      dlog("enrich", "done", { added, error, capped });
    })();
  }, [rawCatalog, mcfg, model]);

  const stop = useCallback(() => { ctl.current?.abort(); }, []);

  // start-up and every new catalog: classify the delta in the background
  const auto = enr.loaded && enr.settings.auto && usable(mcfg) && !!rawCatalog;
  useEffect(() => { if (auto && todo.length) run(); }, [auto, rawCatalog, run]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!enr.settings.auto) ctl.current?.abort(); }, [enr.settings.auto]);

  const total = rawCatalog?.products.filter(r => !/^f-/.test(r[0])).length ?? 0;
  const value = useMemo(() => ({ status, pending: todo.length, total, run, stop, model }), [status, todo.length, total, run, stop, model]);
  return <C.Provider value={value}>{children}</C.Provider>;
}

export function useEnrichRunner(): Ctx {
  const c = useContext(C);
  if (!c) throw new Error("useEnrichRunner outside EnrichProvider");
  return c;
}

