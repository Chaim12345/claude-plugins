// "For you": product recommendations, built like X's open-sourced home-timeline pipeline
// (github.com/twitter/the-algorithm): several candidate sources, a feature-based ranker, filters,
// diversity heuristics (X's "author diversity" becomes category and manufacturer diversity), and a
// feedback loop ("not interested" lowers what produced the card, adding raises it).
// Pure logic, no React or storage: runs under `node --test`.
import { isStale, priceInfo } from "./compare.ts";
import type { Product } from "./types.ts";

export type Source = "due" | "together" | "deal" | "drop" | "staple";

/** One past basket: when the user finished shopping, and what was in it. */
export type Basket = { at: number; items: Record<string, number> };

/** Feedback: dismissed products (code -> when) and per-source / per-category counts. */
export type Feedback = { dismissed: Record<string, number>; neg: Record<string, number>; pos: Record<string, number> };
export const emptyFeedback = (): Feedback => ({ dismissed: {}, neg: {}, pos: {} });

/** A deal the ranker can use (a subset of the deals feed's items). */
export type DealLike = { code: string; verdict: string; realPct: number; savePct: number; unit: number; qty: number; club: boolean };
/** A price move (insights.summarizeChanges). */
export type DropLike = { p: Product; pct: number };

export type Rec = {
  p: Product;
  source: Source;
  score: number;
  reason: string; // why this card, shown on it ("קונים כל ~7 ימים, לאחרונה לפני 9")
  qty: number; // suggested quantity (the user's usual one)
  price: number; // agorot: the deal's unit price when there is one, else the cheapest shelf price
};

export type RecInput = {
  products: Map<string, Product>;
  active: number[];
  cart: Record<string, number>;
  freq: Record<string, [number, number, number?]>; // code -> [times added, last added ms, first added ms]
  baskets: Basket[];
  deals: DealLike[]; // usable deals (club filtered), any verdict
  drops: DropLike[];
  feedback: Feedback;
  now: number;
  limit?: number;
};

const DAY = 86_400_000;

/** How much each source is trusted before feedback (a hand-set "light ranker"). */
export const SOURCE_WEIGHT: Record<Source, number> = { due: 1.0, together: 0.8, deal: 0.7, drop: 0.65, staple: 0.35 };

// ---- usual quantity and buying rhythm ----

/** The quantity the user usually buys: the median over past baskets that had it, else 1 (0.5 kg for fresh). */
export function usualQty(code: string, baskets: Basket[], weighted = false): number {
  const qs = baskets.map(b => b.items[code]).filter((q): q is number => q != null && q > 0).sort((a, b) => a - b);
  if (!qs.length) return weighted ? 0.5 : 1;
  return qs[Math.floor((qs.length - 1) / 2)];
}

/**
 * Days between purchases and days since the last one. From baskets when the product is in two or
 * more; else from the add-to-cart counter (first and last day it was added, over count - 1 gaps).
 */
export function rhythm(code: string, baskets: Basket[], f?: [number, number, number?]): { every: number; since: number; last: number } | null {
  const at = baskets.filter(b => b.items[code]).map(b => b.at).sort((a, b) => a - b);
  if (at.length >= 2) {
    const every = (at[at.length - 1] - at[0]) / (at.length - 1) / DAY;
    return { every, since: 0, last: at[at.length - 1] };
  }
  if (f && f[0] >= 2 && f[2] && f[1] > f[2]) return { every: (f[1] - f[2]) / (f[0] - 1) / DAY, since: 0, last: f[1] };
  return null;
}

// ---- co-occurrence ("bought together") ----

/** For each product, how often each other product was in the same past basket (counts, no self pairs). */
export function coCounts(baskets: Basket[]): Map<string, Map<string, number>> {
  const m = new Map<string, Map<string, number>>();
  for (const b of baskets) {
    const codes = Object.keys(b.items);
    if (codes.length > 60) continue; // a huge basket says little about pairs
    for (const a of codes) {
      let row = m.get(a);
      if (!row) m.set(a, (row = new Map()));
      for (const c of codes) if (c !== a) row.set(c, (row.get(c) ?? 0) + 1);
    }
  }
  return m;
}

// ---- the pipeline ----

/** Category weights from what the user buys (cart, counter, baskets), summing to 1. */
export function affinity(input: Pick<RecInput, "products" | "cart" | "freq" | "baskets">): Map<string, number> {
  const w = new Map<string, number>();
  const add = (code: string, x: number) => { const p = input.products.get(code); if (p) w.set(p.cat, (w.get(p.cat) ?? 0) + x); };
  for (const code of Object.keys(input.cart)) add(code, 2);
  for (const [code, [n]] of Object.entries(input.freq)) add(code, Math.min(n, 6));
  for (const b of input.baskets) for (const code of Object.keys(b.items)) add(code, 1);
  const total = [...w.values()].reduce((a, b) => a + b, 0);
  if (total > 0) for (const [k, v] of w) w.set(k, v / total);
  return w;
}

