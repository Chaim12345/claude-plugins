import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button, Num, PriceTag, ProductImage, Stepper, T, useTheme } from "../components/ui";
import { priceInfo } from "../lib/compare";
import { matchList, quantityFor, type Match } from "../lib/listmatch";
import { parseList } from "../lib/listparse";
import { useData } from "../lib/store";

type Row = { m: Match; pick: number; qty: number; on: boolean; open: boolean };

const EXAMPLE = "חלב 3% x2\nעגבניות 1 ק\"ג\nחצי קילו לימונים\nשתי במבות\n500 גרם גבינה צהובה\nחזה עוף 1.5 קג\nתפו\"א\nביצים";

export default function PasteList() {
  const t = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { text: shared } = useLocalSearchParams<{ text?: string }>();
  const { catalog, products, active, addMany } = useData();
  const [text, setText] = useState(typeof shared === "string" ? shared : "");
  const [rows, setRows] = useState<Row[] | null>(null);

  const count = useMemo(() => text.split("\n").filter(l => l.trim()).length, [text]);

  function analyse() {
    const ms = matchList(products, parseList(text), active);
    setRows(ms.map(m => {
      const p = m.cands[0] ? products.get(m.cands[0].code) : undefined;
      return { m, pick: 0, qty: p ? quantityFor(m.line, p) : 0, on: !!p && m.conf !== "low", open: false };
    }));
  }

  const patch = (i: number, r: Partial<Row>) => setRows(prev => prev && prev.map((x, k) => (k === i ? { ...x, ...r } : x)));

  function add() {
    if (!rows) return;
    const items: Record<string, number> = {};
    for (const r of rows) {
      const c = r.m.cands[r.pick];
      if (!r.on || !c) continue;
      items[c.code] = Math.round(((items[c.code] ?? 0) + r.qty) * 10) / 10;
    }
    addMany(items);
    router.dismissTo("/cart");
  }

  if (!catalog) {
    return <View style={{ flex: 1, padding: 24 }}><T>המחירונים עוד לא נטענו.</T><Button title="חזרה" onPress={() => router.back()} /></View>;
  }

  if (!rows) {
    return (
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 18, paddingTop: insets.top + 12, paddingBottom: insets.bottom + 24, gap: 12 }}>
        <T style={{ fontSize: 22, fontWeight: "800" }}>הדבקת רשימת קניות</T>
        <T style={{ color: t.ink2 }}>הדביקו רשימה (גם מוואטסאפ): פריט בכל שורה או מופרדים בפסיקים. אפשר לכתוב כמויות: ״2 חלב״, ״עגבניות 1 ק״ג״, ״חצי קילו לימונים״.</T>
        <TextInput value={text} onChangeText={setText} multiline textAlignVertical="top" accessibilityLabel="רשימת קניות"
          placeholder={EXAMPLE} placeholderTextColor={t.ink2}
          style={[{ minHeight: 220, borderRadius: 12, borderWidth: 1, borderColor: t.line, backgroundColor: t.surface, padding: 12, color: t.ink, textAlign: "right", fontSize: 16, lineHeight: 24 }, Platform.OS === "web" && ({ outlineStyle: "none" } as object)]} />
        <View style={{ flexDirection: "row", gap: 10 }}>
          <Button title={count ? `התאמת מוצרים (${count})` : "התאמת מוצרים"} style={{ flex: 1 }} disabled={!count} onPress={analyse} />
          <Button kind="ghost" title="ביטול" style={{ flex: 1 }} onPress={() => router.back()} />
        </View>
        {text ? <Pressable onPress={() => setText("")}><Text style={{ color: t.brand, fontWeight: "700", textAlign: "right" }}>ניקוי</Text></Pressable> : null}
      </ScrollView>
    );
  }

  const found = rows.filter(r => r.m.cands.length).length;
  const chosen = rows.filter(r => r.on && r.m.cands[r.pick]).length;
  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingTop: insets.top + 12, paddingBottom: 24, gap: 10 }}>
        <T style={{ fontSize: 22, fontWeight: "800" }}>בדיקת הרשימה</T>
        <T style={{ color: t.ink2 }}>נמצאו מוצרים ל־<Num style={{ fontWeight: "800", color: t.ink }}>{found}</Num> מתוך <Num style={{ fontWeight: "800", color: t.ink }}>{rows.length}</Num> שורות. בדקו את ההתאמות, ושנו כמות או מוצר לפי הצורך.</T>
        {rows.map((r, i) => {
          const c = r.m.cands[r.pick];
          const p = c ? products.get(c.code) : undefined;
          const pi = p ? priceInfo(p, active) : null;
          if (!p || !pi || pi.lo == null) {
            return (
              <View key={i} style={{ backgroundColor: t.surface, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: t.bad + "88", flexDirection: "row", gap: 10, alignItems: "center" }}>
                <Ionicons name="alert-circle" size={22} color={t.bad} />
                <View style={{ flex: 1 }}>
                  <T style={{ fontWeight: "700" }}>{r.m.line.raw}</T>
                  <T style={{ color: t.bad, fontSize: 13 }}>{r.m.line.text ? "לא נמצא מוצר מתאים בסניפים שנבחרו" : "חסר שם מוצר בשורה"}</T>
                </View>
              </View>
            );
          }
          const warn = r.m.conf !== "high" && r.pick === 0;
          return (
            <View key={i} style={{ backgroundColor: t.surface, borderRadius: 14, padding: 12, gap: 8, opacity: r.on ? 1 : 0.55, borderWidth: warn && r.on ? 1 : 0, borderColor: t.warn + "99" }}>
              <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
                <Pressable onPress={() => patch(i, { on: !r.on })} accessibilityRole="checkbox" accessibilityState={{ checked: r.on }} accessibilityLabel={`הוספת ${p.name}`}>
                  <Ionicons name={r.on ? "checkbox" : "square-outline"} size={26} color={r.on ? t.brand : t.ink2} />
                </Pressable>
                <ProductImage p={p} size={52} />
                <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
                  <T numberOfLines={2} style={{ fontWeight: "700", fontSize: 14.5 }}>{p.name}</T>
                  <T numberOfLines={1} style={{ color: t.ink2, fontSize: 12 }}>מהשורה: ״{r.m.line.raw}״{warn ? <Text style={{ color: t.warn, fontWeight: "700" }}> · כדאי לבדוק</Text> : null}</T>
                </View>
                <PriceTag agorot={pi.lo} />
              </View>
              <View style={{ flexDirection: "row", gap: 10, alignItems: "center", justifyContent: "space-between" }}>
                <Stepper p={p} qty={r.qty} onChange={q => patch(i, { qty: Math.max(p.weighted ? 0.5 : 1, q), on: true })} compact />
                {r.m.cands.length > 1 ? (
                  <Pressable onPress={() => patch(i, { open: !r.open })} accessibilityRole="button" accessibilityLabel="החלפת מוצר" style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, height: 34, borderRadius: 10, backgroundColor: t.surface2 }}>
                    <Ionicons name="swap-horizontal" size={16} color={t.brand} />
                    <Text style={{ fontWeight: "700", color: t.ink }}>החלפה</Text>
                  </Pressable>
                ) : null}
              </View>
              {r.open ? (
                <View style={{ gap: 4 }}>
                  {r.m.cands.map((cd, k) => {
                    const alt = products.get(cd.code)!;
                    const api = priceInfo(alt, active);
                    return (
                      <Pressable key={cd.code} onPress={() => patch(i, { pick: k, qty: quantityFor(r.m.line, alt), open: false, on: true })} accessibilityState={{ selected: k === r.pick }}
                        style={{ flexDirection: "row", alignItems: "center", gap: 8, padding: 8, borderRadius: 10, backgroundColor: k === r.pick ? t.brandSoft : t.surface2 }}>
                        <ProductImage p={alt} size={34} />
                        <T numberOfLines={2} style={{ flex: 1, fontSize: 13.5, fontWeight: k === r.pick ? "700" : "500" }}>{alt.name}</T>
                        {api.lo != null ? <Num style={{ fontSize: 13, color: t.ink2 }}>{(api.lo / 100).toFixed(2)} ₪</Num> : null}
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}
            </View>
          );
        })}
      </ScrollView>
      <View style={{ padding: 14, paddingBottom: insets.bottom + 14, gap: 8, backgroundColor: t.surface, borderTopWidth: 1, borderTopColor: t.line, flexDirection: "row" }}>
        <Button title={chosen ? `הוספה לסל (${chosen})` : "הוספה לסל"} style={{ flex: 2 }} disabled={!chosen} onPress={add} />
        <Button kind="ghost" title="עריכת הרשימה" style={{ flex: 1 }} onPress={() => setRows(null)} />
      </View>
    </View>
  );
}
