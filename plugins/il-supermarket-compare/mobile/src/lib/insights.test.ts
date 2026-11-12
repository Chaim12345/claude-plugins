import { test } from "node:test";
import assert from "node:assert/strict";
import { compare, isStale, soldDaysAgo, changedDaysAgo, search, toProducts } from "./compare.ts";
import { bumpFreq, categoryWinners, diffCatalogs, mergeChanges, priceIndex, recentlyChanged, regulars, summarizeChanges, topGaps, trimFreq, type Change } from "./insights.ts";
import type { Catalog, RawProduct } from "./types.ts";
import { sizeOf } from "./units.ts";

const stores = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `S${i}:1`, chain: `רשת ${i}`, branch: `b${i}`, address: "", lat: 32, lon: 34.8, approx: false, file: `f${i}-a` }));
const catalog = (products: RawProduct[], n = 3): Catalog => ({ version: 2, priceDate: "2026-11-12", generatedAt: "", skipped: [], categories: [], areas: [], stores: stores(n), products });

test("metadata reaches the product: size, maker in search, stale and changed days", () => {
  const c = catalog([
    ["1", "ביסלי גריל", "snacks", 0, [690, 750, 700], null, null, { size: [200, "g", 3], maker: "אסם", il: true, stale: [[1, 45], [2, 16]], chg: [[0, 2]] }],
    ["2", "חלב 3% 1 ליטר", "dairy", 0, [650, 700, null], null, null],
  ]);
  const ps = toProducts(c);
  const bisli = ps.get("1")!;
  assert.equal(soldDaysAgo(bisli, 1), 45);
  assert.equal(isStale(bisli, 1), true);
  assert.equal(isStale(bisli, 2), false); // 16 days: reported, but not yet "probably not on the shelf"
  assert.equal(soldDaysAgo(bisli, 0), 0);
  assert.equal(changedDaysAgo(bisli, 0), 2);
  assert.equal(changedDaysAgo(bisli, 1), null);
  assert.deepEqual(search(ps.values(), [0, 1, 2], "אסם", "all", "pop").map(([p]) => p.code), ["1"]);
  assert.equal(ps.get("2")!.meta, null); // a 7-element product from an older catalog still loads
});

test("size: chains' agreed figure beats the name, a multi-pack in the name beats both, one chain alone only fills a gap", () => {
  const p = (name: string, size?: [number, "g" | "ml" | "u", number]) => ({ code: name, name, cat: "dairy", meta: size ? { size } : null });
  // the name parser reads "20 גרם חלבון" as nothing useful; three chains say 200 g
  assert.deepEqual(sizeOf(p("דנונה פרו 20 גרם חלבון", [200, "g", 3])), { kind: "weight", amount: 200, packs: 1 });
  // no size in the name at all
  assert.deepEqual(sizeOf(p("אפרופו חטיף תירס", [50, "g", 2])), { kind: "weight", amount: 50, packs: 1 });
  // name and chains agree: the name's parse is kept
  assert.deepEqual(sizeOf(p("חלב 3% 1 ליטר", [1000, "ml", 4])), { kind: "volume", amount: 1000, packs: 1 });
  // the name spells out a six-pack
  assert.deepEqual(sizeOf(p("קולה 6x330 מל", [330, "ml", 2])), { kind: "volume", amount: 1980, packs: 6 });
  // one chain alone does not override the name...
  assert.deepEqual(sizeOf(p("שמן 750 מל", [1000, "ml", 1])), { kind: "volume", amount: 750, packs: 1 });
  // ...but is better than nothing
  assert.deepEqual(sizeOf(p("רוטב צ'ילי", [300, "ml", 1])), { kind: "volume", amount: 300, packs: 1 });
  assert.equal(sizeOf(p("מסטיק")), null);
  // the chains say 6000 g for a four-pack of 1.5 L soda: the amount is theirs, the unit the name's
  assert.deepEqual(sizeOf({ ...p("סודה אננס 1.5 ליטר רביעייה", [6000, "g", 3]), cat: "drinks" }), { kind: "volume", amount: 6000, packs: 1 });
});

test("basket: an item the branch has not sold for a month is priced but flagged as doubtful", () => {
  const c = catalog([
    ["1", "א", "pantry", 0, [500, 600, 700], null, null, { stale: [[0, 40]] }],
    ["2", "ב", "pantry", 0, [300, 300, 300], null, null],
  ]);
  const cmp = compare(toProducts(c), { "1": 1, "2": 1 }, [0, 1, 2]);
  const row0 = cmp.rows.find(r => r.i === 0)!;
  assert.deepEqual(row0.doubt, ["א"]);
  assert.equal(row0.total, 800); // still counted in the total
  assert.deepEqual(cmp.rows.find(r => r.i === 1)!.doubt, []);
});

