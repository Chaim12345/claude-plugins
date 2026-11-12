// Persistence for the watchlist, alert inbox, settings and price history (AsyncStorage), and a lock so a
// background run and a foreground run never process the same sync at once.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { mergeSettings, type InboxItem } from "./alerts";
import { emptyHistory, type History } from "./history";
import type { Cart } from "./types";
import { emptyWatch, type WatchState } from "./watchflow";

const K = { core: "salzol:watch", history: "salzol:history", lock: "salzol:watch:lock", place: "salzol:place", off: "salzol:off", club: "salzol:club" };

async function get<T>(k: string, d: T): Promise<T> {
  try {
    const v = await AsyncStorage.getItem(k);
    return v == null ? d : (JSON.parse(v) as T);
  } catch {
    return d;
  }
}

type Core = { followed: string[]; usual: Cart | null; usualAt: number | null; settings: unknown; inbox: InboxItem[]; sent: Record<string, number>; lastDigest: number | null; asked: boolean };

export async function loadWatch(): Promise<WatchState> {
  const d = emptyWatch();
  const [c, h] = await Promise.all([get<Partial<Core>>(K.core, {}), get<History>(K.history, emptyHistory())]);
  return {
    followed: Array.isArray(c.followed) ? c.followed : d.followed,
    usual: c.usual && typeof c.usual === "object" ? c.usual : null,
    usualAt: c.usualAt ?? null,
    settings: mergeSettings(c.settings as never),
    inbox: Array.isArray(c.inbox) ? c.inbox : [],
    sent: c.sent && typeof c.sent === "object" ? c.sent : {},
    lastDigest: c.lastDigest ?? null,
    asked: !!c.asked,
    history: h && h.v === 1 && Array.isArray(h.days) && Array.isArray(h.stores) ? h : emptyHistory(),
  };
}

/** Saves the state; `withHistory: false` skips the (larger) history for changes that don't touch it. */
export async function saveWatch(s: WatchState, withHistory = true): Promise<void> {
  const { history, ...core } = s;
  await Promise.all([
    AsyncStorage.setItem(K.core, JSON.stringify(core)).catch(() => {}),
    withHistory ? AsyncStorage.setItem(K.history, JSON.stringify(history)).catch(() => {}) : Promise.resolve(),
  ]);
}

/** What the background task needs from the main app's saved state. */
export async function loadPrefs() {
  const [place, off, club] = await Promise.all([
    get<{ place: string; lat: number; lon: number; radius: number } | null>(K.place, null),
    get<string[]>(K.off, []),
    get<Record<string, boolean>>(K.club, {}),
  ]);
  return { place, off, club };
}

const LOCK_MS = 10 * 60_000;
/** Runs fn unless another run holds the lock (then returns null). The lock expires after 10 minutes. */
export async function withLock<T>(fn: () => Promise<T>): Promise<T | null> {
  const t = await get<number>(K.lock, 0);
  if (Date.now() - t < LOCK_MS) return null;
  await AsyncStorage.setItem(K.lock, JSON.stringify(Date.now())).catch(() => {});
  try {
    return await fn();
  } finally {
    await AsyncStorage.removeItem(K.lock).catch(() => {});
  }
}
