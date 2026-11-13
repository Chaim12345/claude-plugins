import { test } from "node:test";
import assert from "node:assert/strict";
import { applyVerdicts, batches, groups, pending, prompt, prune, readAnswer, stats, verdictKey, type Verdicts } from "./aicheck.ts";
import type { DealItem } from "./dealsFeed.ts";
import { DEFAULT_CONFIG, LlmError, chat, endpoint, errorOf, listModels, parseJsonLoose, usable, validBaseUrl } from "./llm.ts";

const NOW = Date.UTC(2026, 10, 13, 10);
const DAY = 86_400_000;
let n = 0;
const deal = (o: Partial<DealItem> & { promoId?: string; desc?: string; name?: string } = {}): DealItem => {
  const code = o.code ?? `c${++n}`;
  return {
    id: `${o.chain ?? "A"}|${o.promoId ?? "p1"}|${code}`, code, chain: "A", chainLabel: "רשת א",
    product: { code, name: o.name ?? `מוצר ${code}`, cat: "snacks", weighted: false, prices: [500], names: null, img: null, meta: { maker: "אסם" } } as unknown as DealItem["product"],
    promo: { id: o.promoId ?? "p1", codes: [code, "x"], minQty: 1, kind: "price", value: 400, club: false, desc: o.desc ?? "מגוון חטיפים" },
    stores: [0], rep: 0, qty: 1, unit: 400, shelf: 500, cheapest: 500, cheapestAt: 0, comparedStores: 2, savePct: 20, saveAgorot: 100, realPct: 20, realAgorot: 100,
    verdict: "real", club: false, clubOwned: false, endMs: NOW + 5 * DAY, unitPrice: null, shelfUnitPrice: null, max: null,
    confidence: "check", checkKind: "words", why: "נוסח המבצע", ...o,
  } as DealItem;
};

test("pending: only flagged deals a model can settle, without a live answer", () => {
  const a = deal(), b = deal({ checkKind: "deep" }), c = deal({ confidence: "ok", checkKind: undefined }), d = deal({ checkKind: "spread" }), e = deal();
  const v: Verdicts = { [verdictKey(e)]: ["yes", NOW + DAY] };
  assert.deepEqual(pending([a, b, c, d, e], v, NOW).map(x => x.code), [a.code, d.code]);
  // an expired answer is asked again
  assert.equal(pending([e], { [verdictKey(e)]: ["yes", NOW - 1] }, NOW).length, 1);
});

test("groups per chain and promotion, split at 40 products, batches by size", () => {
  const many = Array.from({ length: 45 }, () => deal({ promoId: "big" }));
  const other = deal({ promoId: "p2", chain: "B" });
  const gs = groups([...many, other], NOW);
  assert.equal(gs.length, 3);
  assert.deepEqual(gs.map(g => g.items.length), [40, 5, 1]);
  assert.equal(gs[2].id, "B|p2");
  assert.equal(gs[0].end, NOW + 5 * DAY);
  const bs = batches(gs, 600);
  assert.ok(bs.length >= 2);
  assert.equal(bs.flat().length, 3); // nothing lost
  assert.equal(batches(gs, 1e9).length, 1);
});

test("prompt lists promotions as P1.. with numbered products, maker included", () => {
  const gs = groups([deal({ name: "במבה 80 גרם", desc: "במבה ב-10" }), deal({ promoId: "p9", desc: "מגוון יוגורט" })], NOW);
  const m = prompt(gs);
  assert.equal(m[0].role, "system");
  assert.match(m[1].content, /P1 \[רשת א\] «במבה ב-10»\n  1\. במבה 80 גרם \(אסם\)/);
  assert.match(m[1].content, /P2 \[רשת א\] «מגוון יוגורט»/);
});

test("readAnswer: maps numbers back, skipped products become unclear for a day, junk ignored", () => {
  const a = deal({ promoId: "q" }), b = deal({ promoId: "q" }), c = deal({ promoId: "q" }), d = deal({ promoId: "r" });
  const gs = groups([a, b, c, d], NOW);
  const v = readAnswer(gs, { P1: { yes: [1, 9, "x"], no: [2], unclear: [] }, P2: { no: [1] } }, NOW);
  assert.deepEqual(v[verdictKey(a)], ["yes", NOW + 5 * DAY]);
  assert.deepEqual(v[verdictKey(b)], ["no", NOW + 5 * DAY]);
  assert.deepEqual(v[verdictKey(c)], ["unclear", NOW + DAY]); // skipped
  assert.equal(v[verdictKey(d)][0], "no");
  // not JSON at all: everything unclear, asked again tomorrow
  const none = readAnswer(gs, null, NOW);
  assert.ok(Object.values(none).every(([x, t]) => x === "unclear" && t === NOW + DAY));
  // in two lists: yes wins
  assert.equal(readAnswer(gs, { P1: { yes: [1], no: [1] } }, NOW)[verdictKey(a)][0], "yes");
});

