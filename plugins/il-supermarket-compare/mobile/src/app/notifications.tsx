import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useState, type ReactNode } from "react";
import { Linking, Platform, Pressable, ScrollView, Switch, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button, T, useTheme } from "../components/ui";
import type { AlertKind, Settings } from "../lib/alerts";
import { backgroundSupported } from "../lib/background";
import { notificationsSupported } from "../lib/notify";
import { useData } from "../lib/store";
import { useWatch } from "../lib/watchctx";
import { clubChains } from "../lib/compare";

const DAYS = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"];
const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export default function NotificationSettings() {
  const t = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { catalog } = useData();
  const { settings: s, setSettings, perm, enableNotifications, disableNotifications } = useWatch();
  const [busy, setBusy] = useState(false);
  const rule = (k: AlertKind, on: boolean) => setSettings({ rules: { [k]: on } });
  const hasClub = catalog ? clubChains(catalog).length > 0 : true;

  return (
    <ScrollView contentContainerStyle={{ padding: 18, paddingTop: insets.top + 12, paddingBottom: insets.bottom + 24, gap: 12 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <T style={{ fontSize: 22, fontWeight: "800" }}>התראות</T>
        <Pressable onPress={() => router.back()} accessibilityLabel="סגירה" hitSlop={10}><Ionicons name="close" size={26} color={t.ink} /></Pressable>
      </View>

      <Card>
        <Line title="התראות במכשיר" sub={notificationsSupported ? "הודעה קצרה כשיש משהו חדש במה שאתם עוקבים אחריו" : "בדפדפן אין התראות מערכת. העדכונים מופיעים בתיבת ״מה חדש״."}>
          <Switch value={s.on} disabled={!notificationsSupported || busy} accessibilityLabel="התראות במכשיר"
            onValueChange={async on => {
              if (!on) return disableNotifications();
              setBusy(true); await enableNotifications(); setBusy(false);
            }} />
        </Line>
        {perm === "denied" && notificationsSupported ? (
          <>
            <T style={{ color: t.bad, fontSize: 13 }}>ההרשאה להתראות חסומה. אפשר לאשר אותה בהגדרות המכשיר.</T>
            <Button kind="ghost" title="פתיחת הגדרות המכשיר" style={{ height: 40 }} onPress={() => Linking.openSettings().catch(() => {})} />
          </>
        ) : null}
        <T style={{ color: t.ink2, fontSize: 12.5 }}>״מה חדש״ (הפעמון למעלה) עובד גם כשההתראות כבויות.</T>
      </Card>

      <Card title="על מה להתריע">
        <Line title="מוצר במעקב יצא למבצע" sub="בסניף בטווח שבחרתם"><Switch value={s.rules.promo} onValueChange={v => rule("promo", v)} accessibilityLabel="מבצע חדש" /></Line>
        <Line title="ירידת מחיר" sub={`ב־${s.dropPct}% לפחות, או המחיר הנמוך ב־30 יום`}><Switch value={s.rules.drop} onValueChange={v => rule("drop", v)} accessibilityLabel="ירידת מחיר" /></Line>
        {s.rules.drop ? <Chips label="סף הירידה" value={s.dropPct} options={[3, 5, 10, 15]} text={v => `${v}%`} onPick={v => setSettings({ dropPct: v })} /> : null}
        <Line title="הסל הרגיל" sub="הסל הכולל התוזל, או שסניף אחר הפך לזול ביותר"><Switch value={s.rules.basket} onValueChange={v => rule("basket", v)} accessibilityLabel="הסל הרגיל" /></Line>
        {s.rules.basket ? (
          <>
            <Chips label="ירידה של לפחות" value={s.basketPct} options={[3, 5, 10]} text={v => `${v}%`} onPick={v => setSettings({ basketPct: v })} />
            <Chips label="או בשקלים" value={s.basketMin} options={[1000, 1500, 2500, 5000]} text={v => `${v / 100} ₪`} onPick={v => setSettings({ basketMin: v })} />
          </>
        ) : null}
        <Line title="מבצע שנגמר בקרוב" sub="48 שעות לפני הסיום"><Switch value={s.rules.ending} onValueChange={v => rule("ending", v)} accessibilityLabel="מבצע שנגמר בקרוב" /></Line>
        <Line title="הדילים הטובים של השבוע" sub="סיכום שבועי של עד 5 שינויים"><Switch value={s.rules.digest} onValueChange={v => rule("digest", v)} accessibilityLabel="סיכום שבועי" /></Line>
        {s.rules.digest ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
            <T style={{ color: t.ink2, fontSize: 13 }}>יום:</T>
            {DAYS.map((d, k) => <Pill key={k} on={s.digestDay === k} label={d} onPress={() => setSettings({ digestDay: k })} />)}
          </View>
        ) : null}
      </Card>

      <Card title="שעות שקט">
        <Line title="לא להפריע בשעות שקט" sub="התראות שיתקבלו אז יגיעו כשהן נגמרות, ותמיד יישמרו ב״מה חדש״">
          <Switch value={s.quiet} onValueChange={v => setSettings({ quiet: v })} accessibilityLabel="שעות שקט" />
        </Line>
        {s.quiet ? (
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Time label="מ־" value={s.quietFrom} onChange={v => setSettings({ quietFrom: v })} />
            <Time label="עד" value={s.quietTo} onChange={v => setSettings({ quietTo: v })} />
          </View>
        ) : null}
      </Card>

      {hasClub ? (
        <Card title="כרטיסי מועדון">
          <Line title="גם מבצעי מועדון בלי כרטיס" sub="כבוי: מתריעים על מבצעי מועדון רק ברשתות שסימנתם בלשונית הסל">
            <Switch value={s.anyClub} onValueChange={v => setSettings({ anyClub: v })} accessibilityLabel="מבצעי מועדון בלי כרטיס" />
          </Line>
        </Card>
      ) : null}

      <T style={{ color: t.ink2, fontSize: 12.5, lineHeight: 18 }}>
        {backgroundSupported
          ? `אחרי כל עדכון מחירים באפליקציה אנחנו בודקים מה השתנה. כשההתראות פועלות, המערכת גם מעירה את האפליקציה לבדיקה ברקע, בערך פעמיים ביום לכל היותר. התזמון נקבע על ידי ${Platform.OS === "ios" ? "iOS (לרוב בלילה, על מטען וב־Wi-Fi)" : "אנדרואיד, ויכול להתעכב בחיסכון בסוללה, במצב Doze ובמכשירים שחוסמים אפליקציות ברקע"}; אין הבטחה לשעה מדויקת. אם סוגרים את האפליקציה בכוח, הבדיקה ברקע נעצרת עד הפתיחה הבאה.`
          : "בדפדפן הבדיקה רצה רק כשהאפליקציה פתוחה, אחרי עדכון מחירים."}
      </T>
    </ScrollView>
  );
}

function Card({ title, children }: { title?: string; children: ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ backgroundColor: t.surface, borderRadius: 14, padding: 14, gap: 12 }}>
      {title ? <T style={{ fontSize: 17, fontWeight: "800" }}>{title}</T> : null}
      {children}
    </View>
  );
}

