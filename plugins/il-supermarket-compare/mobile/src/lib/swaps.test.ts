import { test } from "node:test";
import assert from "node:assert/strict";
import { makeDeals, toProducts } from "./compare.ts";
import { applySwap, findSwaps, totalSaving, typeKeys } from "./swaps.ts";
import type { Catalog, Promo, RawProduct } from "./types.ts";

// Stores: 0 and 1 are ~1 km apart, 2 is ~10 km away. Prices in agorot, one per store.
const stores = [[32.08, 34.81, "A"], [32.089, 34.81, "B"], [32.17, 34.81, "C"]].map(([lat, lon, chain], i) => ({ id: `${chain}:${i}`, chain: chain as string, branch: "", address: "", lat: lat as number, lon: lon as number, approx: false }));
const mk = (rows: [string, string, string, (number | null)[]][], promos?: Promo[][]): Catalog => ({
  priceDate: "2026-11-12", generatedAt: "", skipped: [], categories: [], areas: [], stores,
  products: rows.map(([code, name, cat, prices]) => [code, name, cat, 0, prices, null, null] as RawProduct), promos,
});
const NOW = new Date(2026, 10, 12, 12).getTime();
const run = (c: Catalog, cart: Record<string, number>, club = {}, opts = {}) => {
  const ps = toProducts(c);
  return findSwaps(c, ps, cart, [0, 1, 2], c.promos ? makeDeals(c, club, NOW) : undefined, opts);
};

test("typeKeys: sizes, brands of staples and filler are ignored; kind words are kept", () => {
  const a = typeKeys("חלב תנובה 3% 1 ליטר")!, b = typeKeys("חלב טרה 3% 1 ל")!;
  assert.equal(a.loose, b.loose, "brands ignored for milk");
  assert.notEqual(a.strict, b.strict);
  assert.notEqual(typeKeys("חלב 3% 1 ליטר")!.loose, typeKeys("חלב 1% 1 ליטר")!.loose, "fat % is a kind word");
  assert.notEqual(typeKeys("יוגורט תות 200 גרם")!.strict, typeKeys("יוגורט וניל 200 גרם")!.strict, "flavour is a kind word");
  assert.equal(typeKeys("שוקולד מילקה 100 גרם")!.loose, null, "chocolate is not a staple: brands are never ignored");
  assert.equal(typeKeys("סימילאק גולד שלב 2 700 גרם"), null, "baby formula is never swapped");
  assert.equal(typeKeys("קוטג' 5% שומן 250 גר")!.strict, typeKeys("קוטג 5% 250ג")!.strict, "quotes, the word שומן and size spellings do not matter");
  assert.equal(typeKeys("1 ליטר"), null, "nothing but a size");
});

test("a staple under another brand, same size, same store: suggested with the reason", () => {
  const c = mk([["1", "חלב תנובה 3% 1 ליטר", "dairy", [700, null, null]], ["2", "חלב טרה 3% 1 ל", "dairy", [580, null, null]]]);
  const [s] = run(c, { "1": 1 });
  assert.equal(s.p.code, "1");
  assert.equal(s.options.length, 1);
  const o = s.options[0];
  assert.equal(o.p.code, "2");
  assert.equal(o.save, 120);
  assert.ok(o.sameStore);
  assert.ok(o.brandChange);
  assert.equal(o.reason, "אותו גודל, 1.20 ₪ פחות");
  assert.equal(totalSaving([s]), 120);
});

test("the same product under another barcode and spelling counts without any brand rule", () => {
  const c = mk([["1", "צמד פטריות מעורב 600 גרם", "other", [2190, null, null]], ["2", "צמד פטריות מעורב 600 ג", "other", [1890, null, null]]]);
  assert.equal(run(c, { "1": 1 })[0].options[0].save, 300);
  // an unknown brand is a word: different unknown brands never match
  const d = mk([["1", "ממרח זיתים אלפא 200 גרם", "pantry", [1000, null, null]], ["2", "ממרח זיתים בטא 200 גרם", "pantry", [500, null, null]]]);
  assert.deepEqual(run(d, { "1": 1 }), []);
});

