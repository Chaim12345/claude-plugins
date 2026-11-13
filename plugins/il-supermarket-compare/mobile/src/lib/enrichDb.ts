// The product records (enrich.ts) in the browser's storage, for the web build. Android and iOS use
// SQLite (enrichDb.native.ts); Metro picks that file there, so this one never loads expo-sqlite.
// Append-only chunks, one per batch: rewriting one growing list on every batch froze the page.
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { EnrichRow } from "./enrich";

const KEY = "salzol:enrich";
const N = `${KEY}:n`;

async function count(): Promise<number> {
  return Number((await AsyncStorage.getItem(N).catch(() => null)) ?? 0) || 0;
}

export async function loadAll(): Promise<EnrichRow[]> {
  const n = await count();
  const m = new Map<string, EnrichRow>();
  try { for (const r of JSON.parse((await AsyncStorage.getItem(KEY)) ?? "[]") as EnrichRow[]) m.set(r.code, r); } catch { /* the old single list */ }
  for (let i = 0; i < n; i++) {
    try { for (const r of JSON.parse((await AsyncStorage.getItem(`${KEY}:${i}`)) ?? "[]") as EnrichRow[]) m.set(r.code, r); } catch { /* a bad chunk */ }
  }
  return [...m.values()];
}

export async function putMany(rows: EnrichRow[]): Promise<void> {
  if (!rows.length) return;
  const n = await count();
  try {
    await AsyncStorage.setItem(`${KEY}:${n}`, JSON.stringify(rows));
    await AsyncStorage.setItem(N, String(n + 1));
  } catch { /* the browser's storage is full: kept in memory for this visit */ }
}

export async function clearAll(): Promise<void> {
  const n = await count();
  await AsyncStorage.multiRemove([KEY, N, ...Array.from({ length: n }, (_, i) => `${KEY}:${i}`)]).catch(() => {});
}
