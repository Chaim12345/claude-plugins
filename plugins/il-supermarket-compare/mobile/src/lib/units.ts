// Pack sizes parsed from product names, and unit prices (per 100 g, per litre, per piece).
// Pure, no imports: runs under `node --test`. Conservative by design: when a name is ambiguous
// ("125 גר 4 יח", two different sizes, "מגוון"), there is no size and so no unit price.

export type UnitKind = "weight" | "volume" | "count";

/** amount is the TOTAL in the pack: grams, millilitres or pieces. packs is how many identical packs it is made of. */
export type Size = { kind: UnitKind; amount: number; packs: number };

/** Price in agorot per 100 g (weight), per 1 L (volume) or per piece (count). */
export type UnitPrice = { kind: UnitKind; agorot: number };

const BASE: Record<UnitKind, number> = { weight: 100, volume: 1000, count: 1 };

// Units, longest first. Strong ones may be glued to the next word ("גרםטירת"); weak ones must end the token,
// so "10 מלפפונים" is not 10 ml and "4 גרעינים" is not 4 g.
const STRONG: [string, UnitKind, number][] = [
  ["קילוגרם", "weight", 1000], ["גרמים", "weight", 1], ["גרם", "weight", 1],
  ["מיליליטר", "volume", 1], ["ליטרים", "volume", 1000], ["ליטר", "volume", 1000],
];
const WEAK: [string, UnitKind, number][] = [
  ["קילו", "weight", 1000], ["קג", "weight", 1000], ["kg", "weight", 1000],
  ["גר", "weight", 1], ["gr", "weight", 1], ["g", "weight", 1], ["ג", "weight", 1],
  ["ליט", "volume", 1000], ["l", "volume", 1000], ["ל", "volume", 1000],
  ["מל", "volume", 1], ["ml", "volume", 1],
];
const COUNT_WORDS = ["יחידות", "יחידה", "יחי", "יח", "שקיקים", "גלילים", "טיטולים", "חיתולים", "קפסולות", "כוסות", "מגבונים", "תחבושות", "כפפות"];
// Words that mean a bare "מ" is metres, not millilitres.
const METRE_CONTEXT = /גליל|רול|ניילון|נייר|סרט|שקית|מטר|רצועות/;

const UNIT_RE = [...STRONG, ...WEAK].map(u => u[0]).sort((a, b) => b.length - a.length).join("|");
const NUM = String.raw`(\d+(?:\.\d+)?)`;
const FLAGS = "giu";
const PLAIN = new RegExp(String.raw`(?<![\d.])${NUM}\s*(${UNIT_RE})`, FLAGS);
const COUNT_RE = new RegExp(String.raw`(?<![\d.])(\d{1,4})\s*(${COUNT_WORDS.join("|")})(?![\p{L}])`, FLAGS);

