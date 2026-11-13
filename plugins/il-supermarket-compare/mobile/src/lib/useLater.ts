// Work that can wait a frame: the screen renders first, then these run in their own tasks, so a
// tap or a key press is never stuck behind a second of number crunching.
import { useEffect, useState } from "react";
import { cachedFeed, dealFeedAsync } from "./feed";
import type { DealItem } from "./dealsFeed";
import type { Catalog, Product } from "./types";

/** compute() after the first paint (and again, deferred, when deps change); `initial` until then. */
export function useLater<T>(compute: () => T, deps: unknown[], initial: T): T {
  const [v, setV] = useState<T>(initial);
  useEffect(() => {
    let live = true;
    const id = setTimeout(() => { if (live) setV(compute()); }, 0);
    return () => { live = false; clearTimeout(id); };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return v;
}

/** The deals feed, built in slices in the background; null until ready (instant when another screen built it). */
export function useDealFeed(catalog: Catalog | null, products: Map<string, Product>, active: number[], club: Record<string, boolean>): { items: DealItem[]; now: number } | null {
  const cached = catalog?.promos ? cachedFeed(catalog, active, club) : null;
  const [got, setGot] = useState<{ catalog: Catalog; f: { items: DealItem[]; now: number } } | null>(null);
  useEffect(() => {
    if (!catalog?.promos || cachedFeed(catalog, active, club)) return;
    let live = true;
    dealFeedAsync(catalog, products, active, club).then(f => { if (live) setGot({ catalog, f }); }, () => {});
    return () => { live = false; };
  }, [catalog, products, active, club]);
  // while another branch selection is being built, the last feed of the same catalog stays on screen;
  // a feed of another catalog (other branch numbering) never does
  return cached ?? (got && got.catalog === catalog ? got.f : null);
}
