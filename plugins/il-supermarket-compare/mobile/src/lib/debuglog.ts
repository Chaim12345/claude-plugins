// A diagnostic log the user can export and send: what the app did on their phone (syncs, portal
// errors, store discovery, geocoding, background runs, crashes). Kept on the device only, never sent
// anywhere by the app itself. Ring buffer of the last MAX lines, saved to storage a moment after
// each write.
import AsyncStorage from "@react-native-async-storage/async-storage";

export type LogLine = { t: number; tag: string; msg: string };

const KEY = "salzol:debuglog";
export const MAX = 2500;

// Storage never breaks logging (it is missing under node tests, and can fail on a full device).
const store = {
  get: async (k: string) => { try { return await AsyncStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { AsyncStorage.setItem(k, v)?.catch?.(() => {}); } catch { /* ignore */ } },
  remove: (k: string) => { try { AsyncStorage.removeItem(k)?.catch?.(() => {}); } catch { /* ignore */ } },
};

let lines: LogLine[] = [];
let loaded = false;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function persist() {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    store.set(KEY, JSON.stringify(lines));
  }, 1500);
}

/** Loads earlier lines (once); lines logged before that are kept after them. */
export async function loadLog(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    const v = await store.get(KEY);
    const old: LogLine[] = v ? JSON.parse(v) : [];
    if (Array.isArray(old)) lines = [...old, ...lines].slice(-MAX);
  } catch {
    /* a damaged log is dropped */
  }
  listeners.forEach(f => f());
}

const clip = (s: string, n = 600) => (s.length > n ? s.slice(0, n) + "…" : s);

/** Adds a line. `data` is JSON-encoded (and shortened); never pass secrets. */
export function dlog(tag: string, msg: string, data?: unknown): void {
  let m = msg;
  if (data !== undefined) {
    try { m += " " + clip(typeof data === "string" ? data : JSON.stringify(data)); } catch { /* not serializable */ }
  }
  lines.push({ t: Date.now(), tag, msg: clip(m, 1200) });
  if (lines.length > MAX) lines = lines.slice(-MAX);
  persist();
  listeners.forEach(f => f());
}

export const logLines = () => lines;
export function onLog(f: () => void): () => void { listeners.add(f); return () => listeners.delete(f); }
export function clearLog(): void {
  lines = [];
  if (timer) { clearTimeout(timer); timer = null; }
  store.remove(KEY);
  listeners.forEach(f => f());
}

const pad = (n: number) => String(n).padStart(2, "0");
export function stamp(t: number): string {
  const d = new Date(t);
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** The log as plain text, newest last, with a header describing the device and the app's state. */
export function logText(header: Record<string, string | number | boolean | null | undefined>, only?: string): string {
  const head = Object.entries(header).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => `${k}: ${v}`).join("\n");
  const body = lines.filter(l => !only || l.tag === only).map(l => `${stamp(l.t)} [${l.tag}] ${l.msg}`).join("\n");
  return `סל זול – יומן אבחון\n${head}\n\n${body}\n`;
}

let installed = false;

/** Catches uncaught JS errors and unhandled promise rejections into the log (keeping the default handler). */
export function installCrashLogging(): void {
  if (installed) return;
  installed = true;
  const g = globalThis as unknown as { ErrorUtils?: { getGlobalHandler(): (e: Error, fatal?: boolean) => void; setGlobalHandler(h: (e: Error, fatal?: boolean) => void): void } };
  const eu = g.ErrorUtils;
  if (eu?.getGlobalHandler) {
    const prev = eu.getGlobalHandler();
    eu.setGlobalHandler((e, fatal) => {
      dlog("crash", `${fatal ? "fatal " : ""}${e?.message ?? e}`, e?.stack?.split("\n").slice(0, 6).join(" | "));
      store.set(KEY, JSON.stringify(lines)); // now: the app may be about to die
      prev(e, fatal);
    });
  }
  const w = globalThis as unknown as { addEventListener?: (n: string, f: (e: { reason?: unknown; message?: string }) => void) => void };
  w.addEventListener?.("unhandledrejection", e => dlog("error", "unhandled promise rejection", String((e.reason as Error)?.message ?? e.reason)));
  w.addEventListener?.("error", e => dlog("error", e.message ?? "error"));
}
