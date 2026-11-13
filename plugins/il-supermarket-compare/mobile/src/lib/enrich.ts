// Product classification by the user's language model: one record per product with what the price
// files don't say in a usable form: product type, category, brand, product line, variant, pack size,
// diet and kashrut tags, and whether it is a chain's own brand.
//
// Runs as a background batch on start-up (enrichRun.tsx) over the products that have no record yet,
// or whose name changed since (the "delta"), most-sold first, and keeps the records in an on-device
// database (enrichDb.ts). Everything here is pure, for tests.
import { norm } from "./compare.ts";
import type { ChatMessage } from "./llm.ts";
import type { Catalog, Category, RawProduct } from "./types.ts";

export const DIET = ["kosher", "mehadrin", "badatz", "parve", "dairy", "meat", "gluten_free", "sugar_free", "low_fat", "organic", "vegan", "lactose_free", "high_protein", "diet"] as const;
export type Diet = (typeof DIET)[number];
export const DIET_LABEL: Record<Diet, string> = {
  kosher: "כשר", mehadrin: "מהדרין", badatz: "בד״ץ", parve: "פרווה", dairy: "חלבי", meat: "בשרי", gluten_free: "ללא גלוטן", sugar_free: "ללא סוכר",
  low_fat: "דל שומן", organic: "אורגני", vegan: "טבעוני", lactose_free: "ללא לקטוז", high_protein: "עתיר חלבון", diet: "דיאט",
};

/** A product's record. Short keys: tens of thousands are stored. */
export type Enriched = {
  t: string; // type, generic and singular: "חלב", "גבינה לבנה", "חטיף תירס"
  c: string; // category id
  b: string; // brand or manufacturer ("" when the name shows none)
  l: string; // product line / sub-brand ("במבה", "פיניש")
  v: string; // variant: flavour, fat %, strength
  s: [number, "g" | "ml" | "u", number] | null; // amount per pack, unit, packs
  d: Diet[];
  pl: boolean; // a chain's own brand
  q: boolean; // the model was unsure
};

/** What is stored per product: the record, a hash of the name it was made from, the model and when. */
export type EnrichRow = { code: string; h: string; rec: Enriched; model: string; at: number };

/** Records are redone when this changes (a new field, a better prompt). */
export const SCHEMA = 1;

