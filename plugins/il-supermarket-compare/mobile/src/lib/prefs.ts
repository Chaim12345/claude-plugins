// Settings that live on the phone: defaults, validation and storage keys. Pure, tested with node --test.
// The React side is in settings.tsx.
import type { Lang } from "../i18n/index.ts";

/** AsyncStorage keys of the settings; the older salzol:* keys are owned by store.tsx. */
export const PREF_KEY = {
  kmCost: "salzol:kmcost", // shekels per km driven
  radius: "salzol:radius", // default search radius in km
  lang: "salzol:lang",
  onboarded: "salzol:onboarded",
} as const;

/**
 * "Clear local data" empties the cart and the saved lists through the store (so the screens update at once), and
 * removes these storage keys directly: the id of the cached catalog on a server engine. A phone build's on-device
 * catalog is owned by the native module, which has no way to clear it.
 */
export const CACHE_KEYS = ["salzol:job"] as const;

export const RADII = [2, 3, 4, 5, 8, 12];
export const DEFAULT_RADIUS = 4;
export const DEFAULT_KM_COST = 1.5; // ₪ per km: fuel and wear for a small car
export const MAX_KM_COST = 20;

export function parseRadius(v: unknown): number {
  return typeof v === "number" && RADII.includes(v) ? v : DEFAULT_RADIUS;
}

/** "1.5", "1,5", " 2 " -> number in [0, MAX_KM_COST]; null when it isn't a usable number. */
export function parseKmCost(text: string): number | null {
  const n = Number(text.trim().replace(",", "."));
  if (!text.trim() || !Number.isFinite(n) || n < 0 || n > MAX_KM_COST) return null;
  return Math.round(n * 100) / 100;
}

export function parseStoredKmCost(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= MAX_KM_COST ? v : DEFAULT_KM_COST;
}

export function parseLang(v: unknown): Lang {
  return v === "en" ? "en" : "he";
}

/** Shekels, no trailing zeros: 1.5 -> "1.5", 2 -> "2". */
export const fmtKmCost = (n: number) => String(Math.round(n * 100) / 100);
