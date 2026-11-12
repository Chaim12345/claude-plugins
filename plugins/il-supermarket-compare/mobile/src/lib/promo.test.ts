import { test } from "node:test";
import assert from "node:assert/strict";
import { bestDeal, clubChains, compare, dealText, makeDeals, promoCost, toProducts } from "./compare.ts";
import type { Catalog, Promo } from "./types.ts";

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

const promo = (o: Partial<Promo> & Pick<Promo, "kind" | "value">): Promo => ({ id: "p", codes: ["111"], minQty: 1, club: false, desc: "מבצע", ...o });
const withPromos = (...perStore: Promo[][]): Catalog => ({ ...cat, promos: perStore });
const NOW = new Date(2026, 10, 12, 12, 0).getTime();
const total = (c: ReturnType<typeof compare>, i: number) => c.rows.find(r => r.i === i)!.total;

test("promoCost: bundle remainder, percent, price, unit limit", () => {
  assert.equal(promoCost(promo({ kind: "bundle", minQty: 2, value: 1000 }), 600, 5), 2 * 1000 + 600); // two pairs + one at shelf
  assert.equal(promoCost(promo({ kind: "bundle", minQty: 3, value: 1000 }), 600, 2), 1200); // below the bundle size: shelf
  assert.equal(promoCost(promo({ kind: "percent", value: 20 }), 500, 3), 1200);
  assert.equal(promoCost(promo({ kind: "price", value: 450 }), 600, 3), 1350);
  assert.equal(promoCost(promo({ kind: "price", value: 450, max: 2 }), 600, 3), 2 * 450 + 600);
});

test("compare applies the best promotion per store and keeps shelf totals", () => {
  const ps = toProducts(cat);
  // milk: A 700 shelf with 2 for 12.00; B 650 shelf with 10% off; C 720, no deal
  const d = makeDeals(withPromos([promo({ kind: "bundle", minQty: 2, value: 1200 })], [promo({ kind: "percent", value: 10 })], []), {}, NOW);
  const c = compare(ps, { "111": 5 }, [0, 1, 2], d);
  assert.equal(total(c, 0), 2 * 1200 + 700);
  assert.equal(c.rows.find(r => r.i === 0)!.shelf, 3500);
  assert.equal(c.rows.find(r => r.i === 0)!.deals, 1);
  assert.equal(total(c, 1), Math.round(5 * 650 * 0.9));
  assert.equal(total(c, 2), 3600);
  assert.equal(c.rows.find(r => r.i === 2)!.deals, 0);
  assert.deepEqual(c.rows.map(r => r.i), [1, 0, 2]);
  assert.equal(c.split, 2925);
  assert.equal(c.splitShelf, 5 * 650);
  assert.equal(c.lines[0].best?.promo?.kind, "percent");
});

test("promotions change the ranking and the like-for-like totals", () => {
  const ps = toProducts(cat);
  const items = { "111": 2, "222": 1 }; // A: 1400 + 450 = 1850, C: 1440 + 390 = 1830
  const plain = compare(ps, items, [0, 2]);
  assert.equal(plain.rows[0].i, 2);
  const d = makeDeals(withPromos([promo({ kind: "bundle", minQty: 2, value: 1000 })], [], []), {}, NOW);
  const c = compare(ps, items, [0, 2], d);
  assert.equal(c.rows[0].i, 0); // A is now 1000 + 450 = 1450
  assert.equal(c.rows[0].total, 1450);
  assert.equal(c.rows[0].fairShelf, 1850);
  assert.equal(c.fairLow, 1450);
  assert.equal(c.fairLowShelf, 1830);
});

test("club promotions count only when the chain's toggle is on", () => {
  const ps = toProducts(cat);
  const catalog = withPromos([promo({ kind: "price", value: 500, club: true })], [], []);
  const at = (club: Record<string, boolean>) => total(compare(ps, { "111": 1 }, [0, 1, 2], makeDeals(catalog, club, NOW)), 0);
  assert.equal(at({}), 700);
  assert.equal(at({ B: true }), 700); // another chain's card doesn't help
  assert.equal(at({ A: true }), 500);
  assert.deepEqual(clubChains(catalog), [{ key: "A", label: "A" }]);
});

test("expired promotions are ignored; open-ended and current ones apply", () => {
  const ps = toProducts(cat);
  const run = (end?: string) => total(compare(ps, { "111": 1 }, [0], makeDeals(withPromos([promo({ kind: "price", value: 500, end })], [], []), {}, NOW)), 0);
  assert.equal(run("202611111200"), 700); // ended yesterday
  assert.equal(run("202611121159"), 700); // ended a minute ago
  assert.equal(run("202611121200"), 500);
  assert.equal(run("202611302359"), 500);
  assert.equal(run(undefined), 500);
});

test("weighted items ignore promotions; no deals means shelf prices", () => {
  const ps = toProducts(cat);
  const d = makeDeals(withPromos([promo({ kind: "percent", value: 50, codes: ["f-tomato", "999"] })], [], []), {}, NOW);
  const cart = { "f-tomato": 1, "111": 1 };
  assert.deepEqual(compare(ps, cart, [0, 1, 2], d).rows.map(r => r.total), compare(ps, cart, [0, 1, 2]).rows.map(r => r.total));
  assert.equal(bestDeal(ps.get("f-tomato")!, [0], d), null);
  assert.equal(makeDeals(cat, {}, NOW).byStore.length, 3); // a catalog without promos works
});

test("bestDeal picks the lowest effective unit price; dealText", () => {
  const ps = toProducts(cat);
  const d = makeDeals(withPromos(
    [promo({ kind: "bundle", minQty: 2, value: 1100 })], // 550 each
    [promo({ kind: "percent", value: 10 })], // 585
    [promo({ kind: "price", value: 800 })], // dearer than the 720 shelf: not a deal
  ), {}, NOW);
  const b = bestDeal(ps.get("111")!, [0, 1, 2], d)!;
  assert.equal(b.i, 0);
  assert.equal(b.unit, 550);
  assert.equal(dealText(b.promo), "2 ב־11.00 ₪");
  assert.equal(dealText(promo({ kind: "percent", value: 20 })), "20% הנחה");
});