test("price index: cheapest branch first, relative to the median price of each product", () => {
  // store 0 is always 10% under store 1, store 2 always 10% over
  const products: RawProduct[] = Array.from({ length: 50 }, (_, k) => [`${k}`, `מוצר ${k}`, k < 25 ? "dairy" : "pantry", 0, [900 + k, 1000 + k, 1100 + k], null, null]);
  const c = catalog(products);
  const rows = priceIndex(toProducts(c).values(), [0, 1, 2]);
  assert.deepEqual(rows.map(r => r.i), [0, 1, 2]);
  assert.ok(rows[0].pct < -8 && rows[0].pct > -11, `store 0 pct ${rows[0].pct}`);
  assert.equal(rows[1].pct, 0);
  assert.ok(rows[2].pct > 8 && rows[2].pct < 11);
  assert.equal(rows[0].n, 50);
  assert.equal(rows[0].cheapest, 50);
  assert.equal(rows[2].cheapest, 0);
});

test("price index: stale prices don't count, small samples aren't ranked, categories rank separately", () => {
  const cheapButDead: RawProduct[] = Array.from({ length: 50 }, (_, k) => [`${k}`, `מ ${k}`, "dairy", 0, [500, 1000, 1000], null, null, { stale: [[0, 60]] }]);
  // store 0's half-price rows are leftovers nobody has bought: with them excluded only two stores remain per product
  assert.deepEqual(priceIndex(toProducts(catalog(cheapButDead)).values(), [0, 1, 2]), []);
  const few: RawProduct[] = Array.from({ length: 10 }, (_, k) => [`${k}`, `מ ${k}`, "dairy", 0, [900, 1000, 1100], null, null]);
  assert.deepEqual(priceIndex(toProducts(catalog(few)).values(), [0, 1, 2]), []); // 10 products is not a verdict
  // dairy is cheapest at store 0, cleaning at store 2
  const mixed: RawProduct[] = [
    ...Array.from({ length: 15 }, (_, k): RawProduct => [`d${k}`, `ח ${k}`, "dairy", 0, [800, 1000, 1100], null, null]),
    ...Array.from({ length: 15 }, (_, k): RawProduct => [`c${k}`, `נ ${k}`, "cleaning", 0, [1200, 1000, 700], null, null]),
  ];
  const w = categoryWinners(toProducts(catalog(mixed)), [0, 1, 2], ["dairy", "cleaning", "pets"]);
  assert.deepEqual(w.map(x => [x.cat, x.best.i]), [["dairy", 0], ["cleaning", 2]]);
});

test("gaps: widest range among widely sold products, excluding stale prices and mismatched barcodes", () => {
  const c = catalog([
    ["1", "גדול", "pantry", 0, [1000, 1500, 1200], null, null],             // 50%
    ["2", "קטן", "pantry", 0, [1000, 1050, 1000], null, null],              // 0.50 apart: under the minimum
    ["3", "טעות", "pantry", 0, [300, 1500, 1400], null, null],              // 5x: two different things
    ["4", "נדיר", "pantry", 0, [1000, 2000, null], null, null],             // sold at 2 of 3 branches only
    ["5", "מת", "pantry", 0, [500, 1000, 1100], null, null, { stale: [[0, 90]] }], // the cheap price is a leftover; 2 live prices
  ]);
  const g = topGaps(toProducts(c).values(), [0, 1, 2]);
  assert.deepEqual(g.map(x => x.p.code), ["1"]);
  assert.deepEqual([g[0].lo, g[0].hi, g[0].loAt, g[0].hiAt, g[0].save, g[0].pct], [1000, 1500, 0, 1, 500, 50]);
});

test("changes: only branches with a newer file, direction from the two catalogs", () => {
  const prev = catalog([["1", "א", "x", 0, [500, 600, 700], null, null], ["2", "ב", "x", 0, [100, null, 300], null, null]]);
  const next = catalog([["1", "א", "x", 0, [550, 500, 700], null, null], ["2", "ב", "x", 0, [100, 200, 250], null, null], ["3", "חדש", "x", 0, [1, 1, 1], null, null]]);
  next.stores[0].file = "f0-b"; // new file: 500 -> 550
  next.stores[2].file = "f2-b"; // new file: product 2 300 -> 250
  // store 1 kept its file; its "change" (600 -> 500) must be ignored: same file, so it is our parsing that differs
  const ch = diffCatalogs(prev, next, "2026-11-13");
  assert.deepEqual(ch, [
    { code: "1", store: "S0:1", from: 500, to: 550, day: "2026-11-13" },
    { code: "2", store: "S2:1", from: 300, to: 250, day: "2026-11-13" },
  ]);
  assert.deepEqual(diffCatalogs(prev, prev, "2026-11-13"), []);
});

