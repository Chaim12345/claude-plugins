import { test } from "node:test";
import assert from "node:assert/strict";
import { CART_HEADER, cleanItemName, formatCart, formatItem, formatProduct, itemLines, type ShareLine } from "./shareText.ts";
import { parseList } from "./listparse.ts";
import { compare, makeDeals, toProducts } from "./compare.ts";
import type { Catalog } from "./types.ts";

test("items read like a shopping list", () => {
  assert.equal(formatItem({ name: "חלב 3% תנובה", qty: 2, weighted: false }), "חלב 3% תנובה ×2");
  assert.equal(formatItem({ name: "עגבניות", qty: 1.5, weighted: true }), "1.5 ק״ג עגבניות");
  assert.equal(formatItem({ name: "לימון", qty: 2, weighted: true }), "2 ק״ג לימון");
});

test("names are made safe for the list parser", () => {
  assert.equal(cleanItemName("חלב, 3% ; תנובה"), "חלב 3% תנובה");
  assert.equal(cleanItemName("עגבניות שרי ק\"ג", true), "עגבניות שרי");
  assert.equal(cleanItemName("* גבינה + זיתים"), "גבינה זיתים");
  assert.equal(cleanItemName("  "), "");
});

const lines: ShareLine[] = [
  { name: "חלב 3% תנובה 1 ליטר", qty: 2, weighted: false },
  { name: "במבה אוסם 80 גרם", qty: 3, weighted: false },
  { name: "7 אפ זירו", qty: 1, weighted: false },
  { name: "ביצים M 12 יח'", qty: 1, weighted: false },
  { name: "לחם אחיד פרוס", qty: 1, weighted: false },
  { name: "עגבניות", qty: 1.5, weighted: true },
  { name: "בננה", qty: 0.5, weighted: true },
];
const best = { chain: "רמי לוי", branch: "ביאליק רמת גן", total: 12340, missing: 2 };

test("a shared cart round-trips through the paste-list parser", () => {
  const text = formatCart(lines, best, { link: "https://example.org/salzol", priceDate: "12.11.2026" });
  const parsed = parseList(itemLines(text));
  assert.equal(parsed.length, lines.length);
  parsed.forEach((p, k) => {
    const l = lines[k];
    if (l.weighted) {
      assert.equal(p.kg, l.qty, l.name);
      assert.equal(p.count, null, l.name);
    } else {
      assert.equal(p.count, l.qty, l.name);
      assert.equal(p.kg, null, l.name);
    }
  });
  // the item itself is what's left once quantity and size words are taken out
  assert.deepEqual(parsed.map(p => p.text), ["חלב 3% תנובה", "במבה אוסם", "7 אפ זירו", "ביצים m", "לחם אחיד פרוס", "עגבניות", "בננה"]);
  // size words stay available as hints for the matcher
  assert.equal(parsed[0].ml, 1000);
  assert.equal(parsed[1].grams, 80);
});

test("the cheapest-branch line and the app line never become items", () => {
  const text = formatCart(lines, best, { link: "https://example.org/salzol" });
  assert.ok(text.startsWith(CART_HEADER + "\nחלב 3% תנובה 1 ליטר ×2\n"));
  assert.ok(text.includes("💰 הכי זול: רמי לוי, ביאליק רמת גן · 123.40 ₪"));
  assert.ok(text.includes("⚠ חסרים בסניף הזה: 2 פריטים"));
  assert.ok(text.endsWith("סל זול · השוואת מחירי סופר לפי המחירונים הרשמיים · https://example.org/salzol"));
  assert.equal(itemLines(text).split("\n").length, lines.length);
  // no best branch: just the list and the app line
  assert.equal(formatCart(lines.slice(0, 1), null), `${CART_HEADER}\nחלב 3% תנובה 1 ליטר ×2\n\nסל זול · השוואת מחירי סופר לפי המחירונים הרשמיים`);
});

test("text that isn't a shared cart is left alone", () => {
  const plain = "חלב\nלחם\nביצים";
  assert.equal(itemLines(plain), plain);
  assert.equal(itemLines(""), "");
});

test("the shared text survives chat apps: Windows line ends, direction marks, a trailing note", () => {
  const text = formatCart(lines, best, {}).replace(/\n/g, "\r\n");
  const marked = text.split("\r\n").map(l => `‏${l}‏`).join("\r\n") + "\r\nשלחו לי בבקשה";
  assert.equal(parseList(itemLines(marked)).length, lines.length);
});

test("real cart in, same cart out", () => {
  const cat: Catalog = {
    priceDate: "2026-11-12", generatedAt: "", skipped: [], categories: [],
    areas: [{ name: "x", lat: 32.08, lon: 34.81 }],
    stores: ["A", "B"].map((c, i) => ({ id: `${c}:${i}`, chain: c, branch: "", address: "", lat: 32.08, lon: 34.81, approx: false })),
    products: [
      ["111", "חלב 3% תנובה 1 ליטר", "dairy", 0, [700, 650], null, null],
      ["333", "עגבניות", "produce", 1, [900, 800], null, null],
    ],
  };
  const products = toProducts(cat);
  const cart = { "111": 2, "333": 1.5 };
  const cmp = compare(products, cart, [0, 1], makeDeals(cat));
  const shareLines = cmp.items.map(([p, q]) => ({ name: p.name, qty: q, weighted: p.weighted }));
  const parsed = parseList(itemLines(formatCart(shareLines, { chain: "B", branch: "", total: cmp.rows[0].total, missing: 0 })));
  assert.deepEqual(parsed.map(p => [p.text, p.count, p.kg]), [["חלב 3% תנובה", 2, null], ["עגבניות", null, 1.5]]);
});

test("one product's best price", () => {
  const t = formatProduct({ name: "חלב 3% תנובה", chain: "רמי לוי", branch: "ביאליק", price: 650, highest: 720, branches: 5, weighted: false, deal: { chain: "שופרסל", text: "2 ב־12.00 ₪" } }, { link: "https://x" });
  assert.equal(t, [
    "🏷 חלב 3% תנובה",
    "💰 הכי זול: 6.50 ₪ ברמי לוי (ביאליק)",
    "📊 ב־5 סניפים: 6.50 עד 7.20 ₪, פער של 0.70 ₪",
    "🔖 מבצע בשופרסל: 2 ב־12.00 ₪",
    "סל זול · השוואת מחירי סופר לפי המחירונים הרשמיים · https://x",
  ].join("\n"));
  const w = formatProduct({ name: "עגבניות", chain: "A", branch: "", price: 800, highest: 800, branches: 1, weighted: true });
  assert.equal(w, "🏷 עגבניות\n💰 הכי זול: 8.00 ₪ לק״ג בA\nסל זול · השוואת מחירי סופר לפי המחירונים הרשמיים");
});

test("awkward real product names keep their count (fractions, trailing plus, leading digits)", () => {
  for (const name of ["חצי בגט", "רבע לשבע טורטית לבנה 120 גר", "תחבושת קוטקס נורמל 26 יחידות +", "7 אפ זירו", "קולה 1.5 ליטר"]) {
    const parsed = parseList(itemLines(formatCart([{ name, qty: 3, weighted: false }], null)));
    assert.equal(parsed.length, 1, name);
    assert.equal(parsed[0].count, 3, name);
  }
});
