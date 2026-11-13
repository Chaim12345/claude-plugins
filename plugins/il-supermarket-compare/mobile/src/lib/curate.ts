// AI catalog curation: a language model the user set up (llm.ts) tidies the catalog the price files
// produce, in three tasks the user runs and reviews in "ניהול קטלוג":
//
//  - cats:  products filed under "שונות" (17% of a city's catalog) get a real category.
//  - names: names with glued numbers and abbreviations ("שוקו' בקבוק 1ל", "ש.חלב") get a clean
//           display name. The original stays searchable and is shown on the product sheet.
//  - links: the same product under two barcodes (one per chain, or an old and a new barcode) becomes
//           one product with every branch's price. Candidates are pairs with the same pack size,
//           similar names and no branch selling both; the model confirms each.
//
// Everything is applied on the phone, on top of the catalog the files gave (curateCatalog), and every
// change can be undone one by one or all at once. Answers are kept by barcode, so each product is
// asked about once, and a new sync only asks about new products.
import { chainKey, norm } from "./compare.ts";
import type { ChatMessage } from "./llm.ts";
import type { Enriched } from "./enrich.ts";
import type { Catalog, Category, ProductMeta, RawProduct } from "./types.ts";
import { sizeOf } from "./units.ts";

export type TaskKind = "cats" | "names" | "links";
export const TASKS: TaskKind[] = ["cats", "names", "links"];

export type Curation = {
  on: Record<TaskKind, boolean>; // apply this task's results
  cats: Record<string, string>; // code -> category id
  names: Record<string, string>; // code -> clean name
  links: Record<string, string>; // secondary code -> primary code
  rejected: Record<string, 1>; // undone by the user: "cats:code", "names:code", "links:secondary"
  approved: Record<string, 1>; // links the user approved: "links:secondary" (links apply only once approved, unless autoLinks)
  autoLinks: boolean;
  asked: Record<string, 1>; // answered already (including "keep as is" / "different"): "cats:code", "names:code", "links:a|b"
};

export const emptyCuration = (): Curation => ({ on: { cats: true, names: true, links: true }, cats: {}, names: {}, links: {}, rejected: {}, approved: {}, autoLinks: false, asked: {} });

/** A link waiting for the user's approval. */
export const awaiting = (cur: Curation, s: string) => !!cur.links[s] && !cur.autoLinks && !cur.approved[`links:${s}`] && !cur.rejected[`links:${s}`];

export const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

// ---------- applying ----------

type Row = RawProduct;

/** Effective links: on, not undone, both products present, no branch selling both, no chains of links. */
export function activeLinks(c: Catalog, cur: Curation): Map<string, string> {
  const out = new Map<string, string>();
  if (!cur.on.links) return out;
  const rows = new Map<string, Row>();
  for (const r of c.products) rows.set(r[0], r);
  const primaries = new Set<string>();
  for (const [s, p] of Object.entries(cur.links)) {
    if (cur.rejected[`links:${s}`] || s === p || awaiting(cur, s)) continue;
    const a = rows.get(s), b = rows.get(p);
    if (!a || !b || cur.links[p]) continue;
    if (!disjoint(a[4], b[4])) continue;
    out.set(s, p);
    primaries.add(p);
  }
  for (const s of [...out.keys()]) if (primaries.has(s)) out.delete(s); // a primary is never also merged away
  return out;
}

const disjoint = (a: (number | null)[], b: (number | null)[]) => a.every((v, i) => v == null || b[i] == null);

function mergeMeta(a: ProductMeta | null | undefined, b: ProductMeta | null | undefined): ProductMeta | null {
  if (!a && !b) return null;
  const m: ProductMeta = { ...(b ?? {}), ...(a ?? {}) };
  if (a?.stale || b?.stale) m.stale = [...(a?.stale ?? []), ...(b?.stale ?? [])];
  if (a?.chg || b?.chg) m.chg = [...(a?.chg ?? []), ...(b?.chg ?? [])];
  return m;
}

