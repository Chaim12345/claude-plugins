import { test } from "node:test";
import assert from "node:assert/strict";
import { toProducts } from "./compare.ts";
import { bestOfWeek, buildDeals, cartQty, defaultFilters, endLabel, endingSoon, filterDeals, misModeled, mineOf, sortDeals, verdictNote, type DealItem } from "./dealsFeed.ts";
import type { Catalog, Promo } from "./types.ts";

// Stores: 0 and 1 are two branches of chain A (portal key "A"), 2 is chain B, 3 is chain C.
const cat: Catalog = {
  priceDate: "2026-11-12", generatedAt: "", skipped: [], categories: [],
  areas: [{ name: "x", lat: 32.08, lon: 34.81 }],
  stores: [["A:1", "רשת א"], ["A:2", "רשת א"], ["B:1", "רשת ב"], ["C:1", "רשת ג"]].map(([id, chain], i) => ({ id, chain, branch: `b${i}`, address: "", lat: 32.08, lon: 34.81 + i / 100, approx: false })),
  products: [
    ["111", "חלב 3% 1 ליטר", "dairy", 0, [700, 700, 650, 720], null, null],
    ["222", "במבה 80 גרם", "snacks", 0, [450, 450, 390, null], null, null],
    ["333", "קולה 1.5 ליטר", "drinks", 0, [1000, 1000, 800, 900], null, null],
    ["444", "שמפו 500 מל", "care", 0, [2000, null, null, null], null, null], // sold at one branch only
    ["f-tomato", "עגבניות", "produce", 1, [690, 690, 590, 590], ["עגבניה", "עגבניה", "עגבניות", "עגבניות"], null],
  ],
};
const NOW = new Date(2026, 10, 12, 12, 0).getTime();
const pr = (o: Partial<Promo> & Pick<Promo, "kind" | "value">): Promo => ({ id: "p", codes: ["111"], minQty: 1, club: false, desc: "מבצע", ...o });
const withPromos = (...perStore: Promo[][]): Catalog => ({ ...cat, promos: perStore });
const ALL = [0, 1, 2, 3];
const build = (c: Catalog, club: Record<string, boolean> = {}, active = ALL) => buildDeals(c, toProducts(c), { active, club, now: NOW });
const one = (items: DealItem[], code: string, chain?: string) => items.find(d => d.code === code && (!chain || d.chain === chain))!;
const keep = { ...defaultFilters, onlyReal: false };

test("an item per promotion: effective unit price, savings vs own shelf and vs the cheapest shelf anywhere", () => {
  // milk: shelf 7.00 at A, 6.50 at B, 7.20 at C. A runs 2 for 12.00 (6.00 each).
  const items = build(withPromos([pr({ kind: "bundle", minQty: 2, value: 1200 })], [], [], []));
  assert.equal(items.length, 1);
  const d = items[0];
  assert.equal(d.unit, 600);
  assert.equal(d.shelf, 700);
  assert.equal(d.qty, 2);
  assert.equal(d.saveAgorot, 200); // 2 units: 2 * (700 - 600)
  assert.equal(Math.round(d.savePct), 14);
  assert.equal(d.cheapest, 650);
  assert.equal(d.cheapestAt, 2);
  assert.equal(d.realAgorot, 100); // 2 * (650 - 600)
  assert.equal(Math.round(d.realPct), 8);
  assert.equal(d.verdict, "real");
});

test("percent and price promotions use the branch's own shelf price", () => {
  const items = build(withPromos([pr({ kind: "percent", value: 20, codes: ["222"] })], [], [pr({ id: "q", kind: "price", value: 350, codes: ["222"] })], []));
  const a = one(items, "222", "A"), b = one(items, "222", "B");
  assert.equal(a.unit, 360);
  assert.equal(b.unit, 350);
  assert.equal(a.verdict, "real", "A's 3.60 is below B's shelf of 3.90");
  assert.equal(b.verdict, "real", "B's 3.50 is below every shelf price");
});

