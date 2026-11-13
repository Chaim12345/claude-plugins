// Geometry and data shaping for the branch map. Pure: no React, no native code, so it runs under `node --test`.
import { km as haversineKm, money, type Comparison } from "./compare.ts";
import type { Catalog } from "./types.ts";

export type LatLon = { lat: number; lon: number };
/** [west, south, east, north] in degrees, the order MapLibre uses for bounds. */
export type Bounds = [number, number, number, number];

/** Free OpenFreeMap vector style: no API key, no sign-up (https://openfreemap.org/). */
export const OPENFREEMAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";
/**
 * OpenFreeMap's attribution wording ("OpenFreeMap © OpenMapTiles Data from OpenStreetMap"). MapLibre also
 * shows its own attribution button on the map; this line is shown under it, always visible.
 */
export const MAP_ATTRIBUTION = "OpenFreeMap © OpenMapTiles Data from OpenStreetMap";

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

export const distanceKm = (a: LatLon, b: LatLon) => haversineKm(a.lat, a.lon, b.lat, b.lon);

/** Initial compass bearing from a to b, in degrees clockwise from north: [0, 360). */
export function bearingDeg(a: LatLon, b: LatLon): number {
  const p1 = rad(a.lat), p2 = rad(b.lat), dl = rad(b.lon - a.lon);
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

/** 0 = north, 1 = north-east, ... 7 = north-west. */
export const compassIndex = (bearing: number) => Math.round((((bearing % 360) + 360) % 360) / 45) % 8;

/** The smallest box holding every point, or null for none. */
export function boundsOf(points: LatLon[]): Bounds | null {
  if (!points.length) return null;
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const p of points) {
    if (p.lon < w) w = p.lon;
    if (p.lon > e) e = p.lon;
    if (p.lat < s) s = p.lat;
    if (p.lat > n) n = p.lat;
  }
  return [w, s, e, n];
}

/** Grows a box by a fraction of its size on every side, and to at least minSpan degrees (so one pin doesn't zoom to the roof). */
export function padBounds(b: Bounds, frac = 0.15, minSpan = 0.01): Bounds {
  const [w, s, e, n] = b;
  const dx = Math.max((e - w) * frac, (minSpan - (e - w)) / 2, 0);
  const dy = Math.max((n - s) * frac, (minSpan - (n - s)) / 2, 0);
  return [w - dx, s - dy, e + dx, n + dy];
}

// Web-mercator helpers. MapLibre draws 512 px tiles: the world is 512 * 2^zoom px wide.
const TILE = 512;
const mercY = (lat: number) => 0.5 - Math.log(Math.tan(Math.PI / 4 + rad(Math.max(-85, Math.min(85, lat))) / 2)) / (2 * Math.PI);
const latFromMercY = (y: number) => deg(2 * Math.atan(Math.exp((0.5 - y) * 2 * Math.PI)) - Math.PI / 2);

export type View = { center: [number, number]; zoom: number };

/** Centre and zoom that show the whole box inside a width x height pixel view with `padding` px around it. */
export function fitView(b: Bounds, width: number, height: number, padding = 48, maxZoom = 16, minZoom = 2): View {
  const [w, s, e, n] = b;
  const dx = Math.max((e - w) / 360, 1e-9);
  const dy = Math.max(Math.abs(mercY(s) - mercY(n)), 1e-9);
  const zx = Math.log2(Math.max(width - 2 * padding, 1) / (TILE * dx));
  const zy = Math.log2(Math.max(height - 2 * padding, 1) / (TILE * dy));
  const zoom = Math.max(minZoom, Math.min(maxZoom, zx, zy));
  return { center: [(w + e) / 2, latFromMercY((mercY(s) + mercY(n)) / 2)], zoom };
}

// ---- Navigation --------------------------------------------------------------------------

export type NavApp = "waze" | "google" | "apple";
export type NavLink = { app: NavApp; url: string };

const c6 = (x: number) => x.toFixed(6);

/**
 * Links that open turn-by-turn navigation to a point, or to an address when the branch has no coordinates.
 * https only, so no app has to be queried first (iOS) and a browser can still show them.
 */
export function navLinks(to: LatLon | string, os: "ios" | "android" | "web" = "android"): NavLink[] {
  const at = typeof to === "string" ? encodeURIComponent(to) : `${c6(to.lat)},${c6(to.lon)}`;
  const out: NavLink[] = [
    { app: "waze", url: typeof to === "string" ? `https://waze.com/ul?q=${at}&navigate=yes` : `https://waze.com/ul?ll=${at}&navigate=yes` },
    { app: "google", url: `https://www.google.com/maps/dir/?api=1&destination=${at}&travelmode=driving` },
  ];
  if (os === "ios") out.push({ app: "apple", url: `https://maps.apple.com/?daddr=${at}&dirflg=d` });
  return out;
}

/** Round-trip drive cost, in shekels, for a one-way distance in km. */
export const tripCost = (oneWayKm: number, perKm: number) => 2 * oneWayKm * perKm;

// ---- Pins --------------------------------------------------------------------------------

export type Pin = {
  i: number; // index in catalog.stores
  id: string;
  chain: string;
  branch: string;
  address: string;
  lat: number | null;
  lon: number | null;
  approx: boolean; // coordinates are only city-level
  km: number | null; // straight line from the user's place
  bearing: number | null;
  total: number | null; // agorot, the cart at this branch; null when the cart is empty
  missing: string[]; // cart items this branch doesn't sell
  rank: number | null; // 0 = best in the comparison
  cheapest: boolean;
  label: string; // pin text: the cart total ("123.40"), or the chain when there's no cart
};

/**
 * One pin per compared branch, best first (cart total, fewest missing items first, as in the basket
 * comparison), or nearest first when the cart is empty. Branches without coordinates are kept (the
 * list shows them) with lat/lon null.
 */
export function buildPins(catalog: Catalog, comparison: Comparison | null, active: number[], origin: LatLon | null): Pin[] {
  const rowOf = new Map(comparison?.rows.map((r, k) => [r.i, { r, k }] as const));
  const pins: Pin[] = active.map(i => {
    const s = catalog.stores[i];
    const here = s.lat != null && s.lon != null ? { lat: s.lat, lon: s.lon } : null;
    const row = rowOf.get(i);
    return {
      i, id: s.id, chain: s.chain, branch: s.branch, address: s.address,
      lat: here?.lat ?? null, lon: here?.lon ?? null, approx: s.approx,
      km: origin && here ? distanceKm(origin, here) : null,
      bearing: origin && here ? bearingDeg(origin, here) : null,
      total: row ? row.r.total : null,
      missing: row ? row.r.missing : [],
      rank: row ? row.k : null,
      cheapest: !!row && row.k === 0,
      label: row ? money(row.r.total) : s.chain,
    };
  });
  const far = Number.POSITIVE_INFINITY;
  pins.sort((a, b) => (a.rank ?? far) - (b.rank ?? far) || (a.km ?? far) - (b.km ?? far));
  return pins;
}

export const hasCoords = (p: Pin): p is Pin & { lat: number; lon: number } => p.lat != null && p.lon != null;

/** Extra driving cost (shekels) of going to this branch instead of the nearest one, round trip; 0 for the nearest. */
export function extraTrip(p: Pin, pins: Pin[], perKm: number): number {
  const kms = pins.map(x => x.km).filter((x): x is number => x != null);
  if (p.km == null || !kms.length) return 0;
  return Math.max(0, tripCost(p.km - Math.min(...kms), perKm));
}
