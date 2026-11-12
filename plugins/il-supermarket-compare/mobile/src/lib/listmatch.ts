// Maps parsed shopping-list lines to catalog products. Pure TypeScript, tested with `npm test`.
import { priceInfo } from "./compare.ts";
import type { ParsedLine } from "./listparse";
import type { Product } from "./types";

// ---------- text normalisation ----------

/** Abbreviations the price files use, written out. Applied to product names and to what people type. */
const ABBREV: [RegExp, string][] = [
  [/(?<![א-ת])ג(?:ב)?\.\s*צהובה/g, "גבינה צהובה"],
  [/(?<![א-ת])ג(?:ב)?\.\s*לבנה/g, "גבינה לבנה"],
  [/(?<![א-ת])ג(?:ב)?\.\s*שמנת/g, "גבינת שמנת"],
  [/(?<![א-ת])ג(?:ב)?\.\s*(?=[א-ת])/g, "גבינה "],
  [/תפוא(?![א-ת])/g, "תפוח אדמה"],
  [/(?<![א-ת])יוג\.?(?![א-ת])/g, "יוגורט"],
  [/(?<![א-ת])מעד\.\s*/g, "מעדן "],
  [/(?<![א-ת])ש\.\s*מריר/g, "שוקולד מריר"],
  [/(?<![א-ת])ש\.\s*חלב/g, "שוקולד חלב"],
  [/(?<![א-ת])ש\.\s*לבן/g, "שוקולד לבן"],
  [/(?<![א-ת])דנונ\.?(?![א-ת])/g, "דנונה "],
  // People say "סבון כלים"; the files say "פלמוליב לכלים" or "נוזל כלים". Bring all three together.
  [/(?<![א-ת])סבון\s+(?:ל)?כלים/g, "נוזל כלים"],
  [/(?<![א-ת])נוזל\s+לכלים/g, "נוזל כלים"],
  [/(?<![א-ת])לכלים(?![א-ת])/g, "נוזל כלים"],
  [/(?<![א-ת])נ\.\s*כלים/g, "נוזל כלים"],
  [/(?<![א-ת])נ\.\s*רצפות/g, "נוזל רצפות"],
  [/(?<![א-ת])מ\.\s*כביסה/g, "מרכך כביסה"],
  [/(?<![א-ת])נ\.\s*טואלט/g, "נייר טואלט"],
  [/(?<![א-ת])ביצ\.(?![א-ת])/g, "ביצים"],
  [/(?<![א-ת])קוטג(?![א-ת])/g, "קוטג"],
  [/(?<![א-ת])חז\.\s*עוף/g, "חזה עוף"],
];

