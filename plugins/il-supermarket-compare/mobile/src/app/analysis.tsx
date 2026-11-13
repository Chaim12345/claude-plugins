import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button, T, useTheme } from "../components/ui";
import { brandIndex, coverage, dietCounts, ownBrandSavings, priced, typeGroups, type TypeGroup } from "../lib/analysis";
import { money } from "../lib/compare";
import { DIET_LABEL } from "../lib/enrich";
import { useData } from "../lib/store";
import { unitText } from "../lib/units";

/** "ניתוח נתונים": what the classified catalog says, measured within each product type. */
export default function AnalysisScreen() {
  const t = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { products, active, catalog } = useData();
  const [typesShown, setTypesShown] = useState(25);

  const a = useMemo(() => {
    const cov = coverage(products.values());
    const xs = priced(products.values(), active);
    const groups = typeGroups(xs);
    return { cov, groups, brands: brandIndex(xs, groups), own: ownBrandSavings(xs), diet: dietCounts(products.values()) };
  }, [products, active]);
  const open = (code: string) => router.push(`/product/${encodeURIComponent(code)}`);
  const pct = (r: number) => `${r < 1 ? "−" : "+"}${Math.abs(Math.round((r - 1) * 100))}%`;
  // below the type median on average, and above it: two lists that never repeat a brand
  const cheapBrands = a.brands.filter(b => b.index < 1).slice(0, 12), dearBrands = a.brands.filter(b => b.index >= 1).reverse().slice(0, 12);
  const storeName = (i: number) => (catalog ? `${catalog.stores[i].chain}${catalog.stores[i].branch ? ` · ${catalog.stores[i].branch}` : ""}` : "");

  const Section = ({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) => (
    <View style={{ backgroundColor: t.surface, borderRadius: 14, padding: 14, gap: 8 }}>
      <T accessibilityRole="header" style={{ fontSize: 17, fontWeight: "800" }}>{title}</T>
      {sub ? <T style={{ color: t.ink2, fontSize: 12.5, lineHeight: 18 }}>{sub}</T> : null}
      {children}
    </View>
  );
  const Row = ({ left, right, color, onPress }: { left: string; right: string; color?: string; onPress?: () => void }) => (
    <Pressable onPress={onPress} disabled={!onPress} accessibilityRole={onPress ? "link" : undefined} style={{ flexDirection: "row", justifyContent: "space-between", gap: 10, paddingVertical: 3 }}>
      <T style={{ flex: 1, fontSize: 13.5 }} numberOfLines={2}>{left}</T>
      <T style={{ fontSize: 13.5, fontWeight: "700", color: color ?? t.ink, fontVariant: ["tabular-nums"] }}>{right}</T>
    </Pressable>
  );

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingTop: insets.top + 12, paddingBottom: insets.bottom + 40, gap: 12 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <T accessibilityRole="header" style={{ fontSize: 22, fontWeight: "800" }}>ניתוח נתונים</T>
          <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="סגירה" hitSlop={10}><Ionicons name="close" size={26} color={t.ink} /></Pressable>
        </View>
        <T style={{ color: t.ink2, fontSize: 13, lineHeight: 19 }}>
          כל השוואה כאן נעשית בתוך אותו סוג מוצר ולפי מחיר ליחידה (ל־100 גרם, לליטר או ליחידה), במחיר הזול ביותר בסניפים שבחרתם, כך שמותג גבינות נמדד מול גבינות ולא מול מלח.
        </T>
        <Section title="מה סווג" sub={`${a.cov.done.toLocaleString("he-IL")} מתוך ${a.cov.total.toLocaleString("he-IL")} מוצרים · ${a.cov.types.toLocaleString("he-IL")} סוגי מוצרים · ${a.cov.brands.toLocaleString("he-IL")} מותגים${a.cov.unsure ? ` · ${a.cov.unsure} שהמודל לא היה בטוח בהם (לא נכללים)` : ""}`}>
          {a.cov.done < a.cov.total ? <Button kind="ghost" title="לסיווג שאר המוצרים" onPress={() => router.push("/catalog")} /> : null}
        </Section>

        {a.own.length ? (
          <Section title="מותג פרטי מול מותגים" sub="כמה זול המותג של הרשת לעומת המותגים הארציים מאותו סוג מוצר (חציון)">
            {a.own.map(o => <Row key={o.brand} left={`${o.brand} (${o.n} מוצרים)`} right={o.savePct >= 0 ? `זול ב־${Math.round(o.savePct)}%` : `יקר ב־${Math.round(-o.savePct)}%`} color={o.savePct >= 0 ? t.good : t.bad} />)}
          </Section>
        ) : null}

        {cheapBrands.length ? (
          <Section title="מותגים זולים מהרגיל" sub="מחיר ליחידה לעומת החציון של אותו סוג מוצר, בממוצע על כל מוצרי המותג (5 מוצרים לפחות, בשני סוגים לפחות)">
            {cheapBrands.map(b => <Row key={b.brand} left={`${b.brand}${b.own ? " · מותג פרטי" : ""} (${b.n} מוצרים, ${b.types} סוגים)`} right={pct(b.index)} color={t.good} />)}
          </Section>
        ) : null}
        {dearBrands.length ? (
          <Section title="מותגים יקרים מהרגיל" sub="אותו חישוב: כמה יותר משלמים על המותג לעומת מוצר טיפוסי מאותו סוג">
            {dearBrands.map(b => <Row key={b.brand} left={`${b.brand}${b.own ? " · מותג פרטי" : ""} (${b.n} מוצרים, ${b.types} סוגים)`} right={pct(b.index)} color={t.bad} />)}
          </Section>
        ) : null}

        {a.groups.length ? (
          <Section title="הכי זול ליחידה בכל סוג מוצר" sub="הסוגים הגדולים קודם. לחיצה פותחת את המוצר.">
            {a.groups.slice(0, typesShown).map(g => <TypeRow key={`${g.type}|${g.kind}`} g={g} open={open} storeName={storeName} />)}
            {a.groups.length > typesShown ? <Button kind="ghost" title={`עוד סוגים (${a.groups.length - typesShown})`} onPress={() => setTypesShown(n => n + 25)} /> : null}
          </Section>
        ) : null}

        {a.diet.length ? (
          <Section title="תזונה וכשרות" sub="לפי מה שכתוב בשם המוצר. אפשר לסנן לפיהם במסך המוצרים.">
            {a.diet.map(d => <Row key={d.tag} left={DIET_LABEL[d.tag]} right={`${d.n.toLocaleString("he-IL")} מוצרים`} />)}
          </Section>
        ) : null}

        {!a.cov.done ? <T style={{ color: t.ink2 }}>עוד אין מוצרים מסווגים. הגדירו מפתח AI והפעילו את הסיווג בניהול הקטלוג.</T> : null}
      </ScrollView>
    </View>
  );
}

function TypeRow({ g, open, storeName }: { g: TypeGroup; open: (code: string) => void; storeName: (i: number) => string }) {
  const t = useTheme();
  const c = g.cheapest;
  const save = Math.round((1 - c.unit.agorot / g.median) * 100);
  return (
    <Pressable onPress={() => open(c.p.code)} accessibilityRole="link" style={{ borderTopWidth: 1, borderTopColor: t.line, paddingVertical: 8, gap: 2 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
        <T style={{ fontWeight: "800", fontSize: 14 }}>{g.type}</T>
        <T style={{ color: t.ink2, fontSize: 12 }}>{g.n} מוצרים{g.brands ? ` · ${g.brands === 1 ? "מותג אחד" : `${g.brands} מותגים`}` : ""}</T>
      </View>
      <T style={{ fontSize: 13.5 }} numberOfLines={2}>{c.p.name}</T>
      <T style={{ color: t.good, fontSize: 12.5, fontWeight: "700" }}>{unitText(c.unit)}{save > 0 ? ` · ${save}% מתחת לחציון` : ""} · חציון {money(Math.round(g.median))} ₪</T>
      <T style={{ color: t.ink2, fontSize: 12 }}>{storeName(c.at)}</T>
    </Pressable>
  );
}
