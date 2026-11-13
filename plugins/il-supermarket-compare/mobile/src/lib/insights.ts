// What the catalog says beyond single prices: which branch is cheapest overall, where comparing pays
// most, what changed since the last sync, and what the user buys again and again.
// Pure logic (no React, no storage): runs under `node --test`.
import { dealText, isStale, priceAt, priceInfo, type Deals } from "./compare.ts";
import type { Catalog, Product } from "./types.ts";

// ---- Price index ---------------------------------------------------------------------------

export type IndexRow = {
  i: number; // store index
  index: number; // 1 = the area's typical price; 0.94 = 6% below it
  pct: number; // (index - 1) * 100, rounded to one decimal
  n: number; // products the figure is based on
  cheapest: number; // of those, how many are cheapest (or tied) here
};

export type IndexOpts = { cat?: string; minStores?: number; minProducts?: number };

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/**
 * How expensive each active branch is, on shelf prices, relative to the others around it.
 *
 * For every product sold at three or more of the branches (two, when only two are compared), each
 * branch's price is divided by the median price of that product; a branch's index is the geometric
 * mean of its ratios. So "0.94" reads "the things this branch sells cost 6% less here than they
 * typically do nearby". A price a branch hasn't charged anyone for a month (not sold there) is left
 * out, and a branch needs `minProducts` comparable products to be ranked. Cheapest first.
 */
export function priceIndex(products: Iterable<Product>, active: number[], o: IndexOpts = {}): IndexRow[] {
  const minStores = o.minStores ?? Math.max(2, Math.min(3, active.length));
  const minProducts = o.minProducts ?? (o.cat ? 12 : 40);
  const logSum = new Map<number, number>(), n = new Map<number, number>(), cheapest = new Map<number, number>();
  for (const p of products) {
    if (o.cat && p.cat !== o.cat) continue;
    const at: number[] = [], vals: number[] = [];
    for (const i of active) {
      const v = p.prices[i];
      if (v == null || v <= 0 || isStale(p, i)) continue;
      at.push(i); vals.push(v);
    }
    if (vals.length < minStores) continue;
    const m = median(vals), lo = Math.min(...vals);
    for (let k = 0; k < at.length; k++) {
      const r = Math.min(2, Math.max(0.5, vals[k] / m)); // one odd price can't swing a branch
      logSum.set(at[k], (logSum.get(at[k]) ?? 0) + Math.log(r));
      n.set(at[k], (n.get(at[k]) ?? 0) + 1);
      if (vals[k] === lo) cheapest.set(at[k], (cheapest.get(at[k]) ?? 0) + 1);
    }
  }
  const rows: IndexRow[] = [];
  for (const i of active) {
    const c = n.get(i) ?? 0;
    if (c < minProducts) continue;
    const index = Math.exp(logSum.get(i)! / c);
    rows.push({ i, index, pct: Math.round((index - 1) * 1000) / 10, n: c, cheapest: cheapest.get(i) ?? 0 });
  }
  return rows.sort((a, b) => a.index - b.index || b.n - a.n);
}

export type CatWinner = { cat: string; best: IndexRow; next: IndexRow | null; rows: IndexRow[] };

/** The cheapest branch for each category that has enough comparable products (see priceIndex). */
export function categoryWinners(products: Map<string, Product>, active: number[], cats: string[]): CatWinner[] {
  const all = [...products.values()];
  const out: CatWinner[] = [];
  for (const cat of cats) {
    const rows = priceIndex(all, active, { cat });
    if (rows.length >= 2) out.push({ cat, best: rows[0], next: rows[1], rows });
  }
  return out;
}

// ---- Where comparing pays ------------------------------------------------------------------

export type Gap = { p: Product; lo: number; hi: number; loAt: number; hiAt: number; n: number; save: number; pct: number };

/**
 * Products with the widest price range between the active branches: the ones worth checking before
 * you buy. Only products most of the branches sell (so it's something you can actually find), prices
 * the branch has sold at recently, at least `minSave` agorot apart, and no more than 3x apart (more
 * than that is two different things under one barcode).
 */
export function topGaps(products: Iterable<Product>, active: number[], limit = 20, minSave = 200): Gap[] {
  const need = Math.max(3, Math.ceil(active.length * 0.5));
  const out: Gap[] = [];
  for (const p of products) {
    let lo = Infinity, hi = 0, loAt = -1, hiAt = -1, n = 0;
    for (const i of active) {
      const v = p.prices[i];
      if (v == null || isStale(p, i)) continue;
      n++;
      if (v < lo) { lo = v; loAt = i; }
      if (v > hi) { hi = v; hiAt = i; }
    }
    if (n < need || hi - lo < minSave || hi > lo * 3) continue;
    out.push({ p, lo, hi, loAt, hiAt, n, save: hi - lo, pct: Math.round((hi / lo - 1) * 100) });
  }
  return out.sort((a, b) => b.pct - a.pct || b.save - a.save).slice(0, limit);
}

