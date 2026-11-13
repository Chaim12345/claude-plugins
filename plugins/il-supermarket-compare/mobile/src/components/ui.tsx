import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useEffect, useState, type ComponentProps, type ReactNode } from "react";
import { Platform, Pressable, StyleSheet, Text, View, useColorScheme, type StyleProp, type TextProps, type TextStyle, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { money } from "../lib/compare";
import { engine } from "../lib/engine";
import type { Product } from "../lib/types";

// Same palette as the web app: green for actions, yellow shelf tags for prices.
const light = {
  bg: "#f4f5ef", surface: "#ffffff", surface2: "#e9ece2", ink: "#1b2620", ink2: "#56625a", line: "#d6dbcf",
  brand: "#1d6b47", brandInk: "#ffffff", brandSoft: "#dcebe2", tag: "#f6cf3a", tagInk: "#1b1b14",
  good: "#1d7a3e", warn: "#a65b00", bad: "#b3261e",
};
const dark: typeof light = {
  bg: "#121814", surface: "#1a221d", surface2: "#232d27", ink: "#e8eee9", ink2: "#9fb0a5", line: "#2f3b34",
  brand: "#4cc18a", brandInk: "#0d1a13", brandSoft: "#1f3a2c", tag: "#f2c83a", tagInk: "#17160e",
  good: "#5fd08f", warn: "#f0a54a", bad: "#ff8a80",
};
export type Theme = typeof light;
export const useTheme = (): Theme => (useColorScheme() === "dark" ? dark : light);

export const CAT_TINT: Record<string, string> = {
  produce: "#7cc46a", meat: "#d9776a", dairy: "#9ac3e6", bakery: "#d8b27a", drinks: "#7fb8c9", snacks: "#e7a64f",
  pantry: "#c9b98d", frozen: "#a9c6e8", cleaning: "#9fd3c7", care: "#d7a8d0", pets: "#bfa58a", other: "#b8bfb3",
};

type IconName = ComponentProps<typeof Ionicons>["name"];
/** What a product tile shows when there's no photo: its department, not two arbitrary letters. */
export const CAT_ICON: Record<string, IconName> = {
  produce: "nutrition-outline", meat: "fish-outline", dairy: "water-outline", bakery: "restaurant-outline",
  drinks: "wine-outline", snacks: "ice-cream-outline", pantry: "basket-outline", frozen: "snow-outline",
  cleaning: "sparkles-outline", care: "heart-outline", pets: "paw-outline", other: "pricetag-outline",
};

/** Hebrew text: right-aligned, right-to-left. */
export function T({ style, ...p }: TextProps & { style?: StyleProp<TextStyle> }) {
  const t = useTheme();
  return <Text {...p} style={[{ color: t.ink, textAlign: "right", writingDirection: "rtl", fontSize: 15 }, style]} />;
}

/** Numbers stay left-to-right inside Hebrew text. */
export function Num({ style, ...p }: TextProps & { style?: StyleProp<TextStyle> }) {
  return <T {...p} style={[{ writingDirection: "ltr", fontVariant: ["tabular-nums"] }, style]} />;
}

export function PriceTag({ agorot, big }: { agorot: number; big?: boolean }) {
  const t = useTheme();
  return (
    <View style={{ backgroundColor: t.tag, borderRadius: 6, borderBottomLeftRadius: 0, paddingHorizontal: 8, paddingVertical: 2, alignSelf: "flex-start" }}>
      <Text style={{ color: t.tagInk, fontWeight: "800", fontSize: big ? 22 : 18, fontVariant: ["tabular-nums"] }}>
        {money(agorot)}<Text style={{ fontSize: 12 }}> ₪</Text>
      </Text>
    </View>
  );
}

/** Yellow "מבצע" tag with the deal's terms. */
export function DealBadge({ text, club }: { text: string; club?: boolean }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", backgroundColor: t.bad + "1f", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 }}>
      <Text style={{ color: t.bad, fontWeight: "800", fontSize: 11.5 }}>מבצע</Text>
      <Text style={{ color: t.bad, fontWeight: "700", fontSize: 11.5, writingDirection: "rtl" }}>{text}</Text>
      {club ? <Text style={{ color: t.bad, fontSize: 10.5, fontWeight: "700" }}>· מועדון</Text> : null}
    </View>
  );
}

export function Button({ title, onPress, kind = "primary", disabled, style, icon, label }: { title: string; onPress: () => void; kind?: "primary" | "ghost"; disabled?: boolean; style?: StyleProp<ViewStyle>; icon?: ReactNode; label?: string }) {
  const t = useTheme();
  const primary = kind === "primary";
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={disabled ? { disabled: true } : undefined} onPress={onPress} disabled={disabled}
      style={({ pressed }) => [{ height: 44, borderRadius: 12, paddingHorizontal: 16, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 6,
        backgroundColor: primary ? t.brand : t.surface2, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 }, style]}>
      {icon}
      <Text style={{ color: primary ? t.brandInk : t.ink, fontWeight: "700", fontSize: 15 }}>{title}</Text>
    </Pressable>
  );
}

