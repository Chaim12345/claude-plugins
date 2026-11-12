// Barcode lookup: a scanner may report a UPC-A as EAN-13 with a leading zero, or the reverse.
import type { Product } from "./types";

export function barcodeVariants(data: string): string[] {
  const d = data.replace(/\D/g, "");
  if (!d) return [];
  const out = new Set<string>([d]);
  const stripped = d.replace(/^0+/, "");
  if (stripped) {
    out.add(stripped);
    for (const n of [8, 12, 13, 14]) if (stripped.length <= n) out.add(stripped.padStart(n, "0"));
  }
  return [...out];
}

export function findByBarcode(products: Map<string, Product>, data: string): Product | null {
  for (const v of barcodeVariants(data)) {
    const p = products.get(v);
    if (p) return p;
  }
  return null;
}
