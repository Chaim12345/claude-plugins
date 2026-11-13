// "Check at the till" deals, settled by a language model the user set up (llm.ts).
//
// The price files list a promotion under barcodes that its own wording often doesn't name ("מבצע
// מגוון חטיפים" under 40 products), and the app can't tell a broad promotion from a mislisted one.
// The model reads the chain's Hebrew wording and the product names and answers, per product: covered,
// not covered, or unclear. The answer is about the promotion, not the shopper, so it is asked once per
// promotion and product, cached on the phone until the promotion ends, and only for the deals the
// rules flagged for their wording or price spread (not for "implausibly deep", which no wording settles).
//
// Covered: the deal loses its warning and says it was checked. Not covered: the deal is hidden.
// Unclear: the warning stays. Many deals share one request (free tiers allow a few hundred a day).
import type { DealItem } from "./dealsFeed";
import type { ChatMessage } from "./llm";

export type AiAnswer = "yes" | "no" | "unclear";
/** [answer, expires at (ms)] keyed by verdictKey. */
export type Verdicts = Record<string, [AiAnswer, number]>;

const DAY = 86_400_000;
/** Answers for promotions without a real end date are asked again after this. */
export const OPEN_TTL = 14 * DAY;
/** A product the model skipped is asked again after this. */
export const MISSING_TTL = DAY;
/** Characters of promotions and product names per request: well inside small models' context. */
export const BATCH_CHARS = 5000;
/** Products of one promotion per request. */
export const GROUP_MAX = 40;

export const verdictKey = (d: Pick<DealItem, "chain" | "code"> & { promo: { id: string } }) => `${d.chain}|${d.promo.id}|${d.code}`;

/** Flagged deals that a model can settle and that have no live answer yet. */
export function pending(items: DealItem[], v: Verdicts, now: number): DealItem[] {
  return items.filter(d => d.confidence === "check" && (d.checkKind === "words" || d.checkKind === "spread") && !(v[verdictKey(d)]?.[1] > now));
}

export type AskItem = { key: string; name: string; maker?: string };
export type AskGroup = { id: string; desc: string; chain: string; end: number; items: AskItem[] };

/** One group per promotion of a chain, each product once; large groups split. */
export function groups(items: DealItem[], now: number): AskGroup[] {
  const by = new Map<string, AskGroup>();
  for (const d of items) {
    const gk = `${d.chain}|${d.promo.id}`;
    let g = by.get(gk);
    if (!g) { g = { id: gk, desc: d.promo.desc, chain: d.chainLabel, end: d.endMs ?? now + OPEN_TTL, items: [] }; by.set(gk, g); }
    const key = verdictKey(d);
    if (!g.items.some(x => x.key === key)) g.items.push({ key, name: d.product.name, maker: d.product.meta?.maker });
  }
  const out: AskGroup[] = [];
  for (const g of by.values()) {
    for (let i = 0; i < g.items.length; i += GROUP_MAX) out.push({ ...g, items: g.items.slice(i, i + GROUP_MAX) });
  }
  return out;
}

const groupChars = (g: AskGroup) => g.desc.length + 30 + g.items.reduce((t, x) => t + x.name.length + (x.maker?.length ?? 0) + 8, 0);

/** Packs groups into requests of about BATCH_CHARS characters. */
export function batches(gs: AskGroup[], maxChars = BATCH_CHARS): AskGroup[][] {
  const out: AskGroup[][] = [];
  let cur: AskGroup[] = [], size = 0;
  for (const g of gs) {
    const n = groupChars(g);
    if (cur.length && size + n > maxChars) { out.push(cur); cur = []; size = 0; }
    cur.push(g); size += n;
  }
  if (cur.length) out.push(cur);
  return out;
}

