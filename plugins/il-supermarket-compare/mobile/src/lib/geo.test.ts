import { test } from "node:test";
import assert from "node:assert/strict";
import { chooseCandidate, typedCity } from "./geo.ts";

const haifa = { lat: 32.794, lon: 34.989 };
const hadera = { lat: 32.436, lon: 34.919 }; // "הרצל 10" in Hadera, ~40 km south
const haifaHerzl = { lat: 32.81, lon: 34.999 };

test("typedCity takes the part after the last comma", () => {
  assert.equal(typedCity("הרצל 10, חיפה"), "חיפה");
  assert.equal(typedCity("שד' ירושלים 70, תל אביב - יפו"), "תל אביב - יפו");
  assert.equal(typedCity("הרצל 10"), null);
  assert.equal(typedCity("הרצל 10,  "), null);
});

test("chooseCandidate skips a same-named street in another town", () => {
  assert.deepEqual(chooseCandidate([hadera, haifaHerzl], haifa), haifaHerzl);
});

test("chooseCandidate rejects when nothing is in the typed city", () => {
  assert.equal(chooseCandidate([hadera], haifa), null);
});

test("chooseCandidate takes the first answer when the city is unknown", () => {
  assert.deepEqual(chooseCandidate([hadera, haifaHerzl], null), hadera);
  assert.equal(chooseCandidate([], null), null);
});
