import { test } from "node:test";
import assert from "node:assert/strict";
import { compareUnit, parseSize, similarSize, sizeOf, sizeText, sortByUnitPrice, unitPrice, unitText, withoutSize } from "./units.ts";

const z = (name: string, cat?: string) => parseSize(name, cat);

test("parseSize: grams, kilos, litres, millilitres in the shapes the chains write them", () => {
  assert.deepEqual(z("יוגורט דנונה ביו טבעי 1.7% 200 גרם"), { kind: "weight", amount: 200, packs: 1 });
  assert.deepEqual(z("SIMPLY FRUIT מולר בטעם אפרסק 3% 150 גר"), { kind: "weight", amount: 150, packs: 1 });
  assert.deepEqual(z("שוקולד מריר100ג פרה עלית"), { kind: "weight", amount: 100, packs: 1 });
  assert.deepEqual(z("לחם 7 דגנים קל 1.1קג"), { kind: "weight", amount: 1100, packs: 1 });
  assert.deepEqual(z('נקניקיות עוף טרי 1 ק"ג'), { kind: "weight", amount: 1000, packs: 1 });
  assert.deepEqual(z("שוופס מוגז ענבים 1.5ליטר"), { kind: "volume", amount: 1500, packs: 1 });
  assert.deepEqual(z("פרוט&ווג מנגו תפוח 1ל"), { kind: "volume", amount: 1000, packs: 1 });
  assert.deepEqual(z("שמן קנולה 1,5 ליטר"), { kind: "volume", amount: 1500, packs: 1 });
  assert.deepEqual(z('קוקה קולה בפלסטיק500 מ"ל'), { kind: "volume", amount: 500, packs: 1 });
  assert.deepEqual(z("משחת פרודונטקס הגנה 75מל"), { kind: "volume", amount: 75, packs: 1 });
  assert.deepEqual(z("כיף שמפו לשיער רגיל 700מ"), { kind: "volume", amount: 700, packs: 1 });
});

test("parseSize: multipacks", () => {
  assert.deepEqual(z("קולה 6x330", "drinks"), { kind: "volume", amount: 1980, packs: 6 });
  assert.deepEqual(z("קולה 6 x 330 מל"), { kind: "volume", amount: 1980, packs: 6 });
  assert.deepEqual(z("POLPA עגבניות חתוכות דק 400X3 גרם MUTTI"), { kind: "weight", amount: 1200, packs: 3 });
  assert.deepEqual(z("בירה 330 מל x 6"), { kind: "volume", amount: 1980, packs: 6 });
  assert.equal(z("קולה 6x330", "snacks"), null, "no unit and not a drink: unsure");
});

test("parseSize: counts", () => {
  assert.deepEqual(z("האגיס פרידום דריי שלב 5 32 יחידות"), { kind: "count", amount: 32, packs: 1 });
  assert.deepEqual(z("מאגדת רפאלס פקאן 5יח"), { kind: "count", amount: 5, packs: 1 });
  assert.equal(z("עוגה 1 יח"), null, "a count of one says nothing");
});

test("parseSize: no size when unsure", () => {
  assert.equal(z("אורז בסמטי מלא סוגת"), null);
  assert.equal(z("חלב 3%"), null);
  assert.equal(z("אלפרו מעדן סויה בטעם וניל 125 גר 4 יח"), null, "125 g each or in total");
  assert.equal(z("קוקה קולה זירו 6 1.5 ל"), null, "a 6-pack of 1.5 L, or a 1.5 L bottle?");
  assert.equal(z("שמפו 250 מל מרכך 400 מל"), null, "two sizes");
  assert.equal(z("מולר פרוטאין משקה חלבון קפה 25 גרם חלבון"), null, "25 g is the protein");
  assert.equal(z("מלפפונים 10 מלפפונים"), null, "מלפפונים is not millilitres");
  assert.equal(z("חטיף 4 גרעינים"), null, "גרעינים is not grams");
  assert.equal(z("פריסקיז מעדני חתול 1.43 גרם"), null, "implausibly small");
  assert.equal(z("ניילון נצמד 30 מ"), null, "30 m of film, not 30 ml");
  assert.equal(z("שוקולד 48%"), null);
});

