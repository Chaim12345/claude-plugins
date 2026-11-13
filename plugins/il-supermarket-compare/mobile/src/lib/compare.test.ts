import { test } from "node:test";
import assert from "node:assert/strict";
import { compare, fmtStamp, norm, priceInfo, search, toProducts } from "./compare.ts";
import type { Catalog } from "./types.ts";

const cat: Catalog = {
  priceDate: "2026-11-12", generatedAt: "", skipped: [], categories: [],
  areas: [{ name: "x", lat: 32.08, lon: 34.81 }],
  stores: ["A", "B", "C"].map((c, i) => ({ id: `${c}:${i}`, chain: c, branch: "", address: "", lat: 32.08, lon: 34.81 + i / 100, approx: false })),
  products: [
    ["111", "חלב 3% תנובה", "dairy", 0, [700, 650, 720], null, "111"],
    ["222", "במבה 80 גרם", "snacks", 0, [450, null, 390], null, "222"],
    ["f-tomato", "עגבניות", "produce", 1, [690, 790, 590], ["עגבניה", "עגבניה", "עגבניות"], null],
  ],
};

test("norm strips Hebrew quote marks", () => {
  assert.equal(norm(`קוטג' 5%  "תנובה"`), "קוטג 5% תנובה");
});

test("priceInfo finds cheapest active store", () => {
  const p = toProducts(cat).get("222")!;
  assert.deepEqual(priceInfo(p, [0, 1, 2]), { lo: 390, hi: 450, at: 2, n: 2 });
  assert.equal(priceInfo(p, [1]).lo, null);
});

test("search filters by words and category, skips unsold", () => {
  const ps = toProducts(cat);
  assert.deepEqual(search(ps.values(), [0, 1, 2], "תנובה", "all", "pop").map(r => r[0].code), ["111"]);
  assert.deepEqual(search(ps.values(), [1], "", "all", "cheap").map(r => r[0].code), ["111", "f-tomato"]);
  assert.deepEqual(search(ps.values(), [0, 1, 2], "", "produce", "pop").map(r => r[0].code), ["f-tomato"]);
});

test("compare totals, like-for-like and split", () => {
  const ps = toProducts(cat);
  const c = compare(ps, { "111": 2, "222": 1, "f-tomato": 1.5 }, [0, 1, 2]);
  // store C: 2*720 + 390 + 1.5*590 = 2715; A: 1400 + 450 + 1035 = 2885; B misses במבה: 1300 + 1185 = 2485
  assert.deepEqual(c.rows.map(r => [r.i, r.total, r.missing.length]), [[2, 2715, 0], [0, 2885, 0], [1, 2485, 1]]);
  assert.equal(c.common, 2); // milk and tomatoes are everywhere
  assert.equal(c.fairLow, Math.min(1400 + 1035, 1300 + 1185, 1440 + 885)); // 2325 at C
  assert.equal(c.split, 1300 + 390 + 885);
  assert.equal(c.splitStores, 2);
});

test("fmtStamp", () => {
  assert.equal(fmtStamp("202611120710"), "12.11 07:10");
  assert.equal(fmtStamp(""), "");
});

test("promotion notes: per store and product, ended ones hidden, none for old catalogs", async () => {
  const { notesFor } = await import("./compare.ts");
  const base = { priceDate: "", generatedAt: "", skipped: [], areas: [], categories: [], products: [],
    stores: [{ id: "a:1", chain: "a", branch: "", address: "", lat: null, lon: null, approx: false }, { id: "b:1", chain: "b", branch: "", address: "", lat: null, lon: null, approx: false }] };
  const now = new Date(2026, 10, 12, 12).getTime();
  const c = { ...base, promoNotes: [[
    { id: "1", codes: ["111", "222"], desc: "ב־5 מעל 75", why: "basket_min" as const, end: "202611302359" },
    { id: "2", codes: ["111"], desc: "נגמר", why: "gift" as const, end: "202611010000" },
  ], []] };
  assert.deepEqual(notesFor(c, 0, "111", now).map(n => n.id), ["1"]);
  assert.deepEqual(notesFor(c, 1, "111", now), []);
  assert.deepEqual(notesFor(base, 0, "111", now), []);
});


test("search keeps products a chosen branch lists without a usable price, after the priced ones", async () => {
  const { search, listedAt } = await import("./compare.ts");
  const mk = (code: string, prices: (number | null)[], meta: object | null = null) => ({ code, name: `מוצר ${code}`, cat: "x", weighted: false, prices, picks: null, img: null, key: `מוצר ${code}`, meta });
  const ps = [mk("a", [null, null], { np: [1] }), mk("b", [500, 400]), mk("c", [null, null], { odd: [[0, 99999]] }), mk("d", [null, null], { np: [0] })];
  assert.deepEqual(search(ps as never, [0, 1], "", "all", "cheap").map(([p]) => p.code), ["b", "a", "c", "d"]);
  assert.deepEqual(search(ps as never, [1], "", "all", "cheap").map(([p]) => p.code), ["b", "a"]); // d is listed only at a branch turned off
  assert.equal(listedAt(ps[0] as never, [0, 1]), 1);
  assert.equal(listedAt(ps[1] as never, [0, 1]), -1);
});
