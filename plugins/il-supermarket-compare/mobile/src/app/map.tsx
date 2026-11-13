import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BranchCard } from "../components/BranchCard";
import { BranchMap, MAP_SUPPORTED } from "../components/BranchMap";
import { Button, Num, T, useTheme } from "../components/ui";
import { money } from "../lib/compare";
import { buildPins, hasCoords, MAP_ATTRIBUTION, type LatLon } from "../lib/mapgeo";
import { useSettings } from "../lib/settings";
import { useData } from "../lib/store";

/** Compared branches on a map, each pin labelled with the cart total there; tap one for its card and navigation. */
export default function BranchMapScreen() {
  const t = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { store } = useLocalSearchParams<{ store?: string }>();
  const { catalog, comparison, active, place, cart } = useData();
  const { t: tr, tx, dir } = useSettings();
  const [failed, setFailed] = useState(false);

  const origin = useMemo<LatLon | null>(() => {
    if (place) return { lat: place.lat, lon: place.lon };
    const a = catalog?.areas[0];
    return a ? { lat: a.lat, lon: a.lon } : null;
  }, [place, catalog]);
  const pins = useMemo(() => (catalog ? buildPins(catalog, comparison, active, origin) : []), [catalog, comparison, active, origin]);
  const hasCart = !!comparison && comparison.items.length > 0;
  const [picked, setPicked] = useState<string | null>(typeof store === "string" ? store : null);
  const selected = pins.find(p => p.id === picked) ?? pins[0] ?? null;
  const showMap = MAP_SUPPORTED && !failed && pins.some(hasCoords);

  const header = (
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 18, paddingTop: insets.top + 12, paddingBottom: 8 }}>
      <View style={{ flex: 1 }}>
        <T style={[tx, { fontSize: 22, fontWeight: "800" }]}>{tr("map.title")}</T>
        {place ? <T numberOfLines={1} style={[tx, { color: t.ink2, fontSize: 13 }]}>{tr("map.around", { place: place.place, km: place.radius })}</T> : null}
      </View>
      <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel={tr("common.close")} hitSlop={10}><Ionicons name="close" size={26} color={t.ink} /></Pressable>
    </View>
  );

  if (!catalog) {
    return (
      <View style={{ flex: 1, direction: dir }}>
        {header}
        <View style={{ padding: 18, gap: 12 }}>
          <T style={tx}>{tr("map.noCatalog")}</T>
          <Button title={tr("common.back")} onPress={() => router.back()} />
        </View>
      </View>
    );
  }
  if (!pins.length) {
    return (
      <View style={{ flex: 1, direction: dir }}>
        {header}
        <View style={{ padding: 18, gap: 12 }}>
          <T style={tx}>{tr("map.noBranches")}</T>
          <Button title={tr("map.chooseLocation")} onPress={() => router.replace("/location")} />
        </View>
      </View>
    );
  }

  const summary = hasCart ? (
    <T style={[tx, { color: t.ink2, fontSize: 13 }]}>{tr("map.cartSummary", { n: Object.keys(cart).length })}</T>
  ) : (
    <T style={[tx, { color: t.ink2, fontSize: 13 }]}>{tr("map.emptyCart")}</T>
  );

  // Web, Expo Go, or a map that failed to start: the same branches as a list.
  if (!showMap) {
    return (
      <View style={{ flex: 1, direction: dir }}>
        {header}
        <ScrollView contentContainerStyle={{ padding: 18, paddingTop: 4, paddingBottom: insets.bottom + 24, gap: 10 }}>
          {summary}
          <T style={[tx, { color: t.ink2, fontSize: 12.5 }]}>{MAP_SUPPORTED ? tr("map.failed") : tr("map.listOnly")}</T>
          {pins.map(p => <BranchCard key={p.id} pin={p} pins={pins} hasCart={hasCart} />)}
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, direction: dir }}>
      {header}
      <View style={{ flex: 1, minHeight: 220 }}>
        <BranchMap pins={pins} user={origin} selectedId={selected?.id ?? null} onSelect={setPicked} onFail={() => setFailed(true)} fitLabel={tr("map.fit")} />
      </View>
      <T style={[tx, { fontSize: 11, color: t.ink2, paddingHorizontal: 18, paddingVertical: 3, backgroundColor: t.surface }]}>{MAP_ATTRIBUTION}</T>
      <View style={{ maxHeight: "46%", backgroundColor: t.bg }}>
        <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: insets.bottom + 12, gap: 10 }}>
          {summary}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {pins.map(p => {
              const on = p.id === selected?.id;
              return (
                <Pressable key={p.id} onPress={() => setPicked(p.id)} accessibilityRole="button" accessibilityState={{ selected: on }}
                  style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1.5, borderColor: on ? t.brand : p.cheapest ? t.good : t.line, backgroundColor: on ? t.brandSoft : t.surface, flexDirection: "row", gap: 6, alignItems: "center" }}>
                  <Text style={{ color: t.ink, fontWeight: "700", fontSize: 13 }}>{p.chain}</Text>
                  {p.total != null ? <Num style={{ fontSize: 13, color: p.cheapest ? t.good : t.ink2, fontWeight: "800" }}>{money(p.total)} ₪</Num> : null}
                </Pressable>
              );
            })}
          </ScrollView>
          {selected ? <BranchCard pin={selected} pins={pins} hasCart={hasCart} /> : null}
          {pins.some(p => !hasCoords(p)) ? <T style={[tx, { color: t.ink2, fontSize: 12 }]}>{tr("map.someUnplaced")}</T> : null}
        </ScrollView>
      </View>
    </View>
  );
}
