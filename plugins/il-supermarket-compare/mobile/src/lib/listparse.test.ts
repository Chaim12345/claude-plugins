import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLine, parseList, splitItems } from "./listparse.ts";

const P = (s: string) => { const { raw: _raw, ...r } = parseLine(s); return r; };
const base = { count: null, kg: null, grams: null, ml: null };

test("digit counts, before and after the item", () => {
  assert.deepEqual(P("2 חלב"), { ...base, text: "חלב", count: 2 });
  assert.deepEqual(P("חלב x2"), { ...base, text: "חלב", count: 2 });
  assert.deepEqual(P("חלב ×2"), { ...base, text: "חלב", count: 2 });
  assert.deepEqual(P("חלב×2"), { ...base, text: "חלב", count: 2 });
  assert.deepEqual(P("חלב 2"), { ...base, text: "חלב", count: 2 });
  assert.deepEqual(P("2חלב"), { ...base, text: "חלב", count: 2 });
  assert.deepEqual(P("3 יח' יוגורט"), { ...base, text: "יוגורט", count: 3 });
  assert.deepEqual(P("יוגורט 3 יחידות"), { ...base, text: "יוגורט", count: 3 });
});

test("kilos and grams", () => {
  assert.deepEqual(P('עגבניות 1 ק"ג'), { ...base, text: "עגבניות", kg: 1 });
  assert.deepEqual(P("1.5 קג חזה עוף"), { ...base, text: "חזה עוף", kg: 1.5 });
  assert.deepEqual(P("1.5 ק.ג תפוזים"), { ...base, text: "תפוזים", kg: 1.5 });
  assert.deepEqual(P("חצי קילו לימונים"), { ...base, text: "לימונים", kg: 0.5 });
  assert.deepEqual(P("קילו וחצי"), { ...base, text: "", kg: 1.5 });
  assert.deepEqual(P("קילו וחצי בננות"), { ...base, text: "בננות", kg: 1.5 });
  assert.deepEqual(P("רבע קילו גזר"), { ...base, text: "גזר", kg: 0.25 });
  assert.deepEqual(P("קילו בצל"), { ...base, text: "בצל", kg: 1 });
  assert.deepEqual(P("2 קילו תפוחי אדמה"), { ...base, text: "תפוחי אדמה", kg: 2 });
  assert.deepEqual(P("500 גרם גבינה צהובה"), { ...base, text: "גבינה צהובה", grams: 500 });
  assert.deepEqual(P("גבינה צהובה 500 גר'"), { ...base, text: "גבינה צהובה", grams: 500 });
});

test("Hebrew number words", () => {
  assert.deepEqual(P("שתי במבות"), { ...base, text: "במבות", count: 2 });
  assert.deepEqual(P("שני יוגורטים"), { ...base, text: "יוגורטים", count: 2 });
  assert.deepEqual(P("שלושה"), { ...base, text: "", count: 3 });
  assert.deepEqual(P("שלוש חלות"), { ...base, text: "חלות", count: 3 });
  assert.deepEqual(P("שני קילו עגבניות"), { ...base, text: "עגבניות", kg: 2 });
  assert.deepEqual(P("חצי חלב"), { ...base, text: "חלב", count: 0.5 });
});

test("percent and volume stay as size hints, not quantities", () => {
  assert.deepEqual(P("חלב 3%"), { ...base, text: "חלב 3%" });
  assert.deepEqual(P("2 חלב 3%"), { ...base, text: "חלב 3%", count: 2 });
  assert.deepEqual(P("קולה 1.5 ליטר"), { ...base, text: "קולה", ml: 1500 });
  assert.deepEqual(P("מים 500 מל x6"), { ...base, text: "מים", ml: 500, count: 6 });
  assert.deepEqual(P("חצי ליטר שמנת"), { ...base, text: "שמנת", ml: 500 });
});

test("bullets, numbering, emojis and WhatsApp markup are stripped", () => {
  const text = "*רשימת קניות*\n1. חלב\n2) 🥛 גבינה צהובה\n- עגבניות 1 ק\"ג\n• ✅ שתי במבות\n[ ] ביצים\n🍞 לחם";
  assert.deepEqual(splitItems(text), ["רשימת קניות", "חלב", "גבינה צהובה", 'עגבניות 1 ק"ג', "שתי במבות", "ביצים", "לחם"]);
  assert.deepEqual(parseList(text).map(l => l.text), ["רשימת קניות", "חלב", "גבינה צהובה", "עגבניות", "במבות", "ביצים", "לחם"]);
});

test("commas split items but not decimals", () => {
  assert.deepEqual(parseList("חלב, 2 לחם, קילו וחצי עגבניות").map(l => [l.text, l.count, l.kg]), [["חלב", null, null], ["לחם", 2, null], ["עגבניות", null, 1.5]]);
  assert.deepEqual(parseList("1,5 קג בננות").map(l => l.kg), [1.5]);
});

test("invisible direction marks and blank lines are ignored", () => {
  assert.deepEqual(splitItems("‏- חלב‏\n\n   \n‎• לחם"), ["חלב", "לחם"]);
});
