import { useRouter } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";
import { MoreChains } from "../../components/MoreChains";
import { Button, Num, ProductImage, Stepper, T, useTheme } from "../../components/ui";
import { fmtDate, money, priceInfo, storeKm } from "../../lib/compare";
import { useData } from "../../lib/store";

export default function CartScreen() {
  const t = useTheme();
  const router = useRouter();
  const { catalog, comparison: c, active, setQty, clearCart, place } = useData();

  if (!catalog || !c || !c.items.length) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 12 }}>
        <T style={{ fontSize: 18, fontWeight: "700", textAlign: "center" }}>הסל ריק</T>
        <T style={{ color: t.ink2, textAlign: "center" }}>הוסיפו מוצרים, ונראה לכם באיזה סניף הסל כולו הכי זול.</T>
        <Button title="למוצרים" onPress={() => router.navigate("/")} />
      </View>
    );
  }
  const best = c.rows[0];
  const save = best && !best.missing.length ? best.total - c.split : 0;
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 40 }}>
      <Section title="איפה לקנות" action={<Pressable onPress={clearCart}><Text style={{ color: t.brand, fontWeight: "700" }}>ריקון הסל</Text></Pressable>}>
        {c.rows.map((r, k) => {
          const s = catalog.stores[r.i];
          const d = storeKm(catalog, r.i);
          const pct = c.common && r.fair > c.fairLow ? `+${((r.fair / c.fairLow - 1) * 100).toFixed(1)}% על אותם מוצרים` : c.common ? "הכי זול על אותם מוצרים" : "";
          return (
            <View key={s.id} style={{ borderWidth: 1, borderColor: k === 0 ? t.good : t.line, backgroundColor: k === 0 ? t.good + "18" : t.surface, borderRadius: 12, padding: 12, gap: 2 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1 }}>
                  <T style={{ fontWeight: "700" }}>{s.chain}</T>
                  {k === 0 ? <Text style={{ backgroundColor: t.good, color: t.surface, fontSize: 11, fontWeight: "800", borderRadius: 999, paddingHorizontal: 8, overflow: "hidden" }}>הכי משתלם</Text> : null}
                </View>
                <Num style={{ fontWeight: "800", fontSize: 18 }}>{money(r.total)} ₪</Num>
              </View>
              <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
                <T numberOfLines={1} style={{ color: t.ink2, fontSize: 12.5, flexShrink: 1 }}>{s.branch}{d != null ? ` · ${d.toFixed(1)} ק״מ` : ""}</T>
                <T style={{ color: r.fair === c.fairLow ? t.good : t.warn, fontSize: 12.5, fontWeight: "700" }}>{pct}</T>
              </View>
              {r.missing.length ? <T style={{ color: t.bad, fontSize: 12.5 }}>חסר: {r.missing.join("، ")}</T> : null}
            </View>
          );
        })}
        <View style={{ backgroundColor: t.surface2, borderRadius: 12, padding: 12 }}>
          <T>קנייה מפוצלת בין {c.splitStores} סניפים: <Text style={{ fontWeight: "800" }}>{money(c.split)} ₪</Text>{save > 0 ? <Text> · חוסך <Text style={{ fontWeight: "800" }}>{money(save)} ₪</Text></Text> : null}</T>
        </View>
        <MoreChains catalog={catalog} comparison={c} active={active} place={place} />
      </Section>

      <Section title={`הפריטים (${c.items.length})`}>
        {c.items.map(([p, q]) => {
          const pi = priceInfo(p, active);
          return (
            <View key={p.code} style={{ flexDirection: "row", gap: 10, alignItems: "center", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: t.line, borderStyle: "dashed" }}>
              <Pressable onPress={() => router.push(`/product/${encodeURIComponent(p.code)}`)}><ProductImage p={p} size={52} /></Pressable>
              <View style={{ flex: 1, gap: 6, minWidth: 0 }}>
                <T numberOfLines={1} style={{ fontWeight: "600", fontSize: 14 }}>{p.name}</T>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <Stepper p={p} qty={q} onChange={v => setQty(p.code, v)} compact />
                  <T style={{ color: t.ink2, fontSize: 13 }}>{pi.lo == null ? "—" : `מ־${money(pi.lo * q)} ₪`}</T>
                </View>
              </View>
            </View>
          );
        })}
      </Section>

      <T style={{ color: t.ink2, fontSize: 12.5, lineHeight: 18 }}>
        השוואה הוגנת על {c.common} מתוך {c.items.length} מוצרים שיש בכל הסניפים. מחירי מדף מקובצי המחירים הרשמיים של הרשתות (חוק המזון), {fmtDate(catalog.priceDate)}. מבצעים ומחירי מועדון עוד לא כלולים. מרחק בקו אווירי.
      </T>
    </ScrollView>
  );
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ backgroundColor: t.surface, borderRadius: 14, padding: 14, gap: 10 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <T style={{ fontSize: 18, fontWeight: "800" }}>{title}</T>
        {action}
      </View>
      {children}
    </View>
  );
}
