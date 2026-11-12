import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { Card, ModalHead, Pct, PctBar, SectionHead, useModalPadding } from "../components/blocks";
import { Num, ProductImage, T, useTheme } from "../components/ui";
import { money, storeKm } from "../lib/compare";
import { fileLagHours, priceIndex, topGaps } from "../lib/insights";
import { useData } from "../lib/store";

/** The price index in full: every branch, overall or for one category, and the products with the widest gaps. */
export default function Insights() {
  const t = useTheme();
  const router = useRouter();
  const pad = useModalPadding();
  const { catalog, products, active } = useData();
  const [cat, setCat] = useState("all");

  const rows = useMemo(() => (catalog ? priceIndex(products.values(), active, cat === "all" ? {} : { cat }) : []), [catalog, products, active, cat]);
  const gaps = useMemo(() => {
    if (!catalog) return [];
    const list = cat === "all" ? products.values() : [...products.values()].filter(p => p.cat === cat);
    return topGaps(list, active, 15);
  }, [catalog, products, active, cat]);

  if (!catalog) return <ScrollView contentContainerStyle={pad}><ModalHead title="מדד המחירים" /><T style={{ color: t.ink2 }}>בחרו מיקום ועדכנו מחירים כדי לראות את המדד.</T></ScrollView>;

  const span = rows.length ? Math.max(...rows.map(r => Math.abs(r.pct))) : 1;
  const unranked = active.length - rows.length;
  return (
    <ScrollView contentContainerStyle={pad}>
      <ModalHead title="מדד המחירים סביבכם" sub="כמה כל סניף יקר או זול ביחס לאחרים, על מוצרים שנמכרים בכמה סניפים. מחירי מדף, בלי מבצעים." />

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {[{ id: "all", name: "כל המוצרים" }, ...catalog.categories].map(c => (
          <Pressable key={c.id} onPress={() => setCat(c.id)} accessibilityRole="button" accessibilityState={{ selected: cat === c.id }}
            style={{ paddingHorizontal: 14, minHeight: 40, justifyContent: "center", borderRadius: 12, backgroundColor: cat === c.id ? t.brand : t.surface2 }}>
            <Text style={{ fontWeight: "600", color: cat === c.id ? t.brandInk : t.ink }}>{c.name}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <Card>
        {rows.length ? rows.map((r, k) => {
          const s = catalog.stores[r.i];
          const d = storeKm(catalog, r.i);
          return (
            <Pressable key={s.id} onPress={() => router.push({ pathname: "/map", params: { store: s.id } })} accessibilityRole="button"
              accessibilityLabel={`מקום ${k + 1}: ${s.chain}, ${s.branch}. ${Math.abs(r.pct).toFixed(1)} אחוז ${r.pct <= 0 ? "מתחת" : "מעל"} למחיר המקובל. מפה וניווט`}
              style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 4 }}>
              <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: k === 0 ? t.tag : t.surface2, alignItems: "center", justifyContent: "center" }}>
                <Text style={{ fontWeight: "800", color: k === 0 ? t.tagInk : t.ink, fontVariant: ["tabular-nums"] }}>{k + 1}</Text>
              </View>
              <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                  <T numberOfLines={1} style={{ fontWeight: "700", fontSize: 15.5, flexShrink: 1 }}>{s.chain}</T>
                  <Pct pct={r.pct} />
                </View>
                <PctBar pct={r.pct} max={span} />
                <T numberOfLines={1} style={{ color: t.ink2, fontSize: 12.5 }}>{s.branch}{d != null ? ` · ${d.toFixed(1)} ק״מ` : ""}</T>
                <T numberOfLines={1} style={{ color: t.ink2, fontSize: 12 }}>הזול ביותר ב־{r.cheapest.toLocaleString("he-IL")} מתוך {r.n.toLocaleString("he-IL")} מוצרים</T>
                {(fileLagHours(catalog, r.i) ?? 0) > 36 ? <T style={{ color: t.warn, fontSize: 12, fontWeight: "600" }}>מחירון מלפני {Math.round(fileLagHours(catalog, r.i)! / 24)} ימים</T> : null}
              </View>
            </Pressable>
          );
        }) : <T style={{ color: t.ink2 }}>אין מספיק מוצרים משותפים בקטגוריה הזאת כדי לדרג את הסניפים.</T>}
        {rows.length && unranked > 0 ? <T style={{ color: t.ink2, fontSize: 12.5 }}>{unranked} סניפים לא דורגו: מעט מדי מוצרים משותפים.</T> : null}
      </Card>

      <Card>
        <SectionHead title="איך זה מחושב" />
        <T style={{ color: t.ink2, fontSize: 13, lineHeight: 20 }}>
          לכל מוצר שנמכר בשלושה סניפים לפחות מחשבים את המחיר החציוני באזור, ובודקים בכמה אחוזים כל סניף מעליו או מתחתיו. המדד של סניף הוא הממוצע על כל המוצרים שלו. מחיר של מוצר שהסניף לא מכר חודש ומעלה לא נספר, כי סביר שהוא לא על המדף. המדד משווה רמת מחירים כללית; לסל מסוים, ההשוואה בלשונית הסל מדויקת יותר.
        </T>
      </Card>

      {gaps.length ? (
        <Card>
          <SectionHead title="פערי המחירים הגדולים" sub="אותו מוצר בדיוק, המחיר הנמוך והגבוה בסניפים שסביבכם" />
          {gaps.map(g => (
            <Pressable key={g.p.code} onPress={() => router.push(`/product/${encodeURIComponent(g.p.code)}`)} accessibilityRole="button"
              accessibilityLabel={`${g.p.name}: מ־${money(g.lo)} עד ${money(g.hi)} ₪`} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <ProductImage p={g.p} size={44} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <T numberOfLines={1} style={{ fontWeight: "600", fontSize: 14 }}>{g.p.name}</T>
                <T numberOfLines={1} style={{ color: t.ink2, fontSize: 12.5 }}>זול ב{catalog.stores[g.loAt].chain} · יקר ב{catalog.stores[g.hiAt].chain}</T>
              </View>
              <View style={{ alignItems: "flex-start" }}>
                <Num style={{ fontWeight: "800", fontSize: 14.5 }}>{money(g.lo)}–{money(g.hi)} ₪</Num>
                <T style={{ color: t.warn, fontSize: 12, fontWeight: "700" }}>פער {g.pct}%</T>
              </View>
            </Pressable>
          ))}
        </Card>
      ) : null}
    </ScrollView>
  );
}
