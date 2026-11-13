import { test } from "node:test";
import assert from "node:assert/strict";
import { brandIndex, coverage, dietCounts, ownBrandSavings, priced, typeGroups } from "./analysis.ts";
import { search, toProducts } from "./compare.ts";
import { curateCatalog, emptyCuration } from "./curate.ts";
import { delta, enrichPrompt, nameHash, readEnrich, readRecord, searchTerms, type Enriched } from "./enrich.ts";
import type { Catalog } from "./types.ts";

const cats = [{ id: "dairy", name: "חלב" }, { id: "snacks", name: "חטיפים" }, { id: "other", name: "שונות" }];
const cat: Catalog = {
  priceDate: "", generatedAt: "", skipped: [], areas: [], categories: cats,
  stores: [0, 1, 2].map(i => ({ id: `C${i}:1`, chain: `רשת ${i}`, branch: "", address: "", lat: 32, lon: 34.8, approx: false })),
  products: [
    ["1", "חלב 3% תנובה 1ל", "dairy", 0, [600, 620, 640], null, null],
    ["2", "במבה 80 גרם", "snacks", 0, [500, null, null], null, null],
    ["3", "משהו", "other", 0, [100, 100, null], null, null],
    ["f-tomato", "עגבניות", "other", 1, [500, 500, 500], ["a", "b", "c"], null],
  ],
};
const rec = (o: Partial<Enriched>): Enriched => ({ t: "חלב", c: "dairy", b: "", l: "", v: "", s: null, d: [], pl: false, q: false, ...o });

test("delta: products without a record or renamed since, most-sold first, fresh-rule items skipped", () => {
  assert.deepEqual(delta(cat, new Map()).map(r => r[0]), ["1", "3", "2"]);
  assert.deepEqual(delta(cat, new Map([["1", nameHash("חלב 3% תנובה 1ל")]])).map(r => r[0]), ["3", "2"]);
  assert.deepEqual(delta(cat, new Map([["1", nameHash("שם ישן")]])).map(r => r[0]), ["1", "3", "2"]); // renamed: asked again
  assert.equal(nameHash("חלב  3%"), nameHash("חלב 3%")); // spacing doesn't count
});

test("readRecord: arrays or objects, validated", () => {
  const valid = new Set(cats.map(c => c.id));
  assert.deepEqual(readRecord(["חלב", "dairy", "תנובה", "", "3%", [1000, "ml", 1], ["dairy", "bogus", "dairy"], 0, 0], "other", valid),
    { t: "חלב", c: "dairy", b: "תנובה", l: "", v: "3%", s: [1000, "ml", 1], d: ["dairy"], pl: false, q: false });
  assert.equal(readRecord(["חלב", "nope", "", "", "", null, [], 1, 1], "snacks", valid)!.c, "snacks"); // unknown category -> the product's own
  assert.equal(readRecord(["חלב", "dairy", "", "", "", [0, "ml", 1], [], 0, 0], "x", valid)!.s, null); // bad size dropped
  assert.equal(readRecord(["חלב", "dairy", "", "", "", [330, "cl", 6], [], 0, 0], "x", valid)!.s, null);
  assert.deepEqual(readRecord(["משקה", "dairy", "", "", "", [330, "ml", 6], [], true, false], "x", valid)!.s, [330, "ml", 6]);
  assert.equal(readRecord({ t: "גבינה", c: "dairy", b: "טרה", d: ["dairy"], pl: 1 }, "x", valid)!.pl, true);
  assert.equal(readRecord(["", "dairy"], "x", valid), null); // no type
  assert.equal(readRecord("text", "x", valid), null);
  const rows = readEnrich(cat.products.slice(0, 3), { "1": ["חלב", "dairy", "תנובה", "", "3%", [1000, "ml", 1], [], 0, 0], "3": ["?", "other", "", "", "", null, [], 0, 1] }, cats, "m", 5);
  assert.deepEqual(rows.map(r => r.code), ["1", "3"]); // 2 skipped: asked next run
  assert.equal(rows[0].h, nameHash("חלב 3% תנובה 1ל")); assert.equal(rows[0].model, "m");
  assert.match(enrichPrompt(cat.products.slice(0, 2), cats)[1].content, /^1\. חלב 3% תנובה 1ל\n2\. במבה/);
});