test("honesty: a promo not below the cheapest shelf elsewhere is labelled notCheapest, and a lone branch is alone", () => {
  // cola: shelf 10.00 at A, 8.00 at B. A's "6.90 deal" beats B's shelf. Milk: 7.00 at A, 6.50 at B: a "6.60 deal" does not.
  const items = build(withPromos([pr({ id: "x", kind: "price", value: 690, codes: ["333"] }), pr({ id: "y", kind: "price", value: 660, codes: ["111"] })], [], [], []));
  const real = items.find(d => d.promo.id === "x")!, dearer = items.find(d => d.promo.id === "y")!;
  assert.equal(real.verdict, "real");
  assert.equal(dearer.verdict, "notCheapest");
  assert.ok(dearer.realPct < 0 && dearer.savePct > 0, "saves against its own shelf but costs more than the shelf at B");
  assert.match(verdictNote(dearer, i => cat.stores[i].chain), /לא זול יותר/);
  // equal to the cheapest shelf elsewhere is not "below" it
  const eq = build(withPromos([pr({ kind: "price", value: 800, codes: ["333"] })], [], [], []));
  assert.equal(eq[0].verdict, "notCheapest");
  // shampoo exists at one branch only
  const solo = build(withPromos([pr({ kind: "price", value: 1500, codes: ["444"] })], [], [], []));
  assert.equal(solo[0].verdict, "alone");
  assert.match(verdictNote(solo[0], () => ""), /אין עם מה להשוות/);
  // the best-of list and "real only" drop both
  const all = [real, dearer, solo[0]];
  assert.deepEqual(filterDeals(all, defaultFilters).items.map(d => d.promo.id), ["x"]);
  assert.equal(filterDeals(all, defaultFilters).hiddenNotReal, 2);
  assert.equal(filterDeals(all, keep).items.length, 3);
  assert.deepEqual(bestOfWeek(all, 10).map(d => d.promo.id), ["x"]);
});

test("only branches the user compares count: a cheaper shelf at a switched-off branch is ignored", () => {
  const c = withPromos([pr({ kind: "price", value: 880, codes: ["333"] })], [], [], []);
  assert.equal(build(c)[0].verdict, "notCheapest");
  assert.equal(build(c, {}, [0, 1, 3])[0].verdict, "real", "B (8.00 shelf) is off; C sells at 9.00");
});

test("a promo that is not below its own shelf price is not a deal; weighted items and unknown codes are skipped", () => {
  const items = build(withPromos([
    pr({ id: "a", kind: "price", value: 700, codes: ["111"] }),
    pr({ id: "b", kind: "price", value: 100, codes: ["f-tomato"] }),
    pr({ id: "c", kind: "price", value: 100, codes: ["999"] }),
  ], [], [], []));
  assert.equal(items.length, 0);
});

test("dedupe: the same promotion at several branches of a chain is one card, at the cheapest branch", () => {
  // milk at A:1 and A:2 (both 7.00), same 2-for-12; plus a different shelf price at A:2
  const c = withPromos([pr({ id: "1", kind: "bundle", minQty: 2, value: 1200 })], [pr({ id: "2", kind: "bundle", minQty: 2, value: 1200 })], [], []);
  const items = build(c);
  assert.equal(items.length, 1);
  assert.deepEqual(items[0].stores.sort(), [0, 1]);
  // a percent promo at two branches with different shelf prices: shown where it is cheapest
  const c2: Catalog = { ...cat, products: [["111", "חלב", "dairy", 0, [700, 650, 800, null], null, null]], promos: [[pr({ kind: "percent", value: 10 })], [pr({ kind: "percent", value: 10 })], [], []] };
  const d = build(c2)[0];
  assert.equal(d.stores.length, 2);
  assert.equal(d.rep, 1);
  assert.equal(d.unit, 585);
  // different terms are different cards; different chains are different cards
  const c3 = withPromos([pr({ id: "1", kind: "bundle", minQty: 2, value: 1200 })], [pr({ id: "2", kind: "bundle", minQty: 2, value: 1300 })], [pr({ id: "3", kind: "bundle", minQty: 2, value: 1200 })], []);
  assert.equal(build(c3).length, 3);
});

