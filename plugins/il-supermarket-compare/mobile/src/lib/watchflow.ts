// What happens after a sync (foreground or background): evaluate the alert rules against the stored
// snapshot, record today's snapshot, update the inbox, choose notifications. Pure, so it is tested.
import { evaluate, mergeInbox, mergeSettings, pickNotifications, type AlertItem, type InboxItem, type Settings, type ToSend } from "./alerts.ts";
import { chainKey, makeDeals, toProducts, type ClubPrefs } from "./compare.ts";
import { configSig, emptyHistory, prune, record, type History } from "./history.ts";
import type { Cart, Catalog } from "./types";

export type WatchState = {
  followed: string[]; // product codes
  usual: Cart | null; // the usual basket, frozen when the user marked it
  usualAt: number | null;
  settings: Settings;
  inbox: InboxItem[];
  sent: Record<string, number>; // dedupe memory
  lastDigest: number | null;
  history: History;
  asked: boolean; // we already offered to turn notifications on
};

export const emptyWatch = (): WatchState => ({ followed: [], usual: null, usualAt: null, settings: mergeSettings(null), inbox: [], sent: {}, lastDigest: null, history: emptyHistory(), asked: false });

export const watching = (s: WatchState) => s.followed.length > 0 || (!!s.usual && Object.keys(s.usual).length > 0);

export type CheckInput = { catalog: Catalog; off: string[]; club: ClubPrefs; now: number };
export type CheckResult = { state: WatchState; send: ToSend[]; fresh: AlertItem[] };

/**
 * One check. `silent` records the snapshot without producing alerts (used when something was just
 * followed, so the sparkline and the baseline start right away).
 */
export function runCheck(st: WatchState, inp: CheckInput, silent = false): CheckResult {
  const { catalog, now } = inp;
  if (!watching(st)) return { state: { ...st, history: prune(st.history, []) }, send: [], fresh: [] };
  const products = toProducts(catalog);
  const active = catalog.stores.map((_, i) => i).filter(i => !inp.off.includes(catalog.stores[i].id));
  const club: ClubPrefs = st.settings.anyClub ? Object.fromEntries(catalog.stores.map(s => [chainKey(s.id), true])) : inp.club;
  const deals = catalog.promos ? makeDeals(catalog, club, now) : undefined;
  const sig = configSig(catalog, active, deals?.club ?? active.map(() => false));
  const settings = silent ? { ...st.settings, rules: { promo: false, drop: false, basket: false, ending: false, digest: false } } : st.settings;
  const out = evaluate({ catalog, products, active, deals, sig, followed: st.followed, usual: st.usual, history: st.history, settings, now, sent: st.sent, lastDigest: st.lastDigest });
  const history = record(st.history, now, sig, out.points, out.basket, st.followed);
  const inbox = mergeInbox(st.inbox, out.alerts, now);
  const picked = pickNotifications(inbox, now, st.settings);
  return {
    state: { ...st, history, inbox: picked.inbox, sent: out.sent, lastDigest: out.lastDigest },
    send: picked.send,
    fresh: out.alerts,
  };
}