// ---- Price changes between syncs -----------------------------------------------------------

/** One price that moved at one branch. day is YYYY-MM-DD (when we saw it). */
export type Change = { code: string; store: string; from: number; to: number; day: string };

/**
 * Prices that differ between two catalogs, for branches in both whose price file is a newer one.
 * The chains' own files only say WHEN a price last changed; the direction and the size come from
 * comparing what we downloaded last time with what we downloaded now.
 */
export function diffCatalogs(prev: Catalog, next: Catalog, day: string): Change[] {
  const before = new Map<string, number>(); // store id -> index in prev
  prev.stores.forEach((s, i) => before.set(s.id, i));
  const pairs: [number, number, string][] = [];
  next.stores.forEach((s, j) => {
    const i = before.get(s.id);
    if (i == null) return;
    if (s.file && prev.stores[i].file === s.file) return; // the same file: nothing can have changed
    pairs.push([i, j, s.id]);
  });
  if (!pairs.length) return [];
  const old = new Map<string, (number | null)[]>();
  for (const p of prev.products) old.set(p[0], p[4]);
  const out: Change[] = [];
  for (const p of next.products) {
    const was = old.get(p[0]);
    if (!was) continue;
    for (const [i, j, store] of pairs) {
      const a = was[i], b = p[4][j];
      if (a == null || b == null || a === b) continue;
      out.push({ code: p[0], store, from: a, to: b, day });
    }
  }
  return out;
}

const dayNum = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86_400_000;

/** The log with new changes added, entries older than keepDays dropped, and the oldest dropped beyond max. */
export function mergeChanges(log: Change[], add: Change[], today: string, keepDays = 30, max = 4000): Change[] {
  const cut = dayNum(today) - keepDays;
  const merged = [...log, ...add].filter(c => dayNum(c.day) >= cut);
  return merged.length > max ? merged.slice(merged.length - max) : merged;
}

export type ChangeView = { p: Product; i: number; from: number; to: number; delta: number; pct: number; day: string };
export type ChangeSummary = { up: ChangeView[]; down: ChangeView[]; since: string | null };

/**
 * The log as the app shows it: for each product at each active branch the net move over the log
 * (first price seen -> current price), drops and rises separately, biggest percentage first. A price
 * that went up and came back is not a change. `only` limits it to some products (the cart, favourites).
 */
export function summarizeChanges(log: Change[], products: Map<string, Product>, catalog: Catalog, active: number[], only?: Set<string>): ChangeSummary {
  const idx = new Map<string, number>();
  catalog.stores.forEach((s, i) => idx.set(s.id, i));
  const on = new Set(active);
  const net = new Map<string, { code: string; i: number; from: number; day: string }>();
  let since: string | null = null;
  for (const c of log) {
    const i = idx.get(c.store);
    if (i == null || !on.has(i) || (only && !only.has(c.code))) continue;
    if (!since || c.day < since) since = c.day;
    const k = `${c.code}|${i}`;
    const e = net.get(k);
    if (e) e.day = c.day; else net.set(k, { code: c.code, i, from: c.from, day: c.day });
  }
  const up: ChangeView[] = [], down: ChangeView[] = [];
  for (const e of net.values()) {
    const p = products.get(e.code);
    const to = p?.prices[e.i];
    if (!p || to == null || to === e.from || e.from <= 0) continue;
    const v: ChangeView = { p, i: e.i, from: e.from, to, delta: to - e.from, pct: Math.round((to / e.from - 1) * 1000) / 10, day: e.day };
    (v.delta < 0 ? down : up).push(v);
  }
  down.sort((a, b) => a.pct - b.pct);
  up.sort((a, b) => b.pct - a.pct);
  return { up, down, since };
}

/** How many prices each active branch says it changed in the last `days` days (chains that date their changes only). */
export function recentlyChanged(products: Iterable<Product>, active: number[], days = 7): { total: number; byStore: Map<number, number> } {
  const on = new Set(active), byStore = new Map<number, number>();
  let total = 0;
  for (const p of products) for (const [i, d] of p.meta?.chg ?? []) {
    if (d > days || !on.has(i) || p.prices[i] == null) continue;
    total++;
    byStore.set(i, (byStore.get(i) ?? 0) + 1);
  }
  return { total, byStore };
}

// ---- Regulars ------------------------------------------------------------------------------

/** code -> [times put in a cart, when last (ms), when first (ms)] */
export type Freq = Record<string, [number, number, number?]>;

/** Counts one more "put in the cart" for a product. At most once a day per product, so +/- taps don't inflate it. */
export function bumpFreq(freq: Freq, code: string, now: number): Freq {
  const e = freq[code];
  if (e && now - e[1] < 20 * 3_600_000) return freq;
  return { ...freq, [code]: [(e?.[0] ?? 0) + 1, now, e?.[2] ?? e?.[1] ?? now] };
}

