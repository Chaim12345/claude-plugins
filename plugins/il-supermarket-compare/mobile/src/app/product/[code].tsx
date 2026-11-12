import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Button, DealBadge, Num, PinnedBar, ProductImage, Stepper, T, useTheme } from "../../components/ui";
import { ProductShareButton } from "../../components/ShareButtons";
import { FollowButton, NotifyOffer, Spark, TrendText } from "../../components/WatchBits";
import { dealText, dealUnit, money, shownPromos, storeKm } from "../../lib/compare";
import { series } from "../../lib/history";
import { useData } from "../../lib/store";
import { useWatch } from "../../lib/watchctx";

export default function ProductSheet() {
  const t = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { code } = useLocalSearchParams<{ code: string }>();
  const { catalog, products, active, cart, setQty, deals } = useData();
  const { isFollowed, state } = useWatch();
  const [now] = useState(Date.now);
  const p = products.get(String(code));
  if (!catalog || !p) {
    return <View style={{ flex: 1, padding: 24 }}><T>המוצר לא נמצא במחירון הנוכחי.</T><Button title="חזרה" onPress={() => router.back()} /></View>;
  }
  const rows = catalog.stores.map((s, i) => ({ s, i, v: p.prices[i] })).filter(r => r.v != null).sort((a, b) => a.v! - b.v!);
  const lo = rows[0]?.v ?? 0;
  const qty = cart[p.code] ?? 0;
  const hi = rows.length ? rows[rows.length - 1].v! : 0;
  return (
    <View style={{ flex: 1 }}>
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 18, paddingTop: insets.top + 8, paddingBottom: 18, gap: 12 }}>
      <View style={{ flexDirection: "row", justifyContent: "flex-end" }}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="סגירה" hitSlop={8}
          style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: t.surface2, alignItems: "center", justifyContent: "center" }}>
          <Ionicons name="close" size={22} color={t.ink} />
        </Pressable>
      </View>
      <View style={{ flexDirection: "row", gap: 14, alignItems: "center" }}>
        <ProductImage p={p} size={96} />
        <View style={{ flex: 1, gap: 4 }}>
          <T style={{ fontSize: 20, fontWeight: "800" }}>{p.name}</T>
          <T style={{ color: t.ink2, fontSize: 13 }}>{p.weighted ? "מחיר לק״ג · מוצר מקביל בכל רשת" : `ברקוד ${p.code}`}</T>
        </View>
      </View>
      {rows.length > 1 && hi > lo ? (
        <View style={{ flexDirection: "row", gap: 10 }}>
          <View style={{ flex: 1, backgroundColor: t.good + "18", borderRadius: 12, padding: 12, gap: 2 }}>
            <T style={{ color: t.ink2, fontSize: 12.5 }}>הכי זול</T>
            <Num style={{ fontWeight: "800", fontSize: 20, color: t.good }}>{money(lo)} ₪</Num>
            <T numberOfLines={1} style={{ fontSize: 12.5 }}>{rows[0].s.chain}</T>
          </View>
          <View style={{ flex: 1, backgroundColor: t.surface, borderRadius: 12, padding: 12, gap: 2 }}>
            <T style={{ color: t.ink2, fontSize: 12.5 }}>הכי יקר</T>
            <Num style={{ fontWeight: "800", fontSize: 20 }}>{money(hi)} ₪</Num>
            <T numberOfLines={1} style={{ fontSize: 12.5, color: t.warn, fontWeight: "700" }}>+{Math.round((hi / lo - 1) * 100)}% מהזול</T>
          </View>
        </View>
      ) : null}
      <View style={{ backgroundColor: t.surface, borderRadius: 14, padding: 12, gap: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <T style={{ fontWeight: "800", fontSize: 16 }}>מחיר ב־30 הימים האחרונים</T>
          <FollowButton code={p.code} name={p.name} />
        </View>
        {isFollowed(p.code) ? (
          <>
            <Spark pts={series(state.history, p.code, now, 30)} height={70} />
            <TrendText pts={series(state.history, p.code, now, 30)} />
          </>
        ) : <T style={{ color: t.ink2, fontSize: 12.5 }}>עקבו אחרי המוצר כדי לשמור את היסטוריית המחיר שלו ולקבל הודעה על מבצע או ירידת מחיר.</T>}
      </View>
      {isFollowed(p.code) ? <NotifyOffer /> : null}
      <View style={{ backgroundColor: t.surface, borderRadius: 14, paddingHorizontal: 12 }}>
        {rows.map(({ s, i, v }) => {
          const d = storeKm(catalog, i);
          const on = active.includes(i);
          const promos = p.weighted ? [] : shownPromos(deals, i, p.code);
          return (
            <View key={s.id} style={{ flexDirection: "row", justifyContent: "space-between", gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: t.line, opacity: on ? 1 : 0.5 }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <T style={{ fontWeight: "700" }}>{s.chain}</T>
                <T numberOfLines={2} style={{ color: t.ink2, fontSize: 12 }}>{s.branch}{d != null ? ` · ${d.toFixed(1)} ק״מ` : ""}{p.picks?.[i] ? ` · ״${p.picks[i]}״` : ""}</T>
                {promos.map((pr, k) => {
                  const locked = pr.club && !deals?.club[i];
                  return (
                    <View key={`${pr.id}-${k}`} style={{ gap: 1, marginTop: 4, opacity: locked ? 0.7 : 1 }}>
                      <DealBadge text={dealText(pr)} club={pr.club} />
                      <T style={{ color: t.ink2, fontSize: 11.5 }}>{pr.desc}{locked ? " · דורש כרטיס מועדון (מופעל בסל)" : ""}</T>
                    </View>
                  );
                })}
              </View>
              <View style={{ alignItems: "flex-start" }}>
                <Num style={{ fontWeight: "800", color: v === lo ? t.good : t.ink }}>{money(v!)} ₪</Num>
                {v! > lo ? <Num style={{ fontSize: 12, color: t.ink2 }}>+{money(v! - lo)}</Num> : null}
                {promos.filter(pr => !pr.club || deals?.club[i]).map(pr => dealUnit(pr, v!)).sort((a, b) => a - b).slice(0, 1).map(u => (
                  <Num key="u" style={{ fontSize: 12, color: t.bad, fontWeight: "700" }}>{money(u)} ₪ במבצע</Num>
                ))}
              </View>
            </View>
          );
        })}
      </View>
      <ProductShareButton p={p} />
    </ScrollView>
    {/* Pinned, so adding is one tap however long the list of branches is. */}
    <PinnedBar>
      {qty ? <Stepper p={p} qty={qty} onChange={q => setQty(p.code, q)} /> : <Button title="הוספה לסל" onPress={() => setQty(p.code, 1)} />}
    </PinnedBar>
    </View>
  );
}
