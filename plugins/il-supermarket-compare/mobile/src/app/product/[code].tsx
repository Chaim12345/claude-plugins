import { useLocalSearchParams, useRouter } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button, Num, ProductImage, Stepper, T, useTheme } from "../../components/ui";
import { money, storeKm } from "../../lib/compare";
import { useData } from "../../lib/store";

export default function ProductSheet() {
  const t = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { code } = useLocalSearchParams<{ code: string }>();
  const { catalog, products, active, cart, setQty } = useData();
  const p = products.get(String(code));
  if (!catalog || !p) {
    return <View style={{ flex: 1, padding: 24 }}><T>המוצר לא נמצא במחירון הנוכחי.</T><Button title="חזרה" onPress={() => router.back()} /></View>;
  }
  const rows = catalog.stores.map((s, i) => ({ s, i, v: p.prices[i] })).filter(r => r.v != null).sort((a, b) => a.v! - b.v!);
  const lo = rows[0]?.v ?? 0;
  const qty = cart[p.code] ?? 0;
  return (
    <ScrollView contentContainerStyle={{ padding: 18, paddingTop: insets.top + 12, paddingBottom: insets.bottom + 24, gap: 12 }}>
      <View style={{ flexDirection: "row", gap: 14, alignItems: "center" }}>
        <ProductImage p={p} size={96} />
        <View style={{ flex: 1, gap: 4 }}>
          <T style={{ fontSize: 20, fontWeight: "800" }}>{p.name}</T>
          <T style={{ color: t.ink2, fontSize: 13 }}>{p.weighted ? "מחיר לק״ג · המוצר המקביל בכל רשת לפי שם" : `ברקוד ${p.code} · אותו מוצר בדיוק בכל הרשתות`}</T>
        </View>
      </View>
      <View style={{ backgroundColor: t.surface, borderRadius: 14, paddingHorizontal: 12 }}>
        {rows.map(({ s, i, v }) => {
          const d = storeKm(catalog, i);
          const on = active.includes(i);
          return (
            <View key={s.id} style={{ flexDirection: "row", justifyContent: "space-between", gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: t.line, opacity: on ? 1 : 0.5 }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <T style={{ fontWeight: "700" }}>{s.chain}</T>
                <T numberOfLines={2} style={{ color: t.ink2, fontSize: 12 }}>{s.branch}{d != null ? ` · ${d.toFixed(1)} ק״מ` : ""}{p.picks?.[i] ? ` · ״${p.picks[i]}״` : ""}</T>
              </View>
              <View style={{ alignItems: "flex-start" }}>
                <Num style={{ fontWeight: "800", color: v === lo ? t.good : t.ink }}>{money(v!)} ₪</Num>
                {v! > lo ? <Num style={{ fontSize: 12, color: t.ink2 }}>+{money(v! - lo)}</Num> : null}
              </View>
            </View>
          );
        })}
      </View>
      <View style={{ flexDirection: "row", gap: 10 }}>
        <View style={{ flex: 1 }}>{qty ? <Stepper p={p} qty={qty} onChange={q => setQty(p.code, q)} /> : <Button title="הוספה לסל" onPress={() => setQty(p.code, 1)} />}</View>
        <Pressable onPress={() => router.back()} style={{ flex: 1, height: 44, borderRadius: 12, backgroundColor: t.surface2, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ fontWeight: "700", color: t.ink }}>סגירה</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}
