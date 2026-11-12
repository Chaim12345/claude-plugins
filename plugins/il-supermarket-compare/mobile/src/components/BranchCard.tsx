import { Ionicons } from "@expo/vector-icons";
import { Linking, Platform, Text, View } from "react-native";
import { money } from "../lib/compare";
import { compassIndex, extraTrip, hasCoords, navLinks, type NavApp, type Pin } from "../lib/mapgeo";
import { useSettings } from "../lib/settings";
import type { MsgKey } from "../i18n";
import { Button, Num, T, useTheme } from "./ui";

const COMPASS: MsgKey[] = ["map.dir.n", "map.dir.ne", "map.dir.e", "map.dir.se", "map.dir.s", "map.dir.sw", "map.dir.w", "map.dir.nw"];
const NAV_LABEL: Record<NavApp, string> = { waze: "Waze", google: "Google Maps", apple: "Apple Maps" };

/** One compared branch: chain, address, distance, cart total, what's missing, and buttons that open navigation. */
export function BranchCard({ pin, pins, hasCart }: { pin: Pin; pins: Pin[]; hasCart: boolean }) {
  const t = useTheme();
  const { t: tr, tx, kmCost } = useSettings();
  const os = Platform.OS === "ios" ? "ios" : Platform.OS === "android" ? "android" : "web";
  const links = navLinks(hasCoords(pin) ? pin : pin.address, os);
  const canNavigate = hasCoords(pin) || !!pin.address;
  const extra = extraTrip(pin, pins, kmCost);
  const borderColor = pin.cheapest ? t.good : t.line;

  return (
    <View style={{ borderWidth: 1, borderColor, backgroundColor: pin.cheapest ? t.good + "18" : t.surface, borderRadius: 14, padding: 12, gap: 6 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1 }}>
          <T style={[tx, { fontWeight: "800", fontSize: 17, flexShrink: 1 }]}>{pin.chain}</T>
          {pin.cheapest ? <Text style={{ backgroundColor: t.good, color: t.surface, fontSize: 11, fontWeight: "800", borderRadius: 999, paddingHorizontal: 8, overflow: "hidden" }}>{tr("map.cheapest")}</Text> : null}
        </View>
        {pin.total != null ? <Num style={{ fontWeight: "800", fontSize: 18 }}>{money(pin.total)} ₪</Num> : null}
      </View>
      <T style={[tx, { color: t.ink2, fontSize: 13 }]}>{[pin.branch, pin.address].filter(Boolean).join(" · ")}</T>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
        {pin.km != null ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Ionicons name="walk-outline" size={15} color={t.ink2} />
            <T style={[tx, { fontSize: 13, color: t.ink2 }]}>
              {tr("map.distance", { km: pin.km.toFixed(1) })}
              {pin.bearing != null ? ` · ${tr(COMPASS[compassIndex(pin.bearing)])}` : ""}
            </T>
          </View>
        ) : null}
        {pin.approx ? <T style={[tx, { fontSize: 12.5, color: t.warn }]}>{tr("map.approx")}</T> : null}
        {!hasCoords(pin) ? <T style={[tx, { fontSize: 12.5, color: t.warn }]}>{tr("map.noCoords")}</T> : null}
      </View>
      {hasCart && pin.missing.length ? <T style={[tx, { color: t.bad, fontSize: 12.5 }]}>{tr("map.missing", { n: pin.missing.length, items: pin.missing.join("، ") })}</T> : null}
      {hasCart && !pin.missing.length ? <T style={[tx, { color: t.good, fontSize: 12.5 }]}>{tr("map.allThere")}</T> : null}
      {extra >= 0.05 ? <T style={[tx, { color: t.ink2, fontSize: 12.5 }]}>{tr("map.extraTrip", { cost: extra.toFixed(1) })}</T> : null}
      {canNavigate ? (
        <View style={{ gap: 6, marginTop: 4 }}>
          <T style={[tx, { fontWeight: "700", fontSize: 13 }]}>{tr("map.navigate")}</T>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {links.map(l => (
              <Button key={l.app} kind={l.app === "waze" ? "primary" : "ghost"} title={NAV_LABEL[l.app]} style={{ flexGrow: 1, flexBasis: 120, height: 40 }}
                icon={<Ionicons name="navigate" size={16} color={l.app === "waze" ? t.brandInk : t.brand} />}
                onPress={() => { Linking.openURL(l.url).catch(() => {}); }} />
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}
