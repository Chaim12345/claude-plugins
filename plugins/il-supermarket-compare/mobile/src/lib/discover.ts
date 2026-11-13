// Pure helpers for on-device store discovery: chains whose price portals refuse non-Israeli IPs
// (Victory, Carrefour, Hazi Hinam, ...) are missing from the built-in store directory, so the phone
// asks them itself (Go core, mobile.DiscoverStores). Go decides what is due (a chain with no
// stores, or discovered stores older than 7 days); these helpers decide how often the app asks Go,
// and what the header says.

export type DiscoverResult = {
  counts: Record<string, number>;
  errors: Record<string, string>;
  names: Record<string, string>; // chain key -> Hebrew name
  skipped: boolean;
};

/** Parses mobile.DiscoverStores' JSON; anything malformed becomes an empty "skipped" result. */
export function parseDiscovery(json: string): DiscoverResult {
  try {
    const r = JSON.parse(json) as Partial<DiscoverResult>;
    return { counts: r.counts ?? {}, errors: r.errors ?? {}, names: r.names ?? {}, skipped: !!r.skipped };
  } catch {
    return { counts: {}, errors: {}, names: {}, skipped: true };
  }
}

/** Go only reads two small files when nothing is due, so asking is cheap; still, don't ask on every refresh tap. */
export const DISCOVER_CHECK_GAP_MS = 6 * 60 * 60 * 1000;

export function shouldCheckDiscovery(lastCheckMs: number | null, nowMs: number, gapMs = DISCOVER_CHECK_GAP_MS): boolean {
  return lastCheckMs == null || nowMs - lastCheckMs >= gapMs || nowMs < lastCheckMs; // a clock set back counts as stale
}

function list(names: string[], max: number): string {
  return names.length <= max ? names.join(", ") : `${names.slice(0, max).join(", ")} ועוד ${names.length - max}`;
}

/** Header text while Go adds stores: "מוסיף סניפים של ויקטורי, קרפור…" (the "discover" event names the chains). */
export function discoverLine(message: string | undefined): string {
  const names = (message ?? "").split(",").map(s => s.trim()).filter(Boolean);
  return names.length ? `מוסיף סניפים של ${list(names, 2)}…` : "מוסיף סניפים…";
}

/** True once discovery has started and the sync proper hasn't (no download/parse events yet). */
export function isDiscovering(phases: string[]): boolean {
  const d = phases.lastIndexOf("discover");
  if (d < 0) return false;
  return !phases.slice(d + 1).some(p => ["download", "cached", "parse"].includes(p));
}

/** "לא הצלחנו להוסיף: ויקטורי, קרפור" for the chains that failed, or null when none did. */
export function failureNote(r: DiscoverResult): string | null {
  const keys = Object.keys(r.errors);
  if (!keys.length) return null;
  return `לא הצלחנו להוסיף: ${list(keys.map(k => r.names[k] || k), 3)}`;
}

/** The note to show now, or null when it was already shown (so the same failure isn't repeated each sync). */
export function nextNote(shown: string | null, r: DiscoverResult): string | null {
  const n = failureNote(r);
  return n && n !== shown ? n : null;
}

/** Total branches added in this run. */
export function addedCount(r: DiscoverResult): number {
  return Object.values(r.counts).reduce((a, b) => a + b, 0);
}
