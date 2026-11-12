// A tiny typed translation helper. Hebrew is the source table (he.ts); English (en.ts) must have exactly the same keys,
// which the compiler checks. Only the screens added with this helper use it: the branch map, settings, onboarding
// and the share buttons. The older screens still hold their Hebrew inline.
import { en } from "./en.ts";
import { he } from "./he.ts";

export type Lang = "he" | "en";
export type MsgKey = keyof typeof he;
export type Params = Record<string, string | number>;

export const LANGS: Lang[] = ["he", "en"];
/** Each language in its own name, as language pickers show them. */
export const LANG_NAMES: Record<Lang, string> = { he: "עברית", en: "English" };

const tables: Record<Lang, Record<MsgKey, string>> = { he, en };

/** The text for a key in a language; "{name}" placeholders are filled from params. A missing English text falls back to Hebrew. */
export function translate(lang: Lang, key: MsgKey, params?: Params): string {
  const s = tables[lang][key] || he[key];
  return params ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m)) : s;
}

let current: Lang = "he";
export const setLanguage = (lang: Lang) => { current = lang; };
export const getLanguage = (): Lang => current;

/** Translate in the current language. Components use useSettings().t, which also re-renders them when the language changes. */
export const t = (key: MsgKey, params?: Params) => translate(current, key, params);
