// "Is it worth a second stop?": does splitting the basket between two branches save more than the extra driving costs?
// Pure logic, straight-line distances like the rest of the app.
import { km as haversine, priceAt, type Deals } from "./compare.ts";
import type { Cart, Product } from "./types.ts";

/** Default cost of driving, in shekels per km. The extra distance is counted as a round trip already. */
export const DEFAULT_PER_KM = 1.5;

export type Point = { lat: number; lon: number };

/** Cost in agorot of each cart item at each store (promotions counted), null when the store doesn't sell it. Rows follow `Object.entries(cart)` order, skipping unknown products. */
export function costMatrix(products: Map<string, Product>, cart: Cart, active: number[], deals?: Deals): (number | null)[][] {
  const rows: (number | null)[][] = [];
  const width = active.length ? Math.max(...active) + 1 : 0;
  for (const [code, q] of Object.entries(cart)) {
    const p = products.get(code);
    if (!p) continue;
    const row: (number | null)[] = new Array(width).fill(null);
    for (const i of active) row[i] = priceAt(p, i, q, deals)?.cost ?? null;
    rows.push(row);
  }
  return rows;
}

export type TripInput = {
  costs: (number | null)[][]; // item x store, agorot
  active: number[];
  points: (Point | null)[]; // per store index
  home: Point | null;
  perKm?: number; // shekels per km of extra driving
};

export type TripAdvice = {
  single: number; // the branch to use if you don't split
  a: number; // the two branches of the best split (a is the one you reach first)
  b: number;
  singleTotal: number; // agorot, the items `single` sells
  splitTotal: number; // agorot, the same items bought at the cheaper of a and b
  gross: number; // singleTotal - splitTotal
  extraKm: number | null; // extra driving versus going only to `single`; null when a location is unknown
  travel: number | null; // agorot
  net: number | null; // gross - travel
  worth: boolean; // saves more than the driving costs (or, with unknown distances, saves anything)
  filled: number; // items `single` doesn't sell that the split covers
  perKm: number;
};

const d = (x: Point, y: Point) => haversine(x.lat, x.lon, y.lat, y.lon);

/**
 * The best two-branch split by money saved after driving. Items are compared on what `single` (the cheapest
 * complete-enough branch: fewest missing items, then lowest total) sells, so a split never "saves" by
 * buying things the single branch doesn't have. Returns null when there is no basket or fewer than two branches.
 */
export function tripAdvice(inp: TripInput): TripAdvice | null {
  const { costs, active, points, home } = inp;
  const perKm = inp.perKm ?? DEFAULT_PER_KM;
  if (!costs.length || active.length < 2) return null;
  const totals = active.map(i => {
    let t = 0, missing = 0;
    for (const row of costs) { const v = row[i]; if (v == null) missing++; else t += v; }
    return { i, t, missing };
  }).sort((x, y) => x.missing - y.missing || x.t - y.t);
  const single = totals[0].i;
  const sold = costs.filter(r => r[single] != null);
  const soldTotal = sold.reduce((t, r) => t + r[single]!, 0);

  const dist = (i: number, j: number) => (points[i] && points[j] ? d(points[i]!, points[j]!) : null);
  const home1 = (i: number) => (home && points[i] ? d(home, points[i]!) : null);

  let best: TripAdvice | null = null;
  for (let x = 0; x < active.length; x++) for (let y = x + 1; y < active.length; y++) {
    const a = active[x], b = active[y];
    let split = 0, filled = 0, ok = true;
    for (const row of costs) {
      const va = row[a], vb = row[b];
      const lo = va == null ? vb : vb == null ? va : Math.min(va, vb);
      if (lo == null) { if (row[single] == null) continue; ok = false; break; }
      if (row[single] == null) { filled++; continue; } // not comparable: bought anyway, somewhere
      split += lo;
    }
    if (!ok) continue;
    const gross = soldTotal - split;
    let extraKm: number | null = null;
    const hs = home1(single), ha = home1(a), hb = home1(b), ab = dist(a, b);
    if (hs != null && ha != null && hb != null && ab != null) {
      // home -> a -> b -> home versus home -> single -> home; the shorter order of the two stops
      const tour = Math.min(ha + ab + hb, hb + ab + ha);
      extraKm = Math.max(0, tour - 2 * hs);
    }
    const travel = extraKm == null ? null : Math.round(extraKm * perKm * 100);
    const net = travel == null ? null : gross - travel;
    const cand: TripAdvice = { single, a, b, singleTotal: soldTotal, splitTotal: split, gross, extraKm, travel, net, worth: net == null ? gross > 0 : net > 0, filled, perKm };
    const score = (c: TripAdvice) => (c.net ?? c.gross);
    if (!best || score(cand) > score(best) || (score(cand) === score(best) && (cand.extraKm ?? 0) < (best.extraKm ?? 0))) best = cand;
  }
  return best;
}

const money = (agorot: number) => (Math.abs(agorot) / 100).toFixed(2);
const kmText = (x: number) => (x < 10 ? x.toFixed(1) : String(Math.round(x)));

/** The plain-language verdict, e.g. "פיצול בין A ו־B חוסך 14.00 ₪, אבל נסיעה נוספת של 3.0 ק״מ עולה בערך 4.50 ₪: כדאי". */
export function tripText(t: TripAdvice, name: (storeIndex: number) => string): string {
  const A = name(t.a), B = name(t.b);
  if (t.gross <= 0) return `פיצול הסל לא חוסך כסף: כל מה שיש ב${name(t.single)} שם הכי זול (או שווה).`;
  const saves = `פיצול בין ${A} ו־${B} חוסך ${money(t.gross)} ₪`;
  if (t.travel == null || t.extraKm == null) return `${saves} (אין נתוני מרחק, ולכן לא חישבנו את עלות הנסיעה).`;
  if (t.extraKm < 0.05) return `${saves}, וכמעט בלי נסיעה נוספת: כדאי.`;
  return `${saves}, אבל נסיעה נוספת של ${kmText(t.extraKm)} ק״מ עולה בערך ${money(t.travel)} ₪: ${t.worth ? "כדאי" : "לא כדאי"}.`;
}
