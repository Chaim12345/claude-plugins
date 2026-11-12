import { test } from "node:test";
import assert from "node:assert/strict";
import { addedCount, discoverLine, failureNote, isDiscovering, nextNote, parseDiscovery, shouldCheckDiscovery } from "./discover.ts";

const H = 60 * 60 * 1000;

test("parseDiscovery reads Go's summary and survives garbage", () => {
  const r = parseDiscovery('{"counts":{"victory":52},"errors":{"hazihinam":"HTTP 403"},"names":{"victory":"ויקטורי","hazihinam":"חצי חינם"}}');
  assert.equal(r.counts.victory, 52);
  assert.equal(r.skipped, false);
  assert.deepEqual(parseDiscovery("nope"), { counts: {}, errors: {}, names: {}, skipped: true });
  assert.equal(parseDiscovery('{"skipped":true}').skipped, true);
});

test("shouldCheckDiscovery asks at start, then at most every 6 hours", () => {
  assert.equal(shouldCheckDiscovery(null, 1000), true);
  assert.equal(shouldCheckDiscovery(0, 5 * H), false);
  assert.equal(shouldCheckDiscovery(0, 6 * H), true);
  assert.equal(shouldCheckDiscovery(10 * H, 9 * H), true); // clock went back
});

test("discoverLine names the chains, shortening long lists", () => {
  assert.equal(discoverLine("ויקטורי, קרפור"), "מוסיף סניפים של ויקטורי, קרפור…");
  assert.equal(discoverLine("ויקטורי, קרפור, קוויק, חצי חינם"), "מוסיף סניפים של ויקטורי, קרפור ועוד 2…");
  assert.equal(discoverLine(undefined), "מוסיף סניפים…");
});

test("isDiscovering is true until the sync proper starts", () => {
  assert.equal(isDiscovering([]), false);
  assert.equal(isDiscovering(["discover", "stores", "geocode"]), true);
  assert.equal(isDiscovering(["discover", "stores", "download"]), false);
  assert.equal(isDiscovering(["download", "discover"]), true);
});

test("failureNote lists the chains that failed", () => {
  const r = parseDiscovery('{"counts":{"victory":3},"errors":{"hazihinam":"x","quik":"y"},"names":{"hazihinam":"חצי חינם"}}');
  assert.equal(failureNote(r), "לא הצלחנו להוסיף: חצי חינם, quik");
  assert.equal(failureNote(parseDiscovery('{"counts":{"victory":3}}')), null);
});

test("nextNote shows a failure once", () => {
  const r = parseDiscovery('{"errors":{"quik":"x"},"names":{"quik":"קוויק"}}');
  const first = nextNote(null, r);
  assert.equal(first, "לא הצלחנו להוסיף: קוויק");
  assert.equal(nextNote(first, r), null);
  assert.equal(nextNote(first, parseDiscovery('{"errors":{"quik":"x","victory":"y"},"names":{"quik":"קוויק","victory":"ויקטורי"}}')), "לא הצלחנו להוסיף: קוויק, ויקטורי");
});

test("addedCount sums the branches found", () => {
  assert.equal(addedCount(parseDiscovery('{"counts":{"a":2,"b":5}}')), 7);
});
