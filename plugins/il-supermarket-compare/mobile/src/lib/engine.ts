// Where prices come from. On a phone build with the Go library, everything runs on the device
// (the native module). On web and in Expo Go, the same calls go to a salzol server.
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import { Platform } from "react-native";
import Native from "../../modules/salzol-native";
import { parseDiscovery, type DiscoverResult } from "./discover";
import { dlog } from "./debuglog";
import { chooseCandidate, typedCity, withTimeout, type LatLon } from "./geo";
import type { Catalog, MoreResult, NearStore, Place, SyncEvent } from "./types";

/** A geocoded address and who answered: the phone's own geocoder, or OpenStreetMap services. */
export type Geocoded = LatLon & { source: "device" | "osm" };

export interface Engine {
  kind: "device" | "server";
  /** The catalog from the last sync, if any, without touching the network. */
  cached(place: Place | null): Promise<Catalog | null>;
  sync(place: Place | null, onEvent: (e: SyncEvent) => void): Promise<Catalog>;
  /**
   * Device engine only: adds the stores of chains whose portals refuse non-Israeli IPs to the
   * on-device directory (a quick no-op when nothing is due). Absent on the server engine, whose
   * directory the server maintains, and in native builds that predate it.
   */
  discover?(onEvent: (e: SyncEvent) => void): Promise<DiscoverResult>;
  nearby(lat: number, lon: number, radiusKm: number): Promise<NearStore[]>;
  geocode(address: string): Promise<Geocoded | null>;
  imageUrl(code: string): string | null;
  /** A second photo source when imageUrl fails (Open Food Facts via the Go core), or null. */
  fallbackImage(code: string): Promise<string | null>;
  /** Branches of other chains for these barcodes (server only, when it has an API token); null when unavailable. */
  more(place: Place, barcodes: string[]): Promise<MoreResult | null>;
}

/** Base URL of a salzol server: same origin on web, else EXPO_PUBLIC_SALZOL_URL (e.g. http://192.168.1.5:8080). */
function serverBase(): string {
  const env = process.env.EXPO_PUBLIC_SALZOL_URL;
  if (env) return env.replace(/\/$/, "");
  return Platform.OS === "web" ? "" : "http://localhost:8080";
}

async function json<T>(r: Response): Promise<T> {
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((body as { message?: string }).message || `HTTP ${r.status}`);
  return body as T;
}

const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));

/**
 * The phone's built-in geocoder (Android's Geocoder, iOS's CLGeocoder): free, no API key.
 * Returns its candidates, or [] when it can't help: location permission refused (Android requires
 * it for geocoding), or no geocoding backend on the device (phones without Google Play services
 * throw "Geocoder service is not available").
 */
async function osCandidates(address: string): Promise<LatLon[]> {
  try {
    const perm = await Location.getForegroundPermissionsAsync();
    if (Platform.OS === "android" && !perm.granted) {
      const asked = await Location.requestForegroundPermissionsAsync();
      if (!asked.granted) return [];
    }
    // The platform geocoder can hang (Google's geocoding service crashed on the CI emulator and the
    // call never returned): after 10 s the offline index and OpenStreetMap answer instead.
    const r = await withTimeout(Location.geocodeAsync(address), 10_000);
    if (r == null) dlog("geocode", "phone geocoder: no answer in 10 s");
    return (r ?? []).map(x => ({ lat: x.latitude, lon: x.longitude }));
  } catch (e) {
    dlog("geocode", "phone geocoder failed", String((e as Error)?.message ?? e));
    return [];
  }
}

const parse = (s: string) => JSON.parse(s) as { found: boolean; lat: number; lon: number };

