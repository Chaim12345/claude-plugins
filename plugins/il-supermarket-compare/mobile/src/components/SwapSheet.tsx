import { useMemo } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { money } from "../lib/compare";
import { useData } from "../lib/store";
import { findSwaps, totalSaving, type SwapSet } from "../lib/swaps";
import { unitText } from "../lib/units";
import { Button, Num, ProductImage, T, useTheme } from "./ui";

/** Cheaper equivalents for the items in the cart, by product code, and the total of the best ones (agorot). */
export function useSwapSets(): { byCode: Map<string, SwapSet>; sets: SwapSet[]; total: number } {
  const { catalog, products, cart, active, deals } = useData();
  return useMemo(() => {
    const sets = catalog && Object.keys(cart).length ? findSwaps(catalog, products, cart, active, deals) : [];
    return { byCode: new Map(sets.map(s => [s.p.code, s])), sets, total: totalSaving(sets) };
  }, [catalog, products, cart, active, deals]);
}

/** "You could save X" at the top of the cart. */
export function SwapBanner({ total, count }: { total: number; count: number }) {
  const t = useTheme();
  if (total <= 0) return null;
  return (
    <View style={{ backgroundColor: t.good + "1c", borderColor: t.good, borderWidth: 1, borderRadius: 12, padding: 12, gap: 2 }}>
      <T style={{ fontWeight: "800", color: t.good }}>אפשר לחסוך עוד {money(total)} ₪ עם {count === 1 ? "החלפה אחת" : `${count} החלפות`}</T>
      <T style={{ color: t.ink2, fontSize: 12.5 }}>מוצרים זהים לפי סוג, גודל ותכונות, שזולים יותר באותו סניף או בסניף קרוב. לחצו על ״אפשר לחסוך״ ליד כל פריט.</T>
    </View>
  );
}

/** The small "אפשר לחסוך" chip on a cart row. */
export function SwapChip({ saving, onPress }: { saving: number; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`אפשר לחסוך ${money(saving)} ₪ בהחלפת המוצר`}
      style={{ alignSelf: "flex-start", flexDirection: "row", gap: 4, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: t.good + "22", borderWidth: 1, borderColor: t.good }}>
      <Text style={{ color: t.good, fontWeight: "800", fontSize: 12 }}>אפשר לחסוך</Text>
      <Text style={{ color: t.good, fontWeight: "700", fontSize: 12, writingDirection: "ltr" }}>{money(saving)} ₪</Text>
    </Pressable>
  );
}

/** Bottom sheet with up to three alternatives for one cart item and a "החלפה" button on each. */
export function SwapSheet({ set, onClose }: { set: SwapSet | null; onClose: () => void }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { catalog, setQty, addMany } = useData();
  if (!set || !catalog) return null;
  const take = (code: string) => {
    setQty(set.p.code, 0);
    addMany({ [code]: set.qty });
    onClose();
  };
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: "flex-end", direction: "rtl" }}>
        <Pressable accessibilityLabel="סגירה" onPress={onClose} style={{ position: "absolute", top: 0, bottom: 0, left: 0, right: 0, backgroundColor: "#0008" }} />
        <View style={{ backgroundColor: t.bg, borderTopLeftRadius: 18, borderTopRightRadius: 18, maxHeight: "85%", paddingBottom: insets.bottom + 8 }}>
          <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
            <View style={{ gap: 2 }}>
              <T style={{ fontSize: 18, fontWeight: "800" }}>אפשר לחסוך על {set.p.name}</T>
              <T style={{ color: t.ink2, fontSize: 12.5 }}>בסל עכשיו: {money(set.cost)} ₪ ב{catalog.stores[set.store].chain}{set.qty > 1 ? ` (${set.qty} יחידות)` : ""}</T>
            </View>
            {set.options.map(o => (
              <View key={o.p.code} style={{ backgroundColor: t.surface, borderRadius: 14, padding: 12, gap: 8 }}>
                <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
                  <ProductImage p={o.p} size={56} />
                  <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
                    <T numberOfLines={2} style={{ fontWeight: "700" }}>{o.p.name}</T>
                    <T style={{ color: t.ink2, fontSize: 12.5 }}>{money(o.packCost)} ₪ ב{catalog.stores[o.store].chain}{o.sameStore ? "" : `, ${o.away != null ? `${o.away.toFixed(1)} ק״מ מהסניף הזול` : "בסניף קרוב"}`}</T>
                  </View>
                </View>
                <T style={{ color: t.good, fontWeight: "800" }}>{o.reason}</T>
                <T style={{ color: t.ink2, fontSize: 12 }}>{unitText(o.unit)} במקום {unitText(o.fromUnit)}</T>
                {o.brandChange ? <T style={{ color: t.ink2, fontSize: 12 }}>מותג אחר, אותו סוג: אותם מילות מפתח (למשל אחוז שומן וטעם), אותו גודל בערך.</T> : null}
                <Button title="החלפה" onPress={() => take(o.p.code)} />
              </View>
            ))}
            <Button kind="ghost" title="השארת הפריט" onPress={onClose} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