export function expand(s: string): string {
  let t = s.replace(/["'׳״`’‘]/g, "").toLowerCase();
  for (const [re, to] of ABBREV) t = t.replace(re, to);
  return t;
}

const FINAL: Record<string, string> = { ך: "כ", ם: "מ", ן: "נ", ף: "פ", ץ: "צ" };

/** A crude Hebrew stem: drops the definite article, plural and feminine endings, folds final letters. */
export function stem(w: string): string {
  if (/^[a-z0-9%§]+$/.test(w)) return w;
  let s = w;
  if (s.length >= 4 && s.startsWith("ה")) s = s.slice(1);
  if (s.length >= 5) s = s.replace(/(ים|ות|י|ת)$/, "");
  if (s.length >= 4) s = s.replace(/ה$/, "");
  return s.replace(/[ךםןףץ]/g, c => FINAL[c]);
}

export function tokens(s: string): string[] {
  return expand(s)
    .replace(/(\d)\.(\d)/g, "$1§$2")
    .replace(/[^א-תa-z0-9%§\s]/g, " ")
    .split(/\s+/)
    .filter(t => t && t !== "%")
    .map(stem);
}

// ---------- fresh (canonical) items ----------

type Fresh = {
  id: string;
  syn: string[]; // phrases that mean this item
  not?: string[]; // words that make it a different product (cherry tomatoes, pickled cucumbers)
  unitKg: number; // typical weight of one piece, to turn "3 לימונים" into kilos
  defKg: number; // quantity when the line says nothing: same defaults as the web app
};

const FRESH: Fresh[] = [
  { id: "f-tomato", syn: ["עגבניה", "עגבניות"], not: ["שרי", "מיובש", "מרוסק", "רסק", "מגי", "חמוצ", "ממרח", "קלוי"], unitKg: 0.15, defKg: 1 },
  { id: "f-cucumber", syn: ["מלפפון", "מלפפונים"], not: ["חמוצ", "מלח", "בייבי", "כבוש", "חומץ"], unitKg: 0.12, defKg: 1 },
  { id: "f-potato", syn: ["תפוח אדמה", "תפוחי אדמה", "תפוא", "תפוח אדמא"], not: ["מקל", "צ'יפס", "ציפס", "מוקפא", "קפוא", "פירה", "אדום"], unitKg: 0.2, defKg: 2 },
  { id: "f-sweetpotato", syn: ["בטטה", "בטטות"], not: ["קפוא", "צ'יפס"], unitKg: 0.3, defKg: 1 },
  { id: "f-onion", syn: ["בצל", "בצלים", "בצל יבש"], not: ["אדום", "ירוק", "מטוגן", "סגול", "שאלוט", "ירוקים"], unitKg: 0.2, defKg: 1 },
  { id: "f-carrot", syn: ["גזר", "גזרים"], not: ["מגורד", "גמדי", "מיץ"], unitKg: 0.1, defKg: 1 },
  { id: "f-redpepper", syn: ["פלפל אדום", "פלפלים אדומים"], not: ["קלוי", "חריף", "מיובש"], unitKg: 0.2, defKg: 1 },
  { id: "f-zucchini", syn: ["קישוא", "קישואים"], unitKg: 0.2, defKg: 1 },
  { id: "f-eggplant", syn: ["חציל", "חצילים"], not: ["סלט", "קלוי"], unitKg: 0.35, defKg: 1 },
  { id: "f-cabbage", syn: ["כרוב", "כרוב לבן"], not: ["סגול", "חמוצ", "כבוש"], unitKg: 1.2, defKg: 1 },
  { id: "f-lemon", syn: ["לימון", "לימונים"], not: ["מיץ", "כבוש", "נענע", "לימונענע", "ליים"], unitKg: 0.1, defKg: 0.5 },
  { id: "f-banana", syn: ["בננה", "בננות"], unitKg: 0.12, defKg: 1 },
  { id: "f-avocado", syn: ["אבוקדו", "אבוקדוים"], not: ["גוואקמולי"], unitKg: 0.25, defKg: 1 },
  { id: "f-orange", syn: ["תפוז", "תפוזים"], not: ["מיץ", "משקה"], unitKg: 0.25, defKg: 1 },
  { id: "f-clementine", syn: ["קלמנטינה", "קלמנטינות"], unitKg: 0.1, defKg: 1 },
  { id: "f-apple", syn: ["תפוח עץ", "תפוחי עץ", "תפוח", "תפוחים"], not: ["מיץ", "מחית", "אדמה"], unitKg: 0.2, defKg: 1 },
  { id: "f-grapes", syn: ["ענבים", "ענבים ירוקים", "ענבים לבנים"], not: ["שחור", "אדום", "יין", "מיץ"], unitKg: 0.5, defKg: 1 },
  { id: "f-chickenbreast", syn: ["חזה עוף", "פילה עוף", "חזה", "חזה עוף טרי", "חזה עוף טריים"], not: ["קפוא", "מעושן", "הודו", "מתובל", "שלם"], unitKg: 0.4, defKg: 1 },
  { id: "f-schnitzel", syn: ["שניצל", "שניצל עוף", "שניצלים", "שניצל עוף טרי"], not: ["קפוא", "תירס", "מוקרם", "טבעול", "צמחוני", "סויה"], unitKg: 0.15, defKg: 1 },
  { id: "f-thighs", syn: ["כרעיים", "כרעיים עוף", "ירכיים", "ירכיים עוף"], not: ["קפוא"], unitKg: 0.3, defKg: 1 },
  { id: "f-drumsticks", syn: ["שוקיים", "שוקיים עוף", "שוק עוף"], not: ["קפוא", "הודו"], unitKg: 0.15, defKg: 1 },
  { id: "f-groundbeef", syn: ["בשר טחון", "בקר טחון", "בשר בקר טחון", "טחון בקר", "טחון", "בשר טחון בקר"], not: ["הודו", "עוף", "עגל", "קפוא", "טבעוני", "צמחוני"], unitKg: 0.5, defKg: 1 },
];

// Words that describe fresh produce without changing what it is.
const HARMLESS = new Set(["טרי", "טריה", "טריות", "טריים", "גדול", "קטנ", "יפה", "יפים", "לבן", "ירוק", "קילו", "לבנ"].map(stem));

const FRESH_PHRASES = FRESH.map(f => ({ f, phrases: f.syn.map(tokens), notSet: new Set((f.not ?? []).flatMap(tokens)) }));

// ---------- the product index ----------

type Size = { g: number | null; ml: number | null };
type Entry = { p: Product; toks: string[]; set: Set<string>; extra: Set<string>; size: Size; staple: boolean };
export type Index = { entries: Entry[]; fresh: Map<string, Product> };

const STAPLE_BRANDS = ["תנובה", "שטראוס", "אסם", "עלית", "טרה", "סוגת", "יטבתה", "אוסם", "תלמה", "זוגלובק", "מאסטר שף"].map(tokens);

export function sizeOf(name: string): Size {
  const t = expand(name).replace(/(\d)\.(\d)/g, "$1§$2");
  let g: number | null = null, ml: number | null = null;
  const re = /(\d+(?:§\d+)?)\s*(קילוגרם|קילו|קג|kg|גרם|גר|ג|g|ליטר|מל|ml|ל|l)(?![א-ת])/g;
  for (let m = re.exec(t); m; m = re.exec(t)) {
    const v = parseFloat(m[1].replace("§", "."));
    const u = m[2];
    if (/^(קילוגרם|קילו|קג|kg)$/.test(u)) g = v * 1000;
    else if (/^(גרם|גר|ג|g)$/.test(u)) g = v;
    else if (/^(ליטר|ל|l)$/.test(u)) ml = v * 1000;
    else ml = v;
  }
  return { g, ml };
}

const cache = new WeakMap<Map<string, Product>, Index>();

export function buildIndex(products: Map<string, Product>): Index {
  const hit = cache.get(products);
  if (hit) return hit;
  const entries: Entry[] = [];
  const fresh = new Map<string, Product>();
  for (const p of products.values()) {
    if (p.code.startsWith("f-")) { fresh.set(p.code, p); continue; }
    const toks = tokens(p.name);
    const set = new Set(toks);
    const extra = new Set<string>();
    for (const n of p.picks ?? []) if (n) for (const t of tokens(n)) if (!set.has(t)) extra.add(t);
    const flat = " " + toks.join(" ") + " ";
    const staple = STAPLE_BRANDS.some(b => flat.includes(" " + b.join(" ") + " "));
    entries.push({ p, toks, set, extra, size: sizeOf(p.name), staple });
  }
  const idx = { entries, fresh };
  cache.set(products, idx);
  return idx;
}

// ---------- matching ----------

export type Candidate = { code: string; score: number; fresh: boolean };
export type Confidence = "high" | "medium" | "low" | "none";
export type Match = { line: ParsedLine; cands: Candidate[]; conf: Confidence };

function tokenScore(q: string, e: Entry): number {
  if (e.set.has(q)) return 1;
  if (e.extra.has(q)) return 0.9;
  if (q.length >= 3) {
    for (const t of e.toks) if (t.length >= 3 && (t.startsWith(q) || q.startsWith(t))) return 0.7;
  }
  return 0;
}

function sameSize(a: number, b: number) { return Math.abs(a - b) <= Math.max(2, 0.03 * Math.max(a, b)); }

function hintOf(line: ParsedLine): Size {
  return { g: line.grams ?? (line.kg != null ? line.kg * 1000 : null), ml: line.ml };
}

function freshMatch(line: ParsedLine, q: string[], idx: Index, active: number[]): Candidate | null {
  let best: { f: Fresh; len: number; rest: number } | null = null;
  for (const { f, phrases, notSet } of FRESH_PHRASES) {
    const p = idx.fresh.get(f.id);
    if (!p || priceInfo(p, active).lo == null) continue;
    if (q.some(t => notSet.has(t))) continue;
    for (const ph of phrases) {
      if (!ph.length || ph.length > q.length) continue;
      for (let s = 0; s + ph.length <= q.length; s++) {
        if (!ph.every((t, k) => q[s + k] === t)) continue;
        const rest = q.length - ph.length - q.filter((t, k) => (k < s || k >= s + ph.length) && HARMLESS.has(t)).length;
        if (!best || ph.length > best.len || (ph.length === best.len && rest < best.rest)) best = { f, len: ph.length, rest };
      }
    }
  }
  if (!best) return null;
  // a bare produce word wins clearly; extra unknown words ("עגבניות מרוסקות" is caught by `not`, "עגבניות עסיסיות" is not) weaken it
  return { code: best.f.id, score: Math.max(0.6, 2 - 0.4 * best.rest), fresh: true };
}

export function matchLine(idx: Index, line: ParsedLine, active: number[]): Match {
  const q = tokens(line.text);
  if (!q.length) return { line, cands: [], conf: "none" };
  const cands: Candidate[] = [];
  const fm = freshMatch(line, q, idx, active);
  if (fm) cands.push(fm);

  const hint = hintOf(line);
  const scored: (Candidate & { cover: number })[] = [];
  const nActive = Math.max(1, active.length);
  for (const e of idx.entries) {
    let cover = 0;
    let strong = false;
    for (const t of q) {
      const s = tokenScore(t, e);
      cover += s;
      if (s >= 0.9) strong = true;
    }
    cover /= q.length;
    if (cover < 0.5 || !strong) continue;
    const pi = priceInfo(e.p, active);
    if (pi.lo == null) continue;
    const matched = q.filter(t => e.set.has(t) || e.extra.has(t)).length;
    let score = cover;
    if (q[0] === e.toks[0]) score += 0.12;
    score -= Math.min(0.12, 0.015 * Math.max(0, e.toks.filter(t => !/^[\d§%]+$/.test(t)).length - matched));
    if (hint.g != null && e.size.g != null) score += sameSize(hint.g, e.size.g) ? 0.3 : -0.1;
    else if (hint.ml != null && e.size.ml != null) score += sameSize(hint.ml, e.size.ml) ? 0.3 : -0.1;
    else if (hint.g != null && e.size.ml != null && sameSize(hint.g, e.size.ml)) score += 0.1;
    score += 0.25 * (pi.n / nActive);
    if (e.staple) score += 0.04;
    scored.push({ code: e.p.code, score, fresh: false, cover });
  }
  scored.sort((a, b) => b.score - a.score || a.code.localeCompare(b.code));
  const coverOf = new Map(scored.map(s => [s.code, s.cover]));
  for (const s of scored.slice(0, 3)) cands.push({ code: s.code, score: s.score, fresh: false });
  cands.sort((a, b) => b.score - a.score);
  const top = cands.slice(0, 3);
  if (!top.length) return { line, cands: [], conf: "none" };
  const c0 = top[0];
  const cover = c0.fresh ? (c0.score >= 1.5 ? 1 : 0.7) : coverOf.get(c0.code) ?? 0;
  const conf: Confidence = cover >= 0.99 ? "high" : cover >= 0.66 ? "medium" : "low";
  return { line, cands: top, conf };
}

export function matchList(products: Map<string, Product>, lines: ParsedLine[], active: number[]): Match[] {
  const idx = buildIndex(products);
  return lines.map(l => matchLine(idx, l, active));
}

// ---------- quantity ----------

const round1 = (x: number) => Math.round(x * 10) / 10;

/** The cart quantity for a line once the product is known: kilos for weighted items, units otherwise. */
export function quantityFor(line: ParsedLine, p: Product): number {
  if (p.weighted) {
    const f = FRESH.find(x => x.id === p.code);
    if (line.kg != null) return round1(line.kg);
    if (line.grams != null) return round1(line.grams / 1000);
    if (line.count != null) {
      const kg = line.count * (f?.unitKg ?? 0.25);
      return Math.max(0.5, Math.ceil(kg / 0.5 - 1e-9) * 0.5);
    }
    return f?.defKg ?? 1;
  }
  return line.count != null ? Math.max(1, Math.round(line.count)) : 1;
}
