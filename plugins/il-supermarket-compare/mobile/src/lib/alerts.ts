// Alert rules for followed products and the usual basket. Pure: a previous snapshot (history.ts), the new
// catalog and the user's settings go in, alerts come out. Delivery (notifications, inbox) lives elsewhere.
import { bestDeal, dealText, dealUnit, money, stampMs, type Deals } from "./compare.ts";
import { basketFor, basketPoint, basketSig, daysBetween, dayKey, latestBasket, latestProduct, lowest, nearBasket, nearProduct, productPoint, type BasketPoint, type History, type ProductPoint } from "./history.ts";
import type { Cart, Catalog, Product } from "./types";

export type AlertKind = "promo" | "drop" | "basket" | "ending" | "digest";

export type AlertItem = {
  id: string; // dedupe key, unique per thing alerted about
  kind: AlertKind;
  at: number; // when it was produced
  title: string; // short label of the kind: "מבצע חדש"
  body: string; // the specific sentence
  code?: string; // product to open on tap
  score: number; // for picking the best when there are too many
};

export type Settings = {
  on: boolean; // system notifications (the in-app inbox always works)
  rules: Record<AlertKind, boolean>;
  dropPct: number; // (b) price drop in percent
  basketPct: number; // (c) basket drop in percent...
  basketMin: number; // ...or in agorot
  quiet: boolean;
  quietFrom: number; // minutes after midnight
  quietTo: number;
  anyClub: boolean; // alert about club-card deals even for chains whose card the user didn't tick
  digestDay: number; // 0 = Sunday ... 5 = Friday
};

export const DEFAULT_SETTINGS: Settings = {
  on: false,
  rules: { promo: true, drop: true, basket: true, ending: true, digest: false },
  dropPct: 5,
  basketPct: 5,
  basketMin: 1500,
  quiet: true,
  quietFrom: 22 * 60,
  quietTo: 7 * 60,
  anyClub: false,
  digestDay: 5,
};

export const DEDUPE_MS = 3 * 86_400_000; // the same alert isn't repeated within 3 days
export const MAX_PER_RUN = 3; // notifications per run
export const ENDING_MS = 48 * 3_600_000; // "ending soon" window
const FLIP_MIN = 100; // a different branch must be at least 1 ₪ cheaper to count as a flip
const FRESH_MS = 24 * 3_600_000; // an alert held back (quiet hours, rate limit) is dropped after this

export function mergeSettings(saved: Partial<Settings> | null | undefined): Settings {
  const s = saved ?? {};
  return { ...DEFAULT_SETTINGS, ...s, rules: { ...DEFAULT_SETTINGS.rules, ...(s.rules ?? {}) } };
}

/** "חלב תנובה 3% 1 ליטר מארז" -> shortened at a word boundary. */
export function shortName(name: string, max = 34): string {
  const n = name.replace(/\s+/g, " ").trim();
  if (n.length <= max) return n;
  const cut = n.slice(0, max);
  const sp = cut.lastIndexOf(" ");
  return (sp > max / 2 ? cut.slice(0, sp) : cut).replace(/[\s,\-–]+$/, "") + "…";
}

/** True when `now` falls in the quiet window (which may wrap midnight, 22:00-07:00). */
export function inQuietHours(now: number, s: Pick<Settings, "quiet" | "quietFrom" | "quietTo">): boolean {
  if (!s.quiet || s.quietFrom === s.quietTo) return false;
  const d = new Date(now);
  const m = d.getHours() * 60 + d.getMinutes();
  return s.quietFrom < s.quietTo ? m >= s.quietFrom && m < s.quietTo : m >= s.quietFrom || m < s.quietTo;
}

/** "היום ב־23:59" / "מחר ב־23:59" */
export function whenText(endMs: number, now: number): string {
  const e = new Date(endMs);
  const hm = `${String(e.getHours()).padStart(2, "0")}:${String(e.getMinutes()).padStart(2, "0")}`;
  const gap = daysBetween(dayKey(now), dayKey(endMs));
  const day = gap <= 0 ? "היום" : gap === 1 ? "מחר" : `ב־${e.getDate()}.${e.getMonth() + 1}`;
  return `${day} ב־${hm}`;
}