/** Keeps the `max` most used entries (by count, then recency). */
export function trimFreq(freq: Freq, max = 300): Freq {
  const e = Object.entries(freq);
  if (e.length <= max) return freq;
  e.sort((a, b) => b[1][0] - a[1][0] || b[1][1] - a[1][1]);
  return Object.fromEntries(e.slice(0, max));
}

/**
 * What the user buys again and again: products they have put in a cart on two or more days (or once,
 * when there is nothing better), that an active branch sells and that are not in the cart now.
 * Most used first.
 */
export function regulars(freq: Freq, products: Map<string, Product>, active: number[], cart: Record<string, number>, limit = 12): Product[] {
  const rows = Object.entries(freq)
    .filter(([code]) => !(code in cart))
    .map(([code, [n, at]]) => ({ p: products.get(code), n, at }))
    .filter((r): r is { p: Product; n: number; at: number } => !!r.p && priceInfo(r.p, active).lo != null)
    .sort((a, b) => b.n - a.n || b.at - a.at);
  const repeat = rows.filter(r => r.n >= 2);
  return (repeat.length >= 3 ? repeat : rows).slice(0, limit).map(r => r.p);
}

// ---- In-store checklist --------------------------------------------------------------------

export type ShopLine = { p: Product; q: number; cost: number; shelf: number; deal: string | null; stale: boolean };
export type ShopPlan = {
  store: number;
  groups: { cat: string; lines: ShopLine[] }[]; // in category order, so the list follows the shop's departments
  missing: { p: Product; q: number; at: number | null; cost: number | null }[]; // not sold at this branch: where it's cheapest instead
  total: number;
};

/**
 * The cart as a shopping list for one branch: what each item costs there (best usable promotion
 * included), grouped by department; and what that branch doesn't sell, with the cheapest active
 * branch that does.
 */
export function shopPlan(products: Map<string, Product>, cart: Record<string, number>, store: number, active: number[], catOrder: string[], deals?: Deals): ShopPlan {
  const byCat = new Map<string, ShopLine[]>();
  const missing: ShopPlan["missing"] = [];
  let total = 0;
  for (const [code, q] of Object.entries(cart)) {
    const p = products.get(code);
    if (!p) continue;
    const r = priceAt(p, store, q, deals);
    if (!r) {
      let at: number | null = null, cost: number | null = null;
      for (const i of active) {
        const o = priceAt(p, i, q, deals);
        if (o && (cost == null || o.cost < cost)) { cost = o.cost; at = i; }
      }
      missing.push({ p, q, at, cost });
      continue;
    }
    total += r.cost;
    const line: ShopLine = { p, q, cost: Math.round(r.cost), shelf: Math.round(r.shelf), deal: r.promo ? dealText(r.promo) : null, stale: isStale(p, store) };
    const l = byCat.get(p.cat);
    if (l) l.push(line); else byCat.set(p.cat, [line]);
  }
  const rank = (c: string) => { const k = catOrder.indexOf(c); return k < 0 ? 999 : k; };
  const groups = [...byCat].sort((a, b) => rank(a[0]) - rank(b[0])).map(([cat, lines]) => ({ cat, lines: lines.sort((a, b) => a.p.name.localeCompare(b.p.name, "he")) }));
  return { store, groups, missing, total: Math.round(total) };
}

// ---- Freshness of the price files ----------------------------------------------------------

/** Hours between a branch's price file and the newest file in the catalog; null when either has no time. */
export function fileLagHours(c: Catalog, i: number): number | null {
  const ms = (s?: string) => (s && /^\d{12}/.test(s) ? Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10), +s.slice(10, 12)) : null);
  const mine = ms(c.stores[i]?.fileTime);
  let newest: number | null = null;
  for (const s of c.stores) { const v = ms(s.fileTime); if (v != null && (newest == null || v > newest)) newest = v; }
  if (mine == null || newest == null) return null;
  return Math.round((newest - mine) / 3_600_000);
}

/** Branches whose price file is more than `hours` behind the newest one: their prices may be out of date. */
export function staleFiles(c: Catalog, active: number[], hours = 36): { i: number; lag: number }[] {
  const out: { i: number; lag: number }[] = [];
  for (const i of active) { const lag = fileLagHours(c, i); if (lag != null && lag > hours) out.push({ i, lag }); }
  return out.sort((a, b) => b.lag - a.lag);
}

// ---- Deals on my products ------------------------------------------------------------------

/**
 * Deals on products the user cares about (cart, regulars, followed), best real saving first, one per
 * product. `items` is the deals feed (already filtered for club use).
 */
export function dealsOnMine<T extends { code: string; verdict: string; realPct: number; savePct: number }>(items: T[], mine: Set<string>, limit = 12): T[] {
  const best = new Map<string, T>();
  const score = (d: T) => (d.verdict === "real" ? 1000 + d.realPct : d.savePct);
  for (const d of items) {
    if (!mine.has(d.code)) continue;
    const b = best.get(d.code);
    if (!b || score(d) > score(b)) best.set(d.code, d);
  }
  return [...best.values()].sort((a, b) => score(b) - score(a)).slice(0, limit);
}
