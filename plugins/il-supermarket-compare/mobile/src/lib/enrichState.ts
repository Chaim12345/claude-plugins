// The product records in memory (loaded from enrichDb at start-up) and the classification settings.
// A module-level store, like curationState: the data store applies the records to the catalog, and the
// runner (enrichRun.tsx) sits below it.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSyncExternalStore } from "react";
import type { Enriched, EnrichRow } from "./enrich";
import { clearAll, loadAll, putMany } from "./enrichDb";

export type EnrichSettings = {
  auto: boolean; // classify new products in the background on start-up and after each price update
  apply: boolean; // use the records in the app (categories, search, filters, analysis)
  model: string; // "" = the model from the AI settings
  dailyCap: number; // requests per day for classification
};
export const DEFAULT_SETTINGS: EnrichSettings = { auto: true, apply: true, model: "", dailyCap: 300 };
export const CAPS = [50, 150, 300, 1000];

type Snapshot = { rows: Map<string, EnrichRow>; recs: Map<string, Enriched>; settings: EnrichSettings; usage: { day: string; requests: number }; loaded: boolean };

const SKEY = "salzol:enrich:settings", UKEY = "salzol:enrich:usage";
let snap: Snapshot = { rows: new Map(), recs: new Map(), settings: DEFAULT_SETTINGS, usage: { day: "", requests: 0 }, loaded: false };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());
const today = () => new Date().toISOString().slice(0, 10);

let loading: Promise<void> | null = null;
export function loadEnrich(): Promise<void> {
  if (!loading) {
    loading = (async () => {
      const [rows, s, u] = await Promise.all([
        loadAll().catch(() => [] as EnrichRow[]),
        AsyncStorage.getItem(SKEY).catch(() => null),
        AsyncStorage.getItem(UKEY).catch(() => null),
      ]);
      const m = new Map(rows.map(r => [r.code, r]));
      let settings = DEFAULT_SETTINGS, usage = { day: today(), requests: 0 };
      try { if (s) settings = { ...DEFAULT_SETTINGS, ...JSON.parse(s) }; } catch { /* defaults */ }
      try { if (u) { const x = JSON.parse(u); if (x.day === today()) usage = x; } } catch { /* fresh day */ }
      snap = { rows: m, recs: new Map(rows.map(r => [r.code, r.rec])), settings, usage, loaded: true };
      emit();
    })();
  }
  return loading;
}

/** New records from one batch: kept in memory and written to the database. */
export async function addRows(rows: EnrichRow[]): Promise<void> {
  if (!rows.length) return;
  const m = new Map(snap.rows), recs = new Map(snap.recs);
  for (const r of rows) { m.set(r.code, r); recs.set(r.code, r.rec); }
  snap = { ...snap, rows: m, recs };
  emit();
  await putMany(rows).catch(() => {});
}

export function countRequest(): void {
  const day = today();
  const usage = { day, requests: (snap.usage.day === day ? snap.usage.requests : 0) + 1 };
  snap = { ...snap, usage };
  emit();
  AsyncStorage.setItem(UKEY, JSON.stringify(usage)).catch(() => {});
}

export function requestsLeft(): number {
  return Math.max(0, snap.settings.dailyCap - (snap.usage.day === today() ? snap.usage.requests : 0));
}

export function setEnrichSettings(p: Partial<EnrichSettings>): void {
  snap = { ...snap, settings: { ...snap.settings, ...p } };
  emit();
  AsyncStorage.setItem(SKEY, JSON.stringify(snap.settings)).catch(() => {});
}

export async function clearEnrich(): Promise<void> {
  snap = { ...snap, rows: new Map(), recs: new Map() };
  emit();
  await clearAll().catch(() => {});
}

export const getEnrich = () => snap;
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const useEnrich = (): Snapshot => useSyncExternalStore(subscribe, () => snap, () => snap);
