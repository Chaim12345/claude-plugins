// Runs the catalog curation tasks (curate.ts) on request from the "ניהול קטלוג" screen. The state
// they write lives in curationState.ts.
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { useAi } from "./ai";
import { runBatches } from "./airun";
import {
  BATCH, catCandidates, catPrompt, linkCandidates, linkPrompt, nameCandidates, namePrompt, readCats, readLinks, readNames, type TaskKind,
} from "./curate";
import { updateCuration, useCuration } from "./curationState";
import { dlog } from "./debuglog";
import { usable } from "./llm";
import { useData } from "./store";

/** Requests per run and task: a city's catalog needs about 15 (categories), 35 (names) and 2 (links). */
export const MAX_REQUESTS = 40;

// ---------- the runner ----------

export type TaskStatus = { running: boolean; done: number; total: number; error?: string; added?: number; at?: number; stopped?: boolean };
const idle: TaskStatus = { running: false, done: 0, total: 0 };

type Ctx = {
  status: Record<TaskKind, TaskStatus>;
  pending: Record<TaskKind, number>;
  run: (k: TaskKind) => void;
  cancel: (k: TaskKind) => void;
};
const CurCtx = createContext<Ctx | null>(null);

export function CurationProvider({ children }: { children: ReactNode }) {
  const { cfg } = useAi();
  const { rawCatalog } = useData();
  const cur = useCuration();
  const [status, setStatus] = useState<Record<TaskKind, TaskStatus>>({ cats: idle, names: idle, links: idle });
  const ctls = useRef<Partial<Record<TaskKind, AbortController>>>({});

  // candidates come from the catalog as the files gave it, so answers are keyed to the original rows
  const cands = useMemo(() => (rawCatalog ? {
    cats: catCandidates(rawCatalog, cur),
    names: nameCandidates(rawCatalog, cur),
    links: linkCandidates(rawCatalog, cur),
  } : { cats: [], names: [], links: [] }), [rawCatalog, cur]);
  const pending = useMemo(() => ({ cats: cands.cats.length, names: cands.names.length, links: cands.links.length }), [cands]);

  const set = (k: TaskKind, s: Partial<TaskStatus>) => setStatus(p => ({ ...p, [k]: { ...p[k], ...s } }));

  const run = useCallback((k: TaskKind) => {
    if (!rawCatalog || !usable(cfg) || ctls.current[k]) return;
    const size = BATCH[k];
    const items = (cands[k] as unknown[]).slice(0, size * MAX_REQUESTS);
    if (!items.length) return;
    const n = Math.ceil(items.length / size);
    const ctl = new AbortController();
    ctls.current[k] = ctl;
    set(k, { running: true, done: 0, total: n, error: undefined, added: 0, stopped: false });
    dlog("curate", `${k}: ${items.length} products in ${n} requests`, { model: cfg.model });
    const cats = rawCatalog.categories;
    let added = 0;
    (async () => {
      const batch = (i: number) => items.slice(i * size, (i + 1) * size);
      const error = await runBatches(cfg, n, i => {
        const b = batch(i);
        return k === "cats" ? catPrompt(b as never, cats) : k === "names" ? namePrompt(b as never) : linkPrompt(b as never);
      }, (i, json) => {
        const b = batch(i);
        const res = k === "cats" ? readCats(b as never, json, cats) : k === "names" ? readNames(b as never, json) : readLinks(b as never, json);
        added += Object.keys(res.set).length;
        updateCuration(c => {
          const into = { ...c[k] } as Record<string, string>;
          for (const [code, v] of Object.entries(res.set)) if (!(k === "links" && into[code])) into[code] = v;
          const asked = { ...c.asked };
          for (const a of res.asked) asked[a] = 1;
          return { ...c, [k]: into, asked };
        });
      }, { signal: ctl.signal, tag: "curate", onProgress: done => set(k, { done, added }) });
      delete ctls.current[k];
      set(k, { running: false, error, added, at: Date.now(), stopped: ctl.signal.aborted });
      dlog("curate", `${k}: done`, { added, error });
    })();
  }, [rawCatalog, cfg, cands]);

  const cancel = useCallback((k: TaskKind) => { ctls.current[k]?.abort(); }, []);

  const value = useMemo(() => ({ status, pending, run, cancel }), [status, pending, run, cancel]);
  return <CurCtx.Provider value={value}>{children}</CurCtx.Provider>;
}

export function useCurationRunner(): Ctx {
  const c = useContext(CurCtx);
  if (!c) throw new Error("useCurationRunner outside CurationProvider");
  return c;
}
