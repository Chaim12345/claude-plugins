// The plain Hebrew text people send each other (WhatsApp, SMS, notes): the cart, or one product's best price.
// The cart format reads like any shopping list, and the paste-list screen takes it back:
// `parseList(itemLines(text))` gives the same items and quantities (see shareText.test.ts). Pure, no React.
import { money } from "./compare.ts";

export type ShareLine = { name: string; qty: number; weighted: boolean };
export type ShareBest = { chain: string; branch: string; total: number; missing: number }; // total in agorot

/** The app's name in every shared text. */
export const SHARE_APP = "סל זול";
/** Where "סל זול" can be found; override with EXPO_PUBLIC_SALZOL_SHARE_URL at build time. */
export const DEFAULT_SHARE_URL = "https://github.com/Chaim12345/claude-plugins/tree/main/plugins/il-supermarket-compare";

/** First line of a shared cart. Everything up to the first blank line below it is the item list. */
export const CART_HEADER = `🛒 רשימת קניות · ${SHARE_APP}`;

const INVISIBLE = /[​-‏‪-‮⁦-⁩﻿ ]/g;
const KG_WORD = /(^|\s)(?:ק["'״׳]?ג|קילו|קילוגרם)(?=\s|$)/g;

/** "2", "1.5", never "1.50" or "2.0". */
export const fmtQty = (q: number) => String(Math.round(q * 10) / 10);

/**
 * A product name that survives the paste-list parser: no commas or semicolons (they split items), no
 * leading bullets, and for fresh produce no stray "ק״ג" (the quantity already carries the unit).
 */
export function cleanItemName(name: string, weighted = false): string {
  let s = name.replace(INVISIBLE, " ").replace(/[,،;؛]/g, " ").replace(/\s+\+\s+/g, " ");
  if (weighted) s = s.replace(KG_WORD, " ");
  s = s.replace(/\s+/g, " ").trim().replace(/^(?:[-–—•*>+]+\s*)+/, "").replace(/(?:\s*[+\-–—])+$/, "");
  return s || name.trim();
}

/**
 * "חלב 3% תנובה ×2" for packaged items, "1.5 ק״ג עגבניות" for items sold by weight. The count goes after the
 * name: in front, "2 × 7 אפ" would read as ×7 (the parser takes the number after a "×").
 */
export function formatItem(l: ShareLine): string {
  const name = cleanItemName(l.name, l.weighted);
  return l.weighted ? `${fmtQty(l.qty)} ק״ג ${name}` : `${name} ×${fmtQty(l.qty)}`;
}

export type CartShareOpts = { link?: string; priceDate?: string };

function footer(link?: string): string {
  return `${SHARE_APP} · השוואת מחירי סופר לפי המחירונים הרשמיים${link ? ` · ${link}` : ""}`;
}

/** The whole cart as text: header, one line per item, then the cheapest branch and the app line. */
export function formatCart(lines: ShareLine[], best: ShareBest | null, opts: CartShareOpts = {}): string {
  const out = [CART_HEADER, ...lines.map(formatItem), ""];
  if (best) {
    out.push(`💰 הכי זול: ${best.chain}${best.branch ? `, ${best.branch}` : ""} · ${money(best.total)} ₪`);
    if (best.missing) out.push(`⚠ חסרים בסניף הזה: ${best.missing} פריטים`);
  }
  if (opts.priceDate) out.push(`📅 מחירים ליום ${opts.priceDate}`);
  out.push(footer(opts.link));
  return out.join("\n");
}

/**
 * The item lines of a shared cart; any other text comes back unchanged (an ordinary pasted list).
 * This is what lets the paste-list screen take the format of formatCart without the header, the
 * cheapest-branch line and the app line turning into "products".
 */
export function itemLines(text: string): string {
  const lines = text.replace(/\r/g, "").split("\n");
  const head = lines.findIndex(l => /^\s*🛒.*סל זול/.test(l.replace(INVISIBLE, "")));
  if (head < 0) return text;
  const items: string[] = [];
  for (const l of lines.slice(head + 1)) {
    const t = l.replace(INVISIBLE, " ").trim();
    if (!t || /^(?:💰|⚠|📅|סל זול)/u.test(t)) break;
    items.push(t);
  }
  return items.join("\n");
}

export type ProductShare = {
  name: string;
  chain: string; // where it's cheapest
  branch: string;
  price: number; // agorot, the lowest shelf price
  highest: number | null; // agorot, the dearest among the compared branches
  branches: number; // how many compared branches sell it
  weighted: boolean;
  deal?: { chain: string; text: string } | null; // best promotion among compared branches
};

/** One product's best price, as text to send. */
export function formatProduct(p: ProductShare, opts: { link?: string } = {}): string {
  const unit = p.weighted ? " לק״ג" : "";
  const out = [`🏷 ${cleanItemName(p.name, p.weighted)}`, `💰 הכי זול: ${money(p.price)} ₪${unit} ב${p.chain}${p.branch ? ` (${p.branch})` : ""}`];
  if (p.highest != null && p.highest > p.price) {
    out.push(`📊 ב־${p.branches} סניפים: ${money(p.price)} עד ${money(p.highest)} ₪, פער של ${money(p.highest - p.price)} ₪`);
  }
  if (p.deal) out.push(`🔖 מבצע ב${p.deal.chain}: ${p.deal.text}`);
  out.push(footer(opts.link));
  return out.join("\n");
}