/**
 * The catalog with the user's curation applied: linked products merged into one row (prices,
 * matched names and freshness per branch), promotions pointed at the merged product, names and
 * categories replaced. The original name, and the barcodes merged in, go into the row's metadata.
 * Returns the same catalog when there is nothing to apply.
 */
export function curateCatalog(c: Catalog, cur: Curation, enr?: Map<string, Enriched> | null): Catalog {
  const links = activeLinks(c, cur);
  const names = cur.on.names ? cur.names : {};
  const cats = cur.on.cats ? cur.cats : {};
  const valid = new Set(c.categories.map(x => x.id));
  const touched = (code: string) => (names[code] && !cur.rejected[`names:${code}`]) || (cats[code] && !cur.rejected[`cats:${code}`] && valid.has(cats[code]));
  const recs = enr && enr.size ? enr : null;
  if (!links.size && !recs && !c.products.some(r => touched(r[0]))) return c;

  const merged = new Map<string, Row[]>(); // primary -> secondaries
  for (const [s, p] of links) merged.set(p, [...(merged.get(p) ?? []), c.products.find(r => r[0] === s)!]);
  const products: Row[] = [];
  for (const r of c.products) {
    if (links.has(r[0])) continue;
    let [code, name, cat, w, prices, picks, img, meta] = r;
    img = img ?? null;
    const extra = merged.get(code);
    if (extra) {
      for (const x of extra) {
        prices = prices.map((v, i) => v ?? x[4][i] ?? null);
        if (picks || x[5]) picks = prices.map((_, i) => picks?.[i] ?? x[5]?.[i] ?? null);
        meta = mergeMeta(meta, x[7]);
        img = img ?? x[6];
      }
      meta = { ...(meta ?? {}), linked: extra.map(x => x[0]) };
    }
    const nn = names[code] && !cur.rejected[`names:${code}`] ? names[code] : null;
    if (nn && nn !== name) { meta = { ...(meta ?? {}), raw: name }; name = nn; }
    // the model's product record: its category, unless the user's category task says otherwise
    const rec = recs?.get(code);
    if (rec) { meta = { ...(meta ?? {}), ai: rec }; if (valid.has(rec.c)) cat = rec.c; }
    const nc = cats[code] && !cur.rejected[`cats:${code}`] && valid.has(cats[code]) ? cats[code] : null;
    if (nc) cat = nc;
    products.push([code, name, cat, w, prices, picks, img, meta ?? null]);
  }
  const mapCodes = (codes: string[]) => { const out = [...new Set(codes.map(x => links.get(x) ?? x))]; return out.length === codes.length && out.every((x, i) => x === codes[i]) ? codes : out; };
  const promos = links.size && c.promos ? c.promos.map(l => l.map(p => { const codes = mapCodes(p.codes); return codes === p.codes ? p : { ...p, codes }; })) : c.promos;
  const promoNotes = links.size && c.promoNotes ? c.promoNotes.map(l => l.map(p => { const codes = mapCodes(p.codes); return codes === p.codes ? p : { ...p, codes }; })) : c.promoNotes;
  return { ...c, products, promos, promoNotes };
}

/** Barcodes merged away -> the product they now belong to (for carts and lists that hold old codes). */
export const aliases = (c: Catalog, cur: Curation) => activeLinks(c, cur);

// ---------- candidates ----------

export type CatItem = { code: string; name: string; maker?: string };
export type NameItem = { code: string; name: string; maker?: string };
export type LinkItem = { a: string; b: string; an: string; bn: string; am?: string; bm?: string; score: number };

/** Products in "שונות" not asked about yet. */
export function catCandidates(c: Catalog, cur: Curation): CatItem[] {
  return c.products.filter(r => r[2] === "other" && !cur.asked[`cats:${r[0]}`] && !cur.cats[r[0]])
    .map(r => ({ code: r[0], name: r[1], maker: r[7]?.maker }));
}

/** A name worth cleaning: numbers glued to words, abbreviations with a dot, stray marks, a cut-off end. */
export function messyName(n: string): boolean {
  return /[א-ת]\d|\d[א-ת]/.test(n) || /[א-ת]\.[א-ת]/.test(n) || /[‎‏‪-‮]/.test(n)
    || /\s[א-ת]$/.test(n.trim()) || /\s{2,}/.test(n) || /[א-ת]'[א-ת]{2}/.test(n);
}

