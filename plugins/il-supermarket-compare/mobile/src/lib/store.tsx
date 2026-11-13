import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { compare, makeDeals, toProducts, type ClubPrefs, type Comparison, type Deals } from "./compare";
import { addedCount, discoverLine, isDiscovering, nextNote, shouldCheckDiscovery, type DiscoverResult } from "./discover";
import { dlog, installCrashLogging, loadLog } from "./debuglog";
import { aliases, curateCatalog } from "./curate";
import { loadCuration, useCuration } from "./curationState";
import { engine } from "./engine";
import { loadEnrich, useEnrichRecs } from "./enrichState";
import { bumpFreq, diffCatalogs, mergeChanges, trimFreq, type Change, type Freq } from "./insights";
import { accept, dismiss, emptyFeedback, expire, type Basket, type Feedback, type Rec } from "./recommend";
import { cleanName, mergeCarts, newId, uniqueName, type SavedList } from "./saved";
import type { Cart, Catalog, Place, Product, SyncEvent } from "./types";

/** note: a short, one-time remark about store discovery ("לא הצלחנו להוסיף: ..."); it never blocks a sync. */
type SyncState = { running: boolean; events: SyncEvent[]; error: string | null; note?: string | null };

const sleep = (ms: number) => new Promise<void>(res => setTimeout(res, ms));