function deviceEngine(): Engine {
  const m = Native!;
  return {
    kind: "device",
    async cached() {
      const s = await m.lastCatalog();
      return s ? (JSON.parse(s) as Catalog) : null;
    },
    async sync(place, onEvent) {
      if (!place) throw new Error("בחרו מיקום כדי להשוות סניפים");
      const sub = m.addListener("onSyncEvent", e => { try { onEvent(JSON.parse(e.json)); } catch { /* ignore malformed */ } });
      try {
        return JSON.parse(await m.syncNear(place.place, place.lat, place.lon, place.radius)) as Catalog;
      } finally {
        sub.remove();
      }
    },
    discover: m.discoverStores ? async onEvent => {
      const sub = m.addListener("onSyncEvent", e => { try { onEvent(JSON.parse(e.json)); } catch { /* ignore malformed */ } });
      try {
        return parseDiscovery(await m.discoverStores!());
      } finally {
        sub.remove();
      }
    } : undefined,
    async nearby(lat, lon, r) { return JSON.parse(await m.nearbyStores(lat, lon, r, 14)) as NearStore[]; },
    // The phone's own geocoder first, checked against the typed city's centre (from the built-in
    // store directory, offline); OpenStreetMap through the Go core when it's missing, refused or
    // points at another town.
    async geocode(address) {
      const city = typedCity(address);
      let centre: LatLon | null = null;
      if (city) {
        const c = parse(await m.cityCentre(city).catch(() => '{"found":false}'));
        if (c.found) centre = { lat: c.lat, lon: c.lon };
      }
      const cands = await osCandidates(address);
      const pick = chooseCandidate(cands, centre);
      dlog("geocode", "phone", { city, centre: !!centre, candidates: cands.length, picked: !!pick });
      if (pick) return { ...pick, source: "device" };
      const g = parse(await m.geocode(address).catch(() => '{"found":false}'));
      dlog("geocode", "osm/offline", { found: g.found });
      if (g.found && chooseCandidate([g], centre)) return { lat: g.lat, lon: g.lon, source: "osm" };
      return null;
    },
    imageUrl: code => `https://img.rami-levy.co.il/product/${encodeURIComponent(code)}/small.jpg`,
    async fallbackImage(code) {
      const u = await m.resolveImage(code).catch(() => "");
      return u && !u.includes("rami-levy") ? u : null;
    },
    more: async () => null, // needs the API token, which stays on a server
  };
}

function serverEngine(): Engine {
  const base = serverBase();
  let job: string | null = null;
  const loadJob = async () => (job ??= await AsyncStorage.getItem("salzol:job").catch(() => null));
  const q = (p: Place) => `lat=${p.lat}&lon=${p.lon}&radius=${p.radius}&place=${encodeURIComponent(p.place)}`;
  return {
    kind: "server",
    async cached() {
      if (!(await loadJob())) return null;
      const r = await fetch(`${base}/data.json?job=${job}`, { cache: "no-store" } as RequestInit);
      return r.ok ? ((await r.json()) as Catalog) : null;
    },
    async sync(place, onEvent) {
      const start = await json<{ job: string }>(await fetch(`${base}/api/sync${place ? "?" + q(place) : ""}`, { method: "POST" }));
      job = start.job;
      AsyncStorage.setItem("salzol:job", job).catch(() => {});
      let seen = 0;
      for (;;) {
        const st = await json<{ running: boolean; events: SyncEvent[]; error?: string }>(await fetch(`${base}/api/sync?job=${job}`, { cache: "no-store" } as RequestInit));
        st.events.slice(seen).forEach(onEvent);
        seen = st.events.length;
        if (!st.running) {
          if (st.error) throw new Error(st.error);
          break;
        }
        await sleep(700);
      }
      return json<Catalog>(await fetch(`${base}/data.json?job=${job}`, { cache: "no-store" } as RequestInit));
    },
    async nearby(lat, lon, r) {
      return (await json<{ stores: NearStore[] }>(await fetch(`${base}/api/nearby?lat=${lat}&lon=${lon}&radius=${r}`))).stores;
    },
    async geocode(address) {
      // Expo Go on a phone: its own geocoder first (no city centre to check against here; the
      // server's answer has the city check).
      if (Platform.OS !== "web") {
        const c = await osCandidates(address);
        if (c.length && !typedCity(address)) return { ...c[0], source: "device" };
      }
      const g = await json<{ found: boolean; lat: number; lon: number }>(await fetch(`${base}/api/geocode?q=${encodeURIComponent(address)}`));
      return g.found ? { lat: g.lat, lon: g.lon, source: "osm" } : null;
    },
    imageUrl: code => `${base}/img/${encodeURIComponent(code)}`,
    fallbackImage: async () => null, // the server already tried every source
    async more(place, barcodes) {
      const health = await fetch(`${base}/api/health`).then(r => r.json()).catch(() => null);
      if (!health?.more) return null;
      const q = `lat=${place.lat}&lon=${place.lon}&radius=${place.radius}${(await loadJob()) ? `&job=${job}` : ""}&codes=${barcodes.join(",")}`;
      const r = await fetch(`${base}/api/more?${q}`);
      return (await r.json().catch(() => ({ error: `HTTP ${r.status}` }))) as MoreResult;
    },
  };
}

export const engine: Engine = Native ? deviceEngine() : serverEngine();
