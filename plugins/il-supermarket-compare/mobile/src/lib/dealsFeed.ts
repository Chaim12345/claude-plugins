// The deals feed: every active promotion across the user's branches, ranked, filtered and checked for honesty.
// Pure logic (no React): runs under `node --test`.
//
// Honesty rules, in short:
//  1. A promotion only counts if its effective unit price is below the shelf price at that same branch.
//  2. "Real" saving is measured against the CHEAPEST shelf price anywhere among the active branches, not against the
//     branch's own shelf price (which a store can inflate). A deal is `real` only when at least two active branches
//     sell the product and the promo unit price is below the cheapest shelf price of all of them.
//  3. A deal whose promo price is not below the cheapest shelf price elsewhere is `notCheapest`; one sold at a single
//     active branch is `alone` (nothing to compare against). Both stay in the list, labelled; neither can enter the
//     "best deals" section.
//  4. Club promotions count only for chains whose club toggle is on. Expired promotions never show.
//  5. The same promotion at several branches of one chain is one card ("בכל N סניפים"), shown at the branch where it is cheapest.
import { chainKey, dealUnit, money, priceInfo, stampMs, storeKm } from "./compare.ts";
import type { Catalog, Product, Promo } from "./types.ts";
import { parseSize, unitPrice, compareUnit, type UnitPrice } from "./units.ts";

export type Verdict = "real" | "alone" | "notCheapest";

export type DealItem = {
  id: string;
  code: string;
  product: Product;
  chain: string; // portal key
  chainLabel: string;
  promo: Promo;
  stores: number[]; // branches (store indexes) that run this exact promotion
  rep: number; // the branch it is cheapest at
  qty: number; // units to buy to get the deal (minQty for bundles)
  unit: number; // effective price per unit under the deal, agorot
  shelf: number; // shelf price per unit at `rep`
  cheapest: number; // cheapest shelf price per unit among active branches
  cheapestAt: number; // branch of that price
  comparedStores: number; // active branches that sell the product
  savePct: number; // % off vs the shelf price at `rep`
  saveAgorot: number; // for `qty` units, vs the shelf price at `rep`
  realPct: number; // % below the cheapest shelf price anywhere (negative when the promo is dearer)
  realAgorot: number; // for `qty` units, vs the cheapest shelf price (negative when dearer)
  verdict: Verdict;
  club: boolean;
  clubOwned: boolean; // the user has this chain's club card on
  endMs: number | null; // null = no real end date
  unitPrice: UnitPrice | null; // per 100 g / L / piece, under the deal
  shelfUnitPrice: UnitPrice | null;
  max: number | null; // units limit per customer
};

const DAY = 86_400_000;
/** End dates this far out (the portals use 2031-01-01) mean "no end date". */
export const OPEN_ENDED_MS = 180 * DAY;

/**
 * "הפריט השני בחצי מחיר" arrives from the core as a bundle whose value is only the discounted second item
 * ("2 for 8.95" when the shelf price is 17.90), which would show a fake 75% saving. The feed drops those:
 * a bundle whose description talks about the second/third item cannot be priced from its numbers alone.
 */
export function misModeled(pr: Promo): boolean {
  return pr.kind === "bundle" && /השני|השנייה|השניה|השלישי|השלישית|בחצי/.test(pr.desc);
}

export type BuildOpts = { active: number[]; club?: Record<string, boolean>; now?: number };

const distOf = (c: Catalog, i: number) => storeKm(c, i) ?? 1e9;

/**
 * Every usable promotion across the active branches, one item per (chain, product, terms): identical promotions at
 * several branches of a chain are merged. Club promotions are included and flagged (`club`, `clubOwned`); filter them with `filterDeals`.
 */
