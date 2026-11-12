import { useRouter } from "expo-router";
import { Pressable, ScrollView, Switch, Text, View } from "react-native";
import { MoreChains } from "../../components/MoreChains";
import { Button, DealBadge, Num, ProductImage, Stepper, T, canScan, useTheme } from "../../components/ui";
import { clubChains, dealText, fmtDate, money, priceInfo, storeKm } from "../../lib/compare";
import { useData } from "../../lib/store";

export default function CartScreen() {
  const t = useTheme();
  const router = useRouter();
  const { catalog, comparison: c, active, setQty, clearCart, place, saved, club, setClub, setClubAll } = useData();

  if (!catalog || !c || !c.items.length) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 12 }}>
        <T style={{ fontSize: 18, fontWeight: "700", textAlign: "center" }}>הסל ריק</T>
        <T style={{ color: t.ink2, textAlign: "center" }}>הוסיפו מוצרים, ונראה לכם באיזה סניף הסל כולו הכי זול.</T>
        <Button title="למוצרים" onPress={() => router.navigate("/")} />
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
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Button kind="ghost" title="שמירה / רשימות" style={{ flex: 1, height: 40 }} onPress={() => router.push("/saved")} />
        <Button kind="ghost" title="הדבקת רשימה" style={{ flex: 1, height: 40 }} onPress={() => router.push("/list")} />
        {canScan() ? <Button kind="ghost" title="סריקה" style={{ flex: 1, height: 40 }} onPress={() => router.push("/scan")} /> : null}
      </View>
      <Section title="איפה לקנות" action={<Pressable onPress={clearCart}><Text style={{ color: t.brand, fontWeight: "700" }}>ריקון הסל</Text></Pressable>}>
        {c.rows.map((r, k) => {
          const s = catalog.stores[r.i];
          const d = storeKm(catalog, r.i);
          const pct = c.common && r.fair > c.fairLow ? `+${((r.fair / c.fairLow - 1) * 100).toFixed(1)}% על אותם מוצרים` : c.common ? "הכי זול על אותם מוצרים" : "";
          const off = r.shelf - r.total;
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
              {off > 0 ? (
                <T style={{ color: t.ink2, fontSize: 12.5 }}>
                  <Text style={{ color: t.bad, fontWeight: "700" }}>חוסך <Num style={{ color: t.bad, fontWeight: "700", fontSize: 12.5 }}>{money(off)}</Num> ₪ ב־{r.deals} מבצעים</Text>
                  {" · ללא מבצעים: "}<Num style={{ color: t.ink2, fontSize: 12.5 }}>{money(r.shelf)}</Num> ₪
                </T>
              ) : null}
              {r.missing.length ? <T style={{ color: t.bad, fontSize: 12.5 }}>חסר: {r.missing.join("، ")}</T> : null}
            </View>
          );
        })}
        <View style={{ backgroundColor: t.surface2, borderRadius: 12, padding: 12 }}>
          <T>קנייה מפוצלת בין {c.splitStores} סניפים: <Text style={{ fontWeight: "800" }}>{money(c.split)} ₪</Text>{save > 0 ? <Text> · חוסך <Text style={{ fontWeight: "800" }}>{money(save)} ₪</Text></Text> : null}{c.splitShelf > c.split ? <Text style={{ color: t.ink2 }}> · ללא מבצעים: {money(c.splitShelf)} ₪</Text> : null}</T>
        </View>
        <MoreChains catalog={catalog} comparison={c} active={active} place={place} />
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

      <Section title={`הפריטים (${c.items.length})`}>
        {c.lines.map(({ p, q, best: b }) => {
          return (
            <View key={p.code} style={{ flexDirection: "row", gap: 10, alignItems: "center", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: t.line, borderStyle: "dashed" }}>
              <Pressable onPress={() => router.push(`/product/${encodeURIComponent(p.code)}`)}><ProductImage p={p} size={52} /></Pressable>
              <View style={{ flex: 1, gap: 6, minWidth: 0 }}>
                <T numberOfLines={1} style={{ fontWeight: "600", fontSize: 14 }}>{p.name}</T>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <Stepper p={p} qty={q} onChange={v => setQty(p.code, v)} compact />
                  <T style={{ color: t.ink2, fontSize: 13 }}>{!b ? "—" : `מ־${money(b.cost)} ₪`}</T>
                </View>
                {b?.promo ? (
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                    <DealBadge text={dealText(b.promo)} club={b.promo.club} />
                    <T style={{ color: t.bad, fontSize: 12, fontWeight: "700" }}>חוסך {money(b.shelf - b.cost)} ₪ ב{catalog.stores[b.i].chain}</T>
                  </View>
                ) : null}
              </View>
            </View>
          );
        })}
      </Section>

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
