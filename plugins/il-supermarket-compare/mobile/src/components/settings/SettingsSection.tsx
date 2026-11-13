import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { useSettings } from "../../lib/settings";
import { T, useTheme } from "../ui";

/**
 * A titled card on the settings screen. To add settings (notifications, for example), write a component
 * built from SettingsSection (and Chip / Hint) and render it in extraSections.tsx; settings.tsx needn't change.
 */
export function SettingsSection({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  const t = useTheme();
  const { tx } = useSettings();
  return (
    <View accessibilityRole="summary" style={{ backgroundColor: t.surface, borderRadius: 14, padding: 14, gap: 10 }}>
      <T style={[tx, { fontSize: 18, fontWeight: "800" }]}>{title}</T>
      {hint ? <T style={[tx, { color: t.ink2, fontSize: 12.5, lineHeight: 18 }]}>{hint}</T> : null}
      {children}
    </View>
  );
}

/** A small explanatory line inside a section. */
export function Hint({ children, bad }: { children: ReactNode; bad?: boolean }) {
  const t = useTheme();
  const { tx } = useSettings();
  return <T style={[tx, { color: bad ? t.bad : t.ink2, fontSize: 12.5, lineHeight: 18 }]}>{children}</T>;
}

/** A pill that is either on or off (a radius, a language, a chain's club card). */
export function Chip({ label, on, onPress, role = "button" }: { label: string; on: boolean; onPress: () => void; role?: "button" | "checkbox" | "radio" }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole={role} accessibilityState={role === "checkbox" ? { checked: on } : { selected: on }}
      style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: on ? t.brand : t.line, backgroundColor: on ? t.brandSoft : t.surface }}>
      <Text style={{ color: t.ink, fontWeight: "600", fontSize: 13 }}>{role === "checkbox" && on ? "✓ " : ""}{label}</Text>
    </Pressable>
  );
}
