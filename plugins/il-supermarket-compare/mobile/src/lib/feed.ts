// The deals feed is built from every promotion of every active branch: a few thousand items. Two
// screens show it (home and the deals tab), so it is built once per catalog / branch selection / club setting.
import { buildDeals, type DealItem } from "./dealsFeed";
import type { Catalog, Product } from "./types";

let last: { catalog: Catalog; key: string; items: DealItem[]; now: number } | null = null;

export function dealFeed(catalog: Catalog, products: Map<string, Product>, active: number[], club: Record<string, boolean>): { items: DealItem[]; now: number } {
  const key = `${active.join(",")}|${Object.keys(club).filter(k => club[k]).sort().join(",")}`;
  if (last && last.catalog === catalog && last.key === key) return last;
  const now = Date.now();
  last = { catalog, key, items: buildDeals(catalog, products, { active, club, now }), now };
  return last;
}