const SYSTEM = `You check Israeli supermarket promotions. Each promotion has the chain's own Hebrew wording and the products its price file lists under it. The chain chose to list these products under this promotion, so most of them belong to it.
For each product, decide whether the promotion's wording covers it:
- "yes": the wording names this product, its brand, its product line, or a category it fits (for example "חטיפי אסם" covers Bamba and Bissli, which Osem makes; "מגוון יוגורטים" covers a yogurt; "סלטי אחלה" covers Achla hummus and tahini salads, an Achla/Strauss line).
- "no": only when the wording clearly describes something else: a different product type (soap listed under a snack promotion), a different named brand (Pepsi wording, a 7up product), or a pack size far outside the range the wording gives.
- "unclear": generic wording ("מבצע", "הנחה", a store-brand discount such as "מותג שופרסל" when the name doesn't show the brand), or a product line you don't know. Brand lines are often unfamiliar: when the product type fits the wording and the brand might be the one named, answer "unclear" or "yes", never "no".
Hebrew abbreviations are common: גר'/ג = grams, ל' = litre, מ"ל = ml, יח' = units, 2ב30 = two for 30 shekels.
Answer with JSON only, no other text, in exactly this shape:
{"P1":{"yes":[1,2],"no":[3],"unclear":[]},"P2":{...}}
using the promotion labels and product numbers given.`;

/** The request for one batch. Product numbers restart in each promotion. */
export function prompt(batch: AskGroup[]): ChatMessage[] {
  const parts = batch.map((g, i) => {
    const lines = g.items.map((x, j) => `  ${j + 1}. ${x.name}${x.maker ? ` (${x.maker})` : ""}`);
    return `P${i + 1} [${g.chain}] «${g.desc}»\n${lines.join("\n")}`;
  });
  return [{ role: "system", content: SYSTEM }, { role: "user", content: parts.join("\n\n") }];
}

/** Reads the model's JSON into verdicts. Products it skipped become "unclear" for a day, so they are asked again later. */
export function readAnswer(batch: AskGroup[], json: unknown, now: number): Verdicts {
  const out: Verdicts = {};
  const obj = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
  batch.forEach((g, i) => {
    const a = (obj[`P${i + 1}`] ?? obj[`p${i + 1}`] ?? obj[String(i + 1)]) as Record<string, unknown> | undefined;
    const seen = new Set<number>();
    const until = Math.max(now + DAY, g.end);
    for (const ans of ["no", "unclear", "yes"] as const) { // a product in two lists: "yes" wins, then "unclear"
      const list = Array.isArray(a?.[ans]) ? (a![ans] as unknown[]) : [];
      for (const n of list) {
        const j = Number(n) - 1;
        if (!Number.isInteger(j) || j < 0 || j >= g.items.length) continue;
        seen.add(j);
        out[g.items[j].key] = [ans, until];
      }
    }
    g.items.forEach((x, j) => { if (!seen.has(j)) out[x.key] = ["unclear", now + MISSING_TTL]; });
  });
  return out;
}

/** Drops expired answers. */
export function prune(v: Verdicts, now: number): Verdicts {
  const out: Verdicts = {};
  for (const k in v) if (v[k][1] > now) out[k] = v[k];
  return out;
}

/**
 * The feed with the model's answers applied: covered deals lose the warning, not-covered deals are
 * removed, unclear ones keep it. Returns the same array when nothing applies.
 */
export function applyVerdicts(items: DealItem[], v: Verdicts, now: number): DealItem[] {
  let changed = false;
  const out: DealItem[] = [];
  for (const d of items) {
    const a = d.confidence === "check" ? v[verdictKey(d)] : undefined;
    if (!a || a[1] <= now) { out.push(d); continue; }
    changed = true;
    if (a[0] === "no") continue;
    if (a[0] === "unclear") out.push({ ...d, ai: "unclear" });
    // covered, but a discount this deep still deserves a look at the till
    else if (d.realPct > 60) out.push({ ...d, ai: "yes", checkKind: "deep", why: "המבצע חל על המוצר, אבל ההנחה חריגה במיוחד" });
    else out.push({ ...d, confidence: "ok", why: undefined, checkKind: undefined, ai: "yes" });
  }
  return changed ? out : items;
}

export type AiStats = { yes: number; no: number; unclear: number };
export function stats(v: Verdicts, now: number): AiStats {
  const s: AiStats = { yes: 0, no: 0, unclear: 0 };
  for (const k in v) if (v[k][1] > now) s[v[k][0]]++;
  return s;
}
