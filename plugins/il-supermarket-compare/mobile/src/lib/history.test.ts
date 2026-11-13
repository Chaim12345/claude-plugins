import { test } from "node:test";
import assert from "node:assert/strict";
import { basketSeries, basketSig, configSig, dayKey, daysBetween, emptyHistory, KEEP_DAYS, latestProduct, lowest, MAX_BYTES, nearProduct, prune, record, series, sizeOf, trend, type ProductPoint } from "./history.ts";
import type { Catalog } from "./types";

const at = (y: number, m: number, d: number, h = 10, min = 0) => new Date(y, m - 1, d, h, min).getTime();
const pt = (lo: number, eff = lo, store = "A:1"): ProductPoint => ({ lo, loStore: store, eff, effStore: store, deal: eff < lo });

test("dayKey and daysBetween work on local calendar days", () => {
  assert.equal(dayKey(at(2026, 11, 2, 23, 59)), "2026-11-02");
  assert.equal(daysBetween("2026-10-31", "2026-11-02"), 2);
  assert.equal(daysBetween("2026-03-26", "2026-03-30"), 4); // across the Israeli DST change
});

test("record merges into the same day and keeps the latest numbers", () => {
  let h = record(emptyHistory(), at(2026, 11, 1), "s", { a: pt(500) }, null);
  h = record(h, at(2026, 11, 1, 15), "s", { b: pt(700, 600, "B:2") }, null);
  assert.equal(h.days.length, 1);
  h = record(h, at(2026, 11, 1, 18), "s", { a: pt(450) }, null);
  assert.equal(latestProduct(h, "a")!.v.lo, 450);
  assert.equal(latestProduct(h, "b")!.v.eff, 600);
  assert.equal(latestProduct(h, "b")!.v.effStore, "B:2");
  assert.equal(latestProduct(h, "b")!.v.deal, true);
});

test("store ids are stored once, not per row", () => {
  let h = emptyHistory();
  for (let d = 1; d <= 20; d++) h = record(h, at(2026, 11, d), "s", { a: pt(500, 500, "RAMI:1234567") }, null);
  assert.deepEqual(h.stores, ["RAMI:1234567"]);
});

test("history keeps 90 days", () => {
  let h = emptyHistory();
  for (let k = 0; k < 120; k++) h = record(h, at(2026, 8, 1) + k * 86_400_000, "s", { a: pt(500 + k) }, null);
  assert.equal(h.days.length, KEEP_DAYS);
  assert.equal(h.days[h.days.length - 1].d, dayKey(at(2026, 8, 1) + 119 * 86_400_000));
});

test("history stays under the size cap, dropping the oldest days first", () => {
  let h = emptyHistory();
  const codes = Array.from({ length: 700 }, (_, i) => String(7290000000000 + i));
  for (let k = 0; k < 90; k++) {
    const day = at(2026, 8, 20) + k * 86_400_000;
    h = record(h, day, "sig", Object.fromEntries(codes.map((c, i) => [c, pt(500 + ((k * 7 + i) % 300), 500, `RAMI:${i % 9}`)])), null);
  }
  assert.ok(sizeOf(h) <= MAX_BYTES, `size ${sizeOf(h)}`);
  assert.ok(h.days.length >= 7 && h.days.length < 90);
  assert.equal(h.days[h.days.length - 1].d, dayKey(at(2026, 8, 20) + 89 * 86_400_000)); // newest survives
});

test("a realistic watch list (40 products, 90 days) fits well under the cap", () => {
  let h = emptyHistory();
  const codes = Array.from({ length: 40 }, (_, i) => String(7290000000000 + i));
  for (let k = 0; k < 90; k++) h = record(h, at(2026, 8, 20) + k * 86_400_000, "sig", Object.fromEntries(codes.map((c, i) => [c, pt(500 + i + k, 480 + i, `RAMI:${i % 5}`)])), null);
  assert.equal(h.days.length, 90);
  assert.ok(sizeOf(h) < 200_000, `size ${sizeOf(h)}`);
});

test("prune drops products nobody follows", () => {
  let h = record(emptyHistory(), at(2026, 11, 1), "s", { a: pt(500), b: pt(600) }, null);
  h = prune(h, ["a"]);
  assert.ok(latestProduct(h, "a"));
  assert.equal(latestProduct(h, "b"), null);
});

test("series, lowest and trend over 30 days", () => {
  let h = emptyHistory();
  const prices = [700, 690, 650, 660, 640, 640];
  prices.forEach((v, k) => { h = record(h, at(2026, 10, 1) + k * 86_400_000 * 3, "s", { a: pt(v) }, null); });
  const now = at(2026, 10, 16);
  const s = series(h, "a", now, 30);
  assert.equal(s.length, 6);
  assert.equal(lowest(h, "a", now, 30), 640);
  assert.equal(lowest(h, "a", now, 30, "2026-10-16"), 640);
  assert.equal(lowest(h, "a", at(2026, 12, 20), 30), null); // nothing in the last 30 days
  const t = trend(s)!;
  assert.equal(t.from, 700);
  assert.equal(t.to, 640);
  assert.ok(Math.abs(t.pct + 8.57) < 0.01);
  assert.equal(trend([{ d: "x", v: 1 }]), null);
});

test("lowest needs at least 3 points", () => {
  let h = record(emptyHistory(), at(2026, 10, 1), "s", { a: pt(500) }, null);
  h = record(h, at(2026, 10, 2), "s", { a: pt(400) }, null);
  assert.equal(lowest(h, "a", at(2026, 10, 3), 30), null);
});

test("nearProduct finds the snapshot about a week ago", () => {
  let h = emptyHistory();
  for (const d of [1, 4, 5, 9, 11]) h = record(h, at(2026, 11, d), "s", { a: pt(100 * d) }, null);
  const w = nearProduct(h, "a", at(2026, 11, 12), 7)!;
  assert.equal(w.day, "2026-11-05");
});

test("basket points are stored and read back as a series", () => {
  const b = (t: number) => ({ total: t, store: "A:1", sig: basketSig({ x: 1 }), missing: 0 });
  let h = record(emptyHistory(), at(2026, 11, 1), "s", {}, b(15000));
  h = record(h, at(2026, 11, 2), "s", {}, b(14500));
  assert.deepEqual(basketSeries(h, at(2026, 11, 3)).map(p => p.v), [15000, 14500]);
});

test("basketSig ignores key order and changes with quantities", () => {
  assert.equal(basketSig({ a: 1, b: 2 }), basketSig({ b: 2, a: 1 }));
  assert.notEqual(basketSig({ a: 1 }), basketSig({ a: 2 }));
});

test("configSig changes with branches and club cards", () => {
  const c = { stores: [{ id: "A:1" }, { id: "B:2" }] } as unknown as Catalog;
  assert.equal(configSig(c, [0, 1], [false, false]), configSig(c, [1, 0], [false, false]));
  assert.notEqual(configSig(c, [0, 1], [false, false]), configSig(c, [0], [false, false]));
  assert.notEqual(configSig(c, [0, 1], [false, false]), configSig(c, [0, 1], [true, false]));
});
