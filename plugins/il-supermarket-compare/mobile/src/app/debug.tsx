import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import { useEffect, useMemo, useState } from "react";
import { FlatList, Platform, Pressable, Text, View } from "react-native";
import { ModalHead, useModalPadding } from "../components/blocks";
import { Button, T, useTheme } from "../components/ui";
import { clearLog, dlog, logLines, logText, onLog, stamp, type LogLine } from "../lib/debuglog";
import { engine } from "../lib/engine";
import { copyText, shareText } from "../lib/shareAction";
import { useData } from "../lib/store";

const TAGS = ["הכל", "sync", "discover", "geocode", "background", "error", "crash"];

/** The diagnostic log: what the app did on this phone, to copy or share with whoever helps fix it. */
export default function Debug() {
  const t = useTheme();
  const pad = useModalPadding();
  const { catalog, place, active } = useData();
  const [, setTick] = useState(0);
  const [tag, setTag] = useState("הכל");
  const [note, setNote] = useState("");
  useEffect(() => onLog(() => setTick(x => x + 1)), []);

  const header = useMemo(() => ({
    app: `${Constants.expoConfig?.version ?? "?"}`,
    engine: engine.kind,
    platform: `${Platform.OS} ${Platform.Version}`,
    device: (Constants as unknown as { deviceName?: string }).deviceName,
    place: place ? `${place.place} (${place.lat.toFixed(3)}, ${place.lon.toFixed(3)}), ${place.radius} km` : "none",
    catalog: catalog ? `v${catalog.version ?? 0}, ${catalog.products.length} products, ${catalog.stores.length} stores (${active.length} on), price date ${catalog.priceDate}` : "none",
    stores: catalog ? catalog.stores.map(s => `${s.id}${s.fileTime ? "@" + s.fileTime : ""}`).join(" ") : "",
    skipped: catalog?.skipped.length ? catalog.skipped.join(" | ") : "",
    exported: new Date().toISOString(),
  }), [catalog, place, active]);

  const only = tag === "הכל" ? undefined : tag;
  const shown: LogLine[] = logLines().filter(l => !only || l.tag === only).slice().reverse();
  const text = () => logText(header, only);

  return (
    <FlatList
      data={shown}
      keyExtractor={(l, i) => `${l.t}-${i}`}
      initialNumToRender={40}
      contentContainerStyle={{ ...pad, gap: 4 }}
      ListHeaderComponent={
        <View style={{ gap: 10, marginBottom: 8 }}>
          <ModalHead title="יומן אבחון" sub="מה האפליקציה עשתה בטלפון הזה: עדכוני מחירים, שגיאות מהרשתות, איתור כתובות ועדכון ברקע. היומן נשמר רק בטלפון; שלחו אותו רק למי שעוזר לכם לתקן תקלה." />
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Button title="שיתוף היומן" icon={<Ionicons name="share-outline" size={18} color={t.brandInk} />} style={{ flex: 1 }}
              onPress={async () => { dlog("app", "log exported"); const r = await shareText(text(), "יומן אבחון סל זול"); setNote(r === "copied" ? "הועתק" : r === "failed" ? "לא הצלחנו לשתף" : ""); }} />
            <Button kind="ghost" title="העתקה" icon={<Ionicons name="copy-outline" size={18} color={t.ink} />}
              onPress={async () => setNote((await copyText(text())) ? "הועתק ללוח" : "ההעתקה נכשלה")} />
          </View>
          {note ? <T style={{ color: t.brand, fontWeight: "700" }}>{note}</T> : null}
          <View style={{ backgroundColor: t.surface, borderRadius: 12, padding: 10, gap: 2 }}>
            {Object.entries(header).filter(([k, v]) => v && k !== "stores").map(([k, v]) => (
              <Text key={k} style={{ color: t.ink2, fontSize: 12, fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }), writingDirection: "ltr", textAlign: "left" }}>{k}: {String(v)}</Text>
            ))}
          </View>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {TAGS.map(x => (
              <Pressable key={x} onPress={() => setTag(x)} accessibilityRole="button" accessibilityState={{ selected: tag === x }}
                style={{ paddingHorizontal: 10, minHeight: 32, justifyContent: "center", borderRadius: 999, backgroundColor: tag === x ? t.ink : t.surface2 }}>
                <Text style={{ color: tag === x ? t.bg : t.ink, fontSize: 12.5, fontWeight: "600" }}>{x} {x === "הכל" ? logLines().length : logLines().filter(l => l.tag === x).length}</Text>
              </Pressable>
            ))}
          </View>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <T style={{ color: t.ink2, fontSize: 12.5 }}>החדש למעלה</T>
            <Pressable onPress={() => { clearLog(); setNote("היומן נמחק"); }} accessibilityRole="button" hitSlop={8}><Text style={{ color: t.bad, fontWeight: "700" }}>מחיקת היומן</Text></Pressable>
          </View>
        </View>
      }
      ListEmptyComponent={<T style={{ color: t.ink2 }}>היומן ריק. עדכנו מחירים או בחרו מיקום, וחזרו לכאן.</T>}
      renderItem={({ item: l }) => (
        <Text selectable style={{ color: l.tag === "error" || l.tag === "crash" ? t.bad : t.ink, fontSize: 11.5, lineHeight: 16, writingDirection: "ltr", textAlign: "left",
          fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }) }}>
          {stamp(l.t)} [{l.tag}] {l.msg}
        </Text>
      )}
    />
  );
}