test("size: within 15% compares by what the same amount costs; beyond that, no suggestion", () => {
  const c = mk([
    ["1", "קמח לבן 1 ק״ג", "pantry", [800, null, null]],
    ["2", "קמח סוגת לבן 1.1 ק״ג", "pantry", [880, null, null]], // 10% bigger, 8.00 per kg: same unit price, no saving
    ["3", "קמח אחלה לבן 900 גרם", "pantry", [600, null, null]], // 10% smaller, 6.67 per kg
    ["4", "קמח שטראוס לבן 500 גרם", "pantry", [200, null, null]], // half the size: out
    ["5", "קמח לבן 1.2 ק״ג", "pantry", [500, null, null]], // 20% bigger: out
  ]);
  const [s] = run(c, { "1": 1 });
  assert.deepEqual(s.options.map(o => o.p.code), ["3"]);
  const o = s.options[0];
  assert.equal(o.save, Math.round(800 - 600 * (1000 / 900)));
  assert.match(o.reason, /^גודל דומה \(900 גרם מול 1 ק״ג\), 1\.33 ₪ פחות$/);
  assert.ok(Math.abs(o.unit.agorot - 66.67) < 0.01);
  assert.ok(Math.abs(o.sizeRatio - 0.9) < 1e-9);
});

test("kind: fat %, flavour and category must match", () => {
  const c = mk([
    ["1", "קוטג׳ תנובה 5% 250 גרם", "dairy", [700, null, null]],
    ["2", "קוטג׳ טרה 3% 250 גרם", "dairy", [400, null, null]], // different fat
    ["3", "קוטג׳ טרה 5% עם בצל 250 גרם", "dairy", [400, null, null]], // extra variant word
    ["4", "קוטג׳ טרה 5% 250 גרם", "pantry", [400, null, null]], // different category
    ["5", "קוטג׳ גד 5% 250 גרם", "dairy", [550, null, null]], // the one
  ]);
  assert.deepEqual(run(c, { "1": 1 })[0].options.map(o => o.p.code), ["5"]);
});

test("brand-identity products are never swapped across brands", () => {
  const c = mk([
    ["1", "שוקולד מילקה חלב 100 גרם", "snacks", [900, null, null]],
    ["2", "שוקולד פרה חלב 100 גרם", "snacks", [600, null, null]],
    ["3", "בירה גולדסטאר 500 מל", "drinks", [800, null, null]],
    ["4", "בירה מכבי 500 מל", "drinks", [500, null, null]],
  ]);
  assert.deepEqual(run(c, { "1": 1, "3": 1 }), []);
});

test("no suggestion without a known size, for weighted items, for baby formula, or when the alternative is already in the cart", () => {
  const c: Catalog = { ...mk([["1", "חלב תנובה 3%", "dairy", [700, null, null]], ["2", "חלב טרה 3% 1 ליטר", "dairy", [500, null, null]], ["3", "חלב תנובה 3% 1 ליטר", "dairy", [700, null, null]]]),
    products: [["1", "חלב תנובה 3%", "dairy", 0, [700, null, null], null, null], ["2", "חלב טרה 3% 1 ליטר", "dairy", 0, [500, null, null], null, null], ["3", "חלב תנובה 3% 1 ליטר", "dairy", 0, [700, null, null], null, null], ["f-x", "עגבניות 1 ק״ג", "produce", 1, [500, null, null], null, null]] };
  assert.deepEqual(run(c, { "1": 1 }), [], "milk without a size");
  assert.equal(run(c, { "3": 1 })[0].options[0].p.code, "2");
  assert.deepEqual(run(c, { "3": 1, "2": 1 }), [], "the cheaper one is already in the cart");
  assert.deepEqual(run(c, { "f-x": 1 }), []);
  const formula = mk([["1", "סימילאק גולד שלב 2 700 גרם", "care", [8000, null, null]], ["2", "מטרנה שלב 2 700 גרם", "care", [6000, null, null]]]);
  assert.deepEqual(run(formula, { "1": 1 }), []);
});

