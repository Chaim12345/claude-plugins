import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, Switch, Text, View } from "react-native";
import { MoreChains } from "../../components/MoreChains";
import { CartShareBar } from "../../components/ShareButtons";
import { SwapBanner, SwapChip, SwapSheet, useSwapSets } from "../../components/SwapSheet";
import { TripCard } from "../../components/TripCard";
import { Button, DealBadge, Num, ProductImage, Stepper, T, canScan, useTheme } from "../../components/ui";
import { NOTE_LABEL, clubChains, dealText, fmtDate, money, notesFor, priceInfo, storeKm, type Comparison } from "../../lib/compare";
import type { Catalog } from "../../lib/types";
import { FollowButton, NotifyOffer } from "../../components/WatchBits";
import { useData } from "../../lib/store";
import { useWatch } from "../../lib/watchctx";

export default function CartScreen() {
  const t = useTheme();
  const router = useRouter();
  const { catalog, comparison: c, active, setQty, clearCart, place, saved, club, setClub, setClubAll, cart } = useData();
  const { usual, setUsual } = useWatch();
  const swaps = useSwapSets();
  const [swapFor, setSwapFor] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  if (!catalog || !c || !c.items.length) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 12 }}>
        <T style={{ fontSize: 18, fontWeight: "700", textAlign: "center" }}>הסל ריק</T>
        <T style={{ color: t.ink2, textAlign: "center" }}>הוסיפו מוצרים, ונראה לכם באיזה סניף הסל כולו הכי זול.</T>
        <Button title="למוצרים" onPress={() => router.navigate("/products")} />
        <Button kind="ghost" title="הדבקת רשימת קניות" onPress={() => router.push("/list")} />
        {canScan() ? <Button kind="ghost" title="סריקת ברקוד" onPress={() => router.push("/scan")} /> : null}
        {saved.length ? <Button kind="ghost" title={`רשימות שמורות (${saved.length})`} onPress={() => router.push("/saved")} /> : null}
      </View>
    );
  }
  const best = c.rows[0];
  const save = best && !best.missing.length ? best.total - c.split : 0;
  const chains = clubChains(catalog);
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 40 }}>
      <Hero catalog={catalog} c={c} onShop={i => router.push({ pathname: "/shop", params: { store: catalog.stores[i].id } })} />
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Action icon="bookmark-outline" label="שמורות" onPress={() => router.push("/saved")} />
        <Action icon="clipboard-outline" label="הדבקה" onPress={() => router.push("/list")} />
        {canScan() ? <Action icon="barcode-outline" label="סריקה" onPress={() => router.push("/scan")} /> : null}
      </View>
      <SwapBanner total={swaps.total} count={swaps.sets.length} />
      <Section title={`הפריטים (${c.items.length})`} action={
        confirmClear
          ? <Pressable onPress={() => { clearCart(); setConfirmClear(false); }} accessibilityRole="button" hitSlop={8}><Text style={{ color: t.bad, fontWeight: "800" }}>למחוק הכל?</Text></Pressable>
          : <Pressable onPress={() => setConfirmClear(true)} accessibilityRole="button" hitSlop={8}><Text style={{ color: t.brand, fontWeight: "700" }}>ריקון הסל</Text></Pressable>
      }>
        {c.lines.map(({ p, q, best: b }) => {
          return (
            <View key={p.code} style={{ flexDirection: "row", gap: 10, alignItems: "center", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: t.line, borderStyle: "dashed" }}>
              <Pressable onPress={() => router.push(`/product/${encodeURIComponent(p.code)}`)}><ProductImage p={p} size={52} /></Pressable>
              <View style={{ flex: 1, gap: 6, minWidth: 0 }}>
                <T numberOfLines={1} style={{ fontWeight: "600", fontSize: 14 }}>{p.name}</T>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <Stepper p={p} qty={q} onChange={v => setQty(p.code, v)} compact />
                  <FollowButton code={p.code} name={p.name} compact />
                  <T style={{ color: t.ink2, fontSize: 13 }}>{!b ? "—" : `מ־${money(b.cost)} ₪`}</T>
                </View>
                {b?.promo ? (
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                    <DealBadge text={dealText(b.promo)} club={b.promo.club} />
                    <T style={{ color: t.bad, fontSize: 12, fontWeight: "700" }}>חוסך {money(b.shelf - b.cost)} ₪ ב{catalog.stores[b.i].chain}</T>
                  </View>
                ) : null}
                {(() => {
                  // a deal with conditions at the branch this item is cheapest at: worth knowing, not counted
                  const n = b ? notesFor(catalog, b.i, p.code)[0] : undefined;
                  return n ? <T numberOfLines={2} style={{ color: t.ink2, fontSize: 12 }}><Text style={{ color: t.bad, fontWeight: "700" }}>{NOTE_LABEL[n.why]} ב{catalog.stores[b!.i].chain}:</Text> {n.desc}</T> : null;
                })()}
                {swaps.byCode.get(p.code) ? <SwapChip saving={swaps.byCode.get(p.code)!.options[0].save} onPress={() => setSwapFor(p.code)} /> : null}
              </View>
            </View>
          );
        })}
      </Section>
      <SwapSheet set={swapFor ? swaps.byCode.get(swapFor) ?? null : null} onClose={() => setSwapFor(null)} />

      <CartShareBar />
      <Section title="איפה לקנות">
        {(showAll ? c.rows : c.rows.slice(0, 3)).map((r, k) => {
          const s = catalog.stores[r.i];
          const d = storeKm(catalog, r.i);
          const pct = c.common && r.fair > c.fairLow ? `+${((r.fair / c.fairLow - 1) * 100).toFixed(1)}% על אותם מוצרים` : c.common ? "הכי זול על אותם מוצרים" : "";
          const off = r.shelf - r.total;
          return (
            <Pressable key={s.id} accessibilityRole="button" accessibilityLabel={`${s.chain}, ${s.branch}: מפה וניווט`} onPress={() => router.push({ pathname: "/map", params: { store: s.id } })}
              style={{ borderWidth: 1, borderColor: k === 0 ? t.good : t.line, backgroundColor: k === 0 ? t.good + "18" : t.surface, borderRadius: 12, padding: 12, gap: 2 }}>
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
              {off > 0 ? (
                <T style={{ color: t.ink2, fontSize: 12.5 }}>
                  <Text style={{ color: t.bad, fontWeight: "700" }}>חוסך <Num style={{ color: t.bad, fontWeight: "700", fontSize: 12.5 }}>{money(off)}</Num> ₪ ב־{r.deals} מבצעים</Text>
                  {" · ללא מבצעים: "}<Num style={{ color: t.ink2, fontSize: 12.5 }}>{money(r.shelf)}</Num> ₪
                </T>
              ) : null}
              {r.missing.length ? <T style={{ color: t.bad, fontSize: 12.5 }}>חסר: {r.missing.join("، ")}</T> : null}
              {r.doubt.length ? <T style={{ color: t.warn, fontSize: 12.5 }}>אולי לא על המדף (לא נמכר כאן חודש ויותר): {r.doubt.join("، ")}</T> : null}
            </Pressable>
          );
        })}
        {c.rows.length > 3 ? (
          <Pressable onPress={() => setShowAll(v => !v)} accessibilityRole="button" style={{ alignItems: "center", paddingVertical: 8 }}>
            <Text style={{ color: t.brand, fontWeight: "700" }}>{showAll ? "הצגת פחות" : `הצגת כל ${c.rows.length} הסניפים`}</Text>
          </Pressable>
        ) : null}
        <View style={{ backgroundColor: t.surface2, borderRadius: 12, padding: 12 }}>
          <T>קנייה מפוצלת בין {c.splitStores} סניפים: <Text style={{ fontWeight: "800" }}>{money(c.split)} ₪</Text>{save > 0 ? <Text> · חוסך <Text style={{ fontWeight: "800" }}>{money(save)} ₪</Text></Text> : null}{c.splitShelf > c.split ? <Text style={{ color: t.ink2 }}> · ללא מבצעים: {money(c.splitShelf)} ₪</Text> : null}</T>
        </View>
        <MoreChains catalog={catalog} comparison={c} active={active} place={place} />
      </Section>

      <TripCard />

      <Section title="הסל הרגיל שלי">
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <T style={{ fontWeight: "700", flexShrink: 1 }}>עקוב אחרי הסל הזה</T>
          <Switch value={!!usual} onValueChange={on => setUsual(on ? cart : null)} accessibilityLabel="עקוב אחרי הסל הזה" />
        </View>
        <T style={{ color: t.ink2, fontSize: 12 }}>
          {usual ? `מעקב אחרי ${Object.keys(usual).length} פריטים. נעדכן כשהסל מתוזל או שסניף אחר הופך לזול ביותר.` : "נשמור את הסל הזה כ״סל הרגיל״ ונעדכן כשהוא מתוזל או שסניף אחר הופך לזול ביותר."}
        </T>
        {usual && JSON.stringify(Object.entries(usual).sort()) !== JSON.stringify(Object.entries(cart).sort()) ? (
          <Button kind="ghost" title="עדכון הסל הרגיל לסל הנוכחי" style={{ height: 40 }} onPress={() => setUsual(cart)} />
        ) : null}
        <Button kind="ghost" title="המעקב שלי" style={{ height: 40 }} onPress={() => router.push("/watch")} />
        <NotifyOffer />
      </Section>

      {chains.length ? (
        <Section title="מחירי מועדון">
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
            <T style={{ fontWeight: "700", flexShrink: 1 }}>יש לי כרטיס מועדון</T>
            <Switch value={chains.some(x => club[x.key])} onValueChange={on => setClubAll(chains.map(x => x.key), on)} accessibilityLabel="יש לי כרטיס מועדון" />
          </View>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {chains.map(x => (
              <Pressable key={x.key} onPress={() => setClub(x.key, !club[x.key])} accessibilityRole="checkbox" accessibilityState={{ checked: !!club[x.key] }}
                style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: club[x.key] ? t.brand : t.line, backgroundColor: club[x.key] ? t.brandSoft : t.surface }}>
                <Text style={{ color: t.ink, fontWeight: "600", fontSize: 13 }}>{club[x.key] ? "✓ " : ""}{x.label}</Text>
              </Pressable>
            ))}
          </View>
          <T style={{ color: t.ink2, fontSize: 12 }}>מחירי מועדון נספרים רק ברשתות שסימנתם. בלי סימון, הסל מחושב במבצעים לכולם בלבד.</T>
        </Section>
      ) : null}

      <T style={{ color: t.ink2, fontSize: 12.5, lineHeight: 18 }}>
        השוואה הוגנת על {c.common} מתוך {c.items.length} מוצרים שיש בכל הסניפים. מחירים ומבצעים מקובצי המחירים הרשמיים של הרשתות (חוק המזון), {fmtDate(catalog.priceDate)}. נספרים מבצעי מחיר, ״N ב־X״ ואחוזי הנחה על מוצר בודד; קופונים, מתנות והנחות על סכום קנייה לא נספרים. מבצע ״N ב־X״ חל על כל N יחידות מאותו מוצר. מרחק בקו אווירי.
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

