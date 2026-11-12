import { useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import { money } from "../lib/compare";
import { useData } from "../lib/store";
import { costMatrix, tripAdvice, tripText } from "../lib/trip";
import { useTripPerKm } from "../lib/tripSetting";
import { Num, T, useTheme } from "./ui";

/** "Is it worth a second stop?": splitting the basket between the two best branches against the driving it costs. */
export function TripCard() {
  const t = useTheme();
  const { catalog, products, cart, active, deals, place } = useData();
  const [perKm, setPerKm] = useTripPerKm();
  const advice = useMemo(() => {
    if (!catalog || !Object.keys(cart).length) return null;
    const area = catalog.areas[0];
    const home = place ? { lat: place.lat, lon: place.lon } : area ? { lat: area.lat, lon: area.lon } : null;
    const points = catalog.stores.map(s => (s.lat != null && s.lon != null ? { lat: s.lat, lon: s.lon } : null));
    return tripAdvice({ costs: costMatrix(products, cart, active, deals), active, points, home, perKm });
  }, [catalog, products, cart, active, deals, place, perKm]);
  if (!catalog || !advice) return null;
  const name = (i: number) => catalog.stores[i].chain;
  const good = advice.gross > 0 && advice.worth;
  const step = (d: number) => setPerKm(perKm + d);
  return (
    <View style={{ backgroundColor: t.surface, borderRadius: 14, padding: 14, gap: 10 }}>
      <T style={{ fontSize: 18, fontWeight: "800" }}>כדאי לעצור פעמיים?</T>
      <View style={{ borderWidth: 1, borderColor: good ? t.good : t.line, backgroundColor: good ? t.good + "18" : t.surface2, borderRadius: 12, padding: 12, gap: 4 }}>
        <T style={{ fontWeight: "700" }}>{tripText(advice, name)}</T>
        {advice.gross > 0 ? (
          <T style={{ color: t.ink2, fontSize: 12.5 }}>
            בסניף אחד ({name(advice.single)}): <Num style={{ fontSize: 12.5, color: t.ink2 }}>{money(advice.singleTotal)} ₪</Num>
            {" · "}מפוצל: <Num style={{ fontSize: 12.5, color: t.ink2 }}>{money(advice.splitTotal)} ₪</Num>
            {advice.net != null ? <Text>{" · "}אחרי נסיעה: <Num style={{ fontSize: 12.5, color: advice.net > 0 ? t.good : t.warn, fontWeight: "700" }}>{advice.net > 0 ? "+" : "−"}{money(Math.abs(advice.net))} ₪</Num></Text> : null}
          </T>
        ) : null}
        {advice.filled ? <T style={{ color: t.ink2, fontSize: 12.5 }}>הפיצול גם משלים {advice.filled} מוצרים שחסרים ב{name(advice.single)}.</T> : null}
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <T style={{ flexShrink: 1, fontSize: 13 }}>עלות נסיעה לכל ק״מ נוסף</T>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Pressable accessibilityLabel="פחות" onPress={() => step(-0.5)} style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: t.brandSoft, alignItems: "center", justifyContent: "center" }}><Text style={{ color: t.brand, fontSize: 20, fontWeight: "700" }}>−</Text></Pressable>
          <Num style={{ minWidth: 64, textAlign: "center", fontWeight: "800" }}>{perKm.toFixed(1)} ₪</Num>
          <Pressable accessibilityLabel="עוד" onPress={() => step(0.5)} style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: t.brandSoft, alignItems: "center", justifyContent: "center" }}><Text style={{ color: t.brand, fontSize: 20, fontWeight: "700" }}>+</Text></Pressable>
        </View>
      </View>
      <T style={{ color: t.ink2, fontSize: 12 }}>מרחק בקו אווירי מהמיקום שבחרתם, הלוך וחזור, ביחס לנסיעה לסניף הזול אחד. בדרכים אמיתיות המרחק גדול יותר.</T>
    </View>
  );
}
