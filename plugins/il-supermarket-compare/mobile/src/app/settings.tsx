import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Linking, Platform, Pressable, ScrollView, Switch, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ExtraSettingsSections } from "../components/settings/extraSections";
import { Chip, Hint, SettingsSection } from "../components/settings/SettingsSection";
import { Button, T, useTheme } from "../components/ui";
import { LANGS, LANG_NAMES } from "../i18n";
import { clubChains } from "../lib/compare";
import { CACHE_KEYS, MAX_KM_COST, RADII, fmtKmCost, parseKmCost } from "../lib/prefs";
import { useSettings } from "../lib/settings";
import { useData } from "../lib/store";

const LINKS = {
  osm: "https://www.openstreetmap.org/copyright",
  ofm: "https://openfreemap.org/",
  oism: "https://github.com/OpenIsraeliSupermarkets/israeli-supermarket-scarpers",
  off: "https://world.openfoodfacts.org/data",
};

export default function SettingsScreen() {
  const t = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t: tr, tx, dir, lang, setLang, radius, setRadius, kmCost, setKmCost } = useSettings();
  const { catalog, club, setClub, setClubAll, saved, deleteSaved, clearCart, cart } = useData();
  const chains = catalog ? clubChains(catalog) : [];

  // The km cost is typed as text and saved once it is a valid number.
  const [kmText, setKmText] = useState(fmtKmCost(kmCost));
  const [kmBad, setKmBad] = useState(false);
  useEffect(() => { setKmText(fmtKmCost(kmCost)); }, [kmCost]);
  const onKm = (s: string) => {
    setKmText(s);
    const n = parseKmCost(s);
    setKmBad(n == null);
    if (n != null) setKmCost(n);
  };

  const [confirm, setConfirm] = useState(false);
  const [cleared, setCleared] = useState(false);
  const clearAll = async () => {
    clearCart();
    saved.forEach(l => deleteSaved(l.id));
    await Promise.all(CACHE_KEYS.map(k => AsyncStorage.removeItem(k).catch(() => {})));
    setConfirm(false);
    setCleared(true);
  };

  const version = Constants.expoConfig?.version ?? "";
  const open = (url: string) => { Linking.openURL(url).catch(() => {}); };
  const inputStyle = [{ width: 90, height: 40, borderRadius: 10, borderWidth: 1, borderColor: kmBad ? t.bad : t.line, backgroundColor: t.surface2, paddingHorizontal: 10, color: t.ink, textAlign: "center" as const, fontSize: 16 }, Platform.OS === "web" && ({ outlineStyle: "none" } as object)];

  return (
    <View style={{ flex: 1, direction: dir }}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 18, paddingTop: insets.top + 12, paddingBottom: insets.bottom + 32, gap: 12 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <T style={[tx, { fontSize: 22, fontWeight: "800" }]}>{tr("settings.title")}</T>
          <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel={tr("common.close")} hitSlop={10}><Ionicons name="close" size={26} color={t.ink} /></Pressable>
        </View>

        <SettingsSection title={tr("settings.search")} hint={tr("settings.radiusHint")}>
          <T style={[tx, { fontWeight: "700" }]}>{tr("settings.radius")}</T>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {RADII.map(r => <Chip key={r} role="radio" on={r === radius} label={tr("common.km", { n: r })} onPress={() => setRadius(r)} />)}
          </View>
        </SettingsSection>

        <SettingsSection title={tr("settings.trip")} hint={tr("settings.tripHint")}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <T style={[tx, { fontWeight: "700", flexShrink: 1 }]}>{tr("settings.kmCost")}</T>
            <TextInput value={kmText} onChangeText={onKm} onBlur={() => { if (parseKmCost(kmText) == null) { setKmText(fmtKmCost(kmCost)); setKmBad(false); } }}
              keyboardType="decimal-pad" inputMode="decimal" accessibilityLabel={tr("settings.kmCost")} style={inputStyle} />
            <T style={tx}>{tr("settings.perKm")}</T>
          </View>
          {kmBad ? <Hint bad>{tr("settings.kmBad", { max: MAX_KM_COST })}</Hint> : null}
        </SettingsSection>

        <SettingsSection title={tr("settings.club")} hint={tr("settings.clubHint")}>
          {chains.length ? (
            <>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                <T style={[tx, { fontWeight: "700", flexShrink: 1 }]}>{tr("settings.haveClub")}</T>
                <Switch value={chains.some(x => club[x.key])} onValueChange={on => setClubAll(chains.map(x => x.key), on)} accessibilityLabel={tr("settings.haveClub")} />
              </View>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                {chains.map(x => <Chip key={x.key} role="checkbox" on={!!club[x.key]} label={x.label} onPress={() => setClub(x.key, !club[x.key])} />)}
              </View>
            </>
          ) : <Hint>{tr("settings.clubNone")}</Hint>}
        </SettingsSection>

        <SettingsSection title={tr("settings.language")} hint={tr("settings.languageHint")}>
          <View style={{ flexDirection: "row", gap: 6 }}>
            {LANGS.map(l => <Chip key={l} role="radio" on={l === lang} label={LANG_NAMES[l]} onPress={() => setLang(l)} />)}
          </View>
        </SettingsSection>

        {/* Sections from other features go in extraSections.tsx */}
        <ExtraSettingsSections />

        <SettingsSection title={tr("settings.data")} hint={tr("settings.dataHint", { items: Object.keys(cart).length, lists: saved.length })}>
          {confirm ? (
            <View style={{ gap: 8 }}>
              <T style={[tx, { color: t.bad, fontWeight: "700" }]}>{tr("settings.confirm")}</T>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <Button title={tr("settings.confirmYes")} style={{ flex: 1, backgroundColor: t.bad }} onPress={clearAll} />
                <Button kind="ghost" title={tr("common.cancel")} style={{ flex: 1 }} onPress={() => setConfirm(false)} />
              </View>
            </View>
          ) : <Button kind="ghost" title={tr("settings.clear")} onPress={() => { setCleared(false); setConfirm(true); }} />}
          {cleared ? <Hint>{tr("settings.cleared")}</Hint> : null}
        </SettingsSection>

        <SettingsSection title={tr("about.title")}>
          <Hint>{tr("about.prices")}</Hint>
          <Hint>{tr("about.addresses")}</Hint>
          <Pressable onPress={() => open(LINKS.osm)} accessibilityRole="link"><Text style={{ color: t.brand, fontWeight: "700", textAlign: tx.textAlign ?? "right" }}>{tr("about.osmLink")}</Text></Pressable>
          <Hint>{tr("about.map")}</Hint>
          <Pressable onPress={() => open(LINKS.ofm)} accessibilityRole="link"><Text style={{ color: t.brand, fontWeight: "700", textAlign: tx.textAlign ?? "right" }}>openfreemap.org</Text></Pressable>
          <Hint>{tr("about.oism")}</Hint>
          <Pressable onPress={() => open(LINKS.oism)} accessibilityRole="link"><Text style={{ color: t.brand, fontWeight: "700", textAlign: tx.textAlign ?? "right" }}>Open Israeli Supermarkets</Text></Pressable>
          <Hint>{tr("about.photos")}</Hint>
          <Pressable onPress={() => open(LINKS.off)} accessibilityRole="link"><Text style={{ color: t.brand, fontWeight: "700", textAlign: tx.textAlign ?? "right" }}>Open Food Facts</Text></Pressable>
          <Hint>{tr("about.disclaimer")}</Hint>
          <T style={[tx, { color: t.ink2, fontSize: 12.5 }]}>{tr("about.version", { v: version })}</T>
        </SettingsSection>
      </ScrollView>
    </View>
  );
}
