// Pure logic shared by every screen: no React, no native code, so it runs under `node --test`.
import type { Cart, Catalog, Product, Promo } from "./types";

export function norm(s: string): string {
  return s.replace(/["'׳״`]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}

export function toProducts(c: Catalog): Map<string, Product> {
  const m = new Map<string, Product>();
  for (const [code, name, cat, w, prices, picks, img] of c.products) {
    m.set(code, { code, name, cat, weighted: w === 1, prices, picks, img: img ?? null, key: norm(name) });
  }
  return m;
}

export function km(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = Math.PI / 180;
  const p1 = lat1 * r, p2 = lat2 * r, dp = p2 - p1, dl = (lon2 - lon1) * r;
  return 2 * 6371 * Math.asin(Math.sqrt(Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2));
}

export function storeKm(c: Catalog, i: number): number | null {
  const a = c.areas[0], s = c.stores[i];
  if (!a || s.lat == null || s.lon == null) return null;
  return km(a.lat, a.lon, s.lat, s.lon);
}

export type PriceInfo = { lo: number | null; hi: number | null; at: number; n: number };

/** Cheapest and dearest price among the active stores. */
export function priceInfo(p: Product, active: number[]): PriceInfo {
  let lo: number | null = null, hi: number | null = null, at = -1, n = 0;
  for (const i of active) {
    const v = p.prices[i];
    if (v == null) continue;
    n++;
    if (lo == null || v < lo) { lo = v; at = i; }
    if (hi == null || v > hi) hi = v;
  }
  return { lo, hi, at, n };
}

export type Sort = "pop" | "cheap" | "gap";

export function search(all: Iterable<Product>, active: number[], q: string, cat: string, sort: Sort): [Product, PriceInfo][] {
  const terms = norm(q).split(" ").filter(Boolean);
  const out: [Product, PriceInfo][] = [];
  for (const p of all) {
    if (cat !== "all" && p.cat !== cat) continue;
    if (terms.length && !terms.every(t => p.key.includes(t))) continue;
    const pi = priceInfo(p, active);
    if (pi.lo == null) continue;
    out.push([p, pi]);
  }
  if (sort === "cheap") out.sort((a, b) => a[1].lo! - b[1].lo!);
  else if (sort === "gap") out.sort((a, b) => b[1].hi! / b[1].lo! - a[1].hi! / a[1].lo!);
  else if (terms.length) out.sort((a, b) => Number(b[0].key.startsWith(terms[0])) - Number(a[0].key.startsWith(terms[0])) || b[1].n - a[1].n);
  return out;
}

// ---- Promotions ----------------------------------------------------------------------------

/** Which chains' club prices the user can get. Keys are portal keys (the part of a store id before ":"). */
export type ClubPrefs = Record<string, boolean>;

/** Promotions indexed for the basket maths: per store index, product code -> promos. */
export type Deals = { byStore: Map<string, Promo[]>[]; club: boolean[]; now: number };

export const chainKey = (storeId: string) => storeId.split(":")[0];

/** "202611302359" -> epoch ms (local time), or null when absent or malformed. */
export function stampMs(s?: string): number | null {
  if (!s || !/^\d{12}/.test(s)) return null;
  return new Date(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10), +s.slice(10, 12)).getTime();
}

export function makeDeals(c: Catalog, club: ClubPrefs = {}, now: number = Date.now()): Deals {
  const byStore = c.stores.map((_, i) => {
    const m = new Map<string, Promo[]>();
    for (const pr of c.promos?.[i] ?? []) for (const code of pr.codes) {
      const l = m.get(code);
      if (l) l.push(pr); else m.set(code, [pr]);
    }
    return m;
  });
  return { byStore, club: c.stores.map(s => !!club[chainKey(s.id)]), now };
}

/** Cost in agorot of q units at shelf price `unit` under one promotion (units beyond its limit, and bundle remainders, at shelf price). */
export function promoCost(pr: Promo, unit: number, q: number): number {
  const cap = pr.max && pr.max > 0 ? Math.min(q, pr.max) : q;
  const rest = (q - cap) * unit;
  if (pr.kind === "price") return rest + cap * pr.value;
  if (pr.kind === "percent") return rest + cap * unit * (1 - pr.value / 100);
  const n = Math.floor(cap / pr.minQty);
  return rest + n * pr.value + (cap - n * pr.minQty) * unit;
}

/** Promotions at store i for this product that haven't ended, club ones included (to show what a card would unlock). */
export function shownPromos(d: Deals | undefined, i: number, code: string): Promo[] {
  const l = d?.byStore[i]?.get(code);
  if (!l) return [];
  return l.filter(pr => {
    const end = stampMs(pr.end);
    return end == null || end >= d!.now;
  });
}

/** Promotions the user can use at store i for this product right now (club ones only with a club card, expired ones never). */
export function livePromos(d: Deals | undefined, i: number, code: string): Promo[] {
  return shownPromos(d, i, code).filter(pr => !pr.club || d!.club[i]);
}

/** Chains (portal keys) that have at least one club promotion in this catalog, with a label to show. */
export function clubChains(c: Catalog): { key: string; label: string }[] {
  const out = new Map<string, string>();
  c.stores.forEach((s, i) => {
    if (!(c.promos?.[i] ?? []).some(pr => pr.club)) return;
    const key = chainKey(s.id);
    if (!out.has(key)) out.set(key, key === "shufersal" ? "שופרסל" : s.chain);
  });
  return [...out].map(([key, label]) => ({ key, label }));
}

export type Priced = { cost: number; shelf: number; promo: Promo | null };

/** Cost of q units at store i: the best usable promotion, or the shelf price. null = not sold there. */
export function priceAt(p: Product, i: number, q: number, d?: Deals): Priced | null {
  const unit = p.prices[i];
  if (unit == null) return null;
  const shelf = unit * q;
  let best: Priced = { cost: shelf, shelf, promo: null };
  if (p.weighted) return best; // fresh items are matched by name; promotions are by barcode
  for (const pr of livePromos(d, i, p.code)) {
    const c = promoCost(pr, unit, q);
    if (c < best.cost - 1e-9) best = { cost: c, shelf, promo: pr };
  }
  return best;
}

/** Effective price of one unit when the deal applies, in agorot. */
export const dealUnit = (pr: Promo, shelf: number) => (pr.kind === "price" ? pr.value : pr.kind === "percent" ? shelf * (1 - pr.value / 100) : pr.value / pr.minQty);

/** Short text for a promotion's terms: "2 ב־10.00 ₪", "8.90 ₪", "20% הנחה". */
export function dealText(pr: Promo): string {
  if (pr.kind === "bundle") return `${pr.minQty} ב־${money(pr.value)} ₪`;
  if (pr.kind === "price") return `${money(pr.value)} ₪`;
  return `${+pr.value.toFixed(1)}% הנחה`;
}

export type BestDeal = { i: number; promo: Promo; unit: number; shelf: number };

/** The deal with the lowest effective unit price among the active stores (for badges on cards). */
export function bestDeal(p: Product, active: number[], d?: Deals): BestDeal | null {
  if (!d || p.weighted) return null;
  let best: BestDeal | null = null;
  for (const i of active) {
    const shelf = p.prices[i];
    if (shelf == null) continue;
    for (const pr of livePromos(d, i, p.code)) {
      const unit = dealUnit(pr, shelf);
      if (unit < shelf && (!best || unit < best.unit)) best = { i, promo: pr, unit, shelf };
    }
  }
  return best;
}

export type StoreTotal = {
  i: number;
  total: number; // with promotions
  shelf: number; // the same items at shelf prices ("ללא מבצעים")
  fair: number; // like-for-like total, with promotions
  fairShelf: number; // like-for-like total at shelf prices
  deals: number; // items in the basket that get a promotion here
  missing: string[];
};
export type Line = { p: Product; q: number; best: (Priced & { i: number }) | null }; // cheapest active store for this item, promotions counted
export type Comparison = {
  items: [Product, number][];
  lines: Line[];
  rows: StoreTotal[]; // best first: fewest missing items, then lowest total
  common: number; // items every active store sells
  fairLow: number; // lowest like-for-like total
  fairLowShelf: number;
  split: number; // cheapest store per item
  splitShelf: number; // the same cherry-pick at shelf prices
  splitStores: number;
};

/**
 * The basket comparison: per-store totals, like-for-like totals and the cherry-pick total, in agorot.
 * With `deals`, each item at each store costs its best usable promotion; shelf totals are kept alongside.
 */
export function compare(products: Map<string, Product>, cart: Cart, active: number[], deals?: Deals): Comparison {
  const items = Object.entries(cart).map(([c, q]) => [products.get(c), q] as const).filter((x): x is [Product, number] => !!x[0]);
  const commonItems = items.filter(([p]) => active.every(i => p.prices[i] != null));
  const rows: StoreTotal[] = active.map(i => {
    let total = 0, shelf = 0, n = 0;
    const missing: string[] = [];
    for (const [p, q] of items) {
      const r = priceAt(p, i, q, deals);
      if (!r) { missing.push(p.name); continue; }
      total += r.cost; shelf += r.shelf;
      if (r.promo) n++;
    }
    let fair = 0, fairShelf = 0;
    for (const [p, q] of commonItems) { const r = priceAt(p, i, q, deals)!; fair += r.cost; fairShelf += r.shelf; }
    return { i, total: Math.round(total), shelf: Math.round(shelf), fair: Math.round(fair), fairShelf: Math.round(fairShelf), deals: n, missing };
  });
  rows.sort((a, b) => a.missing.length - b.missing.length || a.total - b.total);
  let split = 0, splitShelf = 0;
  const used = new Set<number>();
  const lines: Line[] = [];
  for (const [p, q] of items) {
    let best: Line["best"] = null;
    let lowShelf: number | null = null;
    for (const i of active) {
      const r = priceAt(p, i, q, deals);
      if (!r) continue;
      if (!best || r.cost < best.cost) best = { ...r, i };
      if (lowShelf == null || r.shelf < lowShelf) lowShelf = r.shelf;
    }
    lines.push({ p, q, best });
    if (best) { split += best.cost; splitShelf += lowShelf!; used.add(best.i); }
  }
  return {
    items: items as [Product, number][],
    lines,
    rows,
    common: commonItems.length,
    fairLow: rows.length ? Math.min(...rows.map(r => r.fair)) : 0,
    fairLowShelf: rows.length ? Math.min(...rows.map(r => r.fairShelf)) : 0,
    split: Math.round(split),
    splitShelf: Math.round(splitShelf),
    splitStores: used.size,
  };
}

export const money = (agorot: number) => (agorot / 100).toFixed(2);
export const step = (p: Product) => (p.weighted ? 0.5 : 1);
export const qtyText = (p: Product, q: number) => (p.weighted ? `${q} ק״ג` : `${q}`);

export function fmtDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${+d}.${+m}.${y}`;
}

/** "202611120710" -> "12.11 07:10" */
export function fmtStamp(s?: string): string {
  if (!s || s.length < 12) return "";
  return `${+s.slice(6, 8)}.${+s.slice(4, 6)} ${s.slice(8, 10)}:${s.slice(10, 12)}`;
}

export function newestStamp(c: Catalog): string {
  return c.stores.map(s => s.fileTime ?? "").sort().pop() ?? "";
}