test("per (chain, product) only the cheapest of several promotions is shown", () => {
  const c = withPromos([pr({ id: "1", kind: "price", value: 600 }), pr({ id: "2", kind: "price", value: 550 }), pr({ id: "3", kind: "percent", value: 5 })], [], [], []);
  const f = filterDeals(build(c), keep);
  assert.equal(f.items.length, 1);
  assert.equal(f.items[0].promo.id, "2");
});

test("club: no-club mode hides club promos; club mode shows them only for chains the user has a card for", () => {
  const c = withPromos([pr({ id: "n", kind: "price", value: 650, codes: ["111"] }), pr({ id: "k", kind: "price", value: 500, club: true, codes: ["111"] })], [], [pr({ id: "kb", kind: "price", value: 300, club: true, codes: ["222"] })], []);
  const noCard = build(c);
  const none = filterDeals(noCard, { ...keep, club: "none" });
  assert.deepEqual(none.items.map(d => d.promo.id), ["n"]);
  assert.equal(none.hiddenClub, 2);
  const noCardClubMode = filterDeals(noCard, { ...keep, club: "club" });
  assert.deepEqual(noCardClubMode.items.map(d => d.promo.id), ["n"], "no card for A or B: club deals stay hidden");
  assert.equal(noCardClubMode.hiddenClub, 2);
  const cardA = filterDeals(build(c, { A: true }), { ...keep, club: "club" });
  assert.deepEqual(cardA.items.map(d => d.promo.id).sort(), ["k"], "A's club price replaces the plain one (cheaper); B's stays hidden");
  assert.equal(cardA.hiddenClub, 1);
  assert.ok(cardA.items[0].club && cardA.items[0].clubOwned);
  const both = filterDeals(build(c, { A: true, B: true }), { ...keep, club: "club" });
  assert.equal(both.items.length, 2);
});

test("expiry: ended promotions never show; far-future ends are open-ended; 'עד' labels", () => {
  const c = withPromos([
    pr({ id: "gone", kind: "price", value: 600, codes: ["111"], end: "202611111159" }),
    pr({ id: "today", kind: "price", value: 600, codes: ["333"], end: "202611122359" }),
    pr({ id: "later", kind: "price", value: 400, codes: ["222"], end: "202611152359" }),
    pr({ id: "never", kind: "price", value: 650, codes: ["111"], end: "203101012359" }),
    pr({ id: "open", kind: "price", value: 640, codes: ["111"] }),
  ], [], [], []);
  const items = build(c);
  assert.ok(!items.some(d => d.promo.id === "gone"));
  const never = items.find(d => d.promo.id === "never")!;
  assert.equal(never.endMs, null);
  assert.equal(endLabel(never.endMs, NOW), "");
  assert.equal(endLabel(items.find(d => d.promo.id === "later")!.endMs, NOW), "עד 15.11");
  assert.equal(endLabel(items.find(d => d.promo.id === "today")!.endMs, NOW), "עד היום");
});

test("endingSoon: within 48 hours only, soonest-saving first, never a dearer-than-shelf deal", () => {
  const c = withPromos([
    pr({ id: "a", kind: "price", value: 500, codes: ["111"], end: "202611122359" }), // today
    pr({ id: "b", kind: "price", value: 350, codes: ["222"], end: "202611141100" }), // 47 hours
    pr({ id: "c", kind: "price", value: 750, codes: ["333"], end: "202611141300" }), // 49 hours
  ], [], [], [pr({ id: "d", kind: "price", value: 850, codes: ["333"], end: "202611130900" })]); // C's 8.50 is not below B's 8.00 shelf
  const items = filterDeals(build(c), keep).items;
  const ids = endingSoon(items, NOW).map(d => d.promo.id);
  assert.ok(ids.includes("a") && ids.includes("b"));
  assert.ok(!ids.includes("c"), "49 hours away");
  assert.ok(!ids.includes("d"), "dearer than the shelf elsewhere");
});

