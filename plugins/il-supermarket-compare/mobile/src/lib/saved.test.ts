import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanName, mergeCarts, uniqueName } from "./saved.ts";
import { barcodeVariants, findByBarcode } from "./barcode.ts";
import type { Product } from "./types.ts";

test("merging carts adds quantities", () => {
  assert.deepEqual(mergeCarts({ a: 1, b: 0.5 }, { b: 1, c: 2 }), { a: 1, b: 1.5, c: 2 });
});

test("names are trimmed, capped and made unique", () => {
  assert.equal(cleanName("   קנייה   שבועית ", "x"), "קנייה שבועית");
  assert.equal(cleanName("  ", "ללא שם"), "ללא שם");
  const l = [{ id: "1", name: "שבועי", items: {}, at: 0 }, { id: "2", name: "שבועי 2", items: {}, at: 0 }];
  assert.equal(uniqueName("שבועי", l), "שבועי 3");
  assert.equal(uniqueName("שבועי", l, "1"), "שבועי");
  assert.equal(uniqueName("חדש", l), "חדש");
});

test("barcodes match across UPC-A / EAN-13 forms", () => {
  const mk = (code: string) => [code, { code } as Product] as const;
  const ps = new Map([mk("7290004131074"), mk("036000291452"), mk("96385074")]);
  assert.equal(findByBarcode(ps, "7290004131074")?.code, "7290004131074");
  assert.equal(findByBarcode(ps, "0036000291452")?.code, "036000291452");
  assert.equal(findByBarcode(ps, "36000291452")?.code, "036000291452");
  assert.equal(findByBarcode(ps, "96385074")?.code, "96385074");
  assert.equal(findByBarcode(ps, "1234567890128"), null);
  assert.deepEqual(barcodeVariants("abc"), []);
});
