// Turns pasted shopping-list text (typed, or copied from WhatsApp) into lines with a quantity.
// Pure: no React, no native code. Matching a line to a product lives in listmatch.ts.

export type ParsedLine = {
  raw: string; // the line as the person wrote it, after stripping bullets and emojis
  text: string; // what is left once quantity and unit words are removed: the item itself
  count: number | null; // "2 חלב", "חלב x2", "שתי במבות", "3 יח' יוגורט"
  kg: number | null; // "1.5 קג", "חצי קילו", "קילו וחצי"
  grams: number | null; // "500 גרם"
  ml: number | null; // "1.5 ליטר", "750 מל": only ever a size hint
};

const WORD_NUM: Record<string, number> = {
  אחד: 1, אחת: 1, שני: 2, שתי: 2, שניים: 2, שתיים: 2, שנים: 2, שתים: 2, שלוש: 3, שלושה: 3, שלושת: 3,
  ארבע: 4, ארבעה: 4, חמש: 5, חמישה: 5, שש: 6, שישה: 6, שבע: 7, שבעה: 7, שמונה: 8, תשע: 9, תשעה: 9, עשר: 10, עשרה: 10,
};
const KG = new Set(["קילו", "קילוגרם", "קג", "קילוגרמים", "kg", "kgs"]);
const GRAM = new Set(["גרם", "גר", "גרמים", "g", "gr", "gram", "grams"]);
const ML = new Set(["מל", "ml", "מיליליטר"]);
const LITER = new Set(["ליטר", "ליטרים", "l", "lt"]);
const UNIT = new Set(["יח", "יחד", "יחידה", "יחידות", "יחי", "pcs", "pc"]);
const HALF = new Set(["חצי", "וחצי"]);
const QUARTER = new Set(["רבע"]);
const FILLER = new Set(["של", "בבקשה", "יחידות", "יחידה", "יח", "חבילות", "חבילה", "אריזות", "אריזה", "מארזים", "מארז"]);

// Directional marks, zero-width characters, variation selectors, non-breaking space.
const INVISIBLE = /[​-‏‪-‮⁦-⁩️ ]/g;

