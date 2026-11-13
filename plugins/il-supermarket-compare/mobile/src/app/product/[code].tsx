import { useLocalSearchParams, useRouter } from "expo-router";
import { DIET_LABEL } from "../../lib/enrich";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Button, DealBadge, Num, PinnedBar, ProductImage, Stepper, T, useTheme } from "../../components/ui";
import { ProductShareButton } from "../../components/ShareButtons";
import { FollowButton, NotifyOffer, Spark, TrendText } from "../../components/WatchBits";
import { NOTE_LABEL, STALE_DAYS, bestDeal, changedDaysAgo, dealText, notesFor, dealUnit, fmtDate, money, priceInfo, shownPromos, soldDaysAgo, storeKm } from "../../lib/compare";
import { series } from "../../lib/history";
import { useData } from "../../lib/store";
import { useWatch } from "../../lib/watchctx";
import { sizeOf, sizeText, unitPrice, unitText } from "../../lib/units";
import { equivalents } from "../../lib/swaps";

export default function ProductSheet() {
  const t = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { code } = useLocalSearchParams<{ code: string }>();
  const { catalog, products, active, cart, setQty, deals, changes } = useData();
  const { isFollowed, state } = useWatch();
  const [now] = useState(Date.now);
  // a barcode that AI curation merged into another product opens that product
  const p = products.get(String(code)) ?? [...products.values()].find(x => x.meta?.linked?.includes(String(code)));
  if (!catalog || !p) {
    return <View style={{ flex: 1, padding: 24 }}><T>המוצר לא נמצא במחירון הנוכחי.</T><Button title="חזרה" onPress={() => router.back()} /></View>;
  }
  // Branches that are selling it first (by price), then the ones that list it but haven't sold it for a month.
  const rows = catalog.stores.map((s, i) => ({ s, i, v: p.prices[i], sold: soldDaysAgo(p, i) })).filter(r => r.v != null)
    .sort((a, b) => Number(a.sold >= STALE_DAYS) - Number(b.sold >= STALE_DAYS) || a.v! - b.v!);
  const all = catalog.stores.map((_, i) => i);
  const range = priceInfo(p, all); // ignores stale prices while a branch is selling the product
  const lo = range.lo ?? 0, hi = range.hi ?? 0;
  const loStore = range.at >= 0 ? catalog.stores[range.at] : null;
  const qty = cart[p.code] ?? 0;
  const size = sizeOf(p);
  const moves = changes.filter(c => c.code === p.code).slice(-6).reverse();
  const storeName = (id: string) => catalog.stores.find(s => s.id === id)?.chain ?? "";
  const deal = bestDeal(p, active, deals);
  const eq = equivalents(p, products, active); // the lowest price a promotion gives right now, if it beats the shelf
  const facts = [p.meta?.maker ? `יצרן: ${p.meta.maker}` : "", p.meta?.il ? "תוצרת הארץ" : ""].filter(Boolean).join(" · ");
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
          <T style={{ color: t.ink2, fontSize: 13 }}>{p.weighted ? (p.picks ? "מחיר לק״ג · מוצר מקביל בכל רשת" : "מחיר לק״ג") : p.code.includes(":") ? `קוד ${p.code.split(":")[1]}` : `ברקוד ${p.code}`}</T>
          {size && lo > 0 ? <T style={{ color: t.ink2, fontSize: 13 }}>גודל: {sizeText(size)}{size.packs > 1 ? ` (${size.packs} אריזות)` : ""} · {unitText(unitPrice(size, lo)!)} במחיר הזול ביותר</T> : null}
          {facts ? <T style={{ color: t.ink2, fontSize: 13 }}>{facts}</T> : null}
          {p.meta?.ai ? <T style={{ color: t.ink2, fontSize: 12.5 }}>{[p.meta.ai.t, p.meta.ai.b && `מותג: ${p.meta.ai.b}${p.meta.ai.pl ? " (פרטי)" : ""}`, p.meta.ai.l, p.meta.ai.v, ...p.meta.ai.d.map(x => DIET_LABEL[x])].filter(Boolean).join(" · ")} (סיווג AI)</T> : null}
          {p.code.includes(":") ? <T style={{ color: t.ink2, fontSize: 12 }}>פריט של הרשת עם קוד פנימי: נמכר רק ברשת הזו</T> : null}
          {p.meta?.raw ? <T style={{ color: t.ink2, fontSize: 12 }}>השם במחירון: {p.meta.raw} (סודר ב־AI)</T> : null}
          {p.meta?.linked?.length ? <T style={{ color: t.ink2, fontSize: 12 }}>אוחד עם ברקוד {p.meta.linked.join(", ")}: אותו מוצר ברשתות אחרות (AI)</T> : null}
        </View>
      </View>
      {rows.length > 1 && hi > lo ? (
        <View style={{ flexDirection: "row", gap: 10 }}>
          <View style={{ flex: 1, backgroundColor: t.good + "18", borderRadius: 12, padding: 12, gap: 2 }}>
            <T style={{ color: t.ink2, fontSize: 12.5 }}>הכי זול</T>
            <Num style={{ fontWeight: "800", fontSize: 20, color: t.good }}>{money(lo)} ₪</Num>
            <T numberOfLines={1} style={{ fontSize: 12.5 }}>{loStore?.chain ?? ""}</T>
          </View>
          <View style={{ flex: 1, backgroundColor: t.surface, borderRadius: 12, padding: 12, gap: 2 }}>
            <T style={{ color: t.ink2, fontSize: 12.5 }}>הכי יקר</T>
            <Num style={{ fontWeight: "800", fontSize: 20 }}>{money(hi)} ₪</Num>
            <T numberOfLines={1} style={{ fontSize: 12.5, color: t.warn, fontWeight: "700" }}>+{Math.round((hi / lo - 1) * 100)}% מהזול</T>
          </View>
        </View>
      ) : null}
      {deal && deal.unit < lo ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: t.bad + "14", borderRadius: 12, padding: 12 }}>
          <Ionicons name="pricetag" size={18} color={t.bad} />
          <T style={{ flex: 1, fontSize: 14 }}>
            במבצע עכשיו: <Text style={{ fontWeight: "800", color: t.bad }}>{money(Math.round(deal.unit))} ₪</Text> ב{catalog.stores[deal.i].chain}
            {deal.promo.minQty > 1 ? ` (${dealText(deal.promo)})` : ""}{deal.promo.club ? " · מועדון" : ""}
          </T>
        </View>
      ) : null}
      <View style={{ backgroundColor: t.surface, borderRadius: 14, paddingHorizontal: 12 }}>
        {rows.map(({ s, i, v, sold }, k) => {
          const d = storeKm(catalog, i);
          const on = active.includes(i);
          const stale = sold >= STALE_DAYS;
          const chg = changedDaysAgo(p, i);
          const promos = p.weighted ? [] : shownPromos(deals, i, p.code);
          const notes = p.weighted ? [] : notesFor(catalog, i, p.code);
          return (
            <View key={s.id} style={{ flexDirection: "row", justifyContent: "space-between", gap: 10, paddingVertical: 10, borderBottomWidth: k === rows.length - 1 ? 0 : 1, borderBottomColor: t.line, opacity: on ? 1 : 0.5 }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <T style={{ fontWeight: "700" }}>{s.chain}</T>
                <T numberOfLines={2} style={{ color: t.ink2, fontSize: 12 }}>{s.branch}{d != null ? ` · ${d.toFixed(1)} ק״מ` : ""}{p.picks?.[i] ? ` · ״${p.picks[i]}״` : ""}</T>
                {notes.map(n => (
                  <View key={n.id} style={{ gap: 1, marginTop: 4 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", borderWidth: 1, borderColor: t.bad + "66", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 }}>
                      <Ionicons name="information-circle-outline" size={13} color={t.bad} />
                      <Text style={{ color: t.bad, fontWeight: "700", fontSize: 11.5 }}>מבצע {NOTE_LABEL[n.why]}{n.club ? " · מועדון" : ""}</Text>
                    </View>
                    <T style={{ color: t.ink2, fontSize: 11.5 }}>{n.desc} · לא נכלל בחישוב הסל</T>
                  </View>
                ))}
                {stale ? (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 3 }}>
                    <Ionicons name="alert-circle-outline" size={14} color={t.warn} />
                    <T style={{ color: t.warn, fontSize: 12, fontWeight: "600", flexShrink: 1 }}>לא נמכר כאן {sold} ימים. ייתכן שאינו על המדף.</T>
                  </View>
                ) : sold ? <T style={{ color: t.ink2, fontSize: 11.5, marginTop: 2 }}>נמכר כאן לאחרונה לפני {sold} ימים</T> : null}
                {chg != null ? <T style={{ color: t.ink2, fontSize: 11.5, marginTop: 2 }}>{chg === 0 ? "המחיר עודכן היום" : chg === 1 ? "המחיר עודכן אתמול" : `המחיר עודכן לפני ${chg} ימים`}</T> : null}
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
                <Num style={{ fontWeight: "800", color: stale ? t.ink2 : v === lo ? t.good : t.ink }}>{money(v!)} ₪</Num>
                {v! > lo ? <Num style={{ fontSize: 12, color: t.ink2 }}>+{money(v! - lo)}</Num> : null}
                {promos.filter(pr => !pr.club || deals?.club[i]).map(pr => dealUnit(pr, v!)).sort((a, b) => a - b).slice(0, 1).map(u => (
                  <Num key="u" style={{ fontSize: 12, color: t.bad, fontWeight: "700" }}>{money(u)} ₪ במבצע</Num>
                ))}
              </View>
            </View>
          );
        })}
      </View>
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
      {eq.length ? (
        <View style={{ backgroundColor: t.surface, borderRadius: 14, padding: 12, gap: 8 }}>
          <T style={{ fontWeight: "800", fontSize: 16 }}>אותו מוצר, כל המותגים</T>
          <T style={{ color: t.ink2, fontSize: 12.5 }}>אותו סוג, אחוז שומן וגודל דומה, מהזול ליחידה. כל אחד בסניף שבו הוא הכי זול.</T>
          {eq.map(e => (
            <Pressable key={e.p.code} disabled={e.p.code === p.code} onPress={() => router.push(`/product/${encodeURIComponent(e.p.code)}`)} accessibilityRole="button"
              style={{ flexDirection: "row", alignItems: "center", gap: 10, opacity: 1, backgroundColor: e.p.code === p.code ? t.brandSoft : "transparent", borderRadius: 10, padding: 4 }}>
              <ProductImage p={e.p} size={40} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <T numberOfLines={1} style={{ fontSize: 13.5, fontWeight: e.p.code === p.code ? "800" : "600" }}>{e.p.code === p.code ? "המוצר הזה · " : ""}{e.p.name}</T>
                <T numberOfLines={1} style={{ color: t.ink2, fontSize: 12 }}>{catalog.stores[e.store].chain} · {unitText(e.unit)}</T>
              </View>
              <Num style={{ fontWeight: "800" }}>{money(e.price)} ₪</Num>
            </Pressable>
          ))}
        </View>
      ) : null}
      {moves.length ? (
        <View style={{ backgroundColor: t.surface, borderRadius: 14, padding: 12, gap: 8 }}>
          <T style={{ fontWeight: "800", fontSize: 16 }}>שינויי מחיר שראינו</T>
          {moves.map((c, k) => (
            <View key={k} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Ionicons name={c.to < c.from ? "trending-down" : "trending-up"} size={18} color={c.to < c.from ? t.good : t.warn} />
              <T numberOfLines={1} style={{ flex: 1, fontSize: 13.5 }}>{storeName(c.store) || "סניף שכבר לא בהשוואה"} · {fmtDate(c.day)}</T>
              <Num style={{ fontSize: 13.5 }}>{money(c.from)} ← <Text style={{ fontWeight: "800" }}>{money(c.to)} ₪</Text></Num>
            </View>
          ))}
        </View>
      ) : null}
      <ProductShareButton p={p} />
    </ScrollView>
    {/* Pinned, so adding is one tap however long the list of branches is. */}
    <PinnedBar>
      {qty ? <Stepper p={p} qty={qty} onChange={q => setQty(p.code, q)} /> : <Button title="הוספה לסל" onPress={() => setQty(p.code, 1)} />}
    </PinnedBar>
    </View>
  );
}
