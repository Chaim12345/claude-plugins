import { test } from "node:test";
import assert from "node:assert/strict";
import { getLanguage, setLanguage, t, translate } from "../i18n/index.ts";
import { en } from "../i18n/en.ts";
import { he } from "../i18n/he.ts";
import { DEFAULT_KM_COST, DEFAULT_RADIUS, PREF_KEY, RADII, fmtKmCost, parseKmCost, parseLang, parseRadius, parseStoredKmCost } from "./prefs.ts";

test("Hebrew and English tables have the same keys, and every placeholder appears in both", () => {
  const hk = Object.keys(he).sort(), ek = Object.keys(en).sort();
  assert.deepEqual(ek, hk);
  const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();
  for (const k of hk as (keyof typeof he)[]) {
    assert.ok(he[k].trim() && en[k].trim(), `${k} is empty`);
    assert.deepEqual(holes(en[k]), holes(he[k]), `placeholders of ${k}`);
  }
});

test("translate fills placeholders and follows the language", () => {
  assert.equal(translate("he", "common.km", { n: 4 }), "4 ק״מ");
  assert.equal(translate("en", "common.km", { n: 4 }), "4 km");
  assert.equal(translate("en", "map.title"), "Branch map");
  assert.equal(translate("he", "map.title"), "מפת סניפים");
  // an unknown placeholder is left visible rather than swallowed
  assert.equal(translate("en", "common.km"), "{n} km");
});

test("t() uses the language that was set", () => {
  assert.equal(getLanguage(), "he");
  assert.equal(t("common.close"), "סגירה");
  setLanguage("en");
  assert.equal(t("common.close"), "Close");
  setLanguage("he");
});

test("km cost: default 1.5, comma decimals, bounds", () => {
  assert.equal(DEFAULT_KM_COST, 1.5);
  assert.equal(PREF_KEY.kmCost, "salzol:kmcost");
  assert.equal(parseKmCost("1.5"), 1.5);
  assert.equal(parseKmCost(" 2,25 "), 2.25);
  assert.equal(parseKmCost("0"), 0);
  assert.equal(parseKmCost(""), null);
  assert.equal(parseKmCost("abc"), null);
  assert.equal(parseKmCost("-1"), null);
  assert.equal(parseKmCost("99"), null);
  assert.equal(parseStoredKmCost(3), 3);
  assert.equal(parseStoredKmCost("3"), DEFAULT_KM_COST);
  assert.equal(parseStoredKmCost(undefined), DEFAULT_KM_COST);
  assert.equal(fmtKmCost(1.5), "1.5");
  assert.equal(fmtKmCost(2), "2");
});

test("radius and language fall back to defaults", () => {
  assert.equal(parseRadius(8), 8);
  assert.equal(parseRadius(7), DEFAULT_RADIUS);
  assert.equal(parseRadius("5"), DEFAULT_RADIUS);
  assert.ok(RADII.includes(DEFAULT_RADIUS));
  assert.equal(parseLang("en"), "en");
  assert.equal(parseLang("fr"), "he");
  assert.equal(parseLang(undefined), "he");
});
