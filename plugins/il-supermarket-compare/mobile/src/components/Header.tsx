import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { fmtDate, fmtStamp, newestStamp } from "../lib/compare";
import { syncLine, useData } from "../lib/store";
import { useWatch } from "../lib/watchctx";
import { T, useTheme } from "./ui";

export function Header() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { place, sync, catalog, runSync } = useData();
  const { unread } = useWatch();
  const n = catalog?.stores.length ?? 0;
  let status = "";
  if (sync.running) status = syncLine(sync, n);
  else if (sync.error) status = `העדכון נכשל: ${sync.error}`;
  else if (catalog) {
    const st = fmtStamp(newestStamp(catalog)) || fmtDate(catalog.priceDate);
    status = `מחירון אחרון: ${st} · ${n} סניפים${catalog.skipped.length ? ` · ${catalog.skipped.length} דולגו` : ""}`;
  }
  return (
    <View style={{ backgroundColor: t.surface, paddingTop: insets.top + 8, paddingHorizontal: 16, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: t.line, gap: 6 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: t.tag, alignItems: "center", justifyContent: "center" }}><Text style={{ fontWeight: "800", color: t.tagInk }}>₪</Text></View>
          <Text style={{ fontSize: 22, fontWeight: "800", color: t.brand }}>סל זול</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="שינוי מיקום" onPress={() => router.push("/location")}
          style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 4, height: 36, borderRadius: 18, borderWidth: 1, borderColor: t.line, paddingHorizontal: 10, minWidth: 0 }}>
          <Ionicons name="location-outline" size={17} color={t.brand} />
          <T numberOfLines={1} style={{ flexShrink: 1, fontWeight: "600", fontSize: 14 }}>{place ? place.place : "בחירת מיקום"}</T>
          {place ? <T numberOfLines={1} style={{ color: t.ink2, fontSize: 13, flexShrink: 0 }}>· {place.radius} ק״מ</T> : null}
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={unread ? `מה חדש, ${unread} לא נקראו` : "מה חדש"} onPress={() => router.push("/inbox")}
          style={{ height: 36, width: 36, borderRadius: 18, borderWidth: 1, borderColor: t.line, alignItems: "center", justifyContent: "center" }}>
          <Ionicons name={unread ? "notifications" : "notifications-outline"} size={18} color={unread ? t.brand : t.ink2} />
          {unread ? <View style={{ position: "absolute", top: -4, right: -4, minWidth: 17, height: 17, borderRadius: 9, paddingHorizontal: 4, backgroundColor: t.bad, alignItems: "center", justifyContent: "center" }}><Text style={{ color: "#fff", fontSize: 10.5, fontWeight: "800" }}>{unread > 9 ? "9+" : unread}</Text></View> : null}
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="עדכון מחירים" onPress={runSync} disabled={sync.running}
          style={{ height: 36, width: 36, borderRadius: 18, borderWidth: 1, borderColor: t.brand, backgroundColor: t.brandSoft, alignItems: "center", justifyContent: "center" }}>
          {sync.running ? <ActivityIndicator size="small" color={t.brand} /> : <Ionicons name="refresh" size={18} color={t.brand} />}
        </Pressable>
      </View>
      {status ? <T numberOfLines={1} style={{ fontSize: 12.5, color: sync.error ? t.bad : t.ink2 }}>{status}</T> : null}
      {sync.note && !sync.running ? <T numberOfLines={1} style={{ fontSize: 12, color: t.ink2 }}>{sync.note}</T> : null}
    </View>
  );
}