export function nameCandidates(c: Catalog, cur: Curation): NameItem[] {
  return c.products.filter(r => !r[7]?.raw && !cur.asked[`names:${r[0]}`] && !cur.names[r[0]] && messyName(r[1]))
    .map(r => ({ code: r[0], name: r[1], maker: r[7]?.maker }));
}

const STOP = new Set("גרם גר ג מל ליטר ל יח יחידות קג ק בטעם טעם עם של מארז אריזה חדש מבצע".split(" "));
const words = (n: string) => norm(n).replace(/[^א-תa-z0-9 ]/g, " ").replace(/(\d)([א-תa-z])|([א-תa-z])(\d)/g, "$1$3 $2$4").split(" ").filter(w => w && !STOP.has(w));
const heads = (n: string) => new Set(words(n).filter(w => !/^\d+$/.test(w)).map(w => w.slice(0, 4)));
const nums = (n: string) => new Set(words(n).filter(w => /^\d+$/.test(w)));

/**
 * Pairs that may be one product under two barcodes: same pack size, no branch sells both, and names
 * that share most words and every number. Each product is proposed at most twice, best first.
 */
export function linkCandidates(c: Catalog, cur: Curation, limit = 600): LinkItem[] {
  const rows = c.products.filter(r => r[3] !== 1 && !cur.links[r[0]]); // weighted produce is matched by name already
  const buckets = new Map<string, { r: Row; h: Set<string>; n: Set<string>; chains: Set<string> }[]>();
  for (const r of rows) {
    const z = sizeOf({ code: r[0], name: r[1], cat: r[2], weighted: false, meta: r[7] ?? null });
    if (!z) continue;
    const key = `${z.kind}:${Math.round(z.amount * z.packs)}`;
    const chains = new Set(r[4].flatMap((v, i) => (v == null ? [] : [chainKey(c.stores[i].id)])));
    const l = buckets.get(key) ?? [];
    l.push({ r, h: heads(r[1]), n: nums(r[1]), chains });
    buckets.set(key, l);
  }
  const out: LinkItem[] = [];
  for (const l of buckets.values()) {
    if (l.length < 2) continue;
    // only pairs that share at least two name words: an index from word to products
    const byHead = new Map<string, number[]>();
    l.forEach((x, i) => { for (const h of x.h) (byHead.get(h) ?? byHead.set(h, []).get(h)!).push(i); });
    for (let i = 0; i < l.length; i++) {
      const shared = new Map<number, number>();
      for (const h of l[i].h) for (const j of byHead.get(h)!) if (j > i) shared.set(j, (shared.get(j) ?? 0) + 1);
      for (const [j, inter] of shared) {
        if (inter < 2) continue;
        const x = l[i], y = l[j];
        const uni = x.h.size + y.h.size - inter;
        const score = uni ? inter / uni : 0;
        if (score < 0.5) continue;
        if (!disjoint(x.r[4], y.r[4])) continue;
        if (x.r[2] !== y.r[2] && x.r[2] !== "other" && y.r[2] !== "other") continue;
        if (cur.asked[`links:${pairKey(x.r[0], y.r[0])}`]) continue;
        // every number in either name appears in the other (variants: 3% vs 5%, No. 4 vs 5)
        if ([...x.n].some(v => !y.n.has(v)) || [...y.n].some(v => !x.n.has(v))) continue;
        const mx = x.r[7]?.maker, my = y.r[7]?.maker;
        if (mx && my && norm(mx) !== norm(my)) continue;
        // the product in more chains stays (its barcode is the national one)
        const [p, sx] = x.chains.size >= y.chains.size ? [x, y] : [y, x];
        out.push({ a: sx.r[0], b: p.r[0], an: sx.r[1], bn: p.r[1], am: sx.r[7]?.maker, bm: p.r[7]?.maker, score });
      }
    }
  }
  out.sort((a, b) => b.score - a.score);
  const seen = new Map<string, number>();
  return out.filter(x => {
    const n = (seen.get(x.a) ?? 0) + (seen.get(x.b) ?? 0);
    if (n >= 2) return false;
    seen.set(x.a, (seen.get(x.a) ?? 0) + 1); seen.set(x.b, (seen.get(x.b) ?? 0) + 1);
    return true;
  }).slice(0, limit);
}

