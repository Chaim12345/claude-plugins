// The product records (enrich.ts) in the browser's storage, for the web build. Android and iOS use
// SQLite (enrichDb.native.ts); Metro picks that file there, so this one never loads expo-sqlite.
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { EnrichRow } from "./enrich";

const KEY = "salzol:enrich";

export async function loadAll(): Promise<EnrichRow[]> {
  try { return JSON.parse((await AsyncStorage.getItem(KEY)) ?? "[]"); } catch { return []; }
}

export async function putMany(rows: EnrichRow[]): Promise<void> {
  if (!rows.length) return;
  const m = new Map((await loadAll()).map(r => [r.code, r]));
  for (const r of rows) m.set(r.code, r);
  try { await AsyncStorage.setItem(KEY, JSON.stringify([...m.values()])); } catch { /* the browser's storage is full: kept in memory for this visit */ }
}

export async function clearAll(): Promise<void> {
  await AsyncStorage.removeItem(KEY).catch(() => {});
}