function normalize(name: string): string {
  return name
    .replace(/["'`״׳”“’‘]/g, "")
    .replace(/(\d),(\d{1,2})(?!\d)/g, "$1.$2")
    .replace(/[×*]/g, "x")
    .toLowerCase();
}

/** The unit word at the start of s ("500 גרם" -> after the number), honouring the word-boundary rule for weak units. */
function unitAt(s: string, bareM: boolean): { kind: UnitKind; factor: number; len: number } | null {
  const lower = s.toLowerCase();
  for (const [w, k, f] of [...STRONG, ...WEAK].sort((a, b) => b[0].length - a[0].length)) {
    if (!lower.startsWith(w)) continue;
    const strong = STRONG.some(x => x[0] === w);
    const next = lower.slice(w.length, w.length + 1);
    if (!strong && next && /\p{L}/u.test(next)) continue;
    return { kind: k, factor: f, len: w.length };
  }
  if (bareM && /^מ(?!\p{L})/u.test(lower)) return { kind: "volume", factor: 1, len: 1 };
  return null;
}

// "25 גרם חלבון" is the protein, not the pack; "6 1.5 ל" is a 6-pack of unknown arrangement.
const NUTRIENT = /^\s*(חלבון|שומן|סוכר|פחמימות|קלוריות|מלח|סיבים|ויטמין)/;
function doubtful(s: string, start: number, end: number): boolean {
  if (NUTRIENT.test(s.slice(end))) return true;
  const lead = s.slice(0, start).match(/(?<![\d.\-])(\d{1,2})\s+$/);
  if (!lead || +lead[1] < 2 || +lead[1] > 24) return false;
  return !/שלב\s*$/.test(s.slice(0, start).slice(0, lead.index)); // "שלב 2 700 גרם" is a formula stage
}

const inRange = (k: UnitKind, amount: number) => (k === "count" ? amount >= 2 && amount <= 1000 : k === "weight" ? amount >= 5 && amount <= 50000 : amount >= 10 && amount <= 30000);

/**
 * The pack size from a product name: "חלב 3% 1 ליטר", "טונה 4x160 גרם", "קולה 6x330". null when the name
 * has no size, more than one, or one that could be read two ways.
 */
export function parseSize(name: string, cat?: string): Size | null {
  const s = normalize(name);
  const bareM = !METRE_CONTEXT.test(s);

  // 6x330, 6 x 330 מל, 400x3 גרם, 330 מל x 6
  const found: Size[] = [];
  const consumed: [number, number][] = [];
  const multi = new RegExp(String.raw`(?<![\d.])${NUM}\s*x\s*${NUM}(?!\d)\s*`, "gi");
  for (const m of s.matchAll(multi)) {
    const a = +m[1], b = +m[2];
    const end = m.index! + m[0].length;
    const u = unitAt(s.slice(end), bareM);
    let amount: number, packs: number;
    if (Number.isInteger(a) && a >= 2 && a <= 24 && b >= 20) { packs = a; amount = b; }
    else if (Number.isInteger(b) && b >= 2 && b <= 24 && a >= 20) { packs = b; amount = a; }
    else return null;
    if (u) {
      found.push({ kind: u.kind, amount: amount * u.factor * packs, packs });
      consumed.push([m.index!, end + u.len]);
    } else if (cat === "drinks" && amount >= 150 && amount <= 750) {
      found.push({ kind: "volume", amount: amount * packs, packs });
      consumed.push([m.index!, end]);
    } else return null;
  }
  if (found.length) {
    if (found.length > 1) return null;
    // "330 מל x 6 x" etc. are not supported; any further plain size in the name makes it ambiguous
    const rest = s.split("").map((c, i) => (consumed.some(([a, b]) => i >= a && i < b) ? " " : c)).join("");
    if (new RegExp(String.raw`(?<![\d.])${NUM}\s*(${UNIT_RE})`, FLAGS).test(rest)) return null;
    return inRange(found[0].kind, found[0].amount) ? found[0] : null;
  }

  // one plain size, optionally followed by "x 6": 330 מל x 6
  const sizes: Size[] = [];
  const re = new RegExp(PLAIN.source, "giu");
  for (const m of s.matchAll(re)) {
    const u = unitAt(s.slice(m.index! + m[1].length).trimStart(), bareM);
    if (!u) continue;
    const after = s.slice(m.index! + m[0].length);
    if (doubtful(s, m.index!, m.index! + m[0].length)) continue;
    const mult = after.match(/^\s*x\s*(\d{1,2})(?![\d.])/);
    const packs = mult ? +mult[1] : 1;
    sizes.push({ kind: u.kind, amount: +m[1] * u.factor * packs, packs });
  }
  // a bare "מ" ("750מ") is not in the unit regex: look for it separately
  if (!sizes.length && bareM) {
    for (const m of s.matchAll(new RegExp(String.raw`(?<![\d.])${NUM}\s*מ(?!\p{L})`, "giu"))) {
      if (+m[1] >= 30 && !doubtful(s, m.index!, m.index! + m[0].length)) sizes.push({ kind: "volume", amount: +m[1], packs: 1 });
    }
  }
  if (sizes.length > 1) return null;
  const count = [...s.matchAll(new RegExp(COUNT_RE.source, "giu"))].map(m => +m[1]);
  if (sizes.length === 1) {
    if (count.some(c => c > 1)) return null; // "125 גר 4 יח": 125 g each or in total?
    const z = sizes[0];
    return inRange(z.kind, z.amount) ? z : null;
  }
  if (count.length === 1 && inRange("count", count[0])) return { kind: "count", amount: count[0], packs: 1 };
  return null;
}

/** The name with its size words removed ("חלב 3% 1 ליטר" -> "חלב 3%"), lower-cased, for matching products by what they are. */
export function withoutSize(name: string): string {
  const s = normalize(name);
  let out = "", last = 0;
  for (const m of s.matchAll(new RegExp(String.raw`(?<![\d.])${NUM}(\s*x\s*\d+(?:\.\d+)?)?\s*`, FLAGS))) {
    const end = m.index! + m[0].length;
    const u = unitAt(s.slice(end), true);
    if (!u && !m[2]) continue; // a plain number: left for the caller
    out += s.slice(last, m.index!) + " ";
    last = end + (u ? u.len : 0);
  }
  return (out + s.slice(last)).replace(new RegExp(COUNT_RE.source, "giu"), " ").replace(/\s+/g, " ").trim();
}

const sizeCache = new Map<string, Size | null>();

type Sized = { code: string; name: string; cat: string; weighted?: boolean; meta?: { size?: [number, "g" | "ml" | "u", number] } | null };
const KIND_OF = { g: "weight", ml: "volume", u: "count" } as const;

/**
 * The pack size of a catalog product, remembered (the products screen asks for thousands of them).
 * Two sources: the size the chains state in their files (meta.size, with how many chains agree) and the
 * product's name. The chains' figure wins when two or more agree: it is the total of a multi-pack and is
 * not fooled by "20 גרם חלבון". A multi-pack spelled out in the name ("6x330") wins over both. A single
 * chain's figure is used only when the name has no size. Fresh items sold by weight have no pack size.
 */
export function sizeOf(p: Sized): Size | null {
  if (p.weighted) return null;
  const s = p.meta?.size;
  const k = `${p.code}|${p.name}|${s ? s.join(":") : ""}`;
  let z = sizeCache.get(k);
  if (z !== undefined) return z;
  const named = parseSize(p.name, p.cat);
  z = named;
  if (s && KIND_OF[s[1]] && s[0] > 0) {
    const stated: Size = { kind: KIND_OF[s[1]], amount: s[0], packs: 1 };
    if (named && named.packs > 1) z = named;
    else if (s[2] >= 2) z = named && named.kind === stated.kind && Math.abs(named.amount - stated.amount) <= 0.02 * stated.amount ? named : stated;
    else z = named ?? stated;
  }
  sizeCache.set(k, z);
  return z;
}

/** Unit price of a pack at `agorot` (the pack's total price). null when the size is unknown. */
export function unitPrice(size: Size | null, agorot: number): UnitPrice | null {
  if (!size || !(agorot > 0)) return null;
  return { kind: size.kind, agorot: (agorot / size.amount) * BASE[size.kind] };
}

const fmt = (agorot: number) => (agorot / 100).toFixed(2);

export const UNIT_LABEL: Record<UnitKind, string> = { weight: "ל־100 גרם", volume: "לליטר", count: "ליחידה" };

/** "2.40 ₪ ל־100 גרם" */
export function unitText(u: UnitPrice): string {
  return `${fmt(u.agorot)} ₪ ${UNIT_LABEL[u.kind]}`;
}

/** "500 גרם", "1.5 ליטר", "6 יחידות" */
export function sizeText(z: Size): string {
  const n = (x: number) => String(+x.toFixed(2));
  if (z.kind === "weight") return z.amount >= 1000 ? `${n(z.amount / 1000)} ק״ג` : `${n(z.amount)} גרם`;
  if (z.kind === "volume") return z.amount >= 1000 ? `${n(z.amount / 1000)} ליטר` : `${n(z.amount)} מ״ל`;
  return `${n(z.amount)} יחידות`;
}

/** Are the two sizes of the same kind and within ±tol of each other (default 15%)? Ratio is b / a. */
export function similarSize(a: Size, b: Size, tol = 0.15): boolean {
  if (a.kind !== b.kind || a.amount <= 0) return false;
  const r = b.amount / a.amount;
  return r >= 1 - tol - 1e-9 && r <= 1 + tol + 1e-9;
}

const KIND_ORDER: Record<UnitKind, number> = { weight: 0, volume: 1, count: 2 };

/** Order for "cheapest per unit": per-100g items first, then per-litre, then per-piece; items without a unit price last. Only prices of the same kind are comparable. */
export function compareUnit(a: UnitPrice | null, b: UnitPrice | null): number {
  if (!a || !b) return a ? -1 : b ? 1 : 0;
  return KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.agorot - b.agorot;
}

/** Rows ordered by unit price (see compareUnit); rows without one keep their relative order at the end. */
export function sortByUnitPrice<T>(rows: T[], get: (row: T) => UnitPrice | null): T[] {
  return rows.map((r, i) => ({ r, i, u: get(r) })).sort((a, b) => compareUnit(a.u, b.u) || a.i - b.i).map(x => x.r);
}
