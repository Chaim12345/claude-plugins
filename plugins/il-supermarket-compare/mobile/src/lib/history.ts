// Price history for followed products and the usual basket: one compact snapshot per day, kept 90 days.
// Pure: no React, no storage (watchstore.ts persists it), so it runs under `node --test`.
import { bestDeal, compare, type Comparison, type Deals } from "./compare.ts";
import type { Cart, Catalog, Product } from "./types";

export const KEEP_DAYS = 90;
export const MAX_BYTES = 300_000; // serialized size cap; oldest days go first
const MIN_DAYS_KEPT = 7;

/**
 * One product on one day, in agorot: [shelf price at the cheapest branch, its store index,
 * effective price counting the best live deal, its store index]. Store indexes point into History.stores,
 * so a branch id is stored once, not on every row.
 */
export type PSnap = [number, number, number, number];
/** The usual basket on one day: [cheapest total with deals, store index, items signature, items missing there]. */
export type BSnap = [number, number, string, number];
export type Day = {
  d: string; // YYYY-MM-DD, local time
  sig: string; // which branches and club cards the numbers were computed for; a change makes the day a new baseline
  p: Record<string, PSnap>;
  b?: BSnap;
};
export type History = { v: 1; stores: string[]; days: Day[] }; // days oldest first

export const emptyHistory = (): History => ({ v: 1, stores: [], days: [] });

export type ProductPoint = { lo: number; loStore: string; eff: number; effStore: string; deal: boolean };
export type BasketPoint = { total: number; store: string; sig: string; missing: number };

const pad = (n: number) => String(n).padStart(2, "0");

/** Local calendar day of a timestamp, "2026-11-12". */
export function dayKey(ms: number): string {
  const x = new Date(ms);
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
}

/** Whole days from day key a to day key b (calendar days, so DST can't skew it). */
export function daysBetween(a: string, b: string): number {
  const [ya, ma, da] = a.split("-").map(Number), [yb, mb, db] = b.split("-").map(Number);
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / 86_400_000);
}

/** A short stable signature of the branches compared and the club cards held. */
export function configSig(catalog: Catalog, active: number[], clubOn: boolean[]): string {
  const ids = active.map(i => catalog.stores[i]?.id + (clubOn[i] ? "+" : "")).filter(Boolean).sort().join(",");
  let h = 5381;
  for (let i = 0; i < ids.length; i++) h = ((h * 33) ^ ids.charCodeAt(i)) >>> 0;
  return `${active.length}.${h.toString(36)}`;
}

/** A signature of the basket's contents: same items and quantities, same signature. */
export function basketSig(cart: Cart): string {
  const s = Object.keys(cart).sort().map(k => `${k}:${cart[k]}`).join("|");
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return `${Object.keys(cart).length}.${h.toString(36)}`;
}

/** The cheapest shelf price and the best live deal for a product among the active stores. null when no active store sells it. */
export function productPoint(p: Product, active: number[], catalog: Catalog, deals?: Deals): ProductPoint | null {
  let lo: number | null = null, at = -1;
  for (const i of active) {
    const v = p.prices[i];
    if (v != null && (lo == null || v < lo)) { lo = v; at = i; }
  }
  if (lo == null) return null;
  const d = bestDeal(p, active, deals);
  const dealUnit = d ? Math.round(d.unit) : null;
  const eff = dealUnit != null && dealUnit < lo ? dealUnit : lo;
  const effAt = dealUnit != null && dealUnit < lo ? d!.i : at;
  return { lo, loStore: catalog.stores[at].id, eff, effStore: catalog.stores[effAt].id, deal: eff < lo };
}

/** The usual basket's cheapest store and total, from a comparison. null for an empty basket or no active store. */
export function basketPoint(cmp: Comparison | null, catalog: Catalog, cart: Cart): BasketPoint | null {
  const best = cmp?.rows[0];
  if (!cmp || !best || !cmp.items.length) return null;
  return { total: best.total, store: catalog.stores[best.i].id, sig: basketSig(cart), missing: best.missing.length };
}

export function basketFor(products: Map<string, Product>, cart: Cart, active: number[], deals?: Deals): Comparison | null {
  return Object.keys(cart).length ? compare(products, cart, active, deals) : null;
}

function intern(h: History, id: string): number {
  let k = h.stores.indexOf(id);
  if (k < 0) { k = h.stores.length; h.stores.push(id); }
  return k;
}

/**
 * Records a day. Merges into that day when it exists (a product followed at noon joins the morning's snapshot;
 * a later sync the same day replaces the numbers), drops products nobody follows any more, enforces the
 * 90-day and size caps. Returns a new History.
 */
export function record(h: History, now: number, sig: string, products: Record<string, ProductPoint>, basket: BasketPoint | null, followed?: Iterable<string>): History {
  const out: History = { v: 1, stores: [...h.stores], days: h.days.map(d => ({ ...d, p: { ...d.p } })) };
  const key = dayKey(now);
  let day = out.days.find(d => d.d === key);
  if (!day) { day = { d: key, sig, p: {} }; out.days.push(day); out.days.sort((a, b) => (a.d < b.d ? -1 : 1)); }
  day.sig = sig;
  for (const [code, pt] of Object.entries(products)) day.p[code] = [pt.lo, intern(out, pt.loStore), pt.eff, intern(out, pt.effStore)];
  if (basket) day.b = [basket.total, intern(out, basket.store), basket.sig, basket.missing]; else delete day.b;
  return trim(followed ? keepOnly(out, new Set(followed)) : out, now);
}

