// Smart swaps: for a cart item, a cheaper product that is the same thing. Conservative by design: it only
// suggests when the two products have the same category, the same product-type words, the same fat % / flavour /
// variant words, a size within ±15% (compared by what the same amount costs) and the same pack count.
// Anything it cannot tell apart is rejected, so a suggestion is one you can accept without checking.
//
// "The same thing" is decided on a name cut into words, with size words, plain numbers and filler removed:
//   strict  the remaining words are identical, brand words included. Catches the same product listed under another
//           barcode or spelling ("קוטג׳ 5% 250 גר" vs "קוטג 5% 250ג").
//   loose   known brand words are dropped too, but ONLY for staples where the brand rarely matters (milk, cottage,
//           butter, sugar, flour, rice, pasta, oil, eggs...): "חלב תנובה 3%" and "חלב טרה 3%". Never for chocolate,
//           snacks, drinks, cosmetics or baby products, where the brand is the product.
// An unknown brand stays in the words, so two products with different unknown brands never match.
import { km, priceAt, type Deals } from "./compare.ts";
import type { Cart, Catalog, Product } from "./types.ts";
import { parseSize, similarSize, sizeText, unitPrice, withoutSize, type Size, type UnitPrice } from "./units.ts";

/** Brands and private labels that loose matching may ignore (staples only, see COMMODITY). */
export const BRANDS = new Set(
  ("אסם סוגת יכין תנובה שטראוס טרה יטבתה גד אחלה זוגלובק שקדיה הלמנס היינץ מעדנות תבור הרדוף פיראוס יחיעם " +
    "רמי לוי שופרסל מותג מחפוד צבר שמיר ניקול סנו סנסודיין אורביט וילי פוד פרימור המסעדה השיטה אלטרנטיב עוף").split(/\s+/),
);

/** Head words of staples: brand-agnostic matching is allowed only when one of these is in the name. */
export const COMMODITY = new Set(
  ("חלב קוטג שמנת חמאה ביצים לבנה לאבנה שמן סוכר מלח קמח אורז פסטה ספגטי אטריות עדשים אפונה תירס טונה מים סודה חומץ אקונומיקה שקיות").split(/\s+/),
);

/** Words that say nothing about what the product is. */
const FILLER = new Set(("עם של בטעם טעם ב ו חדש אריזה שומן כשר מהדרין א ק ג ל מ גרם גר קג ליטר מל יח יחידות").split(/\s+/));

/** Baby formula and the like: never auto-swapped (and a "שלב 1" is not a "שלב 2"). */
const NEVER = /שלב\s*\d|סימילאק|מטרנה|נוטרילון|פרימיל/;

export type TypeKeys = { strict: string; loose: string | null };