test("applyVerdicts: yes clears the warning, no hides, unclear keeps it; deep discounts stay flagged", () => {
  const yes = deal(), no = deal(), unc = deal(), deep = deal({ realPct: 75 }), plain = deal({ confidence: "ok", checkKind: undefined });
  const until = NOW + DAY;
  const v: Verdicts = { [verdictKey(yes)]: ["yes", until], [verdictKey(no)]: ["no", until], [verdictKey(unc)]: ["unclear", until], [verdictKey(deep)]: ["yes", until] };
  const out = applyVerdicts([yes, no, unc, deep, plain], v, NOW);
  assert.deepEqual(out.map(d => d.code), [yes.code, unc.code, deep.code, plain.code]);
  assert.equal(out[0].confidence, "ok"); assert.equal(out[0].ai, "yes"); assert.equal(out[0].why, undefined);
  assert.equal(out[1].confidence, "check"); assert.equal(out[1].ai, "unclear");
  assert.equal(out[2].confidence, "check"); assert.equal(out[2].checkKind, "deep");
  assert.equal(out[3], plain);
  // no answers: the same array (keeps memoised screens stable)
  const items = [yes, no];
  assert.equal(applyVerdicts(items, {}, NOW), items);
  // expired answers don't apply
  assert.equal(applyVerdicts(items, { [verdictKey(no)]: ["no", NOW - 1] }, NOW), items);
  assert.deepEqual(stats({ ...v, old: ["no", NOW - 1] }, NOW), { yes: 2, no: 1, unclear: 1 });
  assert.deepEqual(Object.keys(prune({ ...v, old: ["no", NOW - 1] }, NOW)).length, 4);
});

test("llm: config checks, URLs, loose JSON", () => {
  assert.equal(usable(DEFAULT_CONFIG), false);
  assert.equal(usable({ ...DEFAULT_CONFIG, on: true, key: "k" }), true);
  assert.equal(usable({ ...DEFAULT_CONFIG, on: true, key: "k", model: " " }), false);
  assert.equal(validBaseUrl("https://api.groq.com/openai/v1"), true);
  assert.equal(validBaseUrl("http://example.com/v1"), false);
  assert.equal(validBaseUrl("http://10.0.2.2:11434/v1"), true);
  assert.equal(endpoint("https://x/v1/", "/models"), "https://x/v1/models");
  assert.deepEqual(parseJsonLoose('```json\n{"P1":{"yes":[1]}}\n```'), { P1: { yes: [1] } });
  assert.deepEqual(parseJsonLoose('Sure! {"ok":true} hope it helps'), { ok: true });
  assert.equal(parseJsonLoose("no json here"), null);
});

test("llm: errors are classified, the key never echoed", () => {
  const e = errorOf(401, JSON.stringify({ error: { message: "API key not valid. key=AIzaSECRET" } }), null);
  assert.equal(e.kind, "auth");
  assert.ok(!e.message.includes("AIzaSECRET"));
  // Gemini wraps errors in an array
  const q = errorOf(429, JSON.stringify([{ error: { message: "Resource exhausted" } }]), "7");
  assert.equal(q.kind, "quota"); assert.equal(q.retryAfterMs, 7000); assert.match(q.message, /Resource exhausted/);
  assert.equal(errorOf(429, "", null).retryAfterMs, 20_000);
  assert.equal(errorOf(404, "", null).kind, "model");
  assert.equal(errorOf(503, "", null).kind, "network");
});

const cfg = { ...DEFAULT_CONFIG, on: true, key: "test-key" };
const fakeFetch = (status: number, body: unknown, seen: { url?: string; init?: RequestInit }[] = []) =>
  (async (url: string, init: RequestInit) => {
    seen.push({ url, init });
    return { ok: status < 400, status, text: async () => JSON.stringify(body), headers: { get: () => null } } as unknown as Response;
  }) as unknown as typeof fetch;

test("llm: chat posts an OpenAI-shaped request with a bearer key and reads the answer", async () => {
  const seen: { url?: string; init?: RequestInit }[] = [];
  const r = await chat(cfg, [{ role: "user", content: "hi" }], { fetch: fakeFetch(200, { choices: [{ message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 5, completion_tokens: 3 } }, seen) });
  assert.equal(r.text, '{"ok":true}'); assert.equal(r.tokensIn, 5);
  assert.equal(seen[0].url, "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
  assert.equal((seen[0].init!.headers as Record<string, string>).Authorization, "Bearer test-key");
  const body = JSON.parse(String(seen[0].init!.body));
  assert.equal(body.model, "gemini-flash-lite-latest"); assert.equal(body.temperature, 0);
  // content as parts
  assert.equal((await chat(cfg, [], { fetch: fakeFetch(200, { choices: [{ message: { content: [{ type: "text", text: "a" }, { text: "b" }] } }] }) })).text, "ab");
  await assert.rejects(chat(cfg, [], { fetch: fakeFetch(200, { choices: [{ message: { content: "" } }] }) }), LlmError);
  await assert.rejects(chat(cfg, [], { fetch: fakeFetch(401, { error: { message: "bad" } }) }), (e: LlmError) => e.kind === "auth");
});

test("llm: model list drops non-chat models and the models/ prefix, preferred first", async () => {
  const m = await listModels(cfg, { fetch: fakeFetch(200, { data: [{ id: "models/gemini-pro-x" }, { id: "models/text-embedding-004" }, { id: "models/gemini-flash-lite-latest" }, { id: "models/imagen-4" }] }) });
  assert.deepEqual(m, ["gemini-flash-lite-latest", "gemini-pro-x"]);
});