function Action({ icon, label, onPress }: { icon: React.ComponentProps<typeof Ionicons>["name"]; label: string; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label}
      style={({ pressed }) => ({ flex: 1, height: 44, borderRadius: 12, backgroundColor: t.surface2, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, opacity: pressed ? 0.85 : 1 })}>
      <Ionicons name={icon} size={18} color={t.brand} />
      <Text style={{ color: t.ink, fontWeight: "700", fontSize: 14 }}>{label}</Text>
    </Pressable>
  );
}

/** The answer in one glance: where the whole basket is cheapest, and how much that saves. */
function Hero({ catalog, c, onShop }: { catalog: Catalog; c: Comparison; onShop: (store: number) => void }) {
  const t = useTheme();
  const best = c.rows[0];
  if (!best) return null;
  const s = catalog.stores[best.i];
  const d = storeKm(catalog, best.i);
  const complete = c.rows.filter(r => !r.missing.length);
  const worst = complete.length > 1 ? Math.max(...complete.map(r => r.total)) : 0;
  const saving = !best.missing.length && worst > best.total ? worst - best.total : 0;
  return (
    <View style={{ backgroundColor: t.brand, borderRadius: 16, padding: 16, gap: 6 }}>
      <Text style={{ color: t.brandInk, opacity: 0.85, fontSize: 13, textAlign: "right", writingDirection: "rtl" }}>
        {best.missing.length ? "הסניף שהכי מתאים לסל שלכם" : "הסל שלכם הכי זול ב"}
      </Text>
      <Text style={{ color: t.brandInk, fontSize: 22, fontWeight: "800", textAlign: "right", writingDirection: "rtl" }}>{s.chain}</Text>
      <Text numberOfLines={1} style={{ color: t.brandInk, opacity: 0.85, fontSize: 13, textAlign: "right", writingDirection: "rtl" }}>{s.branch}{d != null ? ` · ${d.toFixed(1)} ק״מ` : ""}</Text>
      <Text numberOfLines={1} style={{ color: t.brandInk, fontSize: 34, fontWeight: "800", fontVariant: ["tabular-nums"], textAlign: "right", marginTop: 2 }}>{money(best.total)}<Text style={{ fontSize: 18 }}> ₪</Text></Text>
      {saving > 0 ? (
        <View style={{ alignSelf: "flex-start", backgroundColor: t.brandInk, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 }}>
          <Text style={{ color: t.brand, fontWeight: "800", fontSize: 13 }}>חוסך {money(saving)} ₪ מול הסניף היקר</Text>
        </View>
      ) : null}
      {best.missing.length ? <Text style={{ color: t.brandInk, fontSize: 12.5, textAlign: "right", writingDirection: "rtl" }}>חסרים בסניף: {best.missing.length} מוצרים</Text> : null}
      {best.doubt.length ? (
        <Text style={{ color: t.brandInk, fontSize: 12.5, textAlign: "right", writingDirection: "rtl", opacity: 0.92 }}>
          שימו לב: {best.doubt.length === 1 ? "מוצר אחד בסל לא נמכר" : `${best.doubt.length} מוצרים בסל לא נמכרו`} בסניף הזה חודש ויותר, וייתכן שאינם על המדף.
        </Text>
      ) : null}
      <Pressable onPress={() => onShop(best.i)} accessibilityRole="button" accessibilityLabel={`יוצאים לקנות ב${s.chain}: רשימת קניות לפי מחלקות`}
        style={({ pressed }) => ({ marginTop: 6, height: 44, borderRadius: 12, backgroundColor: t.brandInk, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, opacity: pressed ? 0.9 : 1 })}>
        <Ionicons name="checkbox-outline" size={20} color={t.brand} />
        <Text style={{ color: t.brand, fontWeight: "800", fontSize: 15 }}>יוצאים לקנות: רשימה לסניף</Text>
      </Pressable>
    </View>
  );
}