test("pack count must match: a 6-pack is not a single bottle", () => {
  const c = mk([
    ["1", "מים מינרלים 1.5 ליטר", "drinks", [300, null, null]],
    ["2", "מים מינרלים 6x1.5 ליטר", "drinks", [500, null, null]],
    ["3", "מים מינרלים סוגת 1.5 ליטר", "drinks", [200, null, null]],
  ]);
  const [s] = run(c, { "1": 1 });
  assert.deepEqual(s.options.map(o => o.p.code), ["3"], "the 6x pack is out (and costs more anyway)");
  const six = mk([
    ["1", "מים מינרלים 6x1.5 ליטר", "drinks", [2000, null, null]],
    ["2", "מים מינרלים 1.5 ליטר", "drinks", [100, null, null]],
  ]);
  assert.deepEqual(run(six, { "1": 1 }), []);
});

test("nearby stores: an alternative at a store within 3 km of the item's cheapest store counts, a far one does not", () => {
  const c = mk([["1", "סוכר סוגת 1 ק״ג", "pantry", [500, null, null]], ["2", "סוכר 1 ק״ג", "pantry", [null, 350, 200]]]);
  const [s] = run(c, { "1": 1 });
  assert.equal(s.options.length, 1);
  const o = s.options[0];
  assert.equal(o.store, 1);
  assert.ok(!o.sameStore);
  assert.ok(o.away! > 0.9 && o.away! < 1.1);
  assert.match(o.reason, /^אותו גודל, 1\.50 ₪ פחות, בB \(1\.0 ק״מ מהסניף הזול\)$/);
  // only the far store sells it: nothing
  const far = mk([["1", "סוכר סוגת 1 ק״ג", "pantry", [500, null, null]], ["2", "סוכר 1 ק״ג", "pantry", [null, null, 300]]]);
  assert.deepEqual(run(far, { "1": 1 }), []);
  assert.equal(run(far, { "1": 1 }, {}, { nearKm: 15 })[0].options[0].store, 2);
});

test("the same store wins when it is within 2% of the nearby one", () => {
  const c = mk([["1", "סוכר סוגת 1 ק״ג", "pantry", [500, null, null]], ["2", "סוכר 1 ק״ג", "pantry", [300, 296, null]]]);
  assert.ok(run(c, { "1": 1 })[0].options[0].sameStore);
  const c2 = mk([["1", "סוכר סוגת 1 ק״ג", "pantry", [500, null, null]], ["2", "סוכר 1 ק״ג", "pantry", [300, 250, null]]]);
  assert.equal(run(c2, { "1": 1 })[0].options[0].store, 1);
});

test("promotions count: the alternative's deal price is the price, club deals only with a card", () => {
  const rows: [string, string, string, (number | null)[]][] = [["1", "אורז לבן סוגת 1 ק״ג", "pantry", [800, null, null]], ["2", "אורז לבן 1 ק״ג", "pantry", [790, null, null]]];
  const deal = (club: boolean): Promo[][] => [[{ id: "p", codes: ["2"], minQty: 1, kind: "price", value: 500, club, desc: "" }], [], []];
  assert.equal(run(mk(rows, deal(false)), { "1": 1 })[0].options[0].save, 300);
  assert.deepEqual(run(mk(rows, deal(true)), { "1": 1 }), [], "club price without a card: not counted (and 7.90 is within the noise floor)");
  assert.equal(run(mk(rows, deal(true)), { "1": 1 }, { A: true })[0].options[0].save, 300);
  // the cart item's own deal is what it costs now
  const own: Promo[][] = [[{ id: "o", codes: ["1"], minQty: 1, kind: "price", value: 450, club: false, desc: "" }], [], []];
  assert.deepEqual(run(mk(rows, own), { "1": 1 }), []);
});