export type EvalInput = {
  catalog: Catalog;
  products: Map<string, Product>;
  active: number[]; // branches in range (not switched off)
  deals?: Deals; // built with the club cards the alerts should assume
  sig: string; // history.configSig of active + club: a change makes this run a new baseline
  followed: string[];
  usual: Cart | null; // the usual basket
  history: History; // before today's snapshot is recorded
  settings: Settings;
  now: number;
  sent: Record<string, number>; // dedupe memory: key -> when alerted
  lastDigest: number | null;
};

export type EvalOut = {
  alerts: AlertItem[]; // new alerts, best first
  sent: Record<string, number>;
  lastDigest: number | null;
  points: Record<string, ProductPoint>; // today's numbers, for history.record
  basket: BasketPoint | null;
};

const chainOf = (c: Catalog, id: string) => c.stores.find(s => s.id === id)?.chain ?? "";
const pctOf = (from: number, to: number) => (from ? ((from - to) / from) * 100 : 0);

export function evaluate(i: EvalInput): EvalOut {
  const { catalog, products, active, deals, followed, usual, history, settings: s, now } = i;
  const today = dayKey(now);
  const sent: Record<string, number> = {};
  for (const [k, t] of Object.entries(i.sent)) if (now - t < 14 * 86_400_000) sent[k] = t;
  const alerts: AlertItem[] = [];
  const points: Record<string, ProductPoint> = {};
  const fresh = (key: string) => !(key in sent && now - sent[key] < DEDUPE_MS);
  const push = (a: Omit<AlertItem, "at">) => {
    if (!fresh(a.id)) return false;
    sent[a.id] = now;
    alerts.push({ ...a, at: now });
    return true;
  };
  // A previous point is a baseline only when it is recent and was computed for the same branches and cards.
  const prevOf = (code: string) => {
    const p = latestProduct(history, code);
    return p && daysBetween(p.day, today) <= 14 && p.sig === i.sig ? p.v : null;
  };

  for (const code of followed) {
    const p = products.get(code);
    if (!p) continue;
    const cur = productPoint(p, active, catalog, deals);
    if (!cur) continue;
    points[code] = cur;
    const prev = prevOf(code);
    const name = shortName(p.name);
    let promoAlerted = false;

    if (s.rules.promo && prev && cur.deal && !prev.deal) {
      const d = bestDeal(p, active, deals);
      if (d) {
        const chain = catalog.stores[d.i].chain;
        const off = pctOf(d.shelf, d.unit);
        promoAlerted = push({
          id: `promo:${code}`, kind: "promo", code, title: "מבצע חדש", score: 60 + Math.min(off, 40),
          body: `${name}: מבצע ${dealText(d.promo)} ב${chain}${d.promo.kind === "bundle" ? ` (${money(d.unit)} ליחידה)` : ""}, במקום ${money(d.shelf)}`,
        });
      }
    }

    if (s.rules.drop && prev && !promoAlerted && cur.eff < prev.eff) {
      const pct = pctOf(prev.eff, cur.eff);
      const low = lowest(history, code, now, 30, today);
      const newLow = low != null && cur.eff < low && pct >= 1;
      if (pct >= s.dropPct || newLow) {
        push({
          id: `drop:${code}`, kind: "drop", code, title: newLow ? "הכי נמוך ב־30 יום" : "ירידת מחיר", score: 30 + Math.min(pct, 40) + (newLow ? 10 : 0),
          body: `${name}: ${money(cur.eff)} ₪ ב${chainOf(catalog, cur.effStore)}, ירד מ־${money(prev.eff)}${newLow ? " · הכי נמוך ב־30 יום" : ""}`,
        });
      }
    }

    if (s.rules.ending && !promoAlerted) {
      const d = bestDeal(p, active, deals);
      const end = stampMs(d?.promo.end);
      if (d && end != null && end > now && end - now <= ENDING_MS) {
        push({
          id: `end:${code}:${catalog.stores[d.i].id}:${d.promo.id}:${d.promo.end}`, kind: "ending", code, title: "המבצע נגמר בקרוב", score: 50 + (ENDING_MS - (end - now)) / ENDING_MS * 10,
          body: `${name}: ${dealText(d.promo)} ב${catalog.stores[d.i].chain}, נגמר ${whenText(end, now)}`,
        });
      }
    }
  }

  // The usual basket.
  let basket: BasketPoint | null = null;
  const cmp = usual ? basketFor(products, usual, active, deals) : null;
  if (usual && cmp) {
    basket = basketPoint(cmp, catalog, usual);
    const prevB = latestBasket(history);
    const same = basket && prevB && daysBetween(prevB.day, today) <= 14 && prevB.sig === i.sig && prevB.v.sig === basketSig(usual) && prevB.v.missing === basket.missing;
    if (basket && prevB && same && s.rules.basket) {
      const drop = prevB.v.total - basket.total;
      const pct = pctOf(prevB.v.total, basket.total);
      const dropped = drop > 0 && (pct >= s.basketPct || drop >= s.basketMin);
      const prevRow = cmp.rows.find(r => catalog.stores[r.i].id === prevB.v.store);
      const flipped = basket.store !== prevB.v.store && !!prevRow && prevRow.total - basket.total >= FLIP_MIN;
      const chain = chainOf(catalog, basket.store);
      if (flipped) {
        push({
          id: `basket:flip:${basket.store}`, kind: "basket", title: "הסל הרגיל", score: 75,
          body: `הסל הרגיל: עכשיו הכי זול ב${chain} (${money(basket.total)} ₪), במקום ${chainOf(catalog, prevB.v.store)} (${money(prevRow!.total)} ₪)`,
        });
      } else if (dropped) {
        push({
          id: "basket:drop", kind: "basket", title: "הסל הרגיל", score: 70 + Math.min(pct, 20),
          body: `הסל הרגיל: ${money(basket.total)} ₪ ב${chain}, ירד מ־${money(prevB.v.total)}`,
        });
      }
    }
    if (s.rules.ending) {
      for (const l of cmp.lines) {
        const pr = l.best?.promo;
        const end = stampMs(pr?.end);
        if (!pr || end == null || end <= now || end - now > ENDING_MS || followed.includes(l.p.code)) continue;
        const st = catalog.stores[l.best!.i];
        push({
          id: `end:${l.p.code}:${st.id}:${pr.id}:${pr.end}`, kind: "ending", code: l.p.code, title: "המבצע נגמר בקרוב", score: 45,
          body: `${shortName(l.p.name)} (מהסל הרגיל): ${dealText(pr)} ב${st.chain}, נגמר ${whenText(end, now)}`,
        });
      }
    }
  }

  let lastDigest = i.lastDigest;
  if (s.rules.digest && digestDue(now, lastDigest, s.digestDay)) {
    const d = digest(i, points, basket);
    if (d) { alerts.push(d); lastDigest = now; }
  }

  alerts.sort((a, b) => b.score - a.score);
  return { alerts, sent, lastDigest, points, basket };
}

