// Saved carts ("קנייה שבועית"): pure helpers; persistence lives in store.tsx.
import type { Cart } from "./types";

export type SavedList = { id: string; name: string; items: Cart; at: number };

const r1 = (x: number) => Math.round(x * 10) / 10;

/** Quantities add up when both carts hold the same product. */
export function mergeCarts(a: Cart, b: Cart): Cart {
  const out: Cart = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = r1((out[k] ?? 0) + v);
  return out;
}

export function cleanName(s: string, fallback: string): string {
  const t = s.replace(/\s+/g, " ").trim().slice(0, 40);
  return t || fallback;
}

export function newId(now = Date.now()): string {
  return now.toString(36) + Math.random().toString(36).slice(2, 6);
}

/** "קנייה שבועית", then "קנייה שבועית 2" when the name is taken. */
export function uniqueName(name: string, lists: SavedList[], ignoreId?: string): string {
  const taken = new Set(lists.filter(l => l.id !== ignoreId).map(l => l.name));
  if (!taken.has(name)) return name;
  for (let i = 2; ; i++) if (!taken.has(`${name} ${i}`)) return `${name} ${i}`;
}
