import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button, Num, T, useTheme } from "../components/ui";
import { engine } from "../lib/engine";
import { useData } from "../lib/store";
import type { NearStore, Place } from "../lib/types";

const RADII = [2, 3, 4, 5, 8, 12];

export default function LocationSheet() {
  const t = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { place, choosePlace } = useData();
  const [q, setQ] = useState(place?.typed ? place.place : "");
  const [cand, setCand] = useState<Place | null>(place);
  const [radius, setRadius] = useState(place?.radius ?? 4);
  const [msg, setMsg] = useState<{ text: string; err?: boolean } | null>(null);
  const [near, setNear] = useState<NearStore[] | null>(null);

  useEffect(() => {
    if (!cand) return;
    let live = true;
    setMsg({ text: "מחפש סניפים בסביבה…" });
    engine.nearby(cand.lat, cand.lon, radius).then(st => {
      if (!live) return;
      setNear(st);
      setMsg(st.length ? { text: `${st.length} סניפים להשוואה סביב ${cand.place}:` } : { text: "אין סניפים מוכרים בטווח הזה. נסו מרחק גדול יותר.", err: true });
    }).catch(() => live && setMsg({ text: "לא הצלחנו לטעון את רשימת הסניפים. נסו שוב.", err: true }));
    return () => { live = false; };
  }, [cand, radius]);

  async function find() {
    const a = q.trim();
    if (!a) return;
    setMsg({ text: "מאתר את הכתובת…" }); setNear(null);
    try {
      const g = await engine.geocode(a);
      if (!g) return setMsg({ text: "לא מצאנו את הכתובת. נסו ״רחוב ומספר, עיר״.", err: true });
      setCand({ place: a, lat: g.lat, lon: g.lon, radius, typed: true });
    } catch {
      setMsg({ text: "איתור הכתובת נכשל. בדקו את החיבור ונסו שוב.", err: true });
    }
  }

  async function gps() {
    setMsg({ text: "מאתר את המיקום שלכם…" }); setNear(null);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) return setMsg({ text: "לא קיבלנו הרשאת מיקום. הקלידו כתובת במקום.", err: true });
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setCand({ place: "המיקום שלי", lat: +pos.coords.latitude.toFixed(5), lon: +pos.coords.longitude.toFixed(5), radius });
    } catch {
      setMsg({ text: "לא הצלחנו לקבל מיקום. הקלידו כתובת במקום.", err: true });
    }
  }

  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 18, paddingTop: insets.top + 12, paddingBottom: insets.bottom + 24, gap: 12 }}>
      <T style={{ fontSize: 22, fontWeight: "800" }}>איפה אתם קונים?</T>
      <T style={{ color: t.ink2 }}>נשווה את כל הסניפים של רשתות הדיסקאונט בטווח, ואת הסניף הקרוב של כל רשת אחרת.</T>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <TextInput value={q} onChangeText={setQ} onSubmitEditing={find} placeholder="כתובת, למשל הרצל 50, רמת גן" placeholderTextColor={t.ink2}
          returnKeyType="search" autoComplete="street-address" accessibilityLabel="כתובת"
          style={{ flex: 1, height: 44, borderRadius: 12, borderWidth: 1, borderColor: t.line, backgroundColor: t.surface2, paddingHorizontal: 12, color: t.ink, textAlign: "right" }} />
        <Button title="חיפוש" onPress={find} />
      </View>
      <Button kind="ghost" title="המיקום הנוכחי שלי" onPress={gps} icon={<Ionicons name="locate" size={18} color={t.brand} />} />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
        <T style={{ color: t.ink2 }}>טווח:</T>
        {RADII.map(r => (
          <Pressable key={r} onPress={() => setRadius(r)} accessibilityState={{ selected: r === radius }}
            style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: r === radius ? t.brand : t.surface2 }}>
            <Text style={{ color: r === radius ? t.brandInk : t.ink, fontWeight: "600" }}>{r} ק״מ</Text>
          </Pressable>
        ))}
      </View>
      {msg ? <T style={{ color: msg.err ? t.bad : t.ink2 }}>{msg.text}</T> : null}
      {near?.length ? (
        <View style={{ backgroundColor: t.surface, borderRadius: 14, paddingHorizontal: 12 }}>
          {near.map(s => (
            <View key={`${s.c}:${s.id}`} style={{ flexDirection: "row", justifyContent: "space-between", gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: t.line }}>
              <T numberOfLines={1} style={{ flex: 1 }}><Text style={{ fontWeight: "700" }}>{s.b}</Text> <Text style={{ color: t.ink2, fontSize: 13 }}>{s.n}</Text></T>
              <Num style={{ color: t.ink2, fontSize: 13 }}>{s.km.toFixed(1)} ק״מ{s.approx ? "~" : ""}</Num>
            </View>
          ))}
        </View>
      ) : null}
      <View style={{ flexDirection: "row", gap: 10 }}>
        <Button title="השוואה כאן" style={{ flex: 1 }} disabled={!cand || !near?.length}
          onPress={() => { if (cand) { choosePlace({ ...cand, radius }); router.back(); } }} />
        <Button kind="ghost" title="ביטול" style={{ flex: 1 }} onPress={() => router.back()} />
      </View>
    </ScrollView>
  );
}
