// Where prices come from. On a phone build with the Go library, everything runs on the device
// (the native module). On web and in Expo Go, the same calls go to a salzol server.
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import { Platform } from "react-native";
import Native from "../../modules/salzol-native";
import type { Catalog, NearStore, Place, SyncEvent } from "./types";

export interface Engine {
  kind: "device" | "server";
  /** The catalog from the last sync, if any, without touching the network. */
  cached(place: Place | null): Promise<Catalog | null>;
  sync(place: Place | null, onEvent: (e: SyncEvent) => void): Promise<Catalog>;
  nearby(lat: number, lon: number, radiusKm: number): Promise<NearStore[]>;
  geocode(address: string): Promise<{ lat: number; lon: number } | null>;
  imageUrl(code: string): string | null;
  /** A second photo source when imageUrl fails (Open Food Facts via the Go core), or null. */
  fallbackImage(code: string): Promise<string | null>;
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

async function osGeocode(address: string) {
  // The phone's built-in geocoder: free, no API key. Android asks for location permission first.
  const perm = await Location.requestForegroundPermissionsAsync();
  if (Platform.OS === "android" && !perm.granted) return null;
  const r = await Location.geocodeAsync(address);
  return r.length ? { lat: r[0].latitude, lon: r[0].longitude } : null;
}

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
    async nearby(lat, lon, r) { return JSON.parse(await m.nearbyStores(lat, lon, r, 14)) as NearStore[]; },
    geocode: osGeocode,
    imageUrl: code => `https://img.rami-levy.co.il/product/${encodeURIComponent(code)}/small.jpg`,
    async fallbackImage(code) {
      const u = await m.resolveImage(code).catch(() => "");
      return u && !u.includes("rami-levy") ? u : null;
    },
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
      if (Platform.OS !== "web") {
        const g = await osGeocode(address).catch(() => null);
        if (g) return g;
      }
      const g = await json<{ found: boolean; lat: number; lon: number }>(await fetch(`${base}/api/geocode?q=${encodeURIComponent(address)}`));
      return g.found ? { lat: g.lat, lon: g.lon } : null;
    },
    imageUrl: code => `${base}/img/${encodeURIComponent(code)}`,
    fallbackImage: async () => null, // the server already tried every source
  };
}

export const engine: Engine = Native ? deviceEngine() : serverEngine();