const STAPLE_CATS = new Set(["dairy", "bakery", "produce", "pantry"]);
const days = (n: number) => (n < 1.5 ? "יום" : `${Math.round(n)} ימים`);

type Cand = { p: Product; source: Source; base: number; reason: string; price?: number };

/** Candidates from every source, before ranking. A product can come from several sources; the best is kept later. */
export function candidates(input: RecInput): Cand[] {
  const { products, active, cart, freq, baskets, now } = input;
  const out: Cand[] = [];
  const sold = (p: Product | undefined): p is Product => !!p && priceInfo(p, active).lo != null;

  // 1. Regulars that are due again (in-network, as X calls the accounts you follow).
  for (const [code, f] of Object.entries(freq)) {
    const p = products.get(code);
    if (!sold(p)) continue;
    const r = rhythm(code, baskets, f);
    const since = (now - (r?.last ?? f[1])) / DAY;
    if (r && r.every >= 2) {
      const due = since / r.every; // 1 = exactly on time
      if (due >= 0.75) out.push({ p, source: "due", base: Math.min(1.6, due), reason: `קונים בערך כל ${days(r.every)}, לאחרונה לפני ${days(since)}` });
    } else if (f[0] >= 2 && since >= 5) {
      out.push({ p, source: "due", base: 0.6, reason: `הוספתם ${f[0]} פעמים, לאחרונה לפני ${days(since)}` });
    }
  }

  // 2. Bought together with what is in the cart now.
  const co = coCounts(baskets);
  const inCart = Object.keys(cart);
  const together = new Map<string, { n: number; with: string }>();
  for (const a of inCart) for (const [b, n] of co.get(a) ?? []) {
    const cur = together.get(b);
    if (!cur || n > cur.n) together.set(b, { n, with: a });
  }
  for (const [code, { n, with: w }] of together) {
    const p = products.get(code);
    if (!sold(p) || n < 2) continue;
    out.push({ p, source: "together", base: Math.min(1.4, 0.5 + n * 0.2), reason: `בדרך כלל נקנה יחד עם ${shortName(products.get(w)?.name ?? "")}` });
  }

  // 3. Real deals in the categories the user buys (out-of-network, like X's recommended posts).
  const aff = affinity(input);
  for (const d of input.deals) {
    if (d.verdict !== "real") continue;
    const p = products.get(d.code);
    if (!sold(p)) continue;
    const a = aff.get(p.cat) ?? 0;
    const mine = !!freq[d.code];
    if (!mine && a < 0.05 && aff.size) continue;
    const pct = Math.max(0, Math.round(d.realPct));
    out.push({ p, source: "deal", base: 0.4 + Math.min(0.8, pct / 40) + (mine ? 0.5 : a), price: Math.round(d.unit),
      reason: mine ? `במבצע: ${pct}% מתחת למחיר הרגיל הזול סביבכם` : `מבצע אמיתי ב${CAT_HE[p.cat] ?? "קטגוריה שאתם קונים"}: ${pct}% פחות` });
  }

  // 4. Price drops on things the user buys or might.
  for (const d of input.drops) {
    if (d.pct >= -3 || !sold(d.p)) continue;
    const mine = !!freq[d.p.code];
    const a = aff.get(d.p.cat) ?? 0;
    if (!mine && a < 0.1) continue;
    out.push({ p: d.p, source: "drop", base: Math.min(1.2, -d.pct / 15) + (mine ? 0.4 : 0), reason: `המחיר ירד ב־${Math.abs(d.pct).toFixed(0)}%` });
  }

  // 5. Cold start: staples sold almost everywhere around, with a real price gap to win.
  if (Object.keys(freq).length < 5) {
    for (const p of products.values()) {
      if (!STAPLE_CATS.has(p.cat)) continue;
      const pi = priceInfo(p, active);
      if (pi.lo == null || pi.n < Math.max(3, active.length * 0.7) || pi.hi! < pi.lo * 1.15) continue;
      out.push({ p, source: "staple", base: 0.3 + Math.min(0.5, (pi.hi! / pi.lo - 1) / 2), reason: `נמכר ב־${pi.n} סניפים, ההפרש עד ${Math.round((pi.hi! / pi.lo - 1) * 100)}%` });
    }
  }
  return out;
}

