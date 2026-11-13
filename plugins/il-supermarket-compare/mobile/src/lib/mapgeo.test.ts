import { test } from "node:test";
import assert from "node:assert/strict";
import { boundsOf, bearingDeg, buildPins, compassIndex, extraTrip, fitView, hasCoords, navLinks, padBounds, tripCost } from "./mapgeo.ts";
import { compare, makeDeals, toProducts } from "./compare.ts";
import type { Catalog } from "./types.ts";

const close = (a: number, b: number, eps = 0.5) => assert.ok(Math.abs(a - b) <= eps, `${a} is not within ${eps} of ${b}`);

test("bearing points the right way", () => {
  const o = { lat: 32, lon: 34.8 };
  close(bearingDeg(o, { lat: 33, lon: 34.8 }), 0);
  close(bearingDeg(o, { lat: 32, lon: 35.8 }), 90, 1);
  close(bearingDeg(o, { lat: 31, lon: 34.8 }), 180);
  close(bearingDeg(o, { lat: 32, lon: 33.8 }), 270, 1);
  assert.equal(compassIndex(0), 0);
  assert.equal(compassIndex(44), 1);
  assert.equal(compassIndex(359), 0);
  assert.equal(compassIndex(270), 6);
});

test("bounds hold every point and padding never shrinks them", () => {
  assert.equal(boundsOf([]), null);
  const b = boundsOf([{ lat: 32.0, lon: 34.8 }, { lat: 32.1, lon: 34.9 }, { lat: 32.05, lon: 34.7 }])!;
  assert.deepEqual(b, [34.7, 32.0, 34.9, 32.1]);
  const p = padBounds(b, 0.1);
  assert.ok(p[0] < b[0] && p[1] < b[1] && p[2] > b[2] && p[3] > b[3]);
  // a single point still gets a usable box
  const one = padBounds(boundsOf([{ lat: 32, lon: 34.8 }])!);
  assert.ok(one[2] - one[0] >= 0.0099 && one[3] - one[1] >= 0.0099);
});

test("fitView centres the box and zooms so it fits", () => {
  const b = padBounds(boundsOf([{ lat: 32.04, lon: 34.78 }, { lat: 32.11, lon: 34.85 }])!);
  const v = fitView(b, 400, 600, 40);
  close(v.center[0], (b[0] + b[2]) / 2, 1e-6);
  assert.ok(v.center[1] > 32.04 && v.center[1] < 32.11);
  // At that zoom the box spans at most the padded view
  const widthPx = ((b[2] - b[0]) / 360) * 512 * 2 ** v.zoom;
  assert.ok(widthPx <= 400 - 80 + 1e-6);
  // a bigger view zooms in, a wider box zooms out
  assert.ok(fitView(b, 800, 1200, 40).zoom > v.zoom);
  assert.ok(fitView([34, 31, 35.5, 33], 400, 600, 40).zoom < v.zoom);
  // never beyond maxZoom
  assert.equal(fitView([34.8, 32, 34.8, 32], 400, 600, 40, 15).zoom, 15);
});

test("navigation links carry the destination", () => {
  const l = navLinks({ lat: 32.085676, lon: 34.810344 }, "android");
  assert.deepEqual(l.map(x => x.app), ["waze", "google"]);
  assert.equal(l[0].url, "https://waze.com/ul?ll=32.085676,34.810344&navigate=yes");
  assert.equal(l[1].url, "https://www.google.com/maps/dir/?api=1&destination=32.085676,34.810344&travelmode=driving");
  assert.deepEqual(navLinks({ lat: 1, lon: 2 }, "ios").map(x => x.app), ["waze", "google", "apple"]);
  // no coordinates: the address goes in, percent-encoded
  const a = navLinks("ביאליק 79, רמת גן");
  assert.equal(a[0].url, "https://waze.com/ul?q=%D7%91%D7%99%D7%90%D7%9C%D7%99%D7%A7%2079%2C%20%D7%A8%D7%9E%D7%AA%20%D7%92%D7%9F&navigate=yes");
  assert.ok(a[1].url.includes("destination=%D7%91"));
});

test("trip cost is a round trip", () => {
  assert.equal(tripCost(2, 1.5), 6);
});

const cat: Catalog = {
  priceDate: "2026-11-12", generatedAt: "", skipped: [], categories: [],
  areas: [{ name: "x", lat: 32.08, lon: 34.81 }],
  stores: [
    { id: "A:1", chain: "A", branch: "a", address: "addr a", lat: 32.08, lon: 34.82, approx: false },
    { id: "B:2", chain: "B", branch: "b", address: "addr b", lat: 32.09, lon: 34.81, approx: false },
    { id: "C:3", chain: "C", branch: "c", address: "", lat: null, lon: null, approx: true },
  ],
  products: [
    ["1", "חלב", "dairy", 0, [700, 650, 600], null, null],
    ["2", "במבה", "snacks", 0, [450, null, 390], null, null],
  ],
};

test("pins: best first with totals, missing items and a single cheapest", () => {
  const products = toProducts(cat);
  const cmp = compare(products, { "1": 1, "2": 1 }, [0, 1, 2], makeDeals(cat));
  const pins = buildPins(cat, cmp, [0, 1, 2], { lat: 32.08, lon: 34.81 });
  assert.deepEqual(pins.map(p => p.id), ["C:3", "A:1", "B:2"]); // C: 9.90 with nothing missing; A: 11.50; B misses an item
  assert.equal(pins[0].cheapest, true);
  assert.equal(pins.filter(p => p.cheapest).length, 1);
  assert.equal(pins[0].label, "9.90");
  assert.deepEqual(pins[2].missing, ["במבה"]);
  assert.equal(pins[0].km, null); // no coordinates
  assert.equal(hasCoords(pins[0]), false);
  assert.ok(pins[1].km! > 0.8 && pins[1].km! < 1.0);
  close(pins[1].bearing!, 90, 1);
});

test("pins without a cart: nearest first, labelled with the chain, unplaced last", () => {
  const pins = buildPins(cat, null, [0, 1, 2], { lat: 32.08, lon: 34.81 });
  assert.deepEqual(pins.map(p => p.id), ["A:1", "B:2", "C:3"]);
  assert.equal(pins[0].total, null);
  assert.equal(pins.some(p => p.cheapest), false);
  assert.equal(pins[0].label, "A");
});

test("extra trip is measured against the nearest branch", () => {
  const pins = buildPins(cat, null, [0, 1], { lat: 32.08, lon: 34.81 });
  assert.equal(extraTrip(pins[0], pins, 1.5), 0);
  const x = extraTrip(pins[1], pins, 1.5);
  assert.ok(x > 0 && x < 3);
});
