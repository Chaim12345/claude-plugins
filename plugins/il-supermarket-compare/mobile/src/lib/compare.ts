// Pure logic shared by every screen: no React, no native code, so it runs under `node --test`.
import type { Cart, Catalog, Product } from "./types";

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

export type StoreTotal = { i: number; total: number; fair: number; missing: string[] };
export type Comparison = {
  items: [Product, number][];
  rows: StoreTotal[]; // best first: fewest missing items, then lowest total
  common: number; // items every active store sells
  fairLow: number; // lowest like-for-like total
  split: number; // cheapest store per item
  splitStores: number;
};

/** The basket comparison: per-store totals, like-for-like totals and the cherry-pick total, in agorot. */
export function compare(products: Map<string, Product>, cart: Cart, active: number[]): Comparison {
  const items = Object.entries(cart).map(([c, q]) => [products.get(c), q] as const).filter((x): x is [Product, number] => !!x[0]);
  const commonItems = items.filter(([p]) => active.every(i => p.prices[i] != null));
  const rows: StoreTotal[] = active.map(i => {
    let total = 0;
    const missing: string[] = [];
    for (const [p, q] of items) {
      const v = p.prices[i];
      if (v == null) missing.push(p.name); else total += v * q;
    }
    const fair = commonItems.reduce((s, [p, q]) => s + p.prices[i]! * q, 0);
    return { i, total: Math.round(total), fair: Math.round(fair), missing };
  });
  rows.sort((a, b) => a.missing.length - b.missing.length || a.total - b.total);
  let split = 0;
  const used = new Set<number>();
  for (const [p, q] of items) {
    const pi = priceInfo(p, active);
    if (pi.lo != null) { split += pi.lo * q; used.add(pi.at); }
  }
  return {
    items: items as [Product, number][],
    rows,
    common: commonItems.length,
    fairLow: rows.length ? Math.min(...rows.map(r => r.fair)) : 0,
    split: Math.round(split),
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