test("records feed the catalog: category, search by brand and diet tag", () => {
  const recs = new Map([["2", rec({ t: "חטיף בוטנים", c: "snacks", b: "אסם", l: "במבה", d: ["gluten_free"] })], ["3", rec({ t: "נוזל כלים", c: "dairy" })]]);
  const c = curateCatalog(cat, emptyCuration(), recs);
  const ps = toProducts(c);
  assert.equal(ps.get("3")!.cat, "dairy");
  assert.equal(ps.get("2")!.meta!.ai!.b, "אסם");
  assert.match(searchTerms(recs.get("2")!), /אסם במבה ללא גלוטן/);
  assert.deepEqual(search(ps.values(), [0, 1, 2], "אסם", "all", "pop").map(([p]) => p.code), ["2"]);
  assert.deepEqual(search(ps.values(), [0, 1, 2], "ללא גלוטן", "all", "pop").map(([p]) => p.code), ["2"]);
  // the user's category task wins over the record
  const c2 = curateCatalog(cat, { ...emptyCuration(), cats: { "3": "snacks" } }, recs);
  assert.equal(toProducts(c2).get("3")!.cat, "snacks");
  assert.equal(curateCatalog(cat, emptyCuration(), new Map()), cat);
});

test("analysis: type groups by unit price, brand index, own-brand savings, diet, coverage", () => {
  const rows: Catalog["products"] = [];
  const add = (code: string, price: number, r: Partial<Enriched>) => rows.push([code, `x${code} 1 ליטר`, "dairy", 0, [price, null, null], null, null]) && r;
  const recs = new Map<string, Enriched>();
  const put = (code: string, price: number, r: Partial<Enriched>) => { add(code, price, r); recs.set(code, rec({ s: [1000, "ml", 1], ...r })); };
  put("a1", 600, { b: "תנובה" }); put("a2", 700, { b: "תנובה", t: "משקה סויה" }); put("a3", 500, { b: "טרה" }); put("a4", 400, { b: "שופרסל", pl: true });
  put("a5", 650, { b: "תנובה" }); put("a6", 480, { b: "שופרסל", pl: true, t: "משקה סויה" }); put("a7", 900, { b: "אלפרו", t: "משקה סויה" }); put("a8", 450, { b: "שופרסל", pl: true, d: ["organic"] });
  put("a9", 800, { b: "תנובה", t: "משקה סויה" }); put("b1", 520, { b: "שופרסל", pl: true, t: "משקה סויה" }); put("b2", 999, { q: true });
  const c: Catalog = { ...cat, products: rows };
  const ps = toProducts(curateCatalog(c, emptyCuration(), recs));
  const xs = priced(ps.values(), [0]);
  assert.equal(xs.length, 10); // the unsure one is left out
  const g = typeGroups(xs);
  assert.deepEqual(g.map(x => [x.type, x.n]), [["חלב", 5], ["משקה סויה", 5]]);
  assert.equal(g[0].cheapest.p.code, "a4"); assert.equal(g[0].median, 500); // agorot per litre: median of 600, 500, 400, 650, 450
  const bi = brandIndex(xs, g, 3);
  assert.equal(bi[0].brand, "שופרסל"); assert.equal(bi[0].own, true);
  assert.equal(bi[bi.length - 1].brand, "תנובה");
  const own = ownBrandSavings(xs, 2);
  assert.equal(own[0].brand, "שופרסל"); assert.ok(own[0].savePct > 20);
  assert.deepEqual(dietCounts(ps.values()), [{ tag: "organic", n: 1 }]);
  assert.deepEqual(coverage(ps.values()), { total: 11, done: 11, unsure: 1, brands: 4, types: 2 });
});