function keepOnly(h: History, codes: Set<string>): History {
  for (const d of h.days) for (const c of Object.keys(d.p)) if (!codes.has(c)) delete d.p[c];
  return h;
}

/** Removes products that are no longer followed. */
export function prune(h: History, followed: Iterable<string>): History {
  return keepOnly({ v: 1, stores: [...h.stores], days: h.days.map(d => ({ ...d, p: { ...d.p } })) }, new Set(followed));
}

export const sizeOf = (h: History) => JSON.stringify(h).length;

/** Drops days older than 90, then the oldest days while the serialized size is over the cap (keeps at least a week), and unused store ids. */
export function trim(h: History, now: number, keepDays = KEEP_DAYS, maxBytes = MAX_BYTES): History {
  const today = dayKey(now);
  let days = h.days.filter(d => daysBetween(d.d, today) < keepDays);
  let out: History = { v: 1, stores: h.stores, days };
  while (days.length > MIN_DAYS_KEPT && sizeOf(out) > maxBytes) { days = days.slice(1); out = { v: 1, stores: h.stores, days }; }
  return compact(out);
}

/** Renumbers the store table to the ids still in use. */
function compact(h: History): History {
  const used = new Map<number, number>(), stores: string[] = [];
  const re = (k: number) => {
    let n = used.get(k);
    if (n == null) { n = stores.length; used.set(k, n); stores.push(h.stores[k]); }
    return n;
  };
  const days = h.days.map(d => {
    const p: Record<string, PSnap> = {};
    for (const [c, s] of Object.entries(d.p)) p[c] = [s[0], re(s[1]), s[2], re(s[3])];
    const day: Day = { d: d.d, sig: d.sig, p };
    if (d.b) day.b = [d.b[0], re(d.b[1]), d.b[2], d.b[3]];
    return day;
  });
  return { v: 1, stores, days };
}

const decodeP = (h: History, s: PSnap): ProductPoint => ({ lo: s[0], loStore: h.stores[s[1]], eff: s[2], effStore: h.stores[s[3]], deal: s[2] < s[0] });
const decodeB = (h: History, s: BSnap): BasketPoint => ({ total: s[0], store: h.stores[s[1]], sig: s[2], missing: s[3] });

export type Dated<T> = { day: string; sig: string; v: T };

/** The latest snapshot of a product on a day before `beforeDay` (default: any day). */
export function latestProduct(h: History, code: string, beforeDay?: string): Dated<ProductPoint> | null {
  for (let i = h.days.length - 1; i >= 0; i--) {
    const d = h.days[i];
    if (beforeDay && d.d >= beforeDay) continue;
    if (d.p[code]) return { day: d.d, sig: d.sig, v: decodeP(h, d.p[code]) };
  }
  return null;
}

export function latestBasket(h: History, beforeDay?: string): Dated<BasketPoint> | null {
  for (let i = h.days.length - 1; i >= 0; i--) {
    const d = h.days[i];
    if (beforeDay && d.d >= beforeDay) continue;
    if (d.b) return { day: d.d, sig: d.sig, v: decodeB(h, d.b) };
  }
  return null;
}

/** The snapshot closest to `ago` days before today, within `slack` days either way. */
export function nearProduct(h: History, code: string, now: number, ago: number, slack = 3): Dated<ProductPoint> | null {
  const today = dayKey(now);
  let best: Dated<ProductPoint> | null = null, bestGap = Infinity;
  for (const d of h.days) {
    if (!d.p[code]) continue;
    const gap = Math.abs(daysBetween(d.d, today) - ago);
    if (gap <= slack && gap < bestGap) { best = { day: d.d, sig: d.sig, v: decodeP(h, d.p[code]) }; bestGap = gap; }
  }
  return best;
}

export function nearBasket(h: History, now: number, ago: number, slack = 3): Dated<BasketPoint> | null {
  const today = dayKey(now);
  let best: Dated<BasketPoint> | null = null, bestGap = Infinity;
  for (const d of h.days) {
    if (!d.b) continue;
    const gap = Math.abs(daysBetween(d.d, today) - ago);
    if (gap <= slack && gap < bestGap) { best = { day: d.d, sig: d.sig, v: decodeB(h, d.b) }; bestGap = gap; }
  }
  return best;
}

export type Point = { d: string; v: number };

/** A product's effective price per day over the last `days` days (including today), oldest first. */
export function series(h: History, code: string, now: number, days = 30): Point[] {
  const today = dayKey(now);
  return h.days.filter(d => d.p[code] && daysBetween(d.d, today) < days).map(d => ({ d: d.d, v: d.p[code][2] }));
}

export function basketSeries(h: History, now: number, days = 30): Point[] {
  const today = dayKey(now);
  return h.days.filter(d => d.b && daysBetween(d.d, today) < days).map(d => ({ d: d.d, v: d.b![0] }));
}

/** The lowest effective price in the last `days` days, not counting `exceptDay` (usually today); null with fewer than `minPoints` points. */
export function lowest(h: History, code: string, now: number, days = 30, exceptDay?: string, minPoints = 3): number | null {
  const pts = series(h, code, now, days).filter(p => p.d !== exceptDay);
  return pts.length >= minPoints ? Math.min(...pts.map(p => p.v)) : null;
}

/** "-12%" style change between the first and last point of a series; null with fewer than two points. */
export function trend(pts: Point[]): { from: number; to: number; pct: number } | null {
  if (pts.length < 2) return null;
  const from = pts[0].v, to = pts[pts.length - 1].v;
  return { from, to, pct: from ? ((to - from) / from) * 100 : 0 };
}