/** The words that say what a product is: type, flavour, fat %, variant. null when there is nothing safe to match on. */
export function typeKeys(name: string): TypeKeys | null {
  if (NEVER.test(name)) return null;
  const words = withoutSize(name)
    .replace(/[()\[\]{}+&/\\,:;!?*|"'`״׳_]/g, " ")
    .replace(/(\d)\s*%/g, "$1%")
    .replace(/(מידה)\s*(\d+\+?)/g, "$1$2")
    .split(/\s+/)
    .map(w => w.replace(/^[-.]+|[-.]+$/g, ""))
    .filter(Boolean)
    .filter(w => !/^\d+(?:\.\d+)?$/.test(w)) // bare numbers
    .filter(w => !FILLER.has(w));
  // a lone letter is probably a truncated word: not safe to match on
  if (!words.length || words.some(w => w.length < 2 && !/\d/.test(w))) return null;
  const key = (l: string[]) => [...new Set(l)].sort().join(" ");
  const strict = key(words);
  const rest = words.filter(w => !BRANDS.has(w));
  const loose = rest.length && rest.some(w => COMMODITY.has(w)) ? key(rest) : null;
  return { strict, loose };
}

type Entry = { p: Product; size: Size };
export type SwapIndex = Map<string, Entry[]>;

const indexes = new WeakMap<Map<string, Product>, SwapIndex>();

/** Packaged products with a known size, grouped by category + type words (strict and loose keys). Cached per catalog. */
export function swapIndex(products: Map<string, Product>): SwapIndex {
  let idx = indexes.get(products);
  if (idx) return idx;
  idx = new Map();
  const add = (k: string, e: Entry) => { const l = idx!.get(k); if (l) l.push(e); else idx!.set(k, [e]); };
  for (const p of products.values()) {
    if (p.weighted) continue;
    const size = parseSize(p.name, p.cat);
    const keys = size ? typeKeys(p.name) : null;
    if (!size || !keys) continue;
    const e = { p, size };
    add(`${p.cat}|s|${keys.strict}`, e);
    if (keys.loose) add(`${p.cat}|l|${keys.loose}`, e);
  }
  indexes.set(products, idx);
  return idx;
}

/** Candidates for a product: the same strict words, or (for staples) the same words with brands ignored. */
function candidates(idx: SwapIndex, p: Product, keys: TypeKeys): Entry[] {
  const seen = new Set<string>(), out: Entry[] = [];
  for (const k of [`${p.cat}|s|${keys.strict}`, keys.loose ? `${p.cat}|l|${keys.loose}` : ""]) {
    for (const e of idx.get(k) ?? []) if (!seen.has(e.p.code)) { seen.add(e.p.code); out.push(e); }
  }
  return out;
}

export type Swap = {
  p: Product; // the alternative
  store: number; // where to buy it
  sameStore: boolean; // the store the cart item is cheapest at
  away: number | null; // km from that store when it isn't the same one
  packCost: number; // agorot for `qty` packs of the alternative at `store`
  save: number; // agorot saved on the same amount of product (size differences are accounted for)
  savePct: number;
  sizeRatio: number; // alternative size / original size
  unit: UnitPrice; // the alternative's unit price at `store`
  fromUnit: UnitPrice;
  brandChange: boolean; // matched with brands ignored (a staple under another brand)
  reason: string; // "אותו גודל, 1.20 ₪ פחות"
};

export type SwapSet = {
  p: Product; // the cart item
  qty: number;
  store: number; // where the cart item is cheapest
  cost: number; // agorot for qty packs there
  options: Swap[]; // best saving first
};

export type SwapOpts = {
  nearKm?: number; // how far from the item's cheapest store an alternative may be (default 3)
  minSave?: number; // agorot (default 30)
  minPct?: number; // percent (default 3)
  max?: number; // alternatives per item (default 3)
};

const money = (a: number) => (a / 100).toFixed(2);

function reasonText(sizeRatio: number, save: number, q: number, same: boolean, sizeLabel: string, store: string, away: number | null): string {
  const size = Math.abs(sizeRatio - 1) <= 0.02 ? "אותו גודל" : `גודל דומה (${sizeLabel})`;
  const where = same ? "" : `, ב${store}${away != null ? ` (${away.toFixed(1)} ק״מ מהסניף הזול)` : ""}`;
  return `${size}, ${money(save)} ₪ פחות${q > 1 ? ` ל־${q} יחידות` : ""}${where}`;
}

/**
 * Cheaper equivalents for each cart item (weighted items are never swapped). The saving compares the same amount
 * of product: the alternative's pack cost is scaled by the size ratio, so a slightly bigger pack is not "cheaper" for being bigger.
 */
export function findSwaps(c: Catalog, products: Map<string, Product>, cart: Cart, active: number[], deals?: Deals, o: SwapOpts = {}): SwapSet[] {
  const nearKm = o.nearKm ?? 3, minSave = o.minSave ?? 30, minPct = o.minPct ?? 3, max = o.max ?? 3;
  const idx = swapIndex(products);
  const out: SwapSet[] = [];
  const storeDist = (i: number, j: number): number | null => {
    const a = c.stores[i], b = c.stores[j];
    if (!a || !b || a.lat == null || a.lon == null || b.lat == null || b.lon == null) return null;
    return km(a.lat, a.lon, b.lat, b.lon);
  };
  for (const [code, q] of Object.entries(cart)) {
    const p = products.get(code);
    if (!p || p.weighted || !(q > 0)) continue;
    const size = parseSize(p.name, p.cat), keys = typeKeys(p.name);
    if (!size || !keys) continue;
    // where the cart item is cheapest right now
    let home = -1, cost = Infinity;
    for (const i of active) {
      const r = priceAt(p, i, q, deals);
      if (r && r.cost < cost) { cost = r.cost; home = i; }
    }
    if (home < 0) continue;
    const homeUnit = unitPrice(size, cost / q);
    const options: Swap[] = [];
    for (const e of candidates(idx, p, keys)) {
      if (e.p.code === code || cart[e.p.code] != null) continue;
      if (e.size.packs !== size.packs || !similarSize(size, e.size)) continue;
      type Pick = { j: number; cost: number; norm: number };
      let best: Pick | null = null, same: Pick | null = null;
      for (const j of active) {
        if (j !== home) { const dd = storeDist(home, j); if (dd == null || dd > nearKm) continue; }
        const r = priceAt(e.p, j, q, deals);
        if (!r) continue;
        const cand = { j, cost: r.cost, norm: r.cost * (size.amount / e.size.amount) }; // norm: what the same amount of product costs
        if (!best || cand.norm < best.norm) best = cand;
        if (j === home) same = cand;
      }
      // the same store wins when it is within 2% of the best: no second shop for pennies
      const pick: Pick | null = same && best && same.norm <= best.norm * 1.02 ? same : best;
      if (!pick) continue;
      const save = cost - pick.norm;
      if (save < minSave || (save / cost) * 100 < minPct) continue;
      if (pick.norm < cost * 0.5) continue; // half price for "the same thing" is too good to be true: probably a size or product mix-up
      const ratio = e.size.amount / size.amount;
      const away = pick.j === home ? null : storeDist(home, pick.j);
      const up = unitPrice(e.size, pick.cost / q)!;
      const sizeLabel = `${sizeText(e.size)} מול ${sizeText(size)}`;
      options.push({
        p: e.p, store: pick.j, sameStore: pick.j === home, away, packCost: pick.cost, save: Math.round(save), savePct: (save / cost) * 100, sizeRatio: ratio,
        unit: up, fromUnit: homeUnit!, brandChange: typeKeys(e.p.name)?.strict !== keys.strict,
        reason: reasonText(ratio, save, q, pick.j === home, sizeLabel, c.stores[pick.j].chain, away),
      });
    }
    if (!options.length) continue;
    options.sort((a, b) => b.save - a.save || a.p.code.localeCompare(b.p.code));
    out.push({ p, qty: q, store: home, cost: Math.round(cost), options: options.slice(0, max) });
  }
  return out;
}

/** Total of the best suggestion per item, agorot. */
export const totalSaving = (sets: SwapSet[]): number => sets.reduce((t, s) => t + (s.options[0]?.save ?? 0), 0);

/** The cart after taking a swap: the original out, the alternative in with the same number of packs. */
export function applySwap(cart: Cart, from: string, to: string): Cart {
  const next: Cart = { ...cart };
  const q = next[from] ?? 1;
  delete next[from];
  next[to] = (next[to] ?? 0) + q;
  return next;
}