test("quantities: the saving is for the whole line", () => {
  const c = mk([["1", "סוכר סוגת 1 ק״ג", "pantry", [500, null, null]], ["2", "סוכר 1 ק״ג", "pantry", [380, null, null]]]);
  const o = run(c, { "1": 3 })[0].options[0];
  assert.equal(o.save, 360);
  assert.match(o.reason, /3 יחידות/);
});

test("thresholds: tiny savings and too-good-to-be-true savings are not suggested; at most 3, best first", () => {
  const c = mk([["1", "סוכר סוגת 1 ק״ג", "pantry", [500, null, null]], ["2", "סוכר 1 ק״ג", "pantry", [490, null, null]], ["3", "סוכר שטראוס 1 ק״ג", "pantry", [240, null, null]]]);
  assert.deepEqual(run(c, { "1": 1 }), []);
  const many = mk([["1", "סוכר סוגת 1 ק״ג", "pantry", [900, null, null]], ...[800, 700, 600, 500].map((v, k) => [`${k + 2}`, `סוכר ${["אסם", "אחלה", "גד", "טרה"][k]} 1 ק״ג`, "pantry", [v, null, null]] as [string, string, string, (number | null)[]])]);
  const s = run(many, { "1": 1 })[0];
  assert.deepEqual(s.options.map(o => o.save), [400, 300, 200]);
  assert.equal(run(many, { "1": 1 }, {}, { max: 1 })[0].options.length, 1);
});

test("applySwap moves the quantity to the alternative and totalSaving adds the best option per item", () => {
  assert.deepEqual(applySwap({ a: 2, b: 1 }, "a", "c"), { b: 1, c: 2 });
  assert.deepEqual(applySwap({ a: 2, c: 1 }, "a", "c"), { c: 3 });
  const c = mk([["1", "סוכר סוגת 1 ק״ג", "pantry", [500, null, null]], ["2", "סוכר 1 ק״ג", "pantry", [380, null, null]], ["3", "אורז אסם 1 ק״ג", "pantry", [900, null, null]], ["4", "אורז 1 ק״ג", "pantry", [800, null, null]]]);
  assert.equal(totalSaving(run(c, { "1": 1, "3": 1 })), 120 + 100);
});

test("equivalents: the same staple across brands, cheapest per unit first, the product itself included", async () => {
  const { equivalents } = await import("./swaps.ts");
  const { toProducts } = await import("./compare.ts");
  const c = {
    priceDate: "", generatedAt: "", skipped: [], categories: [], areas: [],
    stores: [0, 1].map(i => ({ id: `s${i}:1`, chain: `c${i}`, branch: "", address: "", lat: 32, lon: 34.8, approx: false })),
    products: [
      ["1", "חלב תנובה 3% 1 ליטר", "dairy", 0, [700, 720], null, null],
      ["2", "חלב טרה 3% 1 ליטר", "dairy", 0, [650, 690], null, null],
      ["3", "חלב יטבתה 3% 1 ליטר", "dairy", 0, [null, 760], null, null],
      ["4", "חלב תנובה 1% 1 ליטר", "dairy", 0, [600, 600], null, null],   // 1% is not 3%
      ["5", "חלב תנובה 3% 2 ליטר", "dairy", 0, [1200, 1250], null, null], // twice the size
      ["6", "במבה 80 גרם", "snacks", 0, [450, 400], null, null],
    ],
  };
  const ps = toProducts(c as never);
  const eq = equivalents(ps.get("1")!, ps, [0, 1]);
  assert.deepEqual(eq.map(e => [e.p.code, e.store, e.price, e.brandChange]), [["2", 0, 650, true], ["1", 0, 700, false], ["3", 1, 760, true]]);
  assert.deepEqual(equivalents(ps.get("6")!, ps, [0, 1]), []); // nothing to compare with
});
