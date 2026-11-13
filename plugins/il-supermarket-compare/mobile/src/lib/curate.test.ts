import { test } from "node:test";
import assert from "node:assert/strict";
import { runBatches } from "./airun.ts";
import { toProducts } from "./compare.ts";
import {
  activeLinks, aliases, catCandidates, catPrompt, changes, counts, curateCatalog, emptyCuration, goodName, linkCandidates, messyName, nameCandidates, pairKey,
  readCats, readLinks, readNames, type Curation,
} from "./curate.ts";
import { DEFAULT_CONFIG, LlmError } from "./llm.ts";
import type { Catalog } from "./types.ts";
import { sizeOf } from "./units.ts";

// stores 0,1 = chain A, 2 = chain B
const cat: Catalog = {
  priceDate: "2026-11-13", generatedAt: "", skipped: [], areas: [{ name: "x", lat: 32, lon: 34.8 }],
  categories: [{ id: "dairy", name: "חלב" }, { id: "snacks", name: "חטיפים" }, { id: "other", name: "שונות" }],
  stores: [["A:1", "א"], ["A:2", "א"], ["B:1", "ב"]].map(([id, chain], i) => ({ id, chain, branch: `b${i}`, address: "", lat: 32, lon: 34.8 + i / 100, approx: false })),
  products: [
    ["111", "חלב טרי 3% תנובה 1ל'", "dairy", 0, [700, 700, 650], null, null, { maker: "תנובה" }],
    ["222", "בייגלה שטוח שומשום 300 גרם", "snacks", 0, [900, 950, null], null, null, { stale: [[0, 20]] }],
    ["333", "בייגלה שטוחים עם שומשום 300 גרם", "snacks", 0, [null, null, 880], null, "img333", { chg: [[2, 3]] }],
    ["444", "בדין מרכך 960 מ\"ל", "other", 0, [1500, null, 1400], null, null],
    ["555", "בייגלה שטוח שומשום 300 גרם אחר", "snacks", 0, [800, null, 820], null, null], // sold together with 222 at store 0
  ],
  promos: [[{ id: "p", codes: ["333", "222"], minQty: 2, kind: "bundle", value: 1500, club: false, desc: "בייגלה 2ב15" }], [], [{ id: "q", codes: ["333"], minQty: 1, kind: "price", value: 800, club: false, desc: "בייגלה" }]],
};
const withCur = (o: Partial<Curation>): Curation => ({ ...emptyCuration(), ...o });

test("nothing to apply: the same catalog", () => {
  assert.equal(curateCatalog(cat, emptyCuration()), cat);
  assert.equal(curateCatalog(cat, withCur({ links: { "333": "222" } })), cat); // waiting for approval
});

test("an approved link merges prices, freshness and image, and repoints promotions", () => {
  const cur = withCur({ links: { "333": "222" }, approved: { "links:333": 1 } });
  const c = curateCatalog(cat, cur);
  assert.equal(c.products.length, 4);
  const m = c.products.find(r => r[0] === "222")!;
  assert.deepEqual(m[4], [900, 950, 880]);
  assert.equal(m[6], "img333");
  assert.deepEqual(m[7]!.stale, [[0, 20]]); assert.deepEqual(m[7]!.chg, [[2, 3]]); assert.deepEqual(m[7]!.linked, ["333"]);
  assert.deepEqual(c.promos![0][0].codes, ["222"]); // both codes collapse to one
  assert.deepEqual(c.promos![2][0].codes, ["222"]);
  assert.deepEqual([...aliases(cat, cur)], [["333", "222"]]);
  // compared in all three branches now
  assert.equal(toProducts(c).get("222")!.prices.filter(v => v != null).length, 3);
  // autoLinks applies without approval; undo or turning the task off removes it
  assert.equal(curateCatalog(cat, withCur({ links: { "333": "222" }, autoLinks: true })).products.length, 4);
  assert.equal(curateCatalog(cat, { ...cur, rejected: { "links:333": 1 } }), cat);
  assert.equal(curateCatalog(cat, { ...cur, on: { ...cur.on, links: false } }), cat);
});

test("a link between products sold in the same branch, or a chain of links, is refused", () => {
  assert.equal(activeLinks(cat, withCur({ links: { "555": "222" }, autoLinks: true })).size, 0);
  // 333 -> 222 -> 111: 222 is merged away and also a target, so 333's link waits; 222 -> 111 shares branches
  assert.equal(activeLinks(cat, withCur({ links: { "333": "222", "222": "111" }, autoLinks: true })).size, 0);
});

test("names and categories: replaced, the original kept for search and pack size", () => {
  const cur = withCur({ names: { "111": "חלב טרי 3% תנובה 1 ליטר" }, cats: { "444": "cleaning", "222": "dairy" } });
  const c = curateCatalog({ ...cat, categories: [...cat.categories, { id: "cleaning", name: "ניקיון" }] }, cur);
  const p = toProducts(c);
  assert.equal(p.get("111")!.name, "חלב טרי 3% תנובה 1 ליטר");
  assert.equal(p.get("111")!.meta!.raw, "חלב טרי 3% תנובה 1ל'");
  assert.match(p.get("111")!.key, /1ל/); // the old name still finds it
  assert.equal(p.get("444")!.cat, "cleaning");
  assert.equal(p.get("222")!.cat, "dairy");
  // an unknown category id is ignored
  assert.equal(toProducts(curateCatalog(cat, withCur({ cats: { "444": "nope" } }))).get("444")!.cat, "other");
  // undo
  assert.equal(toProducts(curateCatalog(cat, { ...cur, rejected: { "names:111": 1 } })).get("111")!.name, "חלב טרי 3% תנובה 1ל'");
  // pack size from the original name
  assert.deepEqual(sizeOf({ code: "x", name: "שם בלי גודל", cat: "dairy", meta: { raw: "חלב 1ל'" } }), sizeOf({ code: "x", name: "חלב 1ל'", cat: "dairy" }));
});