/** Strip quote marks the way compare.ts norm() does, plus markdown and emojis. */
function clean(s: string): string {
  return s
    .replace(INVISIBLE, " ")
    .replace(/\p{Extended_Pictographic}/gu, " ")
    .replace(/[*_~`]/g, " ")
    .replace(/ק\.\s?ג\.?/g, "קג")
    .replace(/["'׳״`’‘]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Bullets, checkboxes and numbering that chat apps and notes put in front of a line. */
const LEAD = /^(?:[-–—•·▪▫●○◦■□☐☑✔✓✅❌*>+]+|\[[ xv✓]?\]|\(?\d{1,2}[.)]|\d{1,2}\s*-)\s+/u;

/** One entry per item: split on new lines, commas and " + ", then drop bullets and emojis. */
export function splitItems(text: string): string[] {
  const out: string[] = [];
  const t = text.replace(/(\d),(\d)/g, "$1.$2").replace(/\r/g, "");
  for (const line of t.split(/\n/)) {
    for (const piece of line.split(/[,،;؛]|\s\+\s/)) {
      let s = piece.replace(INVISIBLE, " ").replace(/\p{Extended_Pictographic}/gu, " ").replace(/([*_~])(\S[^*_~]*?)\1/g, "$2").trim();
      for (let i = 0; i < 3 && LEAD.test(s); i++) s = s.replace(LEAD, "");
      s = s.trim();
      if (s) out.push(s);
    }
  }
  return out;
}

const isNum = (t: string) => /^\d+(\.\d+)?$/.test(t);

export function parseLine(rawLine: string): ParsedLine {
  let s = clean(rawLine);
  // "2חלב", "500גרם", "חלב x2", "חלב×2", "x2"
  s = s.replace(/(\d)([א-תa-z])/g, "$1 $2").replace(/([א-ת])(\d)/g, "$1 $2");
  s = s.replace(/(^|\s)[x×]\s*(\d+(?:\.\d+)?)(?=\s|$)/g, "$1 ×$2").replace(/(\d+(?:\.\d+)?)\s*[x×](?=\s|$)/g, " ×$1 ");
  s = s.replace(/(\S)×(\d)/g, "$1 ×$2").replace(/\s+/g, " ").trim();
  const toks = s.split(" ").filter(Boolean);
  const n = toks.length;
  const used = new Array<boolean>(n).fill(false);
  let count: number | null = null, kg: number | null = null, grams: number | null = null, ml: number | null = null;
  const num = (i: number): number | null => (i < 0 || i >= n ? null : isNum(toks[i]) ? parseFloat(toks[i]) : toks[i] in WORD_NUM ? WORD_NUM[toks[i]] : null);
  const pct = (i: number) => /%$/.test(toks[i]) || toks[i + 1] === "%" || /^%/.test(toks[i + 1] ?? "");

  for (let i = 0; i < n; i++) {
    const m = /^×(\d+(?:\.\d+)?)$/.exec(toks[i]);
    if (m) { count = parseFloat(m[1]); used[i] = true; }
  }

  for (let i = 0; i < n; i++) {
    if (used[i]) continue;
    const t = toks[i];
    const q = num(i);
    // a quantity followed by its unit: "1.5 קג", "500 גרם", "3 יח", "שני קילו", "2 וחצי קילו"
    if (q != null && !pct(i)) {
      let j = i + 1, amount = q;
      if (HALF.has(toks[j] ?? "") && j + 1 < n && (KG.has(toks[j + 1]) || LITER.has(toks[j + 1]))) { amount += 0.5; j++; }
      const u = toks[j];
      if (u && KG.has(u)) { kg = (kg ?? 0) + amount; for (let k = i; k <= j; k++) used[k] = true; continue; }
      if (u && GRAM.has(u)) { grams = amount; used[i] = used[j] = true; continue; }
      if (u && ML.has(u)) { ml = amount; used[i] = used[j] = true; continue; }
      if (u && LITER.has(u)) { ml = amount * 1000; for (let k = i; k <= j; k++) used[k] = true; continue; }
      if (u && UNIT.has(u)) { count = amount; used[i] = used[j] = true; continue; }
    }
    // a unit with an implied one: "קילו עגבניות", "חצי קילו", "רבע קילו", "קילו וחצי"
    if (KG.has(t)) {
      const prev = i > 0 && !used[i - 1] ? toks[i - 1] : "";
      let amount = 1;
      if (HALF.has(prev)) { amount = 0.5; used[i - 1] = true; }
      else if (QUARTER.has(prev)) { amount = 0.25; used[i - 1] = true; }
      else if (HALF.has(toks[i + 1] ?? "")) { amount = 1.5; used[i + 1] = true; }
      kg = (kg ?? 0) + amount; used[i] = true; continue;
    }
    if (LITER.has(t)) {
      const prev = i > 0 && !used[i - 1] ? toks[i - 1] : "";
      if (HALF.has(prev)) used[i - 1] = true;
      ml = HALF.has(prev) ? 500 : 1000; used[i] = true; continue;
    }
    if (UNIT.has(t) && i > 0 && num(i - 1) != null && !used[i - 1] && count == null) { count = num(i - 1); used[i - 1] = used[i] = true; continue; }
    // "חצי חלב", "רבע גבינה": a fraction in front of the item (after the unit cases above)
    if ((HALF.has(t) || QUARTER.has(t)) && i === 0 && n > 1 && !KG.has(toks[1]) && !LITER.has(toks[1])) {
      count = HALF.has(t) ? 0.5 : 0.25; used[i] = true; continue;
    }
    // a bare number (or number word) at either end of the line is a count; "3%" is not
    if (q != null && (i === 0 || i === n - 1) && !pct(i) && count == null) {
      count = q; used[i] = true;
      if (HALF.has(toks[i + 1] ?? "") && !used[i + 1]) { count += 0.5; used[i + 1] = true; }
    }
  }
  const text = toks.filter((_, i) => !used[i] && !FILLER.has(toks[i])).join(" ").trim();
  return { raw: rawLine.trim(), text, count, kg, grams, ml };
}

export function parseList(text: string): ParsedLine[] {
  return splitItems(text).map(parseLine);
}
