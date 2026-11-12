import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { compare, makeDeals, toProducts, type ClubPrefs, type Comparison, type Deals } from "./compare";
import { addedCount, discoverLine, isDiscovering, nextNote, shouldCheckDiscovery, type DiscoverResult } from "./discover";
import { engine } from "./engine";
import { cleanName, mergeCarts, newId, uniqueName, type SavedList } from "./saved";
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
  deals: Deals | undefined; // promotions and club prices; undefined for catalogs without them
  club: ClubPrefs; // chains whose club prices the user can get
  ready: boolean; // finished reading saved state
  setQty(code: string, qty: number): void;
  addMany(items: Cart): void; // adds quantities to what is already in the cart
  saved: SavedList[];
  saveCart(name: string): void; // saves the current cart under a name
  loadSaved(id: string, mode: "replace" | "merge"): void;
  renameSaved(id: string, name: string): void;
  deleteSaved(id: string): void;
  clearCart(): void;
  toggleStore(id: string): void;
  setClub(chain: string, on: boolean): void;
  setClubAll(chains: string[], on: boolean): void;
  choosePlace(p: Place): void;
  runSync(): void;
};

const C = createContext<Ctx | null>(null);

const KEY = { cart: "salzol:cart", place: "salzol:place", off: "salzol:off", saved: "salzol:saved", club: "salzol:club" };

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
  const [saved, setSaved] = useState<SavedList[]>([]);
  const [club, setClubState] = useState<ClubPrefs>({});
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
      const [c, p, o, sv, cl] = await Promise.all([load<Cart>(KEY.cart, {}), load<Place | null>(KEY.place, null), load<string[]>(KEY.off, []), load<SavedList[]>(KEY.saved, []), load<ClubPrefs>(KEY.club, {})]);
      setCart(c); setPlace(p); setOff(o); setSaved(Array.isArray(sv) ? sv : []); setClubState(cl);
      const cached = await engine.cached(p).catch(() => null);
      if (cached) setCatalog(cached);
      setReady(true);
      runSyncFor(p);
    })();
  }, [runSyncFor]);

  const products = useMemo(() => (catalog ? toProducts(catalog) : new Map<string, Product>()), [catalog]);
  const active = useMemo(() => (catalog ? catalog.stores.map((_, i) => i).filter(i => !off.includes(catalog.stores[i].id)) : []), [catalog, off]);
  const deals = useMemo(() => (catalog?.promos ? makeDeals(catalog, club) : undefined), [catalog, club]);
  const comparison = useMemo(() => (catalog && Object.keys(cart).length ? compare(products, cart, active, deals) : null), [catalog, products, cart, active, deals]);

  const value: Ctx = {
    catalog, products, active, cart, place, sync, comparison, deals, club, ready, saved,
    addMany(items) {
      setCart(prev => {
        const next = mergeCarts(prev, items);
        save(KEY.cart, next);
        return next;
      });
    },
    saveCart(name) {
      setSaved(prev => {
        const next = [{ id: newId(), name: uniqueName(cleanName(name, "הסל שלי"), prev), items: { ...cart }, at: Date.now() }, ...prev];
        save(KEY.saved, next);
        return next;
      });
    },
    loadSaved(id, mode) {
      const l = saved.find(x => x.id === id);
      if (!l) return;
      const next = mode === "merge" ? mergeCarts(cart, l.items) : { ...l.items };
      setCart(next); save(KEY.cart, next);
    },
    renameSaved(id, name) {
      setSaved(prev => {
        const next = prev.map(l => (l.id === id ? { ...l, name: uniqueName(cleanName(name, l.name), prev, id) } : l));
        save(KEY.saved, next);
        return next;
      });
    },
    deleteSaved(id) {
      setSaved(prev => {
        const next = prev.filter(l => l.id !== id);
        save(KEY.saved, next);
        return next;
      });
    },
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
    setClub(chain, on) {
      setClubState(prev => {
        const next = { ...prev, [chain]: on };
        save(KEY.club, next);
        return next;
      });
    },
    setClubAll(chains, on) {
      setClubState(prev => {
        const next = { ...prev };
        for (const c of chains) next[c] = on;
        save(KEY.club, next);
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
