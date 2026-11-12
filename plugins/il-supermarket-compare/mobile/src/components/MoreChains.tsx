import { useEffect, useState } from "react";
import { Linking, Text, View } from "react-native";
import { money, type Comparison } from "../lib/compare";
import { engine } from "../lib/engine";
import type { Catalog, MoreResult, Place } from "../lib/types";
import { Num, T, useTheme } from "./ui";

/** Branches of chains the catalog doesn't cover (Victory, Carrefour, Yellow...), priced through the
 * Open Israeli Supermarkets API. Coverage there is partial, so they're listed apart from the ranking
 * and compared item for item with the best local branch. */
export function MoreChains({ catalog, comparison: c, active, place }: { catalog: Catalog; comparison: Comparison; active: number[]; place: Place | null }) {
  const t = useTheme();
  const items = c.items.filter(([p]) => /^\d{7,14}$/.test(p.code));
  const codes = items.map(([p]) => p.code).sort().join(",");
  const [data, setData] = useState<MoreResult | null | "loading">(null);

  useEffect(() => {
    if (!place || !codes) return setData(null);
    let live = true;
    setData("loading");
    const timer = setTimeout(() => {
      engine.more(place, codes.split(",")).then(d => live && setData(d)).catch(e => live && setData({ error: String(e?.message ?? e) }));
    }, 700);
    return () => { live = false; clearTimeout(timer); };
  }, [place, codes]);

  if (data === null) return null;
  const head = <T style={{ fontSize: 18, fontWeight: "800" }}>רשתות נוספות</T>;
  if (data === "loading") return <View style={{ gap: 6 }}>{head}<T style={{ color: t.ink2, fontSize: 13 }}>בודק את המוצרים ברשתות נוספות (ויקטורי, קרפור, יילו ועוד)…</T></View>;
  if ("error" in data) return <View style={{ gap: 6 }}>{head}<T style={{ color: t.ink2, fontSize: 13 }}>לא הצלחנו לבדוק רשתות נוספות: {data.error}</T></View>;

  const rows = data.stores.map(s => {
    const covered = items.filter(([p]) => s.prices[p.code] != null);
    const total = covered.reduce((x, [p, q]) => x + s.prices[p.code] * q, 0);
    let local: { t: number; i: number } | null = null;
    for (const i of active) {
      if (!covered.every(([p]) => p.prices[i] != null)) continue;
      const v = covered.reduce((x, [p, q]) => x + p.prices[i]! * q, 0);
      if (!local || v < local.t) local = { t: v, i };
    }
    return { s, covered, total, local, diff: local ? (total / local.t - 1) * 100 : null };
  }).sort((a, b) => (a.diff ?? 999) - (b.diff ?? 999));

  return (
    <View style={{ gap: 8 }}>
      {head}
      {rows.length ? rows.map(({ s, covered, total, local, diff }) => (
        <View key={`${s.chainCode}:${s.branch}`} style={{ borderWidth: 1, borderColor: t.line, borderRadius: 12, padding: 12, gap: 2 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
            <T style={{ fontWeight: "700", flexShrink: 1 }}>{s.chain}</T>
            <Num style={{ fontWeight: "800", fontSize: 17 }}>{money(total)} ₪</Num>
          </View>
          <T numberOfLines={1} style={{ color: t.ink2, fontSize: 12.5 }}>{s.branch} · {s.km.toFixed(1)} ק״מ{s.approx ? "~" : ""} · {covered.length} מתוך {items.length} מוצרים</T>
          {local && diff != null ? (
            <T style={{ fontSize: 12.5, fontWeight: "700", color: diff <= 0 ? t.good : t.warn }}>
              {diff <= 0 ? `${Math.abs(diff).toFixed(1)}% פחות מ${catalog.stores[local.i].chain}` : `+${diff.toFixed(1)}% לעומת ${catalog.stores[local.i].chain}`} על אותם מוצרים
            </T>
          ) : null}
        </View>
      )) : <T style={{ color: t.ink2, fontSize: 13 }}>לא מצאנו בטווח סניפים של רשתות נוספות עם מחירים לרוב המוצרים בסל.</T>}
      <T style={{ color: t.ink2, fontSize: 12 }}>
        מקור: <Text style={{ color: t.brand, textDecorationLine: "underline" }} onPress={() => Linking.openURL(("sourceUrl" in data && data.sourceUrl) || "https://github.com/OpenIsraeliSupermarkets")}>Open Israeli Supermarkets</Text>. הכיסוי שם חלקי, ולכן הרשתות האלה לא נכללות בדירוג.
      </T>
    </View>
  );
}
