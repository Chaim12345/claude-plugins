import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { ModalHead, useModalPadding } from "../components/blocks";
import { Button, Num, PinnedBar, ProductImage, T, useTheme } from "../components/ui";
import { money, qtyText, storeKm } from "../lib/compare";
import { shopPlan } from "../lib/insights";
import { useData } from "../lib/store";

const KEY = "salzol:shopping"; // { store: id, checked: codes[] }

/**
 * In the shop: the cart as a checklist for one branch, grouped by department, with what each item
 * costs there. Ticks survive closing the app; "סיימתי" clears them (and, if asked, the cart).
 */
export default function Shop() {
  const t = useTheme();
  const router = useRouter();
  const pad = useModalPadding();
  const { catalog, products, cart, active, deals, comparison, clearCart } = useData();
  const params = useLocalSearchParams<{ store?: string }>();
  const [storeId, setStoreId] = useState<string | null>(params.store ?? null);
  const [checked, setChecked] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(KEY).then(v => {
      const s = v ? JSON.parse(v) : null;
      if (s && Array.isArray(s.checked)) setChecked(s.checked);
      if (!params.store && s?.store) setStoreId(s.store);
    }).catch(() => {}).finally(() => setLoaded(true));
  }, [params.store]);
  useEffect(() => { if (loaded) AsyncStorage.setItem(KEY, JSON.stringify({ store: storeId, checked })).catch(() => {}); }, [loaded, storeId, checked]);

  const idx = catalog && storeId ? catalog.stores.findIndex(s => s.id === storeId) : -1;
  const store = idx >= 0 ? idx : comparison?.rows[0]?.i ?? -1;
  const plan = useMemo(() => (catalog && store >= 0 ? shopPlan(products, cart, store, active, catalog.categories.map(c => c.id), deals) : null), [catalog, products, cart, store, active, deals]);

  if (!catalog || !plan || store < 0) {
    return (
      <ScrollView contentContainerStyle={pad}>
        <ModalHead title="רשימת קניות" />
        <T style={{ color: t.ink2 }}>הוסיפו מוצרים לסל, ונכין מהם רשימה לסניף שבו הם הכי זולים.</T>
        <Button title="למוצרים" onPress={() => router.navigate("/products")} />
      </ScrollView>
    );
  }

  const s = catalog.stores[store];
  const lines = plan.groups.flatMap(g => g.lines);
  const done = lines.filter(l => checked.includes(l.p.code));
  const left = plan.total - done.reduce((a, l) => a + l.cost, 0);
  const catName = (id: string) => catalog.categories.find(c => c.id === id)?.name ?? id;
  const toggle = (code: string) => setChecked(c => (c.includes(code) ? c.filter(x => x !== code) : [...c, code]));
  const d = storeKm(catalog, store);
  const finish = (empty: boolean) => { setChecked([]); if (empty) clearCart(); router.back(); };

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={pad}>
        <ModalHead title="רשימת קניות" />
        <Pressable onPress={() => setPicking(v => !v)} accessibilityRole="button" accessibilityState={{ expanded: picking }} accessibilityLabel={`הסניף: ${s.chain} ${s.branch}. החלפת סניף`}
          style={{ flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: t.surface, borderRadius: 14, padding: 12 }}>
          <Ionicons name="storefront" size={22} color={t.brand} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <T style={{ fontWeight: "800", fontSize: 16 }}>{s.chain}</T>
            <T numberOfLines={1} style={{ color: t.ink2, fontSize: 12.5 }}>{s.branch}{d != null ? ` · ${d.toFixed(1)} ק״מ` : ""}</T>
          </View>
          <Text style={{ color: t.brand, fontWeight: "700" }}>החלפה</Text>
        </Pressable>
        {picking && comparison ? (
          <View style={{ backgroundColor: t.surface, borderRadius: 14, paddingHorizontal: 12 }}>
            {comparison.rows.map((r, k) => {
              const o = catalog.stores[r.i];
              return (
                <Pressable key={o.id} onPress={() => { setStoreId(o.id); setPicking(false); }} accessibilityRole="radio" accessibilityState={{ selected: r.i === store }}
                  style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 10, borderBottomWidth: k === comparison.rows.length - 1 ? 0 : 1, borderBottomColor: t.line }}>
                  <Ionicons name={r.i === store ? "radio-button-on" : "radio-button-off"} size={20} color={r.i === store ? t.brand : t.ink2} />
                  <T numberOfLines={1} style={{ flex: 1, fontSize: 14 }}>{o.chain} · <Text style={{ color: t.ink2 }}>{o.branch}</Text></T>
                  <Num style={{ fontWeight: "700" }}>{money(r.total)} ₪</Num>
                  {r.missing.length ? <T style={{ color: t.bad, fontSize: 12 }}>חסרים {r.missing.length}</T> : null}
                </Pressable>
              );
            })}
          </View>
        ) : null}

        <View style={{ gap: 6 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
            <T style={{ fontWeight: "700" }}>{done.length} מתוך {lines.length} בעגלה</T>
            <T style={{ color: t.ink2 }}>נשאר: <Num style={{ fontWeight: "800", color: t.ink }}>{money(left)} ₪</Num></T>
          </View>
          <View style={{ height: 8, borderRadius: 4, backgroundColor: t.surface2, overflow: "hidden" }}>
            <View style={{ width: `${lines.length ? (done.length / lines.length) * 100 : 0}%`, height: 8, backgroundColor: t.brand }} />
          </View>
        </View>

        {plan.groups.map(g => (
          <View key={g.cat} style={{ gap: 6 }}>
            <T accessibilityRole="header" style={{ fontWeight: "800", fontSize: 15, color: t.ink2 }}>{catName(g.cat)}</T>
            <View style={{ backgroundColor: t.surface, borderRadius: 14, paddingHorizontal: 10 }}>
              {g.lines.map((l, k) => {
                const on = checked.includes(l.p.code);
                return (
                  <Pressable key={l.p.code} onPress={() => toggle(l.p.code)} accessibilityRole="checkbox" accessibilityState={{ checked: on }} aria-checked={on}
                    accessibilityLabel={`${l.p.name}, ${qtyText(l.p, l.q)}, ${money(l.cost)} ₪`}
                    style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, borderBottomWidth: k === g.lines.length - 1 ? 0 : 1, borderBottomColor: t.line, opacity: on ? 0.5 : 1 }}>
                    <Ionicons name={on ? "checkmark-circle" : "ellipse-outline"} size={28} color={on ? t.good : t.ink2} />
                    <ProductImage p={l.p} size={44} />
                    <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                      <T numberOfLines={2} style={{ fontWeight: "600", fontSize: 14.5, textDecorationLine: on ? "line-through" : "none" }}>{l.p.name}</T>
                      <T style={{ color: t.ink2, fontSize: 12.5 }}>
                        {l.p.weighted ? qtyText(l.p, l.q) : `× ${l.q}`}
                        {l.deal ? <Text style={{ color: t.bad, fontWeight: "700" }}> · מבצע {l.deal}</Text> : null}
                      </T>
                      {l.stale ? <T style={{ color: t.warn, fontSize: 12 }}>לא נמכר כאן חודש ויותר, ייתכן שאינו במלאי</T> : null}
                    </View>
                    <View style={{ alignItems: "flex-start" }}>
                      <Num style={{ fontWeight: "800" }}>{money(l.cost)} ₪</Num>
                      {l.deal && l.shelf > l.cost ? <Num style={{ color: t.ink2, fontSize: 12, textDecorationLine: "line-through" }}>{money(l.shelf)}</Num> : null}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))}

        {plan.missing.length ? (
          <View style={{ gap: 6 }}>
            <T style={{ fontWeight: "800", fontSize: 15, color: t.bad }}>אין בסניף הזה</T>
            <View style={{ backgroundColor: t.surface, borderRadius: 14, padding: 12, gap: 8 }}>
              {plan.missing.map(m => (
                <View key={m.p.code} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <ProductImage p={m.p} size={36} />
                  <T numberOfLines={1} style={{ flex: 1, fontSize: 14 }}>{m.p.name}</T>
                  <T style={{ color: t.ink2, fontSize: 12.5 }}>{m.at != null ? `${catalog.stores[m.at].chain} · ${money(m.cost!)} ₪` : "לא נמכר בסביבה"}</T>
                </View>
              ))}
            </View>
          </View>
        ) : null}
        <T style={{ color: t.ink2, fontSize: 12, lineHeight: 17 }}>מחירים לפי המחירון הרשמי של הסניף מ־{s.fileTime ? `${+s.fileTime.slice(6, 8)}.${+s.fileTime.slice(4, 6)}` : "היום"}. מחיר בקופה יכול להיות שונה אם המחיר השתנה מאז.</T>
      </ScrollView>
      <PinnedBar>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Button title="סיימתי, לרוקן את הסל" onPress={() => finish(true)} style={{ flex: 1 }} disabled={!done.length} />
          <Button kind="ghost" title="סיימתי" onPress={() => finish(false)} style={{ paddingHorizontal: 18 }} />
        </View>
      </PinnedBar>
    </View>
  );
}