// ---------- prompts and answers ----------

export const BATCH: Record<TaskKind, number> = { cats: 100, names: 60, links: 50 };

const JSON_ONLY = "Answer with JSON only, no other text.";

export function catPrompt(items: CatItem[], cats: Category[]): ChatMessage[] {
  const list = cats.map(c => `${c.id} = ${c.name}`).join("\n");
  return [
    { role: "system", content: `You sort Israeli supermarket products into categories. The categories:\n${list}\nPick the one a shopper would look in. Use "other" only for things that fit none (for example batteries, clothing, stationery, toys). Brands help: תנובה, טרה, יטבתה are dairy; עלית, אסם, תלמה make snacks and pantry goods; סנו, פיניש are cleaning. ${JSON_ONLY} Shape: {"1":"dairy","2":"snacks"}` },
    { role: "user", content: items.map((x, i) => `${i + 1}. ${x.name}${x.maker ? ` (${x.maker})` : ""}`).join("\n") },
  ];
}

export function namePrompt(items: NameItem[]): ChatMessage[] {
  return [
    { role: "system", content: `You tidy Israeli supermarket product names from the chains' price files for display. For each name write a clean Hebrew name:
- separate numbers from words and write the size at the end in full: "200ג'" -> "200 גרם", "1.5ל'" -> "1.5 ליטר", "500מ"ל" -> "500 מ״ל", "6יח" -> "6 יחידות";
- expand abbreviations only when sure: "ש.חלב" -> "שוקולד חלב", "לל"ס" -> "ללא סוכר";
- keep the brand, the variety, the fat percentage and every number exactly; never add facts that are not in the name; drop stray marks and repeated spaces;
- keep Latin brand names as they are; keep kashrut words (מהדרין, בד"ץ).
If a name is already clean or you are unsure, return it unchanged. ${JSON_ONLY} Shape: {"1":"clean name","2":"..."}` },
    { role: "user", content: items.map((x, i) => `${i + 1}. ${x.name}`).join("\n") },
  ];
}

export function linkPrompt(items: LinkItem[]): ChatMessage[] {
  return [
    { role: "system", content: `You match Israeli supermarket products across chains. Each pair has two product names from different price files, already known to have the same pack size. Answer "same" only when both names clearly describe the same product: the same brand, the same product, variety, flavour, fat percentage and pack. Answer "different" when anything differs (another brand, another variety or flavour, a different pack such as a jar vs a bag). Answer "unsure" when the names don't say enough, and in particular when only one of the two names shows a brand or manufacturer: an unbranded name is often the chain's own store brand, a different product. ${JSON_ONLY} Shape: {"1":"same","2":"different","3":"unsure"}` },
    { role: "user", content: items.map((x, i) => `${i + 1}. A: ${x.an}${x.am ? ` (${x.am})` : ""}\n   B: ${x.bn}${x.bm ? ` (${x.bm})` : ""}`).join("\n") },
  ];
}

const pick = (obj: unknown, i: number): unknown => (obj && typeof obj === "object" ? (obj as Record<string, unknown>)[String(i + 1)] : undefined);

/** Category answers: valid ids only. Asked products are remembered either way. */
export function readCats(items: CatItem[], json: unknown, cats: Category[]): { set: Record<string, string>; asked: string[] } {
  const valid = new Set(cats.map(c => c.id));
  const set: Record<string, string> = {}, asked: string[] = [];
  items.forEach((x, i) => {
    const v = pick(json, i);
    if (typeof v !== "string") return; // not answered: asked again next run
    asked.push(`cats:${x.code}`);
    if (valid.has(v) && v !== "other") set[x.code] = v;
  });
  return { set, asked };
}

