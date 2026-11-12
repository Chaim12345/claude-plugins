import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button, DealBadge, Num, PriceTag, ProductImage, T, useTheme } from "../components/ui";
import { FollowButton, NotifyOffer, Spark, TrendText } from "../components/WatchBits";
import { bestDeal, compare, dealText, money, priceInfo } from "../lib/compare";
import { basketSeries, series } from "../lib/history";
import { useData } from "../lib/store";
import { useWatch } from "../lib/watchctx";

export default function Watch() {
  const t = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { catalog, products, active, deals, cart } = useData();
  const { state, usual, setUsual, unread } = useWatch();
  const [now] = useState(Date.now);
  const rows = state.followed.map(code => products.get(code)).filter(Boolean).map(p => ({
    p: p!, pi: priceInfo(p!, active), deal: bestDeal(p!, active, deals), pts: series(state.history, p!.code, now, 30),
  }));
  const missing = state.followed.length - rows.length;
  const usualCmp = catalog && usual ? compare(products, usual, active, deals) : null;
  const usualBest = usualCmp?.rows[0];
  const cartCount = Object.keys(cart).length;

  return (
    <ScrollView contentContainerStyle={{ padding: 18, paddingTop: insets.top + 12, paddingBottom: insets.bottom + 24, gap: 12 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <T style={{ fontSize: 22, fontWeight: "800" }}>המעקב שלי</T>
        <Pressable onPress={() => router.back()} accessibilityLabel="סגירה" hitSlop={10}><Ionicons name="close" size={26} color={t.ink} /></Pressable>
      </View>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Button kind="ghost" title={unread ? `מה חדש (${unread})` : "מה חדש"} style={{ flex: 1, height: 40 }} onPress={() => router.push("/inbox")} />
        <Button kind="ghost" title="הגדרות התראות" style={{ flex: 1, height: 40 }} onPress={() => router.push("/notifications")} />
      </View>
      <NotifyOffer />

      <View style={{ backgroundColor: t.surface, borderRadius: 14, padding: 14, gap: 10 }}>
        <T style={{ fontSize: 17, fontWeight: "800" }}>הסל הרגיל שלי</T>
        {usual && usualBest && catalog ? (
          <>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <T style={{ color: t.ink2, fontSize: 13 }}>{Object.keys(usual).length} פריטים · הכי זול ב{catalog.stores[usualBest.i].chain}</T>
                {usualBest.missing.length ? <T style={{ color: t.bad, fontSize: 12.5 }}>חסר שם: {usualBest.missing.join("، ")}</T> : null}
              </View>
              <PriceTag agorot={usualBest.total} />
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <View style={{ flex: 1 }}><TrendText pts={basketSeries(state.history, now, 30)} /></View>
              <Spark pts={basketSeries(state.history, now, 30)} width={110} height={44} />
            </View>
            <View style={{ flexDirection: "row", gap: 8 }}>
              {cartCount ? <Button kind="ghost" title="עדכון לסל הנוכחי" style={{ flex: 1, height: 40 }} onPress={() => setUsual(cart)} /> : null}
              <Button kind="ghost" title="הפסקת מעקב" style={{ flex: 1, height: 40 }} onPress={() => setUsual(null)} />
            </View>
          </>
        ) : (
          <>
            <T style={{ color: t.ink2, fontSize: 13 }}>סמנו את הסל כ״הסל הרגיל שלי״ ונעדכן אתכם כשהוא מתוזל, או כשסניף אחר הופך לזול ביותר.</T>
            {cartCount ? <Button title={`הסל הנוכחי הוא הסל הרגיל (${cartCount} פריטים)`} onPress={() => setUsual(cart)} /> : <Button kind="ghost" title="לסל" onPress={() => router.navigate("/cart")} />}
          </>
        )}
      </View>

      <T style={{ fontSize: 17, fontWeight: "800" }}>מוצרים במעקב ({rows.length})</T>
      {rows.length ? rows.map(({ p, pi, deal, pts }) => (
        <Pressable key={p.code} onPress={() => router.push(`/product/${encodeURIComponent(p.code)}`)} accessibilityRole="button"
          style={{ backgroundColor: t.surface, borderRadius: 14, padding: 12, gap: 8 }}>
          <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
            <ProductImage p={p} size={56} />
            <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
              <T numberOfLines={2} style={{ fontWeight: "700", fontSize: 14.5 }}>{p.name}</T>
              {pi.lo != null ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <PriceTag agorot={pi.lo} />
                  <T numberOfLines={1} style={{ color: t.ink2, fontSize: 12.5, flexShrink: 1 }}>ב{catalog?.stores[pi.at]?.chain}</T>
                </View>
              ) : <T style={{ color: t.ink2, fontSize: 12.5 }}>לא נמכר בסניפים שנבחרו</T>}
            </View>
            <FollowButton code={p.code} name={p.name} compact />
          </View>
          {deal ? (
            <View style={{ gap: 2 }}>
              <DealBadge text={dealText(deal.promo)} club={deal.promo.club} />
              <T numberOfLines={1} style={{ color: t.ink2, fontSize: 11.5 }}>{deal.promo.desc} · {catalog?.stores[deal.i].chain} · <Num style={{ fontSize: 11.5, color: t.bad, fontWeight: "700" }}>{money(deal.unit)} ₪</Num> ליחידה</T>
            </View>
          ) : null}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <View style={{ flex: 1 }}><TrendText pts={pts} /></View>
            <Spark pts={pts} width={110} height={36} />
          </View>
        </Pressable>
      )) : (
        <T style={{ color: t.ink2, textAlign: "center", padding: 16 }}>עוד לא עוקבים אחרי מוצרים. לחצו על ״עקוב״ בכרטיס מוצר.</T>
      )}
      {missing > 0 ? <T style={{ color: t.ink2, fontSize: 12.5 }}>{missing} מוצרים במעקב לא מופיעים במחירון הנוכחי (אולי באזור אחר), ולכן לא מוצגים כאן.</T> : null}
      <View style={{ alignItems: "center" }}><Button kind="ghost" title="לחיפוש מוצרים" onPress={() => router.navigate("/")} /></View>
    </ScrollView>
  );
}