test("sorts: % (vs own shelf or vs cheapest), shekel saving, ending, unit price", () => {
  // milk (shelf 7.00 at A, 6.50 at B) at A: 6.00 -> 14.3% own, 7.7% vs cheapest
  // bamba (4.50 at A, 3.90 at B, 80 g) at A: 4.00 -> 11.1% own, -2.6%... use 3.50: 22% own, 10.3% vs cheapest
  const c = withPromos([
    pr({ id: "m", kind: "price", value: 600, codes: ["111"], end: "202611200000" }),
    pr({ id: "b", kind: "price", value: 350, codes: ["222"], end: "202611140000" }),
    pr({ id: "c", kind: "bundle", minQty: 3, value: 2400, codes: ["333"], end: "202611300000" }), // 8.00 each; shelf A 10.00, cheapest 8.00 at B -> notCheapest
  ], [], [], []);
  const items = filterDeals(build(c), keep).items;
  const ids = (s: Parameters<typeof sortDeals>[1], b?: Parameters<typeof sortDeals>[2]) => sortDeals(items, s, b).map(d => d.promo.id);
  assert.deepEqual(ids("pct", "shelf"), ["b", "c", "m"]); // 22.2%, 20%, 14.3% off their own shelf price
  assert.deepEqual(ids("pct", "cheapest"), ["b", "m", "c"]); // 10.3%, 7.7%, and c is not below B's 8.00 shelf
  assert.deepEqual(ids("ending"), ["b", "m", "c"]);
  assert.equal(items.find(d => d.promo.id === "c")!.qty, 3);
});

test("sort by saving percentage: own-shelf basis and cheapest-anywhere basis can disagree", () => {
  // A's milk shelf was raised to 9.00 (others 6.50); promo 6.60 is "27% off" its own shelf but dearer than B's shelf.
  const c: Catalog = { ...cat, products: [["111", "חלב", "dairy", 0, [900, null, 650, null], null, null], ["222", "במבה", "snacks", 0, [450, null, 450, null], null, null]],
    promos: [[pr({ id: "milk", kind: "price", value: 660, codes: ["111"] }), pr({ id: "bamba", kind: "price", value: 400, codes: ["222"] })], [], [], []] };
  const items = filterDeals(build(c), keep).items;
  const order = (b: "shelf" | "cheapest") => sortDeals(items, "pct", b).map(d => d.promo.id);
  assert.deepEqual(order("shelf"), ["milk", "bamba"]);
  assert.deepEqual(order("cheapest"), ["bamba", "milk"]);
  assert.equal(items.find(d => d.promo.id === "milk")!.verdict, "notCheapest");
});

test("sort by unit price groups by kind and puts unknown sizes last", () => {
  const c: Catalog = { ...cat, products: [
    ["1", "גבינה 250 גרם", "dairy", 0, [1000, 1100, null, null], null, null],
    ["2", "גבינה 500 גרם", "dairy", 0, [1500, 1600, null, null], null, null],
    ["3", "מיץ 1 ליטר", "drinks", 0, [600, 700, null, null], null, null],
    ["4", "מוצר בלי גודל", "other", 0, [100, 110, null, null], null, null],
  ], promos: [[pr({ id: "a", kind: "price", value: 900, codes: ["1"] }), pr({ id: "b", kind: "price", value: 1200, codes: ["2"] }), pr({ id: "c", kind: "price", value: 500, codes: ["3"] }), pr({ id: "d", kind: "price", value: 80, codes: ["4"] })], [], [], []] };
  const items = filterDeals(build(c), keep).items;
  // per 100 g: 9.00/2.5 = 3.60 vs 12.00/5 = 2.40
  assert.deepEqual(sortDeals(items, "unit").map(d => d.promo.id), ["b", "a", "c", "d"]);
  assert.ok(items.find(d => d.promo.id === "d")!.unitPrice === null);
});

