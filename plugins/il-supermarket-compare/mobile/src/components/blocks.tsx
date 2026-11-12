// Layout pieces shared by the home, insights and price-change screens.
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import type { ReactNode } from "react";
import { Pressable, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { money } from "../lib/compare";
import type { Product } from "../lib/types";
import { Num, PriceTag, ProductImage, T, useTheme } from "./ui";

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  return <View style={[{ backgroundColor: t.surface, borderRadius: 16, padding: 14, gap: 10 }, style]}>{children}</View>;
}

/** Section title with an optional "see all" link. */
export function SectionHead({ title, sub, action, onAction }: { title: string; sub?: string; action?: string; onAction?: () => void }) {
  const t = useTheme();
  return (
    <View style={{ gap: 2 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <T accessibilityRole="header" style={{ fontSize: 18, fontWeight: "800", flexShrink: 1 }}>{title}</T>
        {action && onAction ? (
          <Pressable onPress={onAction} accessibilityRole="button" hitSlop={10} style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
            <Text style={{ color: t.brand, fontWeight: "700", fontSize: 13.5 }}>{action}</Text>
            <Ionicons name="chevron-back" size={15} color={t.brand} />
          </Pressable>
        ) : null}
      </View>
      {sub ? <T style={{ color: t.ink2, fontSize: 12.5, lineHeight: 17 }}>{sub}</T> : null}
    </View>
  );
}

/** Title and close button of a modal screen. */
export function ModalHead({ title, sub }: { title: string; sub?: string }) {
  const t = useTheme();
  const router = useRouter();
  return (
    <View style={{ gap: 2 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <T accessibilityRole="header" style={{ fontSize: 22, fontWeight: "800", flexShrink: 1 }}>{title}</T>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="סגירה" hitSlop={8}
          style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: t.surface2, alignItems: "center", justifyContent: "center" }}>
          <Ionicons name="close" size={22} color={t.ink} />
        </Pressable>
      </View>
      {sub ? <T style={{ color: t.ink2, fontSize: 13, lineHeight: 19 }}>{sub}</T> : null}
    </View>
  );
}

export function useModalPadding() {
  const insets = useSafeAreaInsets();
  return { padding: 16, paddingTop: insets.top + 10, paddingBottom: insets.bottom + 28, gap: 14 } as const;
}

/** "-6.2%" in green, "+4.1%" in amber, "0%" plain. */
export function Pct({ pct, size = 15 }: { pct: number; size?: number }) {
  const t = useTheme();
  const color = pct < -0.05 ? t.good : pct > 0.05 ? t.warn : t.ink2;
  return <Num style={{ color, fontWeight: "800", fontSize: size }}>{pct > 0 ? "+" : pct < 0 ? "−" : ""}{Math.abs(pct).toFixed(1)}%</Num>;
}

/** A bar whose length is |pct| out of `max`: green for cheaper than typical, amber for dearer. */
export function PctBar({ pct, max }: { pct: number; max: number }) {
  const t = useTheme();
  const w = Math.max(4, Math.min(100, (Math.abs(pct) / Math.max(max, 1)) * 100));
  return (
    <View style={{ height: 6, borderRadius: 3, backgroundColor: t.surface2, overflow: "hidden" }}>
      <View style={{ width: `${w}%`, height: 6, borderRadius: 3, backgroundColor: pct <= 0 ? t.good : t.warn }} />
    </View>
  );
}

/** A small product tile for horizontal rows: photo, name, price, one-tap add. */
export function MiniProduct({ p, price, note, qty, onAdd, onOpen }: { p: Product; price: number; note?: string; qty: number; onAdd: () => void; onOpen: () => void }) {
  const t = useTheme();
  return (
    <View style={{ width: 132, backgroundColor: t.surface, borderRadius: 14, padding: 10, gap: 6 }}>
      <Pressable onPress={onOpen} accessibilityRole="button" accessibilityLabel={`${p.name}, ${money(price)} ₪`} style={{ gap: 6 }}>
        <View style={{ alignItems: "center" }}><ProductImage p={p} size={76} /></View>
        <T numberOfLines={2} style={{ fontSize: 13, fontWeight: "600", lineHeight: 17, minHeight: 34 }}>{p.name}</T>
      </Pressable>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
        <PriceTag agorot={price} />
        <Pressable onPress={onAdd} accessibilityRole="button" accessibilityLabel={qty ? `עוד אחד: ${p.name}` : `הוספה לסל: ${p.name}`} hitSlop={8}
          style={({ pressed }) => ({ width: 36, height: 36, borderRadius: 18, backgroundColor: qty ? t.brandSoft : t.brand, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.85 : 1 })}>
          {qty ? <Text style={{ color: t.brand, fontWeight: "800", fontSize: 14, fontVariant: ["tabular-nums"] }}>{qty}</Text> : <Ionicons name="add" size={22} color={t.brandInk} />}
        </Pressable>
      </View>
      {note ? <T numberOfLines={1} style={{ fontSize: 11.5, color: t.ink2 }}>{note}</T> : null}
    </View>
  );
}

/** The search box as it looks on the products screen, as a button that takes you there. */
export function SearchButton({ onPress }: { onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="search" accessibilityLabel="חיפוש מוצר"
      style={{ flex: 1, flexDirection: "row", alignItems: "center", backgroundColor: t.surface2, borderRadius: 22, paddingHorizontal: 14, height: 44, gap: 8, minWidth: 0 }}>
      <Ionicons name="search" size={18} color={t.ink2} />
      <T numberOfLines={1} style={{ color: t.ink2, fontSize: 15, flex: 1 }}>חיפוש: חלב, עגבניות, במבה…</T>
    </Pressable>
  );
}
