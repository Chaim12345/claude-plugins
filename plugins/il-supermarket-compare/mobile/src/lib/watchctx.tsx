// App state for the watchlist, the usual basket, alert settings, the inbox and price history.
// Lives inside DataProvider and reads its catalog; store.tsx itself is untouched.
import { useRouter } from "expo-router";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import { unreadCount, type InboxItem, type Settings } from "./alerts";
import { backgroundSupported, setBackgroundRefresh } from "./background";
import { installHandler, notificationsSupported, onTap, permission, requestPermission, type Permission } from "./notify";
import { useData } from "./store";
import type { Cart } from "./types";
import { loadWatch, saveWatch, withLock } from "./watchstore";
import { emptyWatch, runCheck, watching, type WatchState } from "./watchflow";

type Ctx = {
  ready: boolean;
  state: WatchState;
  followed: Set<string>;
  isFollowed(code: string): boolean;
  toggleFollow(code: string): void;
  usual: Cart | null;
  setUsual(cart: Cart | null): void;
  settings: Settings;
  setSettings(patch: Partial<Omit<Settings, "rules">> & { rules?: Partial<Settings["rules"]> }): void;
  inbox: InboxItem[];
  unread: number;
  markAllRead(): void;
  clearInbox(): void;
  perm: Permission;
  /** Turns system notifications on: asks for the permission when needed. Returns whether they are on. */
  enableNotifications(): Promise<boolean>;
  disableNotifications(): void;
  /** True once, after the first follow, when it's a good moment to offer notifications. */
  shouldOffer: boolean;
  dismissOffer(): void;
};

const C = createContext<Ctx | null>(null);

export function WatchProvider({ children }: { children: ReactNode }) {
  const { catalog, sync, active, club, ready: dataReady } = useData();
  const router = useRouter();
  const [state, setState] = useState<WatchState>(emptyWatch);
  const [ready, setReady] = useState(false);
  const [perm, setPerm] = useState<Permission>("undetermined");
  const ref = useRef(state);
  const env = useRef({ catalog, active, club });
  useEffect(() => { env.current = { catalog, active, club }; });

  const commit = useCallback((next: WatchState, withHistory = false) => {
    ref.current = next;
    setState(next);
    saveWatch(next, withHistory);
  }, []);

  const offIds = () => {
    const { catalog: c, active: a } = env.current;
    return c ? c.stores.filter((_, i) => !a.includes(i)).map(s => s.id) : [];
  };

  // Load saved state once, learn the permission, make sure the channel and tap handler exist.
  useEffect(() => {
    let off: (() => void) | undefined;
    (async () => {
      const s = await loadWatch();
      ref.current = s;
      setState(s);
      setPerm(await permission());
      installHandler();
      setReady(true);
      off = onTap(code => {
        try { router.push(code ? `/product/${encodeURIComponent(code)}` : "/inbox"); } catch { /* navigation not ready */ }
      });
    })();
    return () => off?.();
  }, [router]);

  // A background run may have added alerts while the app was away.
  useEffect(() => {
    const sub = AppState.addEventListener("change", async st => {
      if (st !== "active") return;
      const s = await loadWatch();
      ref.current = s;
      setState(s);
      setPerm(await permission());
    });
    return () => sub.remove();
  }, []);

  // After every successful sync in the app: diff against the stored snapshot, update inbox and history.
  // Notifications are not posted from here: the person is looking at the app and sees the bell badge.
  const wasRunning = useRef(false);
  useEffect(() => {
    const finished = wasRunning.current && !sync.running && !sync.error;
    wasRunning.current = sync.running;
    if (!finished || !catalog || !ready) return;
    withLock(async () => {
      const cur = ref.current;
      if (!watching(cur)) return;
      const res = runCheck(cur, { catalog, off: offIds(), club, now: Date.now() });
      commit(res.state, true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sync.running]);

  // Daily background refresh: registered while there is something to watch and notifications are on.
  useEffect(() => {
    if (!ready || !dataReady || !backgroundSupported) return;
    setBackgroundRefresh(state.settings.on && perm === "granted" && watching(state));
  }, [ready, dataReady, state, perm]);

  // Follow / usual basket changes record a baseline right away (no alerts), so the chart starts today.
  const baseline = useCallback((next: WatchState): WatchState => {
    const { catalog: c, club: cl } = env.current;
    if (!c) return next;
    return runCheck(next, { catalog: c, off: offIds(), club: cl, now: Date.now() }, true).state;
  }, []);

  const value = useMemo<Ctx>(() => {
    const followed = new Set(state.followed);
    return {
      ready, state, followed,
      isFollowed: code => followed.has(code),
      toggleFollow(code) {
        const cur = ref.current;
        const has = cur.followed.includes(code);
        const next = { ...cur, followed: has ? cur.followed.filter(c => c !== code) : [...cur.followed, code] };
        commit(baseline(next), true);
      },
      usual: state.usual,
      setUsual(cart) {
        const cur = ref.current;
        const next = { ...cur, usual: cart && Object.keys(cart).length ? { ...cart } : null, usualAt: cart && Object.keys(cart).length ? Date.now() : null };
        commit(baseline(next), true);
      },
      settings: state.settings,
      setSettings(patch) {
        const cur = ref.current;
        commit({ ...cur, settings: { ...cur.settings, ...patch, rules: { ...cur.settings.rules, ...(patch.rules ?? {}) } } });
      },
      inbox: state.inbox,
      unread: unreadCount(state.inbox),
      markAllRead() { commit({ ...ref.current, inbox: ref.current.inbox.map(x => (x.read ? x : { ...x, read: true })) }); },
      clearInbox() { commit({ ...ref.current, inbox: [] }); },
      perm,
      async enableNotifications() {
        let p = await permission();
        if (p !== "granted") p = await requestPermission();
        setPerm(p);
        const ok = p === "granted";
        const cur = ref.current;
        commit({ ...cur, asked: true, settings: { ...cur.settings, on: ok } });
        return ok;
      },
      disableNotifications() { const cur = ref.current; commit({ ...cur, settings: { ...cur.settings, on: false } }); },
      shouldOffer: notificationsSupported && ready && state.followed.length > 0 && !state.asked && !state.settings.on && perm !== "denied" && perm !== "unsupported",
      dismissOffer() { commit({ ...ref.current, asked: true }); },
    };
  }, [state, ready, perm, commit, baseline]);

  return <C.Provider value={value}>{children}</C.Provider>;
}

export function useWatch(): Ctx {
  const v = useContext(C);
  if (!v) throw new Error("useWatch outside WatchProvider");
  return v;
}