test("category, chain and 'mine' filters", () => {
  const c = withPromos([pr({ id: "m", kind: "price", value: 600, codes: ["111"] }), pr({ id: "b", kind: "price", value: 350, codes: ["222"] })], [], [pr({ id: "bb", kind: "price", value: 300, codes: ["333"] })], []);
  const items = build(c);
  const ids = (f: Partial<typeof keep>) => filterDeals(items, { ...keep, ...f }).items.map(d => d.promo.id).sort();
  assert.deepEqual(ids({ cat: "dairy" }), ["m"]);
  assert.deepEqual(ids({ chain: "B" }), ["bb"]);
  const ps = toProducts(cat);
  const mine = mineOf({ "111": 2 }, ps);
  assert.deepEqual(ids({ mine }), ["m"]);
  const mine2 = mineOf({ "222": 1 }, ps);
  assert.deepEqual(ids({ mine: mine2 }), ["b"], "cart has bamba: snacks category, only the bamba deal");
  assert.deepEqual(ids({ mine: { codes: new Set(), cats: new Set(["drinks"]) } }), ["bb"], "a cart category pulls in other products of it");
  assert.deepEqual(ids({ mine: mineOf({}, ps) }), []);
});

test("bundle quantities: add-to-cart adds the bundle size, not one", () => {
  const items = build(withPromos([pr({ id: "b", kind: "bundle", minQty: 3, value: 1500 }), pr({ id: "p", kind: "price", value: 400, codes: ["222"] }), pr({ id: "c", kind: "percent", value: 10, codes: ["333"] })], [], [], []));
  assert.equal(cartQty(one(items, "111")), 3);
  assert.equal(cartQty(one(items, "222")), 1);
  assert.equal(cartQty(one(items, "333")), 1);
});

test("bestOfWeek: real only, noise floor, one per product, one per promotion, a few per category, ranked by real saving", () => {
  const c: Catalog = { ...cat,
    products: Array.from({ length: 8 }, (_, k) => [`d${k}`, `מוצר ${k}`, k < 6 ? "dairy" : "snacks", 0, [2000, null, 2500, null], null, null] as Catalog["products"][number])
      .concat([["tiny", "זול", "snacks", 0, [100, null, 120, null], null, null]]),
    promos: [[
      pr({ id: "s", kind: "price", value: 1000, codes: ["d0", "d1"] }), // one promo, two products: counts once
      ...[2, 3, 4, 5].map(k => pr({ id: `p${k}`, kind: "price", value: 1500 - k * 10, codes: [`d${k}`] })),
      pr({ id: "snk", kind: "price", value: 1800, codes: ["d6"] }),
      pr({ id: "t", kind: "price", value: 50, codes: ["tiny"] }), // 58% but only 0.70 below the cheapest shelf: below the noise floor
    ], [], [], []] };
  const items = filterDeals(build(c), keep).items;
  const best = bestOfWeek(items, 10);
  assert.ok(!best.some(d => d.code === "tiny"), "under 1.00 real saving");
  assert.equal(best.filter(d => d.promo.id === "s").length, 1);
  assert.ok(best.filter(d => d.product.cat === "dairy").length <= 3);
  assert.equal(best[0].promo.id, "s");
  assert.equal(new Set(best.map(d => d.code)).size, best.length);
  assert.ok(best.every(d => d.verdict === "real"));
  for (let i = 1; i < best.length; i++) assert.ok(best[i - 1].realPct >= best[i].realPct);
});

