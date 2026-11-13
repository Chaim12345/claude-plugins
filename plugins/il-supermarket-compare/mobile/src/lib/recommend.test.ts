import { test } from "node:test";
import assert from "node:assert/strict";
import { toProducts } from "./compare.ts";
import { accept, affinity, coCounts, dismiss, dueBasket, emptyFeedback, expire, feedbackMul, recommend, rhythm, usualQty, type Basket, type RecInput } from "./recommend.ts";
import type { Catalog, RawProduct } from "./types.ts";

const DAY = 86_400_000, NOW = 1_800_000_000_000;
const stores = Array.from({ length: 4 }, (_, i) => ({ id: `S${i}:1`, chain: `c${i}`, branch: "", address: "", lat: 32, lon: 34.8, approx: false }));
const P = (code: string, name: string, cat: string, prices: (number | null)[], meta?: object): RawProduct => [code, name, cat, 0, prices, null, null, (meta ?? null) as never];
const cat: Catalog = { version: 3, priceDate: "", generatedAt: "", skipped: [], categories: [], areas: [], stores, products: [
  P("milk", "חלב 3% 1 ליטר", "dairy", [650, 690, 700, 710], { maker: "תנובה" }),
  P("cottage", "קוטג 5%", "dairy", [550, 600, 610, 620], { maker: "תנובה" }),
  P("yogurt", "יוגורט", "dairy", [300, 320, 330, 340], { maker: "תנובה" }),
  P("bread", "לחם אחיד", "bakery", [700, 820, 830, 900]),
  P("bamba", "במבה", "snacks", [450, 400, 480, 500], { maker: "אסם" }),
  P("bisli", "ביסלי", "snacks", [600, 650, 700, 720], { maker: "אסם" }),
  P("soap", "סבון", "cleaning", [1500, 1600, 1700, 1800]),
  P("dead", "מוצר מת", "dairy", [100, null, null, null], { stale: [[0, 60]] }),
] };
const products = toProducts(cat);
const active = [0, 1, 2, 3];
const basket = (daysAgo: number, items: Record<string, number>): Basket => ({ at: NOW - daysAgo * DAY, items });
const base = (o: Partial<RecInput> = {}): RecInput => ({ products, active, cart: {}, freq: {}, baskets: [], deals: [], drops: [], feedback: emptyFeedback(), now: NOW, ...o });

test("usual quantity and buying rhythm from past baskets, else from the add counter", () => {
  const bs = [basket(21, { milk: 2 }), basket(14, { milk: 3 }), basket(7, { milk: 2, bread: 1 })];
  assert.equal(usualQty("milk", bs), 2);
  assert.equal(usualQty("soap", bs), 1);
  assert.equal(usualQty("soap", bs, true), 0.5);
  assert.deepEqual(rhythm("milk", bs), { every: 7, since: 0, last: NOW - 7 * DAY });
  assert.equal(rhythm("bread", bs), null);
  assert.equal(rhythm("bread", bs, [3, NOW - DAY, NOW - 21 * DAY])!.every, 10);
});

test("co-occurrence counts pairs within baskets", () => {
  const co = coCounts([basket(1, { milk: 1, bread: 1 }), basket(2, { milk: 1, bread: 1, bamba: 1 })]);
  assert.equal(co.get("milk")!.get("bread"), 2);
  assert.equal(co.get("bread")!.get("bamba"), 1);
  assert.equal(co.get("milk")!.has("milk"), false);
});

test("pipeline: due regulars, bought-together, real deals; filters for cart, dismissed and stale", () => {
  const baskets = [basket(21, { milk: 2, bread: 1 }), basket(14, { milk: 2, bread: 1 }), basket(7, { milk: 2, bread: 1, cottage: 1 })];
  const freq = { milk: [3, NOW - 7 * DAY, NOW - 21 * DAY] as [number, number, number], dead: [4, NOW - 30 * DAY, NOW - 60 * DAY] as [number, number, number] };
  const recs = recommend(base({ baskets, freq, cart: { bread: 1 },
    deals: [{ code: "yogurt", verdict: "real", realPct: 20, savePct: 25, unit: 240, qty: 1, club: false },
            { code: "soap", verdict: "notCheapest", realPct: -5, savePct: 10, unit: 1400, qty: 1, club: false }] }));
  const by = new Map(recs.map(r => [r.p.code, r]));
  assert.equal(by.get("milk")?.source, "due");               // bought every 7 days, last 7 days ago
  assert.equal(by.get("milk")?.qty, 2);                       // usual quantity
  assert.match(by.get("milk")!.reason, /כל 7 ימים/);
  assert.equal(by.get("yogurt")?.source, "deal");             // real deal in a category they buy
  assert.equal(by.get("yogurt")?.price, 240);
  assert.equal(by.has("soap"), false);                        // not a real deal, and not a category they buy
  assert.equal(by.has("bread"), false);                       // already in the cart
  assert.equal(by.has("dead"), false);                        // only sold where it hasn't sold for 2 months
  assert.equal(by.has("cottage"), false);                     // with bread only once: below the two-basket threshold
  assert.deepEqual(dueBasket(recs), { milk: 2 });
});

test("cold start: staples with a real price gap, before the user has history", () => {
  const recs = recommend(base());
  assert.ok(recs.length > 0);
  assert.ok(recs.every(r => r.source === "staple"));
  assert.ok(recs.every(r => ["dairy", "bakery", "produce", "pantry"].includes(r.p.cat)));
});

test("diversity: repeated categories and manufacturers are pushed down", () => {
  const deals = ["milk", "cottage", "yogurt", "bamba", "bisli"].map(code => ({ code, verdict: "real", realPct: 30, savePct: 30, unit: 100, qty: 1, club: false }));
  const freq = Object.fromEntries(["milk", "cottage", "yogurt", "bamba", "bisli"].map(c => [c, [1, NOW - DAY] as [number, number]]));
  const recs = recommend(base({ deals, freq, limit: 3 }));
  const cats = recs.map(r => r.p.cat);
  assert.ok(cats.includes("snacks") && cats.includes("dairy"), `got ${cats}`); // not three dairy cards in a row
});

test("feedback: not interested removes the product and lowers its source and category; adding raises them", () => {
  const recs = recommend(base());
  const first = recs[0];
  let fb = dismiss(emptyFeedback(), first, NOW);
  assert.ok(!recommend(base({ feedback: fb })).some(r => r.p.code === first.p.code));
  assert.ok(feedbackMul(fb, `src:${first.source}`) < 1);
  fb = accept(fb, first);
  assert.ok(feedbackMul(fb, `src:${first.source}`) > feedbackMul(dismiss(emptyFeedback(), first, NOW), `src:${first.source}`));
  assert.equal(Object.keys(expire(fb, NOW + 31 * DAY).dismissed).length, 0);
  const many = { ...emptyFeedback(), neg: { "src:deal": 50 } };
  assert.equal(feedbackMul(many, "src:deal"), 0.3); // floored: a source is never switched off entirely
});

test("category affinity sums to 1 and follows what is bought", () => {
  const a = affinity({ products, cart: { milk: 1 }, freq: { bamba: [6, NOW] }, baskets: [basket(1, { milk: 1 })] });
  const total = [...a.values()].reduce((x, y) => x + y, 0);
  assert.ok(Math.abs(total - 1) < 1e-9);
  assert.ok((a.get("snacks") ?? 0) > (a.get("dairy") ?? 0)); // 6 adds of bamba vs 2+1 for milk
});