/** The digest goes out on the chosen weekday; a missed week catches up on the next run. */
export function digestDue(now: number, last: number | null, day: number): boolean {
  const since = last == null ? Infinity : (now - last) / 86_400_000;
  if (since < 5) return false;
  return new Date(now).getDay() === day || (last != null && since >= 8);
}

/** "הדילים הטובים של השבוע": up to 5 followed products and the basket, by biggest drop in a week or current deal. */
function digest(i: EvalInput, points: Record<string, ProductPoint>, basket: BasketPoint | null): AlertItem | null {
  const { catalog, products, history, now } = i;
  const rows: { score: number; line: string }[] = [];
  for (const [code, cur] of Object.entries(points)) {
    const p = products.get(code)!;
    const wk = nearProduct(history, code, now, 7);
    const weekPct = wk && wk.sig === i.sig ? pctOf(wk.v.eff, cur.eff) : 0;
    const dealPct = cur.deal ? pctOf(cur.lo, cur.eff) : 0;
    const score = Math.max(weekPct, dealPct);
    if (score < 1) continue;
    const how = weekPct >= dealPct ? `ירד ${Math.round(weekPct)}% השבוע` : `מבצע, ${Math.round(dealPct)}% פחות`;
    rows.push({ score, line: `${shortName(p.name, 28)}: ${money(cur.eff)} ₪ ב${chainOf(catalog, cur.effStore)} (${how})` });
  }
  if (basket && i.usual) {
    const wk = nearBasket(history, now, 7);
    if (wk && wk.sig === i.sig && wk.v.sig === basket.sig) {
      const pct = pctOf(wk.v.total, basket.total);
      if (pct >= 1) rows.push({ score: pct + 20, line: `הסל הרגיל: ${money(basket.total)} ₪ ב${chainOf(catalog, basket.store)} (ירד ${Math.round(pct)}% השבוע)` });
    }
  }
  if (!rows.length) return null;
  rows.sort((a, b) => b.score - a.score);
  return { id: `digest:${dayKey(now)}`, kind: "digest", at: now, title: "הדילים הטובים של השבוע", body: rows.slice(0, 5).map(r => `• ${r.line}`).join("\n"), score: 20 };
}

