// The product records (enrich.ts) on Android and iOS: an SQLite table, read once at start-up, written a
// batch at a time as the model answers. The web build uses enrichDb.ts (the browser's storage).
import type { EnrichRow } from "./enrich";

type SQLiteModule = typeof import("expo-sqlite");
type DB = Awaited<ReturnType<SQLiteModule["openDatabaseAsync"]>>;

let dbp: Promise<DB | null> | null = null;

function open(): Promise<DB | null> {
  if (!dbp) {
    dbp = (async () => {
      try {
        const SQ = require("expo-sqlite") as SQLiteModule;
        const db = await SQ.openDatabaseAsync("salzol.db");
        await db.execAsync(`PRAGMA journal_mode = WAL;
          CREATE TABLE IF NOT EXISTS product_ai (code TEXT PRIMARY KEY NOT NULL, h TEXT NOT NULL, rec TEXT NOT NULL, model TEXT NOT NULL, at INTEGER NOT NULL);`);
        return db;
      } catch {
        return null; // an old build without the native module
      }
    })();
  }
  return dbp;
}

export async function loadAll(): Promise<EnrichRow[]> {
  const db = await open();
  if (!db) return [];
  const rows = await db.getAllAsync<{ code: string; h: string; rec: string; model: string; at: number }>("SELECT code, h, rec, model, at FROM product_ai");
  const out: EnrichRow[] = [];
  for (const r of rows) { try { out.push({ code: r.code, h: r.h, rec: JSON.parse(r.rec), model: r.model, at: r.at }); } catch { /* skip a bad row */ } }
  return out;
}

export async function putMany(rows: EnrichRow[]): Promise<void> {
  const db = await open();
  if (!db || !rows.length) return;
  await db.withTransactionAsync(async () => {
    for (const r of rows) {
      await db.runAsync("INSERT OR REPLACE INTO product_ai (code, h, rec, model, at) VALUES (?, ?, ?, ?, ?)", r.code, r.h, JSON.stringify(r.rec), r.model, r.at);
    }
  });
}

export async function clearAll(): Promise<void> {
  const db = await open();
  if (db) await db.execAsync("DELETE FROM product_ai");
}
