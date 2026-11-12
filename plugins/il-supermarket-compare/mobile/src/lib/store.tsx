import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { compare, toProducts, type Comparison } from "./compare";
import { addedCount, discoverLine, isDiscovering, nextNote, shouldCheckDiscovery, type DiscoverResult } from "./discover";
import { engine } from "./engine";
import type { Cart, Catalog, Place, Product, SyncEvent } from "./types";

/** note: a short, one-time remark about store discovery ("לא הצלחנו להוסיף: ..."); it never blocks a sync. */
type SyncState = { running: boolean; events: SyncEvent[]; error: string | null; note?: string | null };

const sleep = (ms: number) => new Promise<void>(res => setTimeout(res, ms));

type Ctx = {
  catalog: Catalog | null;
  products: Map<string, Product>;
  active: number[]; // indexes of stores being compared
  cart: Cart;
  place: Place | null;
  sync: SyncState;
  comparison: Comparison | null;
  ready: boolean; // finished reading saved state
  setQty(code: string, qty: number): void;
  clearCart(): void;
  toggleStore(id: string): void;
  choosePlace(p: Place): void;
  runSync(): void;
};

const C = createContext<Ctx | null>(null);

const KEY = { cart: "salzol:cart", place: "salzol:place", off: "salzol:off" };

async function load<T>(k: string, d: T): Promise<T> {
  try {
    const v = await AsyncStorage.getItem(k);
    return v == null ? d : (JSON.parse(v) as T);
  } catch {
    return d;
  }
}
const save = (k: string, v: unknown) => AsyncStorage.setItem(k, JSON.stringify(v)).catch(() => {});

export function DataProvider({ children }: { children: ReactNode }) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [cart, setCart] = useState<Cart>({});
  const [place, setPlace] = useState<Place | null>(null);
  const [off, setOff] = useState<string[]>([]);
  const [sync, setSync] = useState<SyncState>({ running: false, events: [], error: null });
  const [ready, setReady] = useState(false);
  const busy = useRef(false);
  const lastDiscover = useRef<number | null>(null);
  const shownNote = useRef<string | null>(null);
  const resync = useRef<((p: Place | null) => void) | null>(null);

  // Discovery is allowed to hold the first sync back for this long; after that the sync goes ahead
  // with the stores it has, and runs again if discovery finds something later.
  const DISCOVER_WAIT_MS = 45_000;

  const noteFrom = useCallback((r: DiscoverResult | null) => {
    const n = r ? nextNote(shownNote.current, r) : shownNote.current ? null : "לא הצלחנו להוסיף סניפים חדשים";
    if (n) {
      shownNote.current = n;
      setSync(s => ({ ...s, note: n }));
    }
  }, []);

  // Adds the stores of the chains the built-in directory lacks (Victory, Carrefour, ...). Go decides
  // whether anything is due; a failure never stops the sync.
  const discover = useCallback(async (p: Place | null) => {
    if (!engine.discover || !shouldCheckDiscovery(lastDiscover.current, Date.now())) return;
    lastDiscover.current = Date.now();
    const run = engine.discover(e => setSync(s => ({ ...s, events: [...s.events, e] }))).then(r => r, () => null);
    const first = await Promise.race([run, sleep(DISCOVER_WAIT_MS).then(() => undefined)]);
    if (first !== undefined) return noteFrom(first);
    run.then(async r => {
      noteFrom(r);
      if (!r || addedCount(r) === 0) return;
      for (let i = 0; i < 60 && busy.current; i++) await sleep(2000); // let the running sync finish first
      resync.current?.(p);
    });
  }, [noteFrom]);

  const runSyncFor = useCallback(async (p: Place | null) => {
    if (busy.current) return;
    if (!p && engine.kind === "device") return; // the phone needs a location to choose stores
    busy.current = true;
    setSync(s => ({ running: true, events: [], error: null, note: s.note }));
    try {
      await discover(p);
      const c = await engine.sync(p, e => setSync(s => ({ ...s, events: [...s.events, e] })));
      setCatalog(c);
      setSync(s => ({ ...s, running: false }));
    } catch (e) {
      setSync(s => ({ ...s, running: false, error: e instanceof Error ? e.message : String(e) }));
    } finally {
      busy.current = false;
    }
  }, [discover]);
  resync.current = runSyncFor;

  // Start-up: saved state first, then the last catalog, then a refresh (fast when nothing is new).
  useEffect(() => {
    (async () => {
      const [c, p, o] = await Promise.all([load<Cart>(KEY.cart, {}), load<Place | null>(KEY.place, null), load<string[]>(KEY.off, [])]);
      setCart(c); setPlace(p); setOff(o);
      const cached = await engine.cached(p).catch(() => null);
      if (cached) setCatalog(cached);
      setReady(true);
      runSyncFor(p);
    })();
  }, [runSyncFor]);

  const products = useMemo(() => (catalog ? toProducts(catalog) : new Map<string, Product>()), [catalog]);
  const active = useMemo(() => (catalog ? catalog.stores.map((_, i) => i).filter(i => !off.includes(catalog.stores[i].id)) : []), [catalog, off]);
  const comparison = useMemo(() => (catalog && Object.keys(cart).length ? compare(products, cart, active) : null), [catalog, products, cart, active]);

  const value: Ctx = {
    catalog, products, active, cart, place, sync, comparison, ready,
    setQty(code, qty) {
      setCart(prev => {
        const next = { ...prev };
        if (qty <= 0) delete next[code]; else next[code] = Math.round(qty * 10) / 10;
        save(KEY.cart, next);
        return next;
      });
    },
    clearCart() { setCart({}); save(KEY.cart, {}); },
    toggleStore(id) {
      setOff(prev => {
        const next = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id];
        save(KEY.off, next);
        return next;
      });
    },
    choosePlace(p) { setPlace(p); save(KEY.place, p); setOff([]); save(KEY.off, []); runSyncFor(p); },
    runSync() { runSyncFor(place); },
  };
  return <C.Provider value={value}>{children}</C.Provider>;
}

export function useData(): Ctx {
  const v = useContext(C);
  if (!v) throw new Error("useData outside DataProvider");
  return v;
}

/** One-line description of a running sync, for the header. */
export function syncLine(s: SyncState, storeCount: number): string {
  const ev = s.events;
  if (isDiscovering(ev.map(e => e.phase))) return discoverLine([...ev].reverse().find(e => e.phase === "discover")?.message);
  const parsed = ev.filter(e => e.phase === "parse").length;
  if (parsed) return `מעבד מחירונים… ${parsed} סניפים`;
  const checked = new Set(ev.filter(e => ["download", "cached", "skip"].includes(e.phase)).map(e => e.store)).size;
  const kb = Math.round(ev.reduce((t, e) => t + (e.bytes ?? 0), 0) / 1024);
  return `בודק מחירונים חדשים… ${checked}${storeCount ? `/${storeCount}` : ""}${kb ? ` · ${kb} KB` : ""}`;
}