test("misModeled: 'the second one at half price' bundles are dropped (the core stores only the second item's price)", () => {
  assert.ok(misModeled(pr({ kind: "bundle", minQty: 2, value: 895, desc: "גולון טווינס לל ס 210גר השני בחצי" })));
  assert.ok(!misModeled(pr({ kind: "bundle", minQty: 2, value: 1200, desc: "פפסי 1.5 ל 2 ב 12" })));
  assert.ok(!misModeled(pr({ kind: "percent", value: 50, desc: "חצי מחיר" })), "a plain percentage is fine");
  const items = build(withPromos([pr({ kind: "bundle", minQty: 2, value: 600, desc: "חלב השני בחצי מחיר" })], [], [], []));
  assert.equal(items.length, 0);
});

test("catalogs without promotions produce no deals", () => {
  assert.deepEqual(build(cat), []);
});

test("namesProduct: Hebrew word forms and generic deal words", async () => {
  const { namesProduct } = await import("./dealsFeed.ts");
  assert.ok(namesProduct("מגוון גלידה בטעמים 3 ב 15.90", "גלידת שמנת וניל בגביע"));      // גלידה / גלידת
  assert.ok(namesProduct("2ב13.90 כוסברה/פטרוזיליה/שמיר", "פטרוזיליה ארוזה"));
  assert.ok(namesProduct("מבצע", "כל דבר"));                                              // nothing specific: not flagged
  assert.ok(!namesProduct("דפי אורז 400 גר 2 ב 21.90", "אצות נורי לסושי"));
  assert.ok(!namesProduct("מסטיק איירוויז מנטה אקליפטוס", "מסטיק אורביט פרופשיונל ספירמינט") === false); // shares "מסטיק"
});

test("confidence, usefulness score and the deal sections", async () => {
  const { dealScore, stockUp, biggestSavings, onMine } = await import("./dealsFeed.ts");
  const c: Catalog = { ...cat,
    products: [
      ["milk", "חלב 3% 1 ליטר", "dairy", 0, [1200, 1200, 1150, 1250], null, null],
      ["oil", "שמן קנולה 1 ליטר", "pantry", 0, [1500, 1500, 1400, 1450], null, null],
      ["gum", "מסטיק אורביט", "snacks", 0, [1350, 1350, 1300, 1400], null, null],
      ["rolls", "לחמניות", "bakery", 0, [200, 200, 180, 210], null, null],
    ] as Catalog["products"],
    promos: [[
      pr({ id: "o", kind: "bundle", minQty: 2, value: 2000, codes: ["oil"], desc: "שמן קנולה 2 ב 20" }),              // saves 8.00 on 2, 29%
      pr({ id: "g", kind: "price", value: 900, codes: ["gum", "milk"], desc: "מסטיק איירוויז 9.00" }),                // milk not named, 2 codes
      pr({ id: "r", kind: "bundle", minQty: 6, value: 600, codes: ["rolls"], desc: "לחמניות 6 ב 6" }),               // perishable x6
    ], [], [], []] };
  const items = filterDeals(build(c), keep).items;
  const by = (code: string) => items.find(d => d.code === code)!;
  assert.equal(by("oil").confidence, "ok");
  assert.equal(by("gum").confidence, "ok");
  assert.equal(by("milk").confidence, "check");
  assert.match(by("milk").why!, /איירוויז/);
  assert.equal(by("gum").realAgorot, 400);
  // usefulness: the user's own product counts double; a flagged deal counts half
  assert.ok(dealScore(by("milk"), { mine: new Set(["milk"]) }) > dealScore(by("milk")));
  assert.ok(dealScore(by("milk")) < dealScore({ ...by("milk"), confidence: "ok" }));
  assert.ok(dealScore(by("rolls")) < dealScore({ ...by("rolls"), product: { ...by("rolls").product, cat: "pantry" } })); // 6 rolls that go stale
  assert.deepEqual(stockUp(items).map(d => d.code), ["oil", "gum"]);           // keeps, 20%+, ₪3+, trusted; most ₪ first
  assert.ok(!biggestSavings(items).some(d => d.code === "milk"));             // flagged deals are left out of the top lists
  assert.deepEqual(onMine(items, new Set(["rolls"])).map(d => d.code), ["rolls"]);
});
