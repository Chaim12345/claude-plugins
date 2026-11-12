import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useRef } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button, T, useTheme } from "../components/ui";
import { notificationsSupported } from "../lib/notify";
import { useWatch } from "../lib/watchctx";

const ICON = { promo: "pricetag", drop: "trending-down", basket: "basket", ending: "time", digest: "newspaper" } as const;

function ago(ms: number): string {
  const m = Math.max(0, Math.round((Date.now() - ms) / 60_000));
  if (m < 2) return "עכשיו";
  if (m < 60) return `לפני ${m} דק׳`;
  const h = Math.round(m / 60);
  if (h < 24) return `לפני ${h} שע׳`;
  const d = Math.round(h / 24);
  return d === 1 ? "אתמול" : `לפני ${d} ימים`;
}

export default function Inbox() {
  const t = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { inbox, markAllRead, clearInbox, state } = useWatch();
  // Unread items stay highlighted while the screen is open and are marked as read when it closes.
  const read = useRef(markAllRead);
  useEffect(() => { read.current = markAllRead; });
  useEffect(() => () => read.current(), []);
  const nothing = !state.followed.length && !state.usual;

  return (
    <ScrollView contentContainerStyle={{ padding: 18, paddingTop: insets.top + 12, paddingBottom: insets.bottom + 24, gap: 12 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <T style={{ fontSize: 22, fontWeight: "800" }}>מה חדש</T>
        <Pressable onPress={() => router.back()} accessibilityLabel="סגירה" hitSlop={10}><Ionicons name="close" size={26} color={t.ink} /></Pressable>
      </View>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Button kind="ghost" title="המעקב שלי" style={{ flex: 1, height: 40 }} onPress={() => router.push("/watch")} />
        <Button kind="ghost" title="הגדרות התראות" style={{ flex: 1, height: 40 }} onPress={() => router.push("/notifications")} />
      </View>

      {inbox.length ? inbox.map(a => (
        <Pressable key={a.id} onPress={() => (a.code ? router.push(`/product/${encodeURIComponent(a.code)}`) : router.push("/watch"))} accessibilityRole="button"
          style={{ flexDirection: "row", gap: 12, backgroundColor: t.surface, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: a.read ? t.surface : t.brand, alignItems: "flex-start" }}>
          <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: a.kind === "ending" ? t.warn + "22" : t.brandSoft, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name={ICON[a.kind]} size={18} color={a.kind === "ending" ? t.warn : t.brand} />
          </View>
          <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
              <T style={{ fontWeight: "800", fontSize: 13.5, color: t.brand }}>{a.title}</T>
              <T style={{ color: t.ink2, fontSize: 12 }}>{ago(a.at)}</T>
            </View>
            <T style={{ fontSize: 14.5, lineHeight: 21 }}>{a.body}</T>
          </View>
          {!a.read ? <View accessibilityLabel="לא נקרא" style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: t.bad, marginTop: 6 }} /> : null}
        </Pressable>
      )) : (
        <View style={{ alignItems: "center", gap: 10, padding: 24 }}>
          <Ionicons name="notifications-outline" size={40} color={t.ink2} />
          <T style={{ fontWeight: "700", textAlign: "center" }}>{nothing ? "עוד לא עוקבים אחרי כלום" : "אין חדש כרגע"}</T>
          <T style={{ color: t.ink2, textAlign: "center" }}>
            {nothing ? "לחצו על ״עקוב״ במוצר, או סמנו את הסל כ״הסל הרגיל שלי״, ונעדכן כאן כשיש מבצע או ירידת מחיר." : "אחרי כל עדכון מחירים נבדוק אם משהו ממה שאתם עוקבים אחריו השתנה."}
          </T>
          {nothing ? <Button title="למעקב שלי" onPress={() => router.push("/watch")} /> : null}
        </View>
      )}

      {inbox.length ? <Pressable onPress={clearInbox}><Text style={{ color: t.ink2, textAlign: "center", fontWeight: "600", padding: 8 }}>ניקוי הרשימה</Text></Pressable> : null}
      {!notificationsSupported ? <T style={{ color: t.ink2, fontSize: 12.5, textAlign: "center" }}>בדפדפן אין התראות מערכת. העדכונים מופיעים כאן אחרי כל עדכון מחירים.</T> : null}
    </ScrollView>
  );
}