function Line({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <T style={{ fontWeight: "700" }}>{title}</T>
        {sub ? <T style={{ color: t.ink2, fontSize: 12.5 }}>{sub}</T> : null}
      </View>
      {children}
    </View>
  );
}

function Pill({ on, label, onPress }: { on: boolean; label: string; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: on }}
      style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: on ? t.brand : t.line, backgroundColor: on ? t.brandSoft : t.surface }}>
      <Text style={{ color: t.ink, fontWeight: "600", fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
}

function Chips({ label, value, options, text, onPick }: { label: string; value: number; options: number[]; text: (v: number) => string; onPick: (v: number) => void }) {
  const t = useTheme();
  const all = options.includes(value) ? options : [...options, value].sort((a, b) => a - b);
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
      <T style={{ color: t.ink2, fontSize: 13 }}>{label}:</T>
      {all.map(v => <Pill key={v} on={v === value} label={text(v)} onPress={() => onPick(v)} />)}
    </View>
  );
}

/** Time of day in 30-minute steps. */
function Time({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  const t = useTheme();
  const step = (d: number) => onChange((value + d + 1440) % 1440);
  return (
    <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: t.surface2, borderRadius: 12, paddingHorizontal: 8, height: 44 }}>
      <T style={{ color: t.ink2, fontSize: 13 }}>{label}</T>
      <Pressable onPress={() => step(-30)} hitSlop={6} accessibilityLabel={`${label} מוקדם יותר`}><Text style={{ color: t.brand, fontSize: 22, fontWeight: "700", paddingHorizontal: 6 }}>−</Text></Pressable>
      <Text style={{ flex: 1, textAlign: "center", fontWeight: "800", color: t.ink, fontVariant: ["tabular-nums"], writingDirection: "ltr" }}>{hhmm(value)}</Text>
      <Pressable onPress={() => step(30)} hitSlop={6} accessibilityLabel={`${label} מאוחר יותר`}><Text style={{ color: t.brand, fontSize: 22, fontWeight: "700", paddingHorizontal: 6 }}>+</Text></Pressable>
    </View>
  );
}
