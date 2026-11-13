import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { TextStyle } from "react-native";
import { setLanguage, translate, type Lang, type MsgKey, type Params } from "../i18n";
import { DEFAULT_KM_COST, DEFAULT_RADIUS, PREF_KEY, parseLang, parseRadius, parseStoredKmCost } from "./prefs";

type SettingsCtx = {
  ready: boolean; // finished reading the saved settings
  kmCost: number; // ₪ per extra km (salzol:kmcost)
  setKmCost(n: number): void;
  radius: number; // default search radius, km
  setRadius(km: number): void;
  lang: Lang;
  setLang(l: Lang): void;
  /** Translate in the chosen language (re-renders when it changes). */
  t(key: MsgKey, params?: Params): string;
  dir: "rtl" | "ltr"; // layout direction for the translated screens
  tx: TextStyle; // text alignment for those screens: T is right-aligned Hebrew, English wants left
  /** null while loading; false on a first run. */
  onboarded: boolean | null;
  finishOnboarding(): void;
};

const C = createContext<SettingsCtx | null>(null);

async function read(k: string): Promise<unknown> {
  try {
    const v = await AsyncStorage.getItem(k);
    return v == null ? undefined : JSON.parse(v);
  } catch {
    return undefined;
  }
}
const write = (k: string, v: unknown) => AsyncStorage.setItem(k, JSON.stringify(v)).catch(() => {});

const LTR_TEXT: TextStyle = { textAlign: "left", writingDirection: "ltr" };

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [kmCost, setKm] = useState(DEFAULT_KM_COST);
  const [radius, setRad] = useState(DEFAULT_RADIUS);
  const [lang, setLangState] = useState<Lang>("he");
  const [onboarded, setOnboarded] = useState<boolean | null>(null);

  useEffect(() => {
    (async () => {
      const [k, r, l, o] = await Promise.all([read(PREF_KEY.kmCost), read(PREF_KEY.radius), read(PREF_KEY.lang), read(PREF_KEY.onboarded)]);
      setKm(parseStoredKmCost(k)); setRad(parseRadius(r));
      const lg = parseLang(l);
      setLanguage(lg); setLangState(lg);
      setOnboarded(o === true);
      setReady(true);
    })();
  }, []);

  const setKmCost = useCallback((n: number) => { setKm(n); write(PREF_KEY.kmCost, n); }, []);
  const setRadius = useCallback((n: number) => { setRad(n); write(PREF_KEY.radius, n); }, []);
  const setLang = useCallback((l: Lang) => { setLanguage(l); setLangState(l); write(PREF_KEY.lang, l); }, []);
  const finishOnboarding = useCallback(() => { setOnboarded(true); write(PREF_KEY.onboarded, true); }, []);
  const t = useCallback((key: MsgKey, params?: Params) => translate(lang, key, params), [lang]);

  const value = useMemo<SettingsCtx>(() => ({
    ready, kmCost, setKmCost, radius, setRadius, lang, setLang, t, dir: lang === "en" ? "ltr" : "rtl", tx: lang === "en" ? LTR_TEXT : {}, onboarded, finishOnboarding,
  }), [ready, kmCost, setKmCost, radius, setRadius, lang, setLang, t, onboarded, finishOnboarding]);
  return <C.Provider value={value}>{children}</C.Provider>;
}

export function useSettings(): SettingsCtx {
  const v = useContext(C);
  if (!v) throw new Error("useSettings outside SettingsProvider");
  return v;
}
