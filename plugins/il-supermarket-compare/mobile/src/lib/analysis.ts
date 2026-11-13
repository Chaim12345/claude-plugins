// Analysis over the whole classified catalog (enrich.ts records + prices): which brands are cheap or
// dear for what they are, how much a chain's own brand saves against the national brands of the same
// product type, the cheapest per unit in every product type, and what the diet tags cover.
//
// "For what they are": every product is compared with the median unit price of its own product type
// and pack unit, so a premium cheese brand is compared with cheese, not with salt.
import { priceInfo } from "./compare.ts";
import { DIET, type Diet } from "./enrich.ts";
import type { Product } from "./types.ts";
import { sizeOf, unitPrice, type UnitPrice } from "./units.ts";

type Priced = { p: Product; type: string; brand: string; own: boolean; unit: UnitPrice; at: number }; // at: the cheapest branch

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const geo = (xs: number[]) => Math.exp(xs.reduce((t, x) => t + Math.log(x), 0) / xs.length);

/** Products with a record and a unit price at the active branches (cheapest current price). */
export function priced(products: Iterable<Product>, active: number[]): Priced[] {
  const out: Priced[] = [];
  for (const p of products) {
    const r = p.meta?.ai;
    if (!r || r.q) continue;
    const pi = priceInfo(p, active), lo = pi.lo;
    if (!lo) continue;
    let z = sizeOf(p);
    if (!z && r.s) z = { kind: r.s[1] === "g" ? "weight" : r.s[1] === "ml" ? "volume" : "count", amount: r.s[0], packs: r.s[2] };
    const unit = p.weighted ? { kind: "weight" as const, agorot: lo / 10 } : unitPrice(z, lo); // weighed: per kg -> per 100 g
    if (!unit) continue;
    out.push({ p, type: r.t, brand: r.b, own: r.pl, unit, at: pi.at });
  }
  return out;
}

export type TypeGroup = { type: string; kind: UnitPrice["kind"]; n: number; brands: number; median: number; cheapest: Priced; dearest: Priced };

/** Product types with at least `min` priced products, biggest first. */
export function typeGroups(xs: Priced[], min = 3): TypeGroup[] {
  const by = new Map<string, Priced[]>();
  for (const x of xs) {
    const k = `${x.type}|${x.unit.kind}`;
    (by.get(k) ?? by.set(k, []).get(k)!).push(x);
  }
  const out: TypeGroup[] = [];
  for (const l of by.values()) {
    if (l.length < min) continue;
    const s = [...l].sort((a, b) => a.unit.agorot - b.unit.agorot);
    out.push({ type: l[0].type, kind: l[0].unit.kind, n: l.length, brands: new Set(l.map(x => x.brand).filter(Boolean)).size, median: median(l.map(x => x.unit.agorot)), cheapest: s[0], dearest: s[s.length - 1] });
  }
  return out.sort((a, b) => b.n - a.n);
}

/** Each product's unit price against its type's median (1 = typical, 0.8 = 20% cheaper). */
function ratios(xs: Priced[], groups: TypeGroup[]): { x: Priced; r: number }[] {
  const med = new Map(groups.map(g => [`${g.type}|${g.kind}`, g.median]));
  const out: { x: Priced; r: number }[] = [];
  for (const x of xs) {
    const m = med.get(`${x.type}|${x.unit.kind}`);
    if (m && x.unit.agorot > 0) out.push({ x, r: x.unit.agorot / m });
  }
  return out;
}

export type BrandStat = { brand: string; n: number; types: number; index: number; own: boolean }; // index: geometric mean ratio

/** Brands with at least `min` comparable products across at least 2 types, cheapest first. */
export function brandIndex(xs: Priced[], groups: TypeGroup[], min = 5): BrandStat[] {
  const by = new Map<string, { r: number[]; types: Set<string>; own: number }>();
  for (const { x, r } of ratios(xs, groups)) {
    if (!x.brand) continue;
    const b = by.get(x.brand) ?? { r: [], types: new Set<string>(), own: 0 };
    b.r.push(r); b.types.add(x.type); if (x.own) b.own++;
    by.set(x.brand, b);
  }
  const out: BrandStat[] = [];
  for (const [brand, b] of by) if (b.r.length >= min && b.types.size >= 2) out.push({ brand, n: b.r.length, types: b.types.size, index: geo(b.r), own: b.own * 2 > b.r.length });
  return out.sort((a, b) => a.index - b.index);
}

export type OwnBrandStat = { brand: string; n: number; savePct: number }; // median % below the national brands of the same type

/** A chain's own brand against the national brands of the same product types. */
export function ownBrandSavings(xs: Priced[], min = 5): OwnBrandStat[] {
  const nat = new Map<string, number[]>();
  for (const x of xs) if (!x.own && x.brand) (nat.get(`${x.type}|${x.unit.kind}`) ?? nat.set(`${x.type}|${x.unit.kind}`, []).get(`${x.type}|${x.unit.kind}`)!).push(x.unit.agorot);
  const by = new Map<string, number[]>();
  for (const x of xs) {
    if (!x.own) continue;
    const l = nat.get(`${x.type}|${x.unit.kind}`);
    if (!l || l.length < 2) continue;
    (by.get(x.brand) ?? by.set(x.brand, []).get(x.brand)!).push((1 - x.unit.agorot / median(l)) * 100);
  }
  return [...by].filter(([, l]) => l.length >= min).map(([brand, l]) => ({ brand, n: l.length, savePct: median(l) })).sort((a, b) => b.savePct - a.savePct);
}

/** How many priced products carry each diet tag. */
export function dietCounts(products: Iterable<Product>): { tag: Diet; n: number }[] {
  const n = new Map<Diet, number>();
  for (const p of products) for (const d of p.meta?.ai?.d ?? []) n.set(d, (n.get(d) ?? 0) + 1);
  return DIET.filter(d => n.get(d)).map(tag => ({ tag, n: n.get(tag)! })).sort((a, b) => b.n - a.n);
}

export function coverage(products: Iterable<Product>): { total: number; done: number; unsure: number; brands: number; types: number } {
  let total = 0, done = 0, unsure = 0;
  const brands = new Set<string>(), types = new Set<string>();
  for (const p of products) {
    if (p.code.startsWith("f-")) continue;
    total++;
    const r = p.meta?.ai;
    if (!r) continue;
    done++;
    if (r.q) unsure++;
    if (r.b) brands.add(r.b);
    types.add(r.t);
  }
  return { total, done, unsure, brands: brands.size, types: types.size };
}