export function Stepper({ p, qty, onChange, compact, width }: { p: Product; qty: number; onChange: (q: number) => void; compact?: boolean; width?: number }) {
  const t = useTheme();
  const st = p.weighted ? 0.5 : 1;
  const h = compact ? 34 : 40;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", height: h, borderRadius: 12, backgroundColor: t.brandSoft, overflow: "hidden", minWidth: compact ? 130 : undefined, width }}>
      <Pressable accessibilityRole="button" accessibilityLabel="עוד" onPress={() => onChange(qty + st)} style={[s.stepBtn, { height: h, width: width ? 34 : 40 }]}><Text style={[s.stepTxt, { color: t.brand }]}>+</Text></Pressable>
      <Text style={{ flex: 1, textAlign: "center", fontWeight: "700", color: t.ink, fontVariant: ["tabular-nums"] }}>{p.weighted ? `${qty} ק״ג` : qty}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="פחות" onPress={() => onChange(qty - st)} style={[s.stepBtn, { height: h, width: width ? 34 : 40 }]}><Text style={[s.stepTxt, { color: t.brand }]}>−</Text></Pressable>
    </View>
  );
}

/** Product photo, with a second source on failure and a lettered tile when there's no photo at all. */
export function ProductImage({ p, size }: { p: Product; size: number | "fill" }) {
  const t = useTheme();
  const [uri, setUri] = useState<string | null>(p.img ? engine.imageUrl(p.img) : null);
  const [tried, setTried] = useState(false);
  useEffect(() => { setUri(p.img ? engine.imageUrl(p.img) : null); setTried(false); }, [p.img]);
  const box: ViewStyle = size === "fill" ? { width: "100%", aspectRatio: 16 / 10 } : { width: size, height: size };
  const tint = CAT_TINT[p.cat] ?? CAT_TINT.other;
  const iconSize = size === "fill" ? 34 : Math.max(18, Math.round(size * 0.42));
  return (
    <View style={[box, { borderRadius: 10, overflow: "hidden", backgroundColor: uri ? "#fff" : tint + "66", alignItems: "center", justifyContent: "center" }]}>
      {uri ? (
        <Image source={{ uri }} style={{ width: "100%", height: "100%" }} contentFit="contain" transition={120} recyclingKey={p.code}
          onError={async () => {
            if (tried || !p.img) return setUri(null);
            setTried(true);
            setUri(await engine.fallbackImage(p.img));
          }} />
      ) : (
        <Ionicons name={CAT_ICON[p.cat] ?? CAT_ICON.other} size={iconSize} color={t.ink} style={{ opacity: 0.55 }} />
      )}
      {p.weighted && (size === "fill" || size >= 60) ? <View style={{ position: "absolute", top: 4, left: 4, backgroundColor: t.surface, borderRadius: 6, paddingHorizontal: 5 }}><Text style={{ fontSize: 10.5, fontWeight: "700", color: t.ink }}>לק״ג</Text></View> : null}
    </View>
  );
}

/** A bar fixed to the bottom of a screen (above the home indicator), for the one action that must always be reachable. */
export function PinnedBar({ children }: { children: ReactNode }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ paddingHorizontal: 14, paddingTop: 12, paddingBottom: insets.bottom + 12, borderTopWidth: 1, borderTopColor: t.line, backgroundColor: t.bg }}>
      {children}
    </View>
  );
}

/** Compact "add to cart" button for dense rows. */
export function AddBtn({ onPress, label = "הוספה לסל" }: { onPress: () => void; label?: string }) {
  const t = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={6}
      style={({ pressed }) => ({ width: 104, height: 36, borderRadius: 12, backgroundColor: t.brand, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.85 : 1 })}>
      <Ionicons name="add" size={22} color={t.brandInk} />
    </Pressable>
  );
}

/** Round icon button next to a search box. */
export function IconBtn({ icon, label, onPress }: { icon: ComponentProps<typeof Ionicons>["name"]; label: string; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress}
      style={({ pressed }) => ({ width: 44, height: 44, borderRadius: 22, backgroundColor: t.brandSoft, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.8 : 1 })}>
      <Ionicons name={icon} size={22} color={t.brand} />
    </Pressable>
  );
}

/** Native phones always have a camera API; browsers only where getUserMedia exists. */
export function canScan(): boolean {
  if (Platform.OS !== "web") return true;
  return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
}

const s = StyleSheet.create({
  stepBtn: { width: 40, alignItems: "center", justifyContent: "center" },
  stepTxt: { fontSize: 20, fontWeight: "700" },
});
