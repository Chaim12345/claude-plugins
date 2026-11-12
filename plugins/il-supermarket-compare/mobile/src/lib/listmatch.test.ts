import { test } from "node:test";
import assert from "node:assert/strict";
import { expand, matchLine, matchList, buildIndex, quantityFor, sizeOf, tokens } from "./listmatch.ts";
import { parseLine, parseList } from "./listparse.ts";
import { toProducts } from "./compare.ts";
import type { Catalog, RawProduct } from "./types.ts";

// Three stores. null = not sold there.
const P: RawProduct[] = [
  ["f-tomato", "עגבניות", "produce", 1, [690, 790, 590], ["עגבניה", "עגבניות", "עגבניה"], null],
  ["f-cucumber", "מלפפונים", "produce", 1, [500, 450, 480], null, null],
  ["f-potato", "תפוחי אדמה לבנים", "produce", 1, [400, 450, null], ["תפו\"א", "תפוחי אדמה", null], null],
  ["f-lemon", "לימון", "produce", 1, [900, 800, 850], null, null],
  ["f-apple", "תפוח עץ (הזן הזול בסניף)", "produce", 1, [1000, 900, 950], null, null],
  ["f-chickenbreast", "חזה עוף טרי", "meat", 1, [3500, 3300, 3400], null, null],
  ["f-groundbeef", "בשר בקר טחון טרי", "meat", 1, [6000, null, 6200], null, null],
  ["f-onion", "בצל יבש", "produce", 1, [300, 300, 300], null, null],
  ["100", "חלב 3% תנובה 1 ליטר", "dairy", 0, [700, 650, 720], null, null],
  ["101", "חלב 1% תנובה 1 ליטר", "dairy", 0, [700, null, null], null, null],
  ["102", "שוקולד חלב עלית 100 גרם", "snacks", 0, [800, 800, 800], null, null],
  ["103", "חלב סויה אלפרו 1 ליטר", "dairy", 0, [1200, null, null], null, null],
  ["200", "ג.צהובה עמק 500 גרם", "dairy", 0, [2500, 2400, 2600], null, null],
  ["201", "ג.צהובה עמק 200 גרם", "dairy", 0, [1200, 1100, 1300], null, null],
  ["202", "גבינת שמנת תנובה 200 גרם", "dairy", 0, [900, 900, 900], null, null],
  ["300", "במבה אסם 80 גרם", "snacks", 0, [450, 450, 390], null, null],
  ["301", "במבה נוגט 60 גרם", "snacks", 0, [400, null, null], null, null],
  ["400", "דנונ.פרו שוקולד 200 גרם", "dairy", 0, [800, 800, 800], null, null],
  ["401", "יוגורט פרו וניל", "dairy", 0, [600, null, null], null, null],
  ["500", "עגבניות מרוסקות 400 גרם", "pantry", 0, [500, 500, 500], null, null],
  ["501", "קולה 1.5 ליטר", "drinks", 0, [800, 800, 800], null, null],
  ["502", "קולה 500 מל", "drinks", 0, [500, 500, 500], null, null],
  ["600", "לחם אחיד פרוס", "bakery", 0, [800, 800, 800], null, null],
  ["601", "קוטג' תנובה 250 גרם", "dairy", 0, [600, 600, 600], null, null],
  ["602", "ביצים L 12 יח'", "dairy", 0, [1500, 1500, 1500], null, null],
  ["700", "מלפפונים חמוצים 700 גרם", "pantry", 0, [700, 700, 700], null, null],
];
const cat: Catalog = {
  priceDate: "2026-11-12", generatedAt: "", skipped: [], categories: [], areas: [],
  stores: ["A", "B", "C"].map((c, i) => ({ id: `${c}:${i}`, chain: c, branch: "", address: "", lat: null, lon: null, approx: false })),
  products: P,
};
const products = toProducts(cat);
const all = [0, 1, 2];
const top = (line: string, active = all) => matchList(products, [parseLine(line)], active)[0].cands[0]?.code;
const qty = (line: string) => { const l = parseLine(line); const m = matchList(products, [l], all)[0]; return quantityFor(l, products.get(m.cands[0].code)!); };

test("abbreviations in product names are expanded", () => {
  assert.equal(expand("ג.צהובה עמק"), "גבינה צהובה עמק");
  assert.equal(expand('תפו"א לבן'), "תפוח אדמה לבן");
  assert.deepEqual(tokens("דנונ.פרו שוקולד"), tokens("דנונה פרו שוקולד"));
});

test("sizes are read from names", () => {
  assert.deepEqual(sizeOf("חלב 3% תנובה 1 ליטר"), { g: null, ml: 1000 });
  assert.deepEqual(sizeOf("ג.צהובה עמק 500 גרם"), { g: 500, ml: null });
  assert.deepEqual(sizeOf("קולה 1.5 ליטר"), { g: null, ml: 1500 });
  assert.deepEqual(sizeOf('אורז 1 ק"ג'), { g: 1000, ml: null });
});