const CAT_HE: Record<string, string> = { produce: "פירות וירקות", meat: "בשר ודגים", dairy: "מוצרי חלב", bakery: "לחם ומאפים", drinks: "משקאות", snacks: "חטיפים",
  pantry: "מזווה", frozen: "קפואים", cleaning: "ניקיון", care: "טיפוח", pets: "חיות מחמד", other: "שונות" };

const shortName = (n: string) => n.split(" ").slice(0, 3).join(" ");

/** Feedback multiplier for a source or category: x0.8 per "not interested", x1.1 per add, within [0.3, 1.6]. */
export function feedbackMul(fb: Feedback, key: string): number {
  const m = Math.pow(0.8, fb.neg[key] ?? 0) * Math.pow(1.1, fb.pos[key] ?? 0);
  return Math.min(1.6, Math.max(0.3, m));
}

/**
 * The full pipeline: candidates -> filters -> ranker (source weight x base x feedback x
 * availability) -> one card per product -> diversity (each further card of a category or
 * manufacturer counts less, as X's author-diversity scorer does) -> top `limit`.
 */
export function recommend(input: RecInput): Rec[] {
  const { cart, feedback: fb, active, baskets } = input;
  const best = new Map<string, Rec>();
  for (const c of candidates(input)) {
    const p = c.p;
    // filters
    if (p.code in cart || fb.dismissed[p.code]) continue;
    const pi = priceInfo(p, active);
    if (pi.lo == null || (pi.at >= 0 && isStale(p, pi.at))) continue;
    // ranker
    const avail = Math.min(1, 0.6 + pi.n / Math.max(4, active.length) * 0.4);
    const score = SOURCE_WEIGHT[c.source] * c.base * feedbackMul(fb, `src:${c.source}`) * feedbackMul(fb, `cat:${p.cat}`) * avail;
    const cur = best.get(p.code);
    if (!cur || score > cur.score) {
      best.set(p.code, { p, source: c.source, score, reason: c.reason, qty: usualQty(p.code, baskets, p.weighted), price: c.price ?? pi.lo });
    }
  }
  const ranked = [...best.values()].sort((a, b) => b.score - a.score);
  // diversity: re-rank with a decay per repeat of category and manufacturer
  const seenCat = new Map<string, number>(), seenMaker = new Map<string, number>();
  const out: Rec[] = [];
  const pool = ranked.slice(0, 200);
  while (pool.length && out.length < (input.limit ?? 12)) {
    let bi = 0, bs = -1;
    for (let i = 0; i < pool.length; i++) {
      const r = pool[i];
      const maker = r.p.meta?.maker ?? "";
      const s = r.score * Math.pow(0.6, seenCat.get(r.p.cat) ?? 0) * (maker ? Math.pow(0.5, seenMaker.get(maker) ?? 0) : 1);
      if (s > bs) { bs = s; bi = i; }
    }
    const [r] = pool.splice(bi, 1);
    seenCat.set(r.p.cat, (seenCat.get(r.p.cat) ?? 0) + 1);
    const maker = r.p.meta?.maker;
    if (maker) seenMaker.set(maker, (seenMaker.get(maker) ?? 0) + 1);
    out.push(r);
  }
  return out;
}

/** Feedback after a card is dismissed ("not interested"): the product, its source and its category count against. */
export function dismiss(fb: Feedback, r: Pick<Rec, "p" | "source">, now: number): Feedback {
  const inc = (m: Record<string, number>, k: string) => ({ ...m, [k]: (m[k] ?? 0) + 1 });
  return { dismissed: { ...fb.dismissed, [r.p.code]: now }, neg: inc(inc(fb.neg, `src:${r.source}`), `cat:${r.p.cat}`), pos: fb.pos };
}

/** Feedback after a card is added to the cart. */
export function accept(fb: Feedback, r: Pick<Rec, "p" | "source">): Feedback {
  const inc = (m: Record<string, number>, k: string) => ({ ...m, [k]: (m[k] ?? 0) + 1 });
  return { ...fb, pos: inc(inc(fb.pos, `src:${r.source}`), `cat:${r.p.cat}`) };
}

/** Dismissals older than `days` expire, so a product can come back later. */
export function expire(fb: Feedback, now: number, ttlDays = 30): Feedback {
  const dismissed = Object.fromEntries(Object.entries(fb.dismissed).filter(([, t]) => now - t < ttlDays * DAY));
  return { ...fb, dismissed };
}

/** The regulars that are due (source "due"), with their usual quantities: "the weekly basket". */
export function dueBasket(recs: Rec[]): Record<string, number> {
  return Object.fromEntries(recs.filter(r => r.source === "due").map(r => [r.p.code, r.qty]));
}