// ---- Inbox and delivery --------------------------------------------------------------------

export type InboxItem = AlertItem & { read: boolean; notified: boolean };
export const INBOX_MAX = 60;
export const INBOX_DAYS = 30;

/** Adds new alerts to the inbox (newest first), dropping old items and capping the length. */
export function mergeInbox(inbox: InboxItem[], fresh: AlertItem[], now: number): InboxItem[] {
  const have = new Set(inbox.map(x => x.id));
  const add = fresh.filter(a => !have.has(a.id)).map(a => ({ ...a, read: false, notified: false }));
  return [...add, ...inbox].filter(x => now - x.at < INBOX_DAYS * 86_400_000).sort((a, b) => b.at - a.at || b.score - a.score).slice(0, INBOX_MAX);
}

export type ToSend = { id: string; title: string; body: string; code?: string };

/**
 * Chooses what to show as system notifications now. Nothing while notifications are off or in quiet
 * hours (alerts wait, up to 24 h). At most `max` per run: when more are waiting, the best `max - 1` go out
 * plus one summary line. Items older than 24 h are marked as notified without being sent.
 */
export function pickNotifications(inbox: InboxItem[], now: number, s: Settings, max = MAX_PER_RUN): { send: ToSend[]; inbox: InboxItem[] } {
  if (!s.on || inQuietHours(now, s)) return { send: [], inbox };
  const stale = (x: InboxItem) => now - x.at >= FRESH_MS;
  const waiting = inbox.filter(x => !x.notified && !stale(x)).sort((a, b) => b.score - a.score);
  const send: ToSend[] = [];
  if (waiting.length <= max) for (const x of waiting) send.push({ id: x.id, title: x.title, body: x.body, code: x.code });
  else {
    for (const x of waiting.slice(0, max - 1)) send.push({ id: x.id, title: x.title, body: x.body, code: x.code });
    send.push({ id: `more:${now}`, title: "עוד עדכונים", body: `ועוד ${waiting.length - (max - 1)} עדכונים בתיבת מה חדש` });
  }
  const done = new Set(waiting.map(x => x.id));
  return { send, inbox: inbox.map(x => (done.has(x.id) || (!x.notified && stale(x)) ? { ...x, notified: true } : x)) };
}

export const unreadCount = (inbox: InboxItem[]) => inbox.filter(x => !x.read).length;