test("fresh items win for produce and meat words, with plural/singular and synonyms", () => {
  assert.equal(top("עגבניה"), "f-tomato");
  assert.equal(top("עגבניות"), "f-tomato");
  assert.equal(top("מלפפון"), "f-cucumber");
  assert.equal(top("מלפפונים"), "f-cucumber");
  assert.equal(top('תפו"א'), "f-potato");
  assert.equal(top("תפוח אדמה"), "f-potato");
  assert.equal(top("תפוחי אדמה"), "f-potato");
  assert.equal(top("תפוח"), "f-apple");
  assert.equal(top("חזה עוף"), "f-chickenbreast");
  assert.equal(top("פילה עוף"), "f-chickenbreast");
  assert.equal(top("בשר טחון"), "f-groundbeef");
  assert.equal(top("בקר טחון"), "f-groundbeef");
  assert.equal(top("לימונים"), "f-lemon");
});

test("qualifiers send produce words to the packaged product", () => {
  assert.equal(top("עגבניות מרוסקות"), "500");
  assert.equal(top("מלפפונים חמוצים"), "700");
});

test("an unavailable fresh item is not offered", () => {
  assert.equal(top("בשר טחון", [1]), undefined); // sold at A and C only
  assert.equal(top("בשר טחון", [0]), "f-groundbeef");
});

test("packaged: token match, start of name and fewer extra words", () => {
  assert.equal(top("חלב"), "100"); // starts with the word and sold in all three stores
  assert.equal(top("חלב תנובה"), "100");
  assert.equal(top("חלב סויה"), "103");
  assert.equal(top("קוטג"), "601");
  assert.equal(top("ביצים"), "602");
  assert.equal(top("לחם"), "600");
});

test("plural forms and abbreviations match", () => {
  assert.equal(top("שתי במבות"), "300");
  assert.equal(top("גבינה צהובה"), "200");
  assert.equal(top("ג.צהובה"), "200");
  assert.equal(top("דנונה פרו"), "400");
});

test("size hints choose between pack sizes", () => {
  assert.equal(top("200 גרם גבינה צהובה"), "201");
  assert.equal(top("500 גרם גבינה צהובה"), "200");
  assert.equal(top("קולה 1.5 ליטר"), "501");
  assert.equal(top("קולה 500 מל"), "502");
  assert.equal(top("חלב 1%"), "101");
  assert.equal(top("חלב 3%"), "100");
  // a size with no matching pack is a hint, not a filter
  assert.ok(["200", "201"].includes(top("גבינה צהובה 750 גרם")!));
});

test("availability across active stores breaks ties", () => {
  // same words match both; במבה אסם is sold in 3 stores, במבה נוגט in 1
  assert.equal(top("במבה"), "300");
  assert.equal(top("חלב 1% תנובה"), "101");
  // 101 sold only at A: with A off it is no longer offered at all
  assert.deepEqual(matchList(products, parseList("חלב 1%"), [1, 2])[0].cands.map(c => c.code).includes("101"), false);
});

test("top three alternatives and confidence", () => {
  const m = matchList(products, parseList("חלב"), all)[0];
  assert.equal(m.cands.length, 3);
  assert.equal(m.conf, "high");
  assert.equal(matchList(products, parseList("אבקת פיצה"), all)[0].conf, "none");
  assert.equal(matchList(products, parseList("שלושה"), all)[0].conf, "none");
  assert.equal(matchList(products, parseList("קילו וחצי"), all)[0].cands.length, 0);
});

test("quantities: units, kilos, defaults per item", () => {
  assert.equal(qty("2 חלב"), 2);
  assert.equal(qty("חלב"), 1);
  assert.equal(qty("חצי חלב"), 1);
  assert.equal(qty("שתי במבות"), 2);
  assert.equal(qty('עגבניות 1 ק"ג'), 1);
  assert.equal(qty("1.5 קג חזה עוף"), 1.5);
  assert.equal(qty("חצי קילו לימונים"), 0.5);
  assert.equal(qty("קילו וחצי מלפפונים"), 1.5);
  assert.equal(qty("500 גרם חזה עוף"), 0.5);
  assert.equal(qty("עגבניות"), 1);
  assert.equal(qty("לימונים"), 0.5); // default for lemons
  assert.equal(qty("תפוחי אדמה"), 2); // default for potatoes
  assert.equal(qty("3 לימונים"), 0.5); // three lemons, about 300 g
  assert.equal(qty("3 חזה עוף"), 1.5);
  // grams are a size hint for packaged goods, not a quantity
  assert.equal(qty("500 גרם גבינה צהובה"), 1);
});

test("a whole WhatsApp list end to end", () => {
  const text = "*קניות לשבת* 🛒\n1. חלב 3% x2\n2. 🍅 עגבניות 1 ק\"ג\n- חצי קילו לימונים\n• שתי במבות\n✅ 500 גרם ג.צהובה\n3 יח' קוטג\nאבקת פיצה";
  const ms = matchList(products, parseList(text), all);
  const out = ms.slice(1).map(m => [m.cands[0]?.code ?? null, m.cands[0] ? quantityFor(m.line, products.get(m.cands[0].code)!) : null]);
  assert.deepEqual(out, [["100", 2], ["f-tomato", 1], ["f-lemon", 0.5], ["300", 2], ["200", 1], ["601", 3], [null, null]]);
});

test("index is cached per catalog", () => {
  assert.equal(buildIndex(products), buildIndex(products));
  assert.ok(matchLine(buildIndex(products), parseLine("חלב"), all).cands.length);
});
