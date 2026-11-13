// The deals feed is built from every promotion of every active branch: tens of thousands of items with
// the full catalog. Two screens show it (home and the deals tab), so it is built once per catalog /
// branch selection / club setting, and in slices between frames (buildDealsSteps), so building it never
// freezes the screen.
import { buildDeals, buildDealsSteps, type DealItem } from "./dealsFeed";
import type { Catalog, Product } from "./types";

type Feed = { items: DealItem[]; now: number };
let last: { catalog: Catalog; key: string; feed: Feed } | null = null;
let building: { catalog: Catalog; key: string; p: Promise<Feed> } | null = null;

const keyOf = (active: number[], club: Record<string, boolean>) => `${active.join(",")}|${Object.keys(club).filter(k => club[k]).sort().join(",")}`;

/** Built now, on this frame (tests, and callers that need it at once). */
export function dealFeed(catalog: Catalog, products: Map<string, Product>, active: number[], club: Record<string, boolean>): Feed {
  const key = keyOf(active, club);
  if (last && last.catalog === catalog && last.key === key) return last.feed;
  const now = Date.now();
  const feed = { items: buildDeals(catalog, products, { active, club, now }), now };
  last = { catalog, key, feed };
  return feed;
}

/** The feed if it is built already, else null. */
export function cachedFeed(catalog: Catalog, active: number[], club: Record<string, boolean>): Feed | null {
  const key = keyOf(active, club);
  return last && last.catalog === catalog && last.key === key ? last.feed : null;
}

/** Builds the feed in slices of about 12 ms, yielding to the screen in between. */
export function dealFeedAsync(catalog: Catalog, products: Map<string, Product>, active: number[], club: Record<string, boolean>): Promise<Feed> {
  const key = keyOf(active, club);
  const hit = cachedFeed(catalog, active, club);
  if (hit) return Promise.resolve(hit);
  if (building && building.catalog === catalog && building.key === key) return building.p;
  const now = Date.now();
  const g = buildDealsSteps(catalog, products, { active, club, now });
  const p = new Promise<Feed>((resolve, reject) => {
    const step = () => {
      try {
        const t0 = Date.now();
        let r = g.next();
        while (!r.done && Date.now() - t0 < 12) r = g.next();
        if (r.done) {
          const feed = { items: r.value, now };
          last = { catalog, key, feed };
          building = null;
          resolve(feed);
        } else setTimeout(step, 0);
      } catch (e) { building = null; reject(e); }
    };
    setTimeout(step, 0);
  });
  building = { catalog, key, p };
  return p;
}
