import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, digestDue, inQuietHours, mergeInbox, mergeSettings, pickNotifications, shortName, whenText, type AlertItem, type InboxItem, type Settings } from "./alerts.ts";
import type { Catalog, Promo } from "./types";
import { emptyWatch, runCheck, type WatchState } from "./watchflow.ts";

const at = (y: number, m: number, d: number, h = 10, min = 0) => new Date(y, m - 1, d, h, min).getTime();
const HOUR = 3_600_000;

// Three branches: rami (A), shufersal (B), yochananof (C). Two products: milk 111, bamba 222, oil 333.
function catalog(prices: Record<string, (number | null)[]>, promos: Promo[][] = [[], [], []]): Catalog {
  const names: Record<string, string> = { "111": "חלב תנובה 3% 1 ליטר", "222": "במבה אוסם 80 גרם", "333": "שמן קנולה 1 ליטר" };
  return {
    priceDate: "2026-11-12", generatedAt: "", skipped: [], categories: [],
    areas: [{ name: "x", lat: 32.08, lon: 34.81 }],
    stores: [["ramilevy", "רמי לוי"], ["shufersal", "שופרסל"], ["yohananof", "יוחננוף"]].map(([k, chain], i) => ({ id: `${k}:${i}`, chain, branch: "", address: "", lat: 32.08, lon: 34.81 + i / 100, approx: false })),
    products: Object.entries(prices).map(([c, p]) => [c, names[c], "dairy", 0, p, null, c]),
    promos,
  };
}
const promo = (id: string, codes: string[], kind: Promo["kind"], value: number, extra: Partial<Promo> = {}): Promo => ({ id, codes, minQty: kind === "bundle" ? 2 : 1, kind, value, club: false, desc: "מבצע", ...extra });
const stamp = (ms: number) => { const d = new Date(ms); const p = (n: number) => String(n).padStart(2, "0"); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}`; };

function watch(over: Partial<WatchState> = {}): WatchState {
  return { ...emptyWatch(), followed: ["111"], settings: { ...DEFAULT_SETTINGS, on: true }, ...over };
}
const run = (st: WatchState, c: Catalog, now: number, club: Record<string, boolean> = {}, off: string[] = []) => runCheck(st, { catalog: c, off, club, now });
const kinds = (r: { fresh: AlertItem[] }) => r.fresh.map(a => a.kind);

const day1 = at(2026, 11, 10, 9);
const day2 = at(2026, 11, 11, 9);
const base = catalog({ "111": [660, 700, 690], "222": [450, 390, 400], "333": [1200, 1100, 1150] });

test("the first check only records a baseline: no alerts", () => {
  const r = run(watch(), base, day1);
  assert.deepEqual(r.fresh, []);
  assert.equal(r.state.history.days.length, 1);
});

test("a followed product going on promotion alerts, with the store and the old price", () => {
  const s1 = run(watch(), base, day1).state;
  const withPromo = catalog({ "111": [660, 700, 690] }, [[promo("p1", ["111"], "price", 590)], [], []]);
  const r = run(s1, withPromo, day2);
  assert.deepEqual(kinds(r), ["promo"]);
  assert.equal(r.fresh[0].body, "חלב תנובה 3% 1 ליטר: מבצע 5.90 ₪ ברמי לוי, במקום 6.60");
  assert.equal(r.fresh[0].code, "111");
});

test("a product already on promotion yesterday does not alert again", () => {
  const withPromo = catalog({ "111": [660, 700, 690] }, [[promo("p1", ["111"], "price", 590)], [], []]);
  const s1 = run(watch(), withPromo, day1).state;
  assert.deepEqual(run(s1, withPromo, day2).fresh, []);
});

test("an unfollowed product is ignored", () => {
  const s1 = run(watch(), base, day1).state;
  const c = catalog({ "111": [660, 700, 690], "222": [300, 390, 400] });
  assert.deepEqual(run(s1, c, day2).fresh, []);
});

test("price drop of 5% or more alerts; 3% does not", () => {
  const s1 = run(watch(), base, day1).state;
  const r3 = run(s1, catalog({ "111": [640, 700, 690] }), day2); // -3.0%
  assert.deepEqual(r3.fresh, []);
  const r6 = run(s1, catalog({ "111": [620, 700, 690] }), day2); // -6.1%
  assert.deepEqual(kinds(r6), ["drop"]);
  assert.equal(r6.fresh[0].body, "חלב תנובה 3% 1 ליטר: 6.20 ₪ ברמי לוי, ירד מ־6.60");
});

test("the drop threshold is configurable", () => {
  const st = watch({ settings: { ...DEFAULT_SETTINGS, on: true, dropPct: 2 } });
  const s1 = run(st, base, day1).state;
  assert.deepEqual(kinds(run(s1, catalog({ "111": [640, 700, 690] }), day2)), ["drop"]);
});

test("a new 30-day low alerts even for a small drop", () => {
  let st = watch();
  const days = [at(2026, 11, 1), at(2026, 11, 3), at(2026, 11, 5), at(2026, 11, 7)];
  for (const [k, d] of days.entries()) st = run(st, catalog({ "111": [k === 0 ? 700 : 660, 700, 690] }), d).state;
  const r = run(st, catalog({ "111": [655, 700, 690] }), at(2026, 11, 9)); // -0.8%, below every earlier price
  assert.deepEqual(kinds(r), []); // under 1%: not worth a ping
  const r2 = run(st, catalog({ "111": [648, 700, 690] }), at(2026, 11, 9)); // -1.8%, a new low
  assert.deepEqual(kinds(r2), ["drop"]);
  assert.match(r2.fresh[0].body, /הכי נמוך ב־30 יום/);
});

test("rules can be switched off one by one", () => {
  const st = watch({ settings: { ...DEFAULT_SETTINGS, on: true, rules: { ...DEFAULT_SETTINGS.rules, drop: false } } });
  const s1 = run(st, base, day1).state;
  assert.deepEqual(run(s1, catalog({ "111": [500, 700, 690] }), day2).fresh, []);
});

test("changing branches or club cards starts a new baseline instead of alerting", () => {
  const withClub = catalog({ "111": [660, 700, 690] }, [[promo("c1", ["111"], "price", 500, { club: true })], [], []]);
  const s1 = run(watch(), withClub, day1, {}).state; // no card: the club price is not usable
  assert.deepEqual(run(s1, withClub, day2, { ramilevy: true }).fresh, []); // card ticked: a different configuration
  const s2 = run(s1, withClub, day2, {}, ["shufersal:1"]).state; // a branch switched off
  assert.equal(s2.history.days.length, 2);
});

test("club-only deals are ignored without the card, and counted with 'any club'", () => {
  const plain = catalog({ "111": [660, 700, 690] });
  const withClub = catalog({ "111": [660, 700, 690] }, [[promo("c1", ["111"], "price", 500, { club: true })], [], []]);
  const s1 = run(watch(), plain, day1).state;
  assert.deepEqual(run(s1, withClub, day2).fresh, []);
  const any = watch({ settings: { ...DEFAULT_SETTINGS, on: true, anyClub: true } });
  const t1 = run(any, plain, day1).state;
  assert.deepEqual(kinds(run(t1, withClub, day2)), ["promo"]);
});

test("a promo ending within 48 hours alerts once, and not when it ends later", () => {
  const now = at(2026, 11, 12, 9);
  const soon = catalog({ "111": [660, 700, 690] }, [[promo("p1", ["111"], "bundle", 1000, { end: stamp(at(2026, 11, 13, 23, 59)) })], [], []]);
  const st = watch();
  const s1 = run(st, soon, at(2026, 11, 11, 9)).state; // seen yesterday, ends in 39 h
  const r = run(s1, soon, now);
  assert.deepEqual(kinds(r), ["ending"]);
  assert.equal(r.fresh[0].body, "חלב תנובה 3% 1 ליטר: 2 ב־10.00 ₪ ברמי לוי, נגמר מחר ב־23:59");
  const later = catalog({ "111": [660, 700, 690] }, [[promo("p1", ["111"], "bundle", 1000, { end: stamp(at(2026, 11, 20, 23, 59)) })], [], []]);
  assert.deepEqual(run(s1, later, now).fresh, []);
  const over = catalog({ "111": [660, 700, 690] }, [[promo("p1", ["111"], "bundle", 1000, { end: stamp(at(2026, 11, 12, 8, 0)) })], [], []]);
  assert.deepEqual(run(s1, over, now).fresh, []); // already ended
});

test("the same alert is not repeated within 3 days, but can come back after", () => {
  const soon = catalog({ "111": [660, 700, 690] }, [[promo("p1", ["111"], "bundle", 1000, { end: stamp(at(2026, 11, 14, 23, 59)) })], [], []]);
  let st = run(watch(), soon, at(2026, 11, 11, 9)).state; // baseline (ending is > 48 h away)
  const r1 = run(st, soon, at(2026, 11, 13, 9)); // ends in 38 h
  assert.deepEqual(kinds(r1), ["ending"]);
  const r2 = run(r1.state, soon, at(2026, 11, 13, 15)); // later the same day: deduplicated
  assert.deepEqual(r2.fresh, []);
  // the dedupe memory expires after 3 days
  const old = { ...r1.state, sent: Object.fromEntries(Object.entries(r1.state.sent).map(([k, t]) => [k, t - 3 * 86_400_000 - 1])) };
  assert.deepEqual(kinds(run(old, soon, at(2026, 11, 13, 16))), ["ending"]);
});

test("dedupe also holds for drops that come back", () => {
  const s1 = run(watch(), base, day1).state;
  const r1 = run(s1, catalog({ "111": [600, 700, 690] }), day2);
  assert.deepEqual(kinds(r1), ["drop"]);
  const up = run(r1.state, base, at(2026, 11, 12, 9)).state;
  const r3 = run(up, catalog({ "111": [600, 700, 690] }), at(2026, 11, 13, 9)); // dropped again, 2 days later
  assert.deepEqual(r3.fresh, []);
});

test("usual basket: cheapest total dropping by 5% or 15 ₪ alerts", () => {
  const cart = { "111": 2, "222": 3 };
  const st = watch({ followed: [], usual: cart, usualAt: 1 });
  const s1 = run(st, base, day1).state;
  assert.ok(s1.history.days[0].b);
  const cheaper = catalog({ "111": [600, 700, 690], "222": [450, 390, 400] }); // A: 2*600+3*450 = 2550 vs 2670 (-4.5%, -1.20 ₪)
  assert.deepEqual(run(s1, cheaper, day2).fresh, []);
  const much = catalog({ "111": [660, 500, 690], "222": [450, 300, 400] }); // B, the cheapest, drops from 2570 to 1900
  const r = run(s1, much, day2);
  assert.deepEqual(kinds(r), ["basket"]);
  assert.match(r.fresh[0].body, /^הסל הרגיל: 19\.00 ₪ בשופרסל, ירד מ־25\.70$/);
});

test("usual basket: a different branch becoming cheapest alerts, and tiny flips do not", () => {
  const cart = { "111": 1, "222": 1 };
  const st = watch({ followed: [], usual: cart, usualAt: 1 });
  const c1 = catalog({ "111": [660, 700, 690], "222": [450, 390, 400] }); // A 1110, B 1090, C 1090 -> B wins (stable sort: B first)
  const s1 = run(st, c1, day1).state;
  const flipC = catalog({ "111": [660, 700, 690], "222": [450, 400, 300] }); // C 990 beats B 1100 by 1.10 ₪
  const r = run(s1, flipC, day2);
  assert.deepEqual(kinds(r), ["basket"]);
  assert.match(r.fresh[0].body, /עכשיו הכי זול ביוחננוף/);
  assert.match(r.fresh[0].body, /במקום שופרסל/);
  const tiny = catalog({ "111": [660, 700, 690], "222": [450, 400, 389] }); // C 1079 vs B 1100: 21 agorot, but a flip needs a full shekel
  assert.deepEqual(run(s1, tiny, day2).fresh, []);
});

test("usual basket: editing the basket is a new baseline, not a price drop", () => {
  const st = watch({ followed: [], usual: { "111": 1, "222": 1 }, usualAt: 1 });
  const s1 = run(st, base, day1).state;
  const edited = { ...s1, usual: { "111": 1 } };
  assert.deepEqual(run(edited, base, day2).fresh, []);
});

test("usual basket: items with a promo ending soon are mentioned", () => {
  const st = watch({ followed: [], usual: { "222": 2 }, usualAt: 1 });
  const c = catalog({ "222": [450, 390, 400] }, [[promo("b1", ["222"], "price", 300, { end: stamp(at(2026, 11, 12, 23, 59)) })], [], []]);
  const r = run(st, c, at(2026, 11, 11, 9)); // ends in 39 h: alerts even on the first run
  assert.deepEqual(kinds(r), ["ending"]);
  assert.match(r.fresh[0].body, /מהסל הרגיל/);
  assert.deepEqual(run(r.state, c, at(2026, 11, 12, 9)).fresh, []); // not again the next morning
});

test("weekly digest: top 5 changes, once a week, on the chosen weekday", () => {
  const st = watch({ followed: ["111", "222", "333"], settings: { ...DEFAULT_SETTINGS, on: true, rules: { ...DEFAULT_SETTINGS.rules, digest: true } } });
  const week1 = at(2026, 11, 6, 9); // Friday
  const s1 = run(st, catalog({ "111": [660, 700, 690], "222": [450, 390, 400], "333": [1200, 1100, 1150] }), week1).state;
  const fri = at(2026, 11, 13, 9); // Friday a week later
  assert.equal(new Date(fri).getDay(), 5);
  const r = run(s1, catalog({ "111": [600, 700, 690], "222": [450, 390, 400], "333": [1200, 1100, 1150] }, [[], [promo("d", ["333"], "percent", 20)], []]), fri);
  const d = r.fresh.find(a => a.kind === "digest")!;
  assert.ok(d);
  assert.equal(d.title, "הדילים הטובים של השבוע");
  const lines = d.body.split("\n");
  assert.ok(lines.length >= 1 && lines.length <= 5);
  assert.match(d.body, /חלב תנובה/);
  assert.match(d.body, /שמן קנולה/);
  assert.notEqual(r.state.lastDigest, null);
  // not again the next day
  const again = run(r.state, catalog({ "111": [590, 700, 690] }), at(2026, 11, 14, 9));
  assert.ok(!again.fresh.some(a => a.kind === "digest"));
});

test("digestDue: weekday match, minimum gap, catch-up after a missed week", () => {
  const fri = at(2026, 11, 13, 9), sat = at(2026, 11, 14, 9), tue = at(2026, 11, 17, 9);
  assert.equal(digestDue(fri, null, 5), true);
  assert.equal(digestDue(sat, null, 5), false);
  assert.equal(digestDue(fri, fri - 2 * 86_400_000, 5), false);
  assert.equal(digestDue(tue, tue - 9 * 86_400_000, 5), true); // missed Friday: next run catches up
});

test("quiet hours: 22:00-07:00 wraps midnight and can be turned off", () => {
  const s = { quiet: true, quietFrom: 22 * 60, quietTo: 7 * 60 };
  assert.equal(inQuietHours(at(2026, 11, 12, 22, 0), s), true);
  assert.equal(inQuietHours(at(2026, 11, 12, 23, 30), s), true);
  assert.equal(inQuietHours(at(2026, 11, 12, 3, 0), s), true);
  assert.equal(inQuietHours(at(2026, 11, 12, 6, 59), s), true);
  assert.equal(inQuietHours(at(2026, 11, 12, 7, 0), s), false);
  assert.equal(inQuietHours(at(2026, 11, 12, 21, 59), s), false);
  assert.equal(inQuietHours(at(2026, 11, 12, 23, 0), { ...s, quiet: false }), false);
  assert.equal(inQuietHours(at(2026, 11, 12, 10, 0), { quiet: true, quietFrom: 9 * 60, quietTo: 12 * 60 }), true); // same-day window
});

const item = (id: string, score: number, at_: number, over: Partial<InboxItem> = {}): InboxItem => ({ id, kind: "drop", at: at_, title: "ירידת מחיר", body: id, score, read: false, notified: false, ...over });
const ON: Settings = { ...DEFAULT_SETTINGS, on: true };

test("quiet hours hold notifications back; they go out at the next allowed run, and the inbox still has them", () => {
  const night = at(2026, 11, 12, 23, 0);
  const inbox = [item("a", 50, night)];
  const held = pickNotifications(inbox, night, ON);
  assert.deepEqual(held.send, []);
  assert.equal(held.inbox[0].notified, false);
  const morning = pickNotifications(held.inbox, at(2026, 11, 13, 7, 30), ON);
  assert.deepEqual(morning.send.map(x => x.id), ["a"]);
  assert.equal(morning.inbox[0].notified, true);
});

test("held-back alerts older than 24 hours are dropped, not sent", () => {
  const r = pickNotifications([item("a", 50, at(2026, 11, 11, 20, 0))], at(2026, 11, 12, 21, 0), ON);
  assert.deepEqual(r.send, []);
  assert.equal(r.inbox[0].notified, true);
});

test("rate limit: at most 3 per run; the best two plus a summary", () => {
  const now = at(2026, 11, 12, 10, 0);
  const inbox = [10, 90, 50, 70, 30, 60].map((sc, k) => item(`i${sc}`, sc, now - k));
  const r = pickNotifications(inbox, now, ON);
  assert.equal(r.send.length, 3);
  assert.deepEqual(r.send.slice(0, 2).map(x => x.id), ["i90", "i70"]);
  assert.match(r.send[2].body, /ועוד 4 עדכונים/);
  assert.ok(r.inbox.every(x => x.notified));
  // exactly 3 go out as they are
  const r3 = pickNotifications(inbox.slice(0, 3), now, ON);
  assert.equal(r3.send.length, 3);
  assert.ok(!r3.send.some(x => x.id.startsWith("more")));
  // nothing is re-sent
  assert.deepEqual(pickNotifications(r.inbox, now, ON).send, []);
});

test("notifications off: nothing is sent, the inbox is untouched", () => {
  const now = at(2026, 11, 12, 10, 0);
  const r = pickNotifications([item("a", 50, now)], now, { ...ON, on: false });
  assert.deepEqual(r.send, []);
  assert.equal(r.inbox[0].notified, false);
});

test("end to end: a promo found at night waits for the morning", () => {
  const s1 = run(watch(), base, at(2026, 11, 11, 9)).state;
  const promoCat = catalog({ "111": [660, 700, 690] }, [[promo("p1", ["111"], "price", 590)], [], []]);
  const night = run(s1, promoCat, at(2026, 11, 11, 23, 30));
  assert.deepEqual(night.send, []);
  assert.equal(night.state.inbox.length, 1);
  const morning = run(night.state, promoCat, at(2026, 11, 12, 7, 30));
  assert.equal(morning.send.length, 1);
  assert.equal(morning.fresh.length, 0);
});

test("mergeInbox: newest first, no duplicates, 30 days, capped", () => {
  const now = at(2026, 11, 12, 10, 0);
  const mk = (id: string, t: number): AlertItem => ({ id, kind: "drop", at: t, title: "t", body: "b", score: 1 });
  let inbox = mergeInbox([], [mk("a", now - 5 * 86_400_000), mk("b", now)], now);
  assert.deepEqual(inbox.map(x => x.id), ["b", "a"]);
  inbox = mergeInbox(inbox, [mk("a", now), mk("c", now + 1)], now);
  assert.deepEqual(inbox.map(x => x.id), ["c", "b", "a"]);
  inbox = mergeInbox(inbox, [], now + 40 * 86_400_000);
  assert.equal(inbox.length, 0);
  const many = mergeInbox([], Array.from({ length: 100 }, (_, k) => mk(`x${k}`, now - k)), now);
  assert.equal(many.length, 60);
});

test("silent run records history without producing alerts", () => {
  const s1 = run(watch(), base, day1).state;
  const r = runCheck(s1, { catalog: catalog({ "111": [500, 700, 690] }), off: [], club: {}, now: day2 }, true);
  assert.deepEqual(r.fresh, []);
  assert.equal(r.state.history.days.length, 2);
});

test("nothing watched: nothing recorded", () => {
  const r = run(watch({ followed: [] }), base, day1);
  assert.equal(r.state.history.days.length, 0);
});

test("helpers: short names, hours, settings merge", () => {
  assert.equal(shortName("חלב"), "חלב");
  assert.ok(shortName("חלב תנובה טרי 3% שומן במארז משפחתי גדול מאוד").endsWith("…"));
  assert.ok(shortName("חלב תנובה טרי 3% שומן במארז משפחתי גדול מאוד").length <= 35);
  assert.equal(whenText(at(2026, 11, 12, 23, 59), at(2026, 11, 12, 9)), "היום ב־23:59");
  assert.equal(whenText(at(2026, 11, 14, 8, 5), at(2026, 11, 12, 9)), "ב־14.11 ב־08:05");
  const m = mergeSettings({ dropPct: 8, rules: { promo: false } as Settings["rules"] });
  assert.equal(m.dropPct, 8);
  assert.equal(m.rules.promo, false);
  assert.equal(m.rules.drop, true);
  assert.equal(m.quietFrom, 22 * 60);
});