export function nameHash(name: string): string {
  let h = 5381;
  const s = `${SCHEMA}|${norm(name)}`;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/** Products per request: about 110 output tokens each, so 80 stay well inside small models' limits. */
export const ENRICH_BATCH = 80;

/**
 * Products with no record, or a record made from another name (renamed, or an older schema): the
 * delta. Ordered by how many branches sell them, so the products that matter most come first.
 */
export function delta(c: Catalog, have: Map<string, string>): RawProduct[] {
  const out = c.products.filter(r => have.get(r[0]) !== nameHash(r[1]) && !/^f-/.test(r[0]));
  const n = (r: RawProduct) => r[4].reduce<number>((t, v) => t + (v == null ? 0 : 1), 0);
  return out.sort((a, b) => n(b) - n(a));
}

export function enrichPrompt(rows: RawProduct[], cats: Category[]): ChatMessage[] {
  const list = cats.map(x => `${x.id}=${x.name}`).join(", ");
  return [
    {
      role: "system",
      content: `You build a product database for an Israeli supermarket price-comparison app from the names in the chains' price files (often abbreviated, sizes glued to words). For each product return an array:
[type, category, brand, line, variant, size, tags, own_brand, unsure]
- type: the product type in Hebrew, generic and singular, without brand, flavour or size ("חלב", "גבינה לבנה", "חטיף תירס", "נוזל כלים", "שמפו", "פסטה", "חזה עוף").
- category: one id of: ${list}. Pick where a shopper would look ("other" only for non-grocery goods such as toys, clothing, candles).
- brand: the brand or manufacturer shoppers know ("תנובה", "אסם", "שטראוס", "קוקה קולה"), "" if the name shows none. A chain's own brand counts (שופרסל, רמי לוי, יש, ויקטורי, טיב טעם).
- line: product line or sub-brand ("במבה", "דני", "פיניש"), else "".
- variant: flavour, fat %, strength or style in a few words ("3%", "תות", "ללא לקטוז"), else "".
- size: [amount per pack, "g"|"ml"|"u", packs], e.g. "6X330 מל" -> [330,"ml",6], "1 ק"ג" -> [1000,"g",1]; null when the name has no size.
- tags: only from ${DIET.join(", ")}. Use a tag only when the name says it (כשר, מהדרין, בד"ץ, ללא גלוטן, אורגני, טבעוני, דיאט...) or it is certain from the type (dairy for cheese or yogurt, meat for chicken or beef). Never add kosher or parve by default. [] when none.
- own_brand: 1 if the brand is a supermarket chain's own label, else 0.
- unsure: 1 only if you are unsure of the type or the brand, else 0.
Answer with JSON only: {"1":[...],"2":[...]} with one entry per product, in the order given.`,
    },
    { role: "user", content: rows.map((r, i) => `${i + 1}. ${r[1]}${r[7]?.maker ? ` [יצרן: ${r[7].maker}]` : ""}`).join("\n") },
  ];
}

const str = (v: unknown, max = 40) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const UNITS = new Set(["g", "ml", "u"]);
const DIETS = new Set<string>(DIET);

/** One answer entry, validated: anything malformed is dropped, an unknown category becomes the product's own. */
export function readRecord(v: unknown, fallbackCat: string, cats: Set<string>): Enriched | null {
  if (!Array.isArray(v) && !(v && typeof v === "object")) return null;
  const a: unknown[] = Array.isArray(v) ? v : [(v as Record<string, unknown>).t, (v as Record<string, unknown>).c, (v as Record<string, unknown>).b, (v as Record<string, unknown>).l, (v as Record<string, unknown>).v, (v as Record<string, unknown>).s, (v as Record<string, unknown>).d, (v as Record<string, unknown>).pl, (v as Record<string, unknown>).q];
  const t = str(a[0]);
  if (!t) return null;
  const c = typeof a[1] === "string" && cats.has(a[1]) ? a[1] : fallbackCat;
  let s: Enriched["s"] = null;
  const z = a[5];
  if (Array.isArray(z) && typeof z[0] === "number" && z[0] > 0 && z[0] < 1e6 && UNITS.has(String(z[1]))) {
    const packs = typeof z[2] === "number" && z[2] >= 1 && z[2] <= 500 ? Math.round(z[2]) : 1;
    s = [z[0], z[1] as "g" | "ml" | "u", packs];
  }
  const d = Array.isArray(a[6]) ? [...new Set(a[6].filter((x): x is Diet => typeof x === "string" && DIETS.has(x)))] : [];
  return { t, c, b: str(a[2]), l: str(a[3]), v: str(a[4], 60), s, d, pl: a[7] === 1 || a[7] === true, q: a[8] === 1 || a[8] === true };
}

/** Reads one batch's answer into rows for the database; products the model skipped are left for the next run. */
export function readEnrich(rows: RawProduct[], json: unknown, cats: Category[], model: string, now: number): EnrichRow[] {
  const valid = new Set(cats.map(x => x.id));
  const obj = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
  const out: EnrichRow[] = [];
  rows.forEach((r, i) => {
    const rec = readRecord(obj[String(i + 1)], r[2], valid);
    if (rec) out.push({ code: r[0], h: nameHash(r[1]), rec, model, at: now });
  });
  return out;
}

/** Text added to a product's search key: type, brand, line and the Hebrew diet labels. */
export function searchTerms(e: Enriched): string {
  return norm([e.t, e.b, e.l, e.v, ...e.d.map(x => DIET_LABEL[x])].filter(Boolean).join(" "));
}
