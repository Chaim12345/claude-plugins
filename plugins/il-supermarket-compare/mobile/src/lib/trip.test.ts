import { test } from "node:test";
import assert from "node:assert/strict";
import { makeDeals, toProducts } from "./compare.ts";
import { costMatrix, DEFAULT_PER_KM, tripAdvice, tripText } from "./trip.ts";
import type { Catalog } from "./types.ts";

const KM = 1 / 111.195; // degrees of latitude per km
const at = (km: number) => ({ lat: km * KM, lon: 0 }); // points on one line north of home
const home = at(0);
const names = ["סניף א", "סניף ב", "סניף ג"];
const name = (i: number) => names[i];

// store 0 is the cheapest overall; store 1 sells the first item for much less
const costs = [[3000, 1600, null], [3000, 6000, null], [3000, 6000, null]];

test("worth it: saves 14 shekels, 3 extra km cost 4.50", () => {
  const t = tripAdvice({ costs, active: [0, 1], points: [at(2), at(3.5)], home })!;
  assert.equal(t.single, 0);
  assert.equal(t.gross, 1400);
  assert.ok(Math.abs(t.extraKm! - 3) < 0.01);
  assert.equal(t.travel, 450);
  assert.equal(t.net, 950);
  assert.ok(t.worth);
  assert.equal(t.perKm, DEFAULT_PER_KM);
  const text = tripText(t, name);
  assert.match(text, /^פיצול בין סניף א ו־סניף ב חוסך 14\.00 ₪/);
  assert.match(text, /נסיעה נוספת של 3\.0 ק״מ עולה בערך 4\.50 ₪: כדאי/);
});

test("not worth it: saves 3 shekels, the extra trip costs 4.50", () => {
  const small = [[3000, 2700, null], [3000, 6000, null]];
  const t = tripAdvice({ costs: small, active: [0, 1], points: [at(2), at(3.5)], home })!;
  assert.equal(t.gross, 300);
  assert.equal(t.travel, 450);
  assert.ok(!t.worth);
  assert.match(tripText(t, name), /לא כדאי/);
});

test("the cost per km is configurable", () => {
  const small = [[3000, 2700], [3000, 6000]];
  const base = { costs: small, active: [0, 1], points: [at(2), at(3.5)], home };
  assert.ok(!tripAdvice({ ...base, perKm: 1.5 })!.worth);
  const cheap = tripAdvice({ ...base, perKm: 0.5 })!;
  assert.equal(cheap.travel, 150);
  assert.ok(cheap.worth);
  assert.equal(tripAdvice({ ...base, perKm: 0 })!.travel, 0);
});

test("extra distance is measured against going to the single best branch, in the shorter order", () => {
  // single branch 5 km away; the second branch is on the way (2 km): no extra driving at all
  const t = tripAdvice({ costs: [[3000, 1000], [3000, 5000]], active: [0, 1], points: [at(5), at(2)], home })!;
  assert.equal(t.single, 0);
  assert.ok(t.extraKm! < 0.01);
  assert.ok(t.worth);
  assert.match(tripText(t, name), /כמעט בלי נסיעה נוספת/);
  // a second branch in the opposite direction: 5 km one way, 4 km the other way: tour 18, single trip 10, extra 8
  const opp = tripAdvice({ costs: [[3000, 1000], [3000, 5000]], active: [0, 1], points: [at(5), at(-4)], home })!;
  assert.ok(Math.abs(opp.extraKm! - 8) < 0.01);
});

test("picks the pair that nets the most after driving, not the biggest gross saving", () => {
  // branch 1 saves 14 on item 0 but is 20 km away; branch 2 saves 10 on item 0 and is 1 km further than branch 0
  const c = [[3000, 1600, 2000], [3000, 6000, 6000], [3000, 6000, 6000]];
  const t = tripAdvice({ costs: c, active: [0, 1, 2], points: [at(2), at(22), at(3)], home })!;
  assert.deepEqual([t.a, t.b].sort(), [0, 2]);
  assert.equal(t.gross, 1000);
});

test("unknown locations: no driving cost, verdict from the saving alone", () => {
  const t = tripAdvice({ costs, active: [0, 1], points: [null, null], home: null })!;
  assert.equal(t.extraKm, null);
  assert.equal(t.travel, null);
  assert.ok(t.worth);
  assert.match(tripText(t, name), /אין נתוני מרחק/);
});

test("no saving from splitting, one branch, or an empty basket", () => {
  const same = tripAdvice({ costs: [[1000, 1500], [2000, 2500]], active: [0, 1], points: [at(1), at(2)], home })!;
  assert.equal(same.gross, 0);
  assert.ok(!same.worth);
  assert.match(tripText(same, name), /לא חוסך/);
  assert.equal(tripAdvice({ costs, active: [0], points: [at(1)], home }), null);
  assert.equal(tripAdvice({ costs: [], active: [0, 1], points: [at(1), at(2)], home }), null);
});

test("items the best branch doesn't sell never count as savings", () => {
  // store 0 lacks item 1 but is the fewest-missing winner anyway? no: store 1 sells all, so it is the single branch
  const c = [[1000, 1500], [null, 2500]];
  const t = tripAdvice({ costs: c, active: [0, 1], points: [at(1), at(2)], home })!;
  assert.equal(t.single, 1);
  assert.equal(t.gross, 500); // item 0: 1000 at store 0 vs 1500 at store 1; item 1 only at store 1
  // the best branch misses an item that another branch has: not a saving
  const c2 = [[1000, 1500], [2500, null]];
  const t2 = tripAdvice({ costs: c2, active: [0, 1], points: [at(1), at(2)], home })!;
  assert.equal(t2.single, 0);
  assert.equal(t2.gross, 0);
  assert.equal(t2.filled, 0);
  const c3 = [[1000, 1500], [null, 2500], [null, 900]];
  const t3 = tripAdvice({ costs: c3, active: [0, 1], points: [at(1), at(2)], home })!;
  assert.equal(t3.single, 1);
});

test("costMatrix counts promotions and leaves missing items null", () => {
  const cat: Catalog = {
    priceDate: "", generatedAt: "", skipped: [], categories: [], areas: [],
    stores: [0, 1].map(i => ({ id: `S${i}:1`, chain: `S${i}`, branch: "", address: "", lat: null, lon: null, approx: false })),
    products: [["1", "חלב", "dairy", 0, [700, 650], null, null], ["2", "במבה", "snacks", 0, [450, null], null, null]],
    promos: [[{ id: "p", codes: ["1"], minQty: 2, kind: "bundle", value: 1000, club: false, desc: "2 ב 10" }], []],
  };
  const m = costMatrix(toProducts(cat), { "1": 2, "2": 1, "zzz": 5 }, [0, 1], makeDeals(cat, {}, new Date(2026, 10, 12).getTime()));
  assert.deepEqual(m, [[1000, 1300], [450, null]]);
});
