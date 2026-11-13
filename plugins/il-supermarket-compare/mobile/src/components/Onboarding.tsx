import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useState, type ComponentProps, type ReactNode } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { clubChains } from "../lib/compare";
import { useSettings } from "../lib/settings";
import { useData } from "../lib/store";
import { Chip } from "./settings/SettingsSection";
import { Button, T, useTheme } from "./ui";

/** Chains offered for the club-card question before any catalog has loaded (keys are portal keys, as in store ids). */
const FALLBACK_CHAINS = [
  { key: "shufersal", label: "שופרסל" }, { key: "RamiLevi", label: "רמי לוי" }, { key: "yohananof", label: "יוחננוף" },
  { key: "osherad", label: "אושר עד" }, { key: "TivTaam", label: "טיב טעם" },
];

const STEPS = 3;

/**
 * First-run introduction: three short pages (official prices and what isn't counted; club card; where you shop).
 * Shown once, skippable. Phones that already have a chosen place (installed before onboarding existed) never see it.
 */
export function Onboarding() {
  const t = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t: tr, tx, dir, onboarded, ready, finishOnboarding } = useSettings();
  const { place, ready: dataReady, catalog, club, setClub } = useData();
  const [step, setStep] = useState(0);

  const existingUser = dataReady && !!place;
  useEffect(() => { if (ready && onboarded === false && existingUser) finishOnboarding(); }, [ready, onboarded, existingUser, finishOnboarding]);
  if (!ready || onboarded !== false || !dataReady || existingUser) return null;

  const chains = catalog && clubChains(catalog).length ? clubChains(catalog) : FALLBACK_CHAINS;
  const last = step === STEPS - 1;
  const done = (goLocate: boolean) => { finishOnboarding(); if (goLocate) router.push("/location"); };

  const page: { icon: ComponentProps<typeof Ionicons>["name"]; title: string; body: ReactNode } =
    step === 0 ? { icon: "document-text-outline", title: tr("onb.prices.title"), body: (
      <>
        <T style={[tx, { fontSize: 16, lineHeight: 24 }]}>{tr("onb.prices.body")}</T>
        <View style={{ backgroundColor: t.surface2, borderRadius: 14, padding: 14, gap: 6 }}>
          <T style={[tx, { fontWeight: "800" }]}>{tr("onb.excluded.title")}</T>
          <T style={[tx, { color: t.ink2, lineHeight: 22 }]}>{tr("onb.excluded.body")}</T>
        </View>
      </>) }
    : step === 1 ? { icon: "card-outline", title: tr("onb.club.title"), body: (
      <>
        <T style={[tx, { fontSize: 16, lineHeight: 24 }]}>{tr("onb.club.body")}</T>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {chains.map(x => <Chip key={x.key} role="checkbox" on={!!club[x.key]} label={x.label} onPress={() => setClub(x.key, !club[x.key])} />)}
        </View>
        <T style={[tx, { color: t.ink2, fontSize: 12.5 }]}>{tr("onb.club.note")}</T>
      </>) }
    : { icon: "location-outline", title: tr("onb.where.title"), body: (
      <T style={[tx, { fontSize: 16, lineHeight: 24 }]}>{tr("onb.where.body")}</T>
    ) };

  return (
    <Modal visible animationType="fade" statusBarTranslucent onRequestClose={() => done(false)}>
      <View style={{ flex: 1, backgroundColor: t.bg, direction: dir }}>
        <View style={{ flexDirection: "row", justifyContent: "flex-end", paddingTop: insets.top + 12, paddingHorizontal: 18 }}>
          <Pressable onPress={() => done(false)} accessibilityRole="button" hitSlop={10}><Text style={{ color: t.ink2, fontWeight: "700", fontSize: 15 }}>{tr("common.skip")}</Text></Pressable>
        </View>
        <ScrollView contentContainerStyle={{ flexGrow: 1, padding: 22, gap: 16, justifyContent: "center" }}>
          <View style={{ width: 64, height: 64, borderRadius: 20, backgroundColor: t.brandSoft, alignItems: "center", justifyContent: "center", alignSelf: "flex-start" }}>
            <Ionicons name={page.icon} size={32} color={t.brand} />
          </View>
          <T style={[tx, { fontSize: 26, fontWeight: "800" }]}>{page.title}</T>
          {page.body}
        </ScrollView>
        <View style={{ paddingHorizontal: 22, paddingBottom: insets.bottom + 18, gap: 14 }}>
          <View style={{ flexDirection: "row", justifyContent: "center", gap: 6 }} accessibilityLabel={tr("onb.step", { n: step + 1, total: STEPS })}>
            {Array.from({ length: STEPS }, (_, i) => <View key={i} style={{ width: i === step ? 22 : 8, height: 8, borderRadius: 4, backgroundColor: i === step ? t.brand : t.line }} />)}
          </View>
          {last ? (
            <View style={{ gap: 8 }}>
              <Button title={tr("onb.where.choose")} onPress={() => done(true)} />
              <Button kind="ghost" title={tr("onb.where.later")} onPress={() => done(false)} />
            </View>
          ) : (
            <View style={{ flexDirection: "row", gap: 8 }}>
              {step > 0 ? <Button kind="ghost" title={tr("common.back")} style={{ flex: 1 }} onPress={() => setStep(step - 1)} /> : null}
              <Button title={tr("common.next")} style={{ flex: 2 }} onPress={() => setStep(step + 1)} />
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}
