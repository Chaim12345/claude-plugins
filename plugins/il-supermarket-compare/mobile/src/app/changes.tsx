import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import { ModalHead, Pct, useModalPadding } from "../components/blocks";
import { ProductImage, T, useTheme } from "../components/ui";
import { fmtDate, money } from "../lib/compare";
import { recentlyChanged, summarizeChanges, type ChangeView } from "../lib/insights";
import { useData } from "../lib/store";
import { useWatch } from "../lib/watchctx";

/** Prices that moved between syncs: what got cheaper, what got dearer, where. */
export default function Changes() {
  const t = useTheme();
  const router = useRouter();
  const pad = useModalPadding();
  const { catalog, products, active, changes, cart, freq } = useData();
  const { state } = useWatch();
  const [dir, setDir] = useState<"down" | "up">("down");
  const [mineOnly, setMineOnly] = useState(false);

  const mine = useMemo(() => new Set([...Object.keys(cart), ...Object.keys(freq), ...state.followed]), [cart, freq, state.followed]);
  const sum = useMemo(() => (catalog ? summarizeChanges(changes, products, catalog, active, mineOnly ? mine : undefined) : null), [changes, products, catalog, active, mineOnly, mine]);
  const dated = useMemo(() => (catalog ? recentlyChanged(products.values(), active, 7) : null), [catalog, products, active]);
  const list: ChangeView[] = sum ? (dir === "down" ? sum.down : sum.up) : [];

  return (
    <FlatList
      data={list}
      keyExtractor={v => `${v.p.code}-${v.i}`}
      contentContainerStyle={{ ...pad, gap: 8 }}
      initialNumToRender={14}
      ListHeaderComponent={
        <View style={{ gap: 12, marginBottom: 4 }}>
          <ModalHead title="מחירים שזזו" sub={sum?.since ? `מה השתנה בסניפים שסביבכם מאז ${fmtDate(sum.since)}. נשמרים 30 ימים.` : "כאן יופיעו מחירים שהוזלו או התייקרו בין עדכון מחירים אחד לבא."} />
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Tab on={dir === "down"} icon="trending-down" color={t.good} label={`הוזלו (${sum?.down.length ?? 0})`} onPress={() => setDir("down")} />
            <Tab on={dir === "up"} icon="trending-up" color={t.warn} label={`התייקרו (${sum?.up.length ?? 0})`} onPress={() => setDir("up")} />
          </View>
          <Pressable onPress={() => setMineOnly(v => !v)} accessibilityRole="checkbox" accessibilityState={{ checked: mineOnly }}
            style={{ alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, minHeight: 36, borderRadius: 999, borderWidth: 1, borderColor: mineOnly ? t.brand : t.line, backgroundColor: mineOnly ? t.brandSoft : t.surface }}>
            <Ionicons name={mineOnly ? "checkmark" : "person-outline"} size={15} color={mineOnly ? t.brand : t.ink2} />
            <Text style={{ color: t.ink, fontWeight: "600", fontSize: 13 }}>רק מוצרים שלי (סל, רגילים, מעקב)</Text>
          </Pressable>
        </View>
      }
      ListEmptyComponent={
        <View style={{ backgroundColor: t.surface, borderRadius: 14, padding: 16, gap: 8 }}>
          <T style={{ fontWeight: "700" }}>{changes.length ? "אין שינויים כאלה כרגע." : "עוד אין מה להשוות."}</T>
          <T style={{ color: t.ink2, fontSize: 13, lineHeight: 20 }}>
            {changes.length ? "נסו את הלשונית השנייה או הסירו את הסינון." : "קובצי המחירים אומרים מתי מחיר השתנה, לא לאיזה כיוון. את הכיוון אנחנו מגלים כשמשווים את המחירון שהורד עכשיו לזה שהורד בפעם הקודמת, ולכן הרשימה מתמלאת מהעדכון השני והלאה."}
          </T>
          {dated && dated.total > 0 ? <T style={{ color: t.ink2, fontSize: 13, lineHeight: 20 }}>בינתיים: לפי הרשתות, {dated.total.toLocaleString("he-IL")} מחירים עודכנו בסניפים שלכם בשבוע האחרון.</T> : null}
        </View>
      }
      renderItem={({ item: v }) => (
        <Pressable onPress={() => router.push(`/product/${encodeURIComponent(v.p.code)}`)} accessibilityRole="button"
          accessibilityLabel={`${v.p.name} ב${catalog!.stores[v.i].chain}: מ־${money(v.from)} ל־${money(v.to)} ₪`}
          style={{ flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: t.surface, borderRadius: 14, padding: 10 }}>
          <ProductImage p={v.p} size={48} />
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <T numberOfLines={1} style={{ fontWeight: "600", fontSize: 14 }}>{v.p.name}</T>
            <T numberOfLines={1} style={{ color: t.ink2, fontSize: 12.5 }}>{catalog!.stores[v.i].chain} · {catalog!.stores[v.i].branch}</T>
            <T numberOfLines={1} style={{ fontSize: 13 }}>{money(v.from)} ← <Text style={{ fontWeight: "800" }}>{money(v.to)} ₪</Text><Text style={{ color: t.ink2 }}> · {fmtDate(v.day)}</Text></T>
          </View>
          <Pct pct={v.pct} />
        </Pressable>
      )}
    />
  );
}

function Tab({ on, icon, color, label, onPress }: { on: boolean; icon: React.ComponentProps<typeof Ionicons>["name"]; color: string; label: string; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="tab" accessibilityState={{ selected: on }}
      style={{ flex: 1, height: 46, borderRadius: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: on ? color + "22" : t.surface, borderWidth: 1.5, borderColor: on ? color : t.line }}>
      <Ionicons name={icon} size={19} color={color} />
      <Text style={{ fontWeight: "700", color: t.ink, fontSize: 14 }}>{label}</Text>
    </Pressable>
  );
}
