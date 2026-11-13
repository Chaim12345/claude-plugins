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

/**
 * recs: the records the app shows. Applying them re-merges the whole catalog and rebuilds every screen
 * (seconds on a phone with 37,000 products), so new records are published at most every PUBLISH_MS,
 * at the end of a run, or when a screen asks (publishEnrich): not on every batch.
 * count: how many records exist now, published or not (cheap to update).
 */
type Snapshot = { recs: Map<string, Enriched>; count: number; settings: EnrichSettings; usage: { day: string; requests: number }; loaded: boolean };

export const PUBLISH_MS = 5 * 60_000;
const live = new Map<string, EnrichRow>(); // every record, current
let lastPublish = 0, unpublished = 0;

const SKEY = "salzol:enrich:settings", UKEY = "salzol:enrich:usage";
let snap: Snapshot = { recs: new Map(), count: 0, settings: DEFAULT_SETTINGS, usage: { day: "", requests: 0 }, loaded: false };
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
      for (const r of rows) live.set(r.code, r);
      let settings = DEFAULT_SETTINGS, usage = { day: today(), requests: 0 };
      try { if (s) settings = { ...DEFAULT_SETTINGS, ...JSON.parse(s) }; } catch { /* defaults */ }
      try { if (u) { const x = JSON.parse(u); if (x.day === today()) usage = x; } } catch { /* fresh day */ }
      snap = { recs: new Map(rows.map(r => [r.code, r.rec])), count: live.size, settings, usage, loaded: true };
      lastPublish = Date.now();
      emit();
    })();
  }
  return loading;
}

/** New records from one batch: written to the database now, shown in the app at the next publish. */
export async function addRows(rows: EnrichRow[]): Promise<void> {
  if (!rows.length) return;
  for (const r of rows) live.set(r.code, r);
  unpublished += rows.length;
  if (Date.now() - lastPublish >= PUBLISH_MS) publishEnrich();
  else { snap = { ...snap, count: live.size }; emit(); }
  await putMany(rows).catch(() => {});
}

/** Shows every record made so far in the app (one catalog rebuild). */
export function publishEnrich(): void {
  if (!unpublished && snap.recs.size === live.size) return;
  const recs = new Map<string, Enriched>();
  for (const [code, r] of live) recs.set(code, r.rec);
  snap = { ...snap, recs, count: live.size };
  unpublished = 0;
  lastPublish = Date.now();
  emit();
}

/** Name hashes of every record, published or not: what the next run can skip. */
export const liveHashes = (): Map<string, string> => new Map([...live.values()].map(r => [r.code, r.h]));

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
  live.clear(); unpublished = 0;
  snap = { ...snap, recs: new Map(), count: 0 };
  emit();
  await clearAll().catch(() => {});
}

export const getEnrich = () => snap;
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const useEnrich = (): Snapshot => useSyncExternalStore(subscribe, () => snap, () => snap);

/** Only the records the app applies (null when switched off): changes at a publish, never per batch. */
export const useEnrichRecs = (): Map<string, Enriched> | null =>
  useSyncExternalStore(subscribe, () => (snap.settings.apply ? snap.recs : null), () => (snap.settings.apply ? snap.recs : null));