test("changes: log is capped and aged out; summary nets out moves and splits up from down", () => {
  const c = catalog([["1", "א", "x", 0, [550, 600, 700], null, null], ["2", "ב", "x", 0, [100, 200, 250], null, null], ["3", "ג", "x", 0, [400, 400, 400], null, null]]);
  const log: Change[] = [
    { code: "1", store: "S0:1", from: 500, to: 520, day: "2026-11-01" },
    { code: "1", store: "S0:1", from: 520, to: 550, day: "2026-11-10" }, // net: 500 -> 550
    { code: "2", store: "S2:1", from: 300, to: 250, day: "2026-11-10" },
    { code: "3", store: "S1:1", from: 400, to: 450, day: "2026-11-05" }, // went up...
    { code: "3", store: "S1:1", from: 450, to: 400, day: "2026-11-09" }, // ...and back: not a change
    { code: "1", store: "GONE:9", from: 1, to: 2, day: "2026-11-10" },   // a branch no longer compared
  ];
  const s = summarizeChanges(log, toProducts(c), c, [0, 1, 2]);
  assert.deepEqual(s.up.map(v => [v.p.code, v.i, v.from, v.to, v.pct]), [["1", 0, 500, 550, 10]]);
  assert.deepEqual(s.down.map(v => [v.p.code, v.i, v.delta]), [["2", 2, -50]]);
  assert.equal(s.since, "2026-11-01");
  assert.deepEqual(summarizeChanges(log, toProducts(c), c, [0, 1, 2], new Set(["2"])).up, []);
  assert.deepEqual(summarizeChanges(log, toProducts(c), c, [1]).down, []); // store 2 switched off

  const old: Change = { code: "9", store: "S0:1", from: 1, to: 2, day: "2026-09-01" };
  assert.deepEqual(mergeChanges([old], [log[2]], "2026-11-12"), [log[2]]);
  assert.equal(mergeChanges(log, log, "2026-11-12", 30, 5).length, 5);
});

test("recently changed: counts the branch-reported changes within the window", () => {
  const c = catalog([
    ["1", "א", "x", 0, [1, 1, 1], null, null, { chg: [[0, 2], [1, 20]] }],
    ["2", "ב", "x", 0, [1, null, 1], null, null, { chg: [[0, 7], [1, 1]] }], // store 1 has no price for it
  ]);
  const r = recentlyChanged(toProducts(c).values(), [0, 1, 2], 7);
  assert.equal(r.total, 2);
  assert.equal(r.byStore.get(0), 2);
  assert.equal(r.byStore.get(1), undefined);
});

test("regulars: counted once a day, shown when bought on two days, never what's already in the cart", () => {
  const H = 3_600_000, t0 = 1_800_000_000_000;
  let f = bumpFreq({}, "1", t0);
  f = bumpFreq(f, "1", t0 + H);          // same day: no second count
  assert.deepEqual(f["1"], [1, t0]);
  f = bumpFreq(f, "1", t0 + 30 * H);
  assert.equal(f["1"][0], 2);
  for (const code of ["2", "3"]) { f = bumpFreq(f, code, t0); f = bumpFreq(f, code, t0 + 30 * H); }
  f = bumpFreq(f, "4", t0 + 31 * H);     // once only
  f = bumpFreq(f, "gone", t0); f = bumpFreq(f, "gone", t0 + 30 * H); // not in this catalog
  const c = catalog([["1", "א", "x", 0, [1, 1, 1], null, null], ["2", "ב", "x", 0, [1, 1, 1], null, null], ["3", "ג", "x", 0, [1, 1, 1], null, null], ["4", "ד", "x", 0, [1, 1, 1], null, null]]);
  const ps = toProducts(c);
  // "2" is in the cart, which leaves two repeats: too few to stand alone, so the one-off "4" joins them (after them)
  assert.deepEqual(regulars(f, ps, [0, 1, 2], { "2": 1 }).map(p => p.code), ["1", "3", "4"]);
  assert.deepEqual(regulars(f, ps, [0, 1, 2], {}).map(p => p.code).sort(), ["1", "2", "3"]);    // three repeats: the one-off "4" is left out
  assert.equal(Object.keys(trimFreq(f, 2)).length, 2);
});