type Ctx = {
  catalog: Catalog | null; // with the user's AI curation applied (merged products, tidied names, categories)
  rawCatalog: Catalog | null; // as the price files gave it
  products: Map<string, Product>;
  active: number[]; // indexes of stores being compared
  cart: Cart;
  place: Place | null;
  sync: SyncState;
  comparison: Comparison | null;
  deals: Deals | undefined; // promotions and club prices; undefined for catalogs without them
  club: ClubPrefs; // chains whose club prices the user can get
  ready: boolean; // finished reading saved state
  freq: Freq; // how often each product was put in a cart (for "my regulars")
  changes: Change[]; // prices that moved between syncs, last 30 days
  baskets: Basket[]; // past baskets, recorded when the cart is emptied after shopping (newest last)
  recFeedback: Feedback; // "for you": dismissed cards and what the user liked
  dismissRec(r: Rec): void;
  acceptRec(r: Rec): void; // adds the usual quantity to the cart and counts as positive feedback
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

const KEY = { cart: "salzol:cart", place: "salzol:place", off: "salzol:off", saved: "salzol:saved", club: "salzol:club", freq: "salzol:freq", changes: "salzol:changes", baskets: "salzol:baskets", recfb: "salzol:recfb" };

const MAX_BASKETS = 30;

/** The same catalog file read twice: same build time, version, branches and size. */
function sameCatalog(a: Catalog, b: Catalog): boolean {
  return a === b || (a.generatedAt === b.generatedAt && a.priceDate === b.priceDate && (a.version ?? 0) === (b.version ?? 0)
    && a.products.length === b.products.length && a.stores.length === b.stores.length && a.stores.every((s, i) => s.id === b.stores[i].id));
}

/** One log line per engine event; the many per-file "check" events are left out. */
function logEvent(tag: string, e: SyncEvent) {
  if (e.phase === "check") return;
  dlog(tag, e.phase, { store: e.store, file: e.file, items: e.items, bytes: e.bytes, ms: e.ms, message: e.message });
}

const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

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
  const [rawCatalog, setCatalog] = useState<Catalog | null>(null);
  const [cart, setCart] = useState<Cart>({});
  const [place, setPlace] = useState<Place | null>(null);
  const [off, setOff] = useState<string[]>([]);
  const [saved, setSaved] = useState<SavedList[]>([]);
  const [club, setClubState] = useState<ClubPrefs>({});
  const [sync, setSync] = useState<SyncState>({ running: false, events: [], error: null });
  // Sync and discovery send dozens of progress events a second; the screens get them 4 times a second.
  const pendingEvents = useRef<SyncEvent[]>([]);
  const eventTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pushEvent = useCallback((e: SyncEvent) => {
    pendingEvents.current.push(e);
    if (eventTimer.current) return;
    eventTimer.current = setTimeout(() => {
      eventTimer.current = null;
      const add = pendingEvents.current;
      pendingEvents.current = [];
      setSync(s => ({ ...s, events: [...s.events, ...add] }));
    }, 250);
  }, []);
  const [ready, setReady] = useState(false);
  const [freq, setFreq] = useState<Freq>({});
  const [changes, setChanges] = useState<Change[]>([]);
  const [baskets, setBaskets] = useState<Basket[]>([]);
  const [recFeedback, setRecFeedback] = useState<Feedback>(emptyFeedback());
  const shown = useRef<Catalog | null>(null); // the catalog on screen, to compare the next one against
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
    dlog("discover", "start");
    const run = engine.discover(e => { logEvent("discover", e); pushEvent(e); })
      .then(r => { dlog("discover", "result", r); return r; }, err => { dlog("error", "discover failed", String(err?.message ?? err)); return null; });
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
    const t0 = Date.now();
    dlog("sync", "start", p ? { place: p.place, lat: +p.lat.toFixed(3), lon: +p.lon.toFixed(3), radius: p.radius, engine: engine.kind } : { engine: engine.kind });
    try {
      await discover(p);
      const c = await engine.sync(p, e => { logEvent("sync", e); pushEvent(e); });
      dlog("sync", "done", { ms: Date.now() - t0, stores: c.stores.length, products: c.products.length, version: c.version ?? 0, skipped: c.skipped });
      // Nothing new (the stored catalog came back): keep the one on screen, no rebuild of every screen.
      if (shown.current && sameCatalog(shown.current, c)) {
        setSync(s => ({ ...s, running: false }));
        return;
      }
      // What moved since the catalog we were showing: the files say when a price changed, this says which way.
      if (shown.current && shown.current !== c) {
        const moved = diffCatalogs(shown.current, c, today());
        if (moved.length) setChanges(prev => { const next = mergeChanges(prev, moved, today()); save(KEY.changes, next); return next; });
      }
      shown.current = c;
      setCatalog(c);
      setSync(s => ({ ...s, running: false }));
    } catch (e) {
      dlog("error", "sync failed", e instanceof Error ? e.message : String(e));
      setSync(s => ({ ...s, running: false, error: e instanceof Error ? e.message : String(e) }));
    } finally {
      busy.current = false;
    }
  }, [discover]);
  resync.current = runSyncFor;

  // Start-up: saved state first, then the last catalog, then a refresh (fast when nothing is new).
  useEffect(() => {
    (async () => {
      installCrashLogging();
      await Promise.all([loadLog(), loadCuration(), loadEnrich()]);
      dlog("app", "start");
      const [c, p, o, sv, cl, fq, ch, bs, rf] = await Promise.all([load<Cart>(KEY.cart, {}), load<Place | null>(KEY.place, null), load<string[]>(KEY.off, []), load<SavedList[]>(KEY.saved, []), load<ClubPrefs>(KEY.club, {}), load<Freq>(KEY.freq, {}), load<Change[]>(KEY.changes, []), load<Basket[]>(KEY.baskets, []), load<Feedback>(KEY.recfb, emptyFeedback())]);
      setBaskets(Array.isArray(bs) ? bs : []);
      setRecFeedback(rf && rf.dismissed ? expire(rf, Date.now()) : emptyFeedback());
      setCart(c); setPlace(p); setOff(o); setSaved(Array.isArray(sv) ? sv : []); setClubState(cl);
      setFreq(fq && typeof fq === "object" ? fq : {}); setChanges(Array.isArray(ch) ? mergeChanges(ch, [], today()) : []);
      const cached = await engine.cached(p).catch(() => null);
      if (cached) { shown.current = cached; setCatalog(cached); }
      setReady(true);
      runSyncFor(p);
    })();
  }, [runSyncFor]);

  const cur = useCuration();
  const recs = useEnrichRecs();
  const catalog = useMemo(() => (rawCatalog ? curateCatalog(rawCatalog, cur, recs) : null), [rawCatalog, cur, recs]);
  // products merged by AI curation: carts, past baskets and the regulars move to the product they joined
  const alias = useMemo(() => (rawCatalog ? aliases(rawCatalog, cur) : new Map<string, string>()), [rawCatalog, cur]);
  useEffect(() => {
    if (!alias.size) return;
    const move = <T extends Record<string, number>>(o: T): T | null => {
      if (!Object.keys(o).some(k => alias.has(k))) return null;
      const out: Record<string, number> = {};
      for (const [k, v] of Object.entries(o)) { const to = alias.get(k) ?? k; out[to] = (out[to] ?? 0) + v; }
      return out as T;
    };
    setCart(prev => { const n = move(prev); if (!n) return prev; save(KEY.cart, n); return n; });
    setFreq(prev => {
      if (!Object.keys(prev).some(k => alias.has(k))) return prev;
      const n: Freq = {};
      for (const [k, v] of Object.entries(prev)) { const to = alias.get(k) ?? k; if (!n[to]) n[to] = v; }
      save(KEY.freq, n);
      return n;
    });
  }, [alias]);
  const products = useMemo(() => (catalog ? toProducts(catalog) : new Map<string, Product>()), [catalog]);
  const active = useMemo(() => (catalog ? catalog.stores.map((_, i) => i).filter(i => !off.includes(catalog.stores[i].id)) : []), [catalog, off]);
  const deals = useMemo(() => (catalog?.promos ? makeDeals(catalog, club) : undefined), [catalog, club]);
  const comparison = useMemo(() => (catalog && Object.keys(cart).length ? compare(products, cart, active, deals) : null), [catalog, products, cart, active, deals]);

  // "My regulars": every product put in a cart counts, at most once a day.
  const used = (codes: string[]) => setFreq(prev => {
    let next = prev;
    const now = Date.now();
    for (const code of codes) next = bumpFreq(next, code, now);
    if (next === prev) return prev;
    next = trimFreq(next);
    save(KEY.freq, next);
    return next;
  });

  // Memoized: every screen reads this context, and a new object on each render re-rendered all of them.
  const value = useMemo<Ctx>(() => ({
    catalog, rawCatalog, products, active, cart, place, sync, comparison, deals, club, ready, saved, freq, changes, baskets, recFeedback,
    dismissRec(r) {
      setRecFeedback(prev => { const next = dismiss(prev, r, Date.now()); save(KEY.recfb, next); return next; });
      dlog("recommend", "dismissed", { code: r.p.code, source: r.source });
    },
    acceptRec(r) {
      setRecFeedback(prev => { const next = accept(prev, r); save(KEY.recfb, next); return next; });
      value.addMany({ [r.p.code]: r.qty });
    },
    addMany(items) {
      used(Object.keys(items));
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
      if (qty > 0 && !(code in cart)) used([code]);
      setCart(prev => {
        const next = { ...prev };
        if (qty <= 0) delete next[code]; else next[code] = Math.round(qty * 10) / 10;
        save(KEY.cart, next);
        return next;
      });
    },
    // Emptying a cart that had things in it means a shopping trip is over: remember the basket
    // (what was bought together, how much, how often) for the recommendations.
    clearCart() {
      if (Object.keys(cart).length) {
        setBaskets(prev => { const next = [...prev, { at: Date.now(), items: { ...cart } }].slice(-MAX_BASKETS); save(KEY.baskets, next); return next; });
        dlog("cart", "basket recorded", { items: Object.keys(cart).length });
      }
      setCart({}); save(KEY.cart, {});
    },
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
    // A new place means other branches: the old catalog is not a "before" for the new one.
    choosePlace(p) { shown.current = null; setPlace(p); save(KEY.place, p); setOff([]); save(KEY.off, []); runSyncFor(p); },
    runSync() { runSyncFor(place); },
  }), [catalog, rawCatalog, products, active, cart, place, sync, comparison, deals, club, ready, saved, freq, changes, baskets, recFeedback, runSyncFor]); // eslint-disable-line react-hooks/exhaustive-deps
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