export function buildDeals(c: Catalog, products: Map<string, Product>, opts: BuildOpts): DealItem[] {
  const now = opts.now ?? Date.now();
  const club = opts.club ?? {};
  const out = new Map<string, DealItem>();
  const sizes = new Map<string, ReturnType<typeof parseSize>>();
  const info = new Map<string, ReturnType<typeof priceInfo>>();
  for (const i of opts.active) {
    const store = c.stores[i];
    if (!store) continue;
    const ck = chainKey(store.id);
    for (const pr of c.promos?.[i] ?? []) {
      if (misModeled(pr)) continue;
      let endMs = stampMs(pr.end);
      if (endMs != null && endMs < now) continue;
      if (endMs != null && endMs - now > OPEN_ENDED_MS) endMs = null;
      const qty = pr.kind === "bundle" ? Math.max(1, pr.minQty) : 1;
      for (const code of pr.codes) {
        const p = products.get(code);
        const shelf = p?.prices[i];
        if (!p || p.weighted || shelf == null) continue;
        const unit = dealUnit(pr, shelf);
        if (!(unit < shelf - 1e-9) || !(unit > 0)) continue; // not a real reduction at its own branch
        const id = [ck, code, pr.kind, pr.value, pr.minQty, pr.club ? 1 : 0, pr.max ?? 0, pr.end ?? ""].join("|");
        const prev = out.get(id);
        if (prev) {
          prev.stores.push(i);
          if (unit < prev.unit - 1e-9 || (Math.abs(unit - prev.unit) < 1e-9 && distOf(c, i) < distOf(c, prev.rep))) {
            prev.rep = i; prev.unit = unit; prev.shelf = shelf;
          }
          continue;
        }
        out.set(id, {
          id, code, product: p, chain: ck, chainLabel: ck === "shufersal" ? "שופרסל" : store.chain, promo: pr, stores: [i], rep: i,
          qty, unit, shelf, cheapest: 0, cheapestAt: i, comparedStores: 0, savePct: 0, saveAgorot: 0, realPct: 0, realAgorot: 0,
          verdict: "alone", club: pr.club, clubOwned: !!club[ck], endMs, unitPrice: null, shelfUnitPrice: null, max: pr.max && pr.max > 0 ? pr.max : null,
        });
      }
    }
  }
  const items = [...out.values()];
  for (const d of items) {
    let pi = info.get(d.code);
    if (!pi) { pi = priceInfo(d.product, opts.active); info.set(d.code, pi); }
    d.cheapest = pi.lo!; d.cheapestAt = pi.at; d.comparedStores = pi.n;
    d.savePct = (1 - d.unit / d.shelf) * 100;
    d.saveAgorot = Math.round((d.shelf - d.unit) * d.qty);
    d.realPct = (1 - d.unit / d.cheapest) * 100;
    d.realAgorot = Math.round((d.cheapest - d.unit) * d.qty);
    d.verdict = d.comparedStores < 2 ? "alone" : d.unit < d.cheapest - 1e-9 ? "real" : "notCheapest";
    if (!sizes.has(d.code)) sizes.set(d.code, parseSize(d.product.name, d.product.cat));
    const z = sizes.get(d.code)!;
    d.unitPrice = unitPrice(z, d.unit);
    d.shelfUnitPrice = unitPrice(z, d.shelf);
  }
  return items;
}

export type ClubMode = "none" | "club"; // "no club needed" | "club deals too (for the chains the user has a card for)"

export type Filters = {
  cat: string; // category id, "all"
  chain: string; // portal key, "all"
  club: ClubMode;
  onlyReal: boolean; // hide deals that are not below the cheapest shelf price elsewhere (and single-branch ones)
  mine?: { codes: Set<string>; cats: Set<string> } | null; // only products in the cart, or in categories of cart items
};

export const defaultFilters: Filters = { cat: "all", chain: "all", club: "none", onlyReal: true, mine: null };

const better = (a: DealItem, b: DealItem) => a.unit < b.unit - 1e-9 || (Math.abs(a.unit - b.unit) < 1e-9 && !a.club && b.club);

/** Club filter + one card per (chain, product): when a chain has several promotions on a product, only the cheapest is kept. */
export function usable(all: DealItem[], club: ClubMode): { items: DealItem[]; hiddenClub: number } {
  let hiddenClub = 0;
  const best = new Map<string, DealItem>();
  for (const d of all) {
    if (d.club && (club === "none" || !d.clubOwned)) { hiddenClub++; continue; }
    const k = `${d.chain}|${d.code}`;
    const prev = best.get(k);
    if (!prev || better(d, prev)) best.set(k, d);
  }
  return { items: [...best.values()], hiddenClub };
}

export type Filtered = { items: DealItem[]; hiddenClub: number; hiddenNotReal: number };

export function filterDeals(all: DealItem[], f: Filters): Filtered {
  const u = usable(all, f.club);
  let hiddenNotReal = 0;
  const items = u.items.filter(d => {
    if (f.cat !== "all" && d.product.cat !== f.cat) return false;
    if (f.chain !== "all" && d.chain !== f.chain) return false;
    if (f.mine && !(f.mine.codes.has(d.code) || f.mine.cats.has(d.product.cat))) return false;
    if (f.onlyReal && d.verdict !== "real") { hiddenNotReal++; return false; }
    return true;
  });
  return { items, hiddenClub: u.hiddenClub, hiddenNotReal };
}

export type DealSort = "pct" | "save" | "ending" | "unit";
/** What the percentage and shekel savings are measured against. */
export type Basis = "shelf" | "cheapest";