const numList = (s: string) => (s.match(/\d+(?:\.\d+)?/g) ?? []).map(Number).sort((a, b) => a - b).join(",");

/**
 * A clean name is accepted only if it keeps every number of the original (sizes, percentages,
 * variants), adds none, keeps at least half the original's length, and actually changes something.
 */
export function goodName(orig: string, clean: string): boolean {
  const c = clean.trim();
  if (!c || c === orig.trim() || c.length < orig.trim().length * 0.5 || c.length > orig.length * 2 + 20) return false;
  return numList(orig) === numList(c);
}

export function readNames(items: NameItem[], json: unknown): { set: Record<string, string>; asked: string[] } {
  const set: Record<string, string> = {}, asked: string[] = [];
  items.forEach((x, i) => {
    const v = pick(json, i);
    if (typeof v !== "string") return;
    asked.push(`names:${x.code}`);
    const clean = v.replace(/\s*\[[^\]]*\]\s*$/, "").replace(/\s+/g, " ").trim();
    if (goodName(x.name, clean)) set[x.code] = clean;
  });
  return { set, asked };
}

export function readLinks(items: LinkItem[], json: unknown): { set: Record<string, string>; asked: string[] } {
  const set: Record<string, string> = {}, asked: string[] = [];
  items.forEach((x, i) => {
    const v = pick(json, i);
    if (typeof v !== "string") return;
    asked.push(`links:${pairKey(x.a, x.b)}`); // "unsure" too: not asked again (resetting the task asks again)
    if (v === "same") set[x.a] = x.b;
  });
  return { set, asked };
}

// ---------- review ----------

export type Change = { kind: TaskKind; code: string; from: string; to: string; undone: boolean; awaiting: boolean; fromWhere?: string; toWhere?: string };

/** Every change the curation makes, for the review list (newest answers are not ordered; sorted by name). */
export function changes(c: Catalog, cur: Curation, kind: TaskKind): Change[] {
  const rows = new Map(c.products.map(r => [r[0], r]));
  const catName = new Map(c.categories.map(x => [x.id, x.name]));
  const out: Change[] = [];
  const src = kind === "cats" ? cur.cats : kind === "names" ? cur.names : cur.links;
  for (const [code, v] of Object.entries(src)) {
    const r = rows.get(code);
    if (!r) continue;
    const undone = !!cur.rejected[`${kind}:${code}`];
    const wait = kind === "links" && awaiting(cur, code);
    if (kind === "cats") out.push({ kind, code, from: `${r[1]} · ${catName.get(r[2]) ?? r[2]}`, to: catName.get(v) ?? v, undone, awaiting: false });
    else if (kind === "names") out.push({ kind, code, from: r[1], to: v, undone, awaiting: false });
    else { const p = rows.get(v); if (p) out.push({ kind, code, from: r[1], to: p[1], undone, awaiting: wait, fromWhere: where(c, r), toWhere: where(c, p) }); }
  }
  // links waiting for approval first
  return out.sort((a, b) => Number(b.awaiting) - Number(a.awaiting) || a.from.localeCompare(b.from, "he"));
}

/** The chains that sell a product, for the review list ("רמי לוי, שופרסל"). */
function where(c: Catalog, r: Row): string {
  return [...new Set(r[4].flatMap((v, i) => (v == null ? [] : [c.stores[i].chain])))].join(", ");
}

export type Counts = { done: number; undone: number; awaiting: number };
export function counts(c: Catalog, cur: Curation): Record<TaskKind, Counts> {
  const codes = new Set(c.products.map(r => r[0]));
  const n = (src: Record<string, string>, k: TaskKind) => {
    let done = 0, undone = 0, wait = 0;
    for (const code in src) {
      if (!codes.has(code)) continue;
      if (cur.rejected[`${k}:${code}`]) undone++;
      else if (k === "links" && awaiting(cur, code)) wait++;
      else done++;
    }
    return { done, undone, awaiting: wait };
  };
  return { cats: n(cur.cats, "cats"), names: n(cur.names, "names"), links: n(cur.links, "links") };
}
