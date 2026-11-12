// Small pieces shared by the watch screens, the product sheet, the cards and the cart.
import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import Svg, { Circle, Polyline } from "react-native-svg";
import { money } from "../lib/compare";
import type { Point } from "../lib/history";
import { trend } from "../lib/history";
import { useWatch } from "../lib/watchctx";
import { Button, Num, T, useTheme } from "./ui";

/** "עקוב" toggle. `compact` is icon-only (for cards and rows). */
export function FollowButton({ code, name, compact }: { code: string; name: string; compact?: boolean }) {
  const t = useTheme();
  const { isFollowed, toggleFollow } = useWatch();
  const on = isFollowed(code);
  if (compact) {
    return (
      <Pressable onPress={() => toggleFollow(code)} hitSlop={8} accessibilityRole="button" accessibilityState={{ selected: on }}
        accessibilityLabel={on ? `הפסקת מעקב: ${name}` : `מעקב אחרי ${name}`}
        style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: on ? t.brand : t.surface + "e6", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: on ? t.brand : t.line }}>
        <Ionicons name={on ? "eye" : "eye-outline"} size={17} color={on ? t.brandInk : t.ink2} />
      </Pressable>
    );
  }
  return (
    <Pressable onPress={() => toggleFollow(code)} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={on ? `הפסקת מעקב: ${name}` : `מעקב אחרי ${name}`}
      style={{ height: 44, borderRadius: 12, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: on ? t.brand : t.brandSoft }}>
      <Ionicons name={on ? "eye" : "eye-outline"} size={19} color={on ? t.brandInk : t.brand} />
      <Text style={{ fontWeight: "700", fontSize: 15, color: on ? t.brandInk : t.brand }}>{on ? "עוקב" : "עקוב"}</Text>
    </Pressable>
  );
}

/** A small line chart of prices (agorot) over time, drawn with react-native-svg. Lower is better, so a falling line is green. */
export function Spark({ pts, height = 56, width }: { pts: Point[]; height?: number; width?: number }) {
  const t = useTheme();
  const [w, setW] = useState(width ?? 0);
  if (pts.length < 2) return null;
  const vs = pts.map(p => p.v), lo = Math.min(...vs), hi = Math.max(...vs);
  const pad = 5, span = hi - lo || 1;
  const x = (i: number) => pad + (i / (pts.length - 1)) * Math.max(1, w - 2 * pad);
  const y = (v: number) => (hi === lo ? height / 2 : pad + (1 - (v - lo) / span) * (height - 2 * pad));
  const color = vs[vs.length - 1] <= vs[0] ? t.good : t.warn;
  const line = pts.map((p, i) => `${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  return (
    <View style={{ height, width }} onLayout={e => { if (!width) setW(e.nativeEvent.layout.width); }} accessibilityLabel={`גרף מחיר: מ־${money(vs[0])} ל־${money(vs[vs.length - 1])} ₪`}>
      {w > 0 ? (
        <Svg width={w} height={height} style={{ direction: "ltr" }}>
          <Polyline points={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          <Circle cx={x(pts.length - 1)} cy={y(vs[vs.length - 1])} r={3.5} fill={color} />
        </Svg>
      ) : null}
    </View>
  );
}

/** "−8%" / "+3%" / "ללא שינוי" over a series, coloured: a falling price is good. */
export function TrendText({ pts, days = 30 }: { pts: Point[]; days?: number }) {
  const t = useTheme();
  const tr = trend(pts);
  if (!tr) return <T style={{ color: t.ink2, fontSize: 12 }}>עוד אין מספיק היסטוריה</T>;
  const r = Math.round(tr.pct * 10) / 10;
  const color = r < 0 ? t.good : r > 0 ? t.warn : t.ink2;
  return (
    <T style={{ fontSize: 12.5, color: t.ink2 }}>
      {days} ימים: <Num style={{ color, fontWeight: "800", fontSize: 12.5 }}>{r === 0 ? "ללא שינוי" : `${r > 0 ? "+" : "−"}${Math.abs(r)}%`}</Num>
      {"  ·  "}מ־<Num style={{ fontSize: 12.5, color: t.ink2 }}>{money(tr.from)}</Num> ל־<Num style={{ fontSize: 12.5, color: t.ink2 }}>{money(tr.to)}</Num> ₪
    </T>
  );
}

/** Offered once, right after the first follow: turn on system notifications (asks for the permission only if they say yes). */
export function NotifyOffer() {
  const t = useTheme();
  const { shouldOffer, enableNotifications, dismissOffer } = useWatch();
  const [busy, setBusy] = useState(false);
  if (!shouldOffer) return null;
  return (
    <View style={{ backgroundColor: t.brandSoft, borderRadius: 14, padding: 14, gap: 10 }}>
      <T style={{ fontWeight: "800" }}>לקבל התראה כשיש מבצע?</T>
      <T style={{ color: t.ink2, fontSize: 13 }}>נבדוק פעם ביום ונשלח הודעה קצרה כשמוצר שאתם עוקבים אחריו יורד במחיר או יוצא למבצע.</T>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Button title="הפעלת התראות" disabled={busy} style={{ flex: 1 }} onPress={async () => { setBusy(true); await enableNotifications(); setBusy(false); }} />
        <Button kind="ghost" title="לא עכשיו" style={{ flex: 1 }} onPress={dismissOffer} />
      </View>
    </View>
  );
}
