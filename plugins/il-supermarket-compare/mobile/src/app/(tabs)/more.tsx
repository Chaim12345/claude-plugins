import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import type { ComponentProps } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { T, useTheme } from "../../components/ui";
import { useData } from "../../lib/store";
import { useWatch } from "../../lib/watchctx";

type IconName = ComponentProps<typeof Ionicons>["name"];

/** Everything that isn't "find a product" or "my basket", one tap away without crowding the header. */
export default function More() {
  const t = useTheme();
  const router = useRouter();
  const { place, saved } = useData();
  const { unread } = useWatch();
  const rows: { icon: IconName; title: string; hint: string; to: string; badge?: number; hidden?: boolean }[] = [
    { icon: "podium-outline", title: "מדד המחירים סביבכם", hint: "איזה סניף הכי זול בסך הכל ובכל קטגוריה, ואיפה הפערים הגדולים", to: "/insights", hidden: !place },
    { icon: "pulse-outline", title: "מחירים שזזו", hint: "מה הוזל ומה התייקר מאז העדכון הקודם", to: "/changes", hidden: !place },
    { icon: "map-outline", title: "מפת הסניפים", hint: "איפה הסניפים, כמה הסל עולה בכל אחד, וניווט", to: "/map", hidden: !place },
    { icon: "eye-outline", title: "המעקב שלי", hint: "מוצרים שאתם עוקבים אחריהם ומגמת המחיר שלהם", to: "/watch" },
    { icon: "notifications-outline", title: "מה חדש", hint: "מבצעים וירידות מחיר שמצאנו עבורכם", to: "/inbox", badge: unread },
    { icon: "alarm-outline", title: "התראות", hint: "מה להתריע, מתי, ובאילו שעות לא להפריע", to: "/notifications" },
    { icon: "bookmark-outline", title: "רשימות שמורות", hint: saved.length ? `${saved.length} רשימות` : "שמרו את הסל כרשימה לשבוע הבא", to: "/saved" },
    { icon: "sparkles-outline", title: "ניהול קטלוג (AI)", hint: "סידור קטגוריות, ניקוי שמות ואיחוד מוצרים כפולים, עם סקירה וביטול", to: "/catalog", hidden: !place },
    { icon: "bug-outline", title: "יומן אבחון", hint: "מה קרה בעדכוני המחירים, לשיתוף כשמשהו לא עובד", to: "/debug" },
    { icon: "settings-outline", title: "הגדרות", hint: "טווח, עלות נסיעה, כרטיסי מועדון, שפה ומקורות הנתונים", to: "/settings" },
  ];
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 40 }}>
      {rows.filter(r => !r.hidden).map(r => (
        <Pressable key={r.to} onPress={() => router.push(r.to as never)} accessibilityRole="button" accessibilityLabel={`${r.title}. ${r.hint}`}
          style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: t.surface, borderRadius: 14, padding: 14, opacity: pressed ? 0.9 : 1 })}>
          <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: t.brandSoft, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name={r.icon} size={22} color={t.brand} />
            {r.badge ? <View style={{ position: "absolute", top: -3, right: -3, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, backgroundColor: t.bad, alignItems: "center", justifyContent: "center" }}><T style={{ color: "#fff", fontSize: 11, fontWeight: "800", textAlign: "center" }}>{r.badge > 9 ? "9+" : r.badge}</T></View> : null}
          </View>
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <T style={{ fontWeight: "700", fontSize: 16 }}>{r.title}</T>
            <T numberOfLines={2} style={{ color: t.ink2, fontSize: 13 }}>{r.hint}</T>
          </View>
          <Ionicons name="chevron-back" size={20} color={t.ink2} />
        </Pressable>
      ))}
    </ScrollView>
  );
}