const pctOf = (d: DealItem, b: Basis) => (b === "shelf" ? d.savePct : d.realPct);
const agoOf = (d: DealItem, b: Basis) => (b === "shelf" ? d.saveAgorot : d.realAgorot);

export function sortDeals(items: DealItem[], sort: DealSort, basis: Basis = "cheapest"): DealItem[] {
  const out = [...items];
  const byPct = (a: DealItem, b: DealItem) => pctOf(b, basis) - pctOf(a, basis) || agoOf(b, basis) - agoOf(a, basis) || a.id.localeCompare(b.id);
  if (sort === "pct") out.sort(byPct);
  else if (sort === "save") out.sort((a, b) => agoOf(b, basis) - agoOf(a, basis) || byPct(a, b));
  else if (sort === "ending") out.sort((a, b) => (a.endMs ?? Infinity) - (b.endMs ?? Infinity) || byPct(a, b));
  else out.sort((a, b) => compareUnit(a.unitPrice, b.unitPrice) || byPct(a, b));
  return out;
}

/** Smallest real saving (agorot per purchase) that makes the "best deals" list: below it a percentage is noise. */
export const MIN_BEST_AGOROT = 100;

/**
 * The best deals: top n by real saving (against the cheapest shelf price anywhere), verified-real ones only.
 * One per product and one per promotion (a promotion that covers six flavours is one deal), at most
 * `perCat` per category so ten sprays don't crowd out everything else.
 */
export function bestOfWeek(items: DealItem[], n = 10, perCat = 3): DealItem[] {
  const seen = new Set<string>(), promos = new Set<string>();
  const cats = new Map<string, number>();
  const out: DealItem[] = [];
  const pool = items.filter(d => d.verdict === "real" && d.realAgorot >= MIN_BEST_AGOROT);
  for (const d of sortDeals(pool, "pct", "cheapest")) {
    const pk = `${d.chain}|${d.promo.id}`;
    if (seen.has(d.code) || promos.has(pk) || (cats.get(d.product.cat) ?? 0) >= perCat) continue;
    seen.add(d.code); promos.add(pk);
    cats.set(d.product.cat, (cats.get(d.product.cat) ?? 0) + 1);
    out.push(d);
    if (out.length >= n) break;
  }
  return out;
}

export const ENDING_SOON_MS = 48 * 3_600_000;

/** Deals that end within 48 hours (best real saving first), never ones that aren't cheaper than the shelf elsewhere. */
export function endingSoon(items: DealItem[], now: number, n = 10): DealItem[] {
  const pool = items.filter(d => d.verdict !== "notCheapest" && d.endMs != null && d.endMs >= now && d.endMs - now <= ENDING_SOON_MS);
  return sortDeals(pool, "pct", "cheapest").slice(0, n);
}

export const isEndingSoon = (d: DealItem, now: number) => d.endMs != null && d.endMs >= now && d.endMs - now <= ENDING_SOON_MS;

export const endingSoonCount =(items: DealItem[], now: number) => items.filter(d => d.endMs != null && d.endMs >= now && d.endMs - now <= ENDING_SOON_MS).length;

/** What "add to cart" adds: the bundle size for "N for X" deals, otherwise one unit. */
export const cartQty = (d: DealItem): number => d.qty;

/** Items in the cart, and the categories of those items: the "only my things" filter. */
export function mineOf(cart: Record<string, number>, products: Map<string, Product>): { codes: Set<string>; cats: Set<string> } {
  const codes = new Set<string>(), cats = new Set<string>();
  for (const code of Object.keys(cart)) {
    const p = products.get(code);
    if (!p) continue;
    codes.add(code); cats.add(p.cat);
  }
  return { codes, cats };
}

/** "עד 15.11", "עד היום", or "" for open-ended promotions. */
export function endLabel(endMs: number | null, now: number): string {
  if (endMs == null) return "";
  const d = new Date(endMs), t = new Date(now);
  if (d.getFullYear() === t.getFullYear() && d.getMonth() === t.getMonth() && d.getDate() === t.getDate()) return "עד היום";
  return `עד ${d.getDate()}.${d.getMonth() + 1}`;
}

/** The one-line honesty note for a card. */
export function verdictNote(d: DealItem, chainOf: (i: number) => string): string {
  if (d.verdict === "real") return `המחיר הזול ביותר על המדף: ${money(d.cheapest)} ₪ ב${chainOf(d.cheapestAt)}`;
  if (d.verdict === "alone") return "נמכר רק בסניף אחד מהנבחרים: אין עם מה להשוות";
  return `לא זול יותר: על המדף ב${chainOf(d.cheapestAt)} המחיר ${money(d.cheapest)} ₪, נמוך או שווה`;
}