test("parseSize: formula stage and fat percent do not get mistaken for pack counts or sizes", () => {
  assert.deepEqual(z("סימילאק גולד שלב 2 700 ג"), { kind: "weight", amount: 700, packs: 1 });
  assert.deepEqual(z("רויון בקרטון 1.5% 500 מל"), { kind: "volume", amount: 500, packs: 1 });
  assert.deepEqual(z("מלפפונים במלח 7-9 560גרם"), { kind: "weight", amount: 560, packs: 1 });
});

test("unitPrice: per 100 g, per litre, per piece", () => {
  assert.deepEqual(unitPrice(z("גבינה 250 גרם"), 1000), { kind: "weight", agorot: 400 });
  assert.deepEqual(unitPrice(z("חלב 1.5 ליטר"), 900), { kind: "volume", agorot: 600 });
  assert.deepEqual(unitPrice(z("טבליות 32 יחידות"), 6400), { kind: "count", agorot: 200 });
  assert.equal(unitPrice(null, 500), null);
  assert.equal(unitPrice(z("חלב 1 ליטר"), 0), null);
  assert.equal(unitText({ kind: "weight", agorot: 240 }), "2.40 ₪ ל־100 גרם");
  assert.equal(unitText({ kind: "volume", agorot: 600 }), "6.00 ₪ לליטר");
  assert.equal(unitText({ kind: "count", agorot: 200 }), "2.00 ₪ ליחידה");
});

test("sizeText and similarSize", () => {
  assert.equal(sizeText({ kind: "weight", amount: 1500, packs: 1 }), "1.5 ק״ג");
  assert.equal(sizeText({ kind: "volume", amount: 330, packs: 1 }), "330 מ״ל");
  const a = { kind: "weight", amount: 500, packs: 1 } as const;
  assert.ok(similarSize(a, { kind: "weight", amount: 575, packs: 1 }), "+15% is in");
  assert.ok(similarSize(a, { kind: "weight", amount: 425, packs: 1 }), "-15% is in");
  assert.ok(!similarSize(a, { kind: "weight", amount: 580, packs: 1 }));
  assert.ok(!similarSize(a, { kind: "volume", amount: 500, packs: 1 }), "different kinds never match");
});

test("compareUnit: grouped by kind, cheapest first, unknown last", () => {
  const w = (agorot: number) => ({ kind: "weight", agorot }) as const;
  const v = (agorot: number) => ({ kind: "volume", agorot }) as const;
  const sorted = [null, v(100), w(500), w(200), null].sort(compareUnit);
  assert.deepEqual(sorted, [w(200), w(500), v(100), null, null]);
});

test("sortByUnitPrice is stable and keeps unknowns in their order at the end; sizeOf skips weighted items", () => {
  const rows = [
    { n: "a", u: null }, { n: "b", u: unitPrice(z("גבינה 250 גרם"), 1000) }, { n: "c", u: null }, { n: "d", u: unitPrice(z("גבינה 500 גרם"), 1500) },
  ];
  assert.deepEqual(sortByUnitPrice(rows, r => r.u).map(r => r.n), ["d", "b", "a", "c"]);
  assert.deepEqual(sizeOf({ code: "1", name: "חלב 1 ליטר", cat: "dairy" }), { kind: "volume", amount: 1000, packs: 1 });
  assert.equal(sizeOf({ code: "f-1", name: "עגבניות 1 ק״ג", cat: "produce", weighted: true }), null);
});

test("withoutSize strips sizes, multipacks and counts but keeps fat percent", () => {
  assert.equal(withoutSize("חלב 3% 1 ליטר"), "חלב 3%");
  assert.equal(withoutSize("קולה 6x330 מל"), "קולה");
  assert.equal(withoutSize("שוקולד מריר100ג פרה"), "שוקולד מריר פרה");
  assert.equal(withoutSize("מאגדת רפאלס 5יח"), "מאגדת רפאלס");
  assert.equal(withoutSize("10 מלפפונים"), "10 מלפפונים");
});