test("candidates: other-category products, messy names, look-alike pairs never sold together", () => {
  assert.deepEqual(catCandidates(cat, emptyCuration()).map(x => x.code), ["444"]);
  assert.deepEqual(catCandidates(cat, withCur({ asked: { "cats:444": 1 } })), []);
  assert.ok(messyName("חלב 1ל'")); assert.ok(messyName("ש.חלב 100 גרם")); assert.ok(messyName("‫מים")); assert.ok(!messyName("חלב טרי 3% 1 ליטר"));
  assert.deepEqual(nameCandidates(cat, emptyCuration()).map(x => x.code), ["111"]);
  const l = linkCandidates(cat, emptyCuration());
  assert.deepEqual(l.map(x => [x.a, x.b]), [["333", "222"]]); // 555 shares a branch with 222; the one in more chains stays
  assert.deepEqual(linkCandidates(cat, withCur({ asked: { [`links:${pairKey("222", "333")}`]: 1 } })), []);
  assert.match(catPrompt(catCandidates(cat, emptyCuration()), cat.categories)[1].content, /^1\. בדין/);
});

test("answers: valid categories, names that keep every number, links only on 'same'", () => {
  const cats = readCats([{ code: "a", name: "x" }, { code: "b", name: "y" }, { code: "c", name: "z" }], { "1": "dairy", "2": "bogus", "3": "other" }, cat.categories);
  assert.deepEqual(cats.set, { a: "dairy" }); assert.deepEqual(cats.asked, ["cats:a", "cats:b", "cats:c"]);
  assert.deepEqual(readCats([{ code: "a", name: "x" }], null, cat.categories).asked, []); // no answer: asked again later
  assert.ok(goodName("יוגורט 3% 200ג'", "יוגורט 3% 200 גרם"));
  assert.ok(!goodName("יוגורט 3% 200ג'", "יוגורט 200 גרם")); // lost the 3
  assert.ok(!goodName("יוגורט 200ג'", "יוגורט 250 גרם"));
  assert.ok(!goodName("יוגורט 200 גרם", "יוגורט 200 גרם")); // unchanged
  assert.ok(!goodName("יוגורט תות 200 גרם של דנונה", "יוגורט 200"));
  const names = readNames([{ code: "a", name: "חלב 1ל'" }, { code: "b", name: "במבה 80ג" }], { "1": "חלב 1 ליטר [תנובה]", "2": "במבה 60 גרם" });
  assert.deepEqual(names.set, { a: "חלב 1 ליטר" }); // a bracketed maker echo is dropped; a changed number is refused
  const links = readLinks([{ a: "1", b: "2", an: "", bn: "", score: 1 }, { a: "3", b: "4", an: "", bn: "", score: 1 }, { a: "5", b: "6", an: "", bn: "", score: 1 }], { "1": "same", "2": "different", "3": "unsure" });
  assert.deepEqual(links.set, { "1": "2" });
  assert.deepEqual(links.asked, ["links:1|2", "links:3|4", "links:5|6"]); // unsure is not asked again either
});

test("review list and counts", () => {
  const cur = withCur({ names: { "111": "חלב 1 ליטר" }, cats: { "444": "dairy" }, links: { "333": "222" }, rejected: { "cats:444": 1 } });
  const ch = changes(cat, cur, "links");
  assert.equal(ch.length, 1); assert.equal(ch[0].awaiting, true); assert.equal(ch[0].to, "בייגלה שטוח שומשום 300 גרם");
  assert.equal(ch[0].fromWhere, "ב"); assert.equal(ch[0].toWhere, "א");
  assert.equal(changes(cat, cur, "cats")[0].undone, true);
  assert.deepEqual(counts(cat, cur), { cats: { done: 0, undone: 1, awaiting: 0 }, names: { done: 1, undone: 0, awaiting: 0 }, links: { done: 0, undone: 0, awaiting: 1 } });
});

test("runBatches: paces, retries a quota error, stops on a bad key", async () => {
  const cfg = { ...DEFAULT_CONFIG, on: true, key: "k" };
  const waits: number[] = [];
  const sleepFn = async (ms: number) => { waits.push(ms); };
  let calls = 0;
  const chatFn = (async () => { calls++; if (calls === 2) throw new LlmError("slow down", 429, 5000, "quota"); return { text: `{"n":${calls}}` }; }) as never;
  const got: unknown[] = [];
  const err = await runBatches(cfg, 3, () => [], (_i, j) => got.push(j), { signal: new AbortController().signal, chatFn, sleepFn });
  assert.equal(err, undefined);
  assert.deepEqual(got, [{ n: 1 }, { n: 3 }, { n: 4 }]);
  assert.deepEqual(waits, [6000, 5000, 6000]); // Gemini preset: 10 a minute; the 429's retry-after
  const bad = (async () => { throw new LlmError("bad key", 401, 0, "auth"); }) as never;
  assert.equal(await runBatches(cfg, 3, () => [], () => {}, { signal: new AbortController().signal, chatFn: bad, sleepFn }), "bad key");
});
