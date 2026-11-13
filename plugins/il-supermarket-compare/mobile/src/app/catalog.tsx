import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, Switch, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button, T, useTheme } from "../components/ui";
import { useAi } from "../lib/ai";
import { BATCH, changes, counts, type Change, type TaskKind } from "../lib/curate";
import { MAX_REQUESTS, useCurationRunner } from "../lib/curation";
import { approveLink, resetAll, resetTask, setAutoLinks, setTaskOn, toggleUndo, useCuration } from "../lib/curationState";
import { useData } from "../lib/store";

const INFO: Record<TaskKind, { title: string; what: string; pending: (n: number) => string; icon: "albums-outline" | "text-outline" | "git-merge-outline" }> = {
  cats: {
    title: "סידור קטגוריות",
    what: "מוצרים שהמחירונים לא שייכו לקטגוריה (״שונות״) מקבלים קטגוריה אמיתית, כך שיופיעו בחיפוש לפי קטגוריה, במדד המחירים ובהמלצות.",
    pending: n => `${n.toLocaleString("he-IL")} מוצרים ב״שונות״ עוד לא נבדקו`,
    icon: "albums-outline",
  },
  names: {
    title: "ניקוי שמות",
    what: "שמות עם מספרים צמודים, קיצורים וסימנים (״שוקו׳ בקבוק 1ל״, ״ש.חלב״) מקבלים שם קריא. כל המספרים נשמרים כמו שהם, השם המקורי נשאר בחיפוש ובדף המוצר, וגודל האריזה עדיין נקרא מהשם המקורי.",
    pending: n => `${n.toLocaleString("he-IL")} שמות לא מסודרים עוד לא נבדקו`,
    icon: "text-outline",
  },
  links: {
    title: "איחוד מוצרים כפולים",
    what: "אותו מוצר בשני ברקודים (ברקוד פנימי של רשת, או ברקוד ישן וחדש) הופך למוצר אחד עם המחיר בכל הסניפים. מוצעים רק זוגות באותו גודל אריזה, עם שמות דומים, שאף סניף לא מוכר את שניהם. איחוד נכנס לתוקף רק אחרי שאישרתם אותו.",
    pending: n => `${n.toLocaleString("he-IL")} זוגות אפשריים עוד לא נבדקו`,
    icon: "git-merge-outline",
  },
};

/** "ניהול קטלוג": run the AI curation tasks, see every change, approve, undo or turn a task off. */
export default function CatalogScreen() {
  const t = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { rawCatalog } = useData();
  const { ready, cfg } = useAi();
  const cur = useCuration();
  const { status, pending, run, cancel } = useCurationRunner();
  const [open, setOpen] = useState<TaskKind | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const n = useMemo(() => (rawCatalog ? counts(rawCatalog, cur) : null), [rawCatalog, cur]);

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingTop: insets.top + 12, paddingBottom: insets.bottom + 40, gap: 12 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <T accessibilityRole="header" style={{ fontSize: 22, fontWeight: "800" }}>ניהול קטלוג</T>
          <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="סגירה" hitSlop={10}><Ionicons name="close" size={26} color={t.ink} /></Pressable>
        </View>
        <T style={{ color: t.ink2, fontSize: 13, lineHeight: 19 }}>
          מודל השפה שהגדרתם מסדר את הקטלוג שהמחירונים יוצרים. השינויים נשמרים בטלפון בלבד, חלים על החיפוש, המבצעים, הסל וההשוואה, ואפשר לבטל כל שינוי בנפרד או לכבות משימה שלמה. כל מוצר נבדק פעם אחת; אחרי עדכון מחירים נבדקים רק מוצרים חדשים.
        </T>
        {!ready ? (
          <View style={{ backgroundColor: t.surface, borderRadius: 14, padding: 14, gap: 10 }}>
            <T style={{ fontWeight: "700" }}>צריך להגדיר בינה מלאכותית קודם</T>
            <T style={{ color: t.ink2, fontSize: 13 }}>מפתח חינמי של Gemini, או של כל ספק תואם OpenAI, בהגדרות.</T>
            <Button title="להגדרות" onPress={() => router.push("/settings")} />
          </View>
        ) : <T style={{ color: t.ink2, fontSize: 12.5 }}>מודל: {cfg.model}</T>}
        {!rawCatalog ? <T style={{ color: t.ink2 }}>הקטלוג עוד לא נטען.</T> : null}

        {rawCatalog && n ? (["cats", "names", "links"] as TaskKind[]).map(k => {
          const s = status[k], c = n[k], info = INFO[k];
          const reqs = Math.min(MAX_REQUESTS, Math.ceil(pending[k] / BATCH[k]));
          return (
            <View key={k} style={{ backgroundColor: t.surface, borderRadius: 14, padding: 14, gap: 10 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <Ionicons name={info.icon} size={22} color={t.brand} />
                <T style={{ flex: 1, fontSize: 17, fontWeight: "800" }}>{info.title}</T>
                <Switch value={cur.on[k]} onValueChange={v => setTaskOn(k, v)} accessibilityLabel={`${info.title}: פעיל`} />
              </View>
              <T style={{ color: t.ink2, fontSize: 12.5, lineHeight: 18 }}>{info.what}</T>
              {!cur.on[k] ? <T style={{ color: t.warn, fontSize: 12.5, fontWeight: "700" }}>כבוי: השינויים שמורים אבל לא מוצגים.</T> : null}
              <T style={{ fontSize: 13.5, fontWeight: "600" }}>
                {k === "links" ? `${c.done} אוחדו · ${c.awaiting} מחכים לאישור` : `${c.done.toLocaleString("he-IL")} שינויים`}{c.undone ? ` · ${c.undone} בוטלו` : ""}
              </T>
              {pending[k] ? <T style={{ color: t.ink2, fontSize: 12.5 }}>{info.pending(pending[k])}</T> : <T style={{ color: t.good, fontSize: 12.5 }}>הכל נבדק</T>}
              {s.running ? <T style={{ color: t.brand, fontSize: 12.5, fontWeight: "700" }}>רץ: {s.done} מתוך {s.total} בקשות · {s.added ?? 0} שינויים חדשים</T> : null}
              {!s.running && s.at && !s.error ? <T style={{ color: s.stopped ? t.ink2 : t.good, fontSize: 12.5 }}>{s.stopped ? "נעצר" : "הסתיים"}: {s.added ?? 0} שינויים חדשים{k === "links" && s.added ? " (מחכים לאישור שלכם בסקירה)" : ""}</T> : null}
              {s.error ? <T style={{ color: t.bad, fontSize: 12.5 }}>נעצר: {s.error}</T> : null}
              {k === "links" ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <T style={{ flex: 1, fontSize: 13 }}>לאחד בלי לחכות לאישור</T>
                  <Switch value={cur.autoLinks} onValueChange={setAutoLinks} accessibilityLabel="לאחד בלי לחכות לאישור" />
                </View>
              ) : null}
              <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                {s.running
                  ? <Button kind="ghost" title="עצירה" label={`עצירה: ${info.title}`} onPress={() => cancel(k)} style={{ flex: 1 }} />
                  : <Button title={pending[k] ? `הרצה (${reqs === 1 ? "בקשה אחת" : `${reqs} בקשות`})` : "אין מה להריץ"} label={`הרצה: ${info.title}`} disabled={!ready || !pending[k]} onPress={() => run(k)} style={{ flex: 1 }} />}
                <Button kind="ghost" title={open === k ? "סגירת הסקירה" : "סקירה"} label={`סקירה: ${info.title}`} disabled={!c.done && !c.undone && !c.awaiting} onPress={() => setOpen(open === k ? null : k)} style={{ flex: 1 }} />
              </View>
              {open === k ? <Review kind={k} /> : null}
              {(c.done || c.undone || c.awaiting) && !s.running ? (
                <Pressable onPress={() => resetTask(k)} accessibilityRole="button" hitSlop={6}>
                  <T style={{ color: t.ink2, fontSize: 12.5, textDecorationLine: "underline" }}>לבטל את השינויים של המשימה הזו ולבדוק מחדש</T>
                </Pressable>
              ) : null}
            </View>
          );
        }) : null}

        {rawCatalog ? (
          <View style={{ gap: 8, marginTop: 4 }}>
            {confirmReset ? (
              <>
                <T style={{ color: t.bad, fontWeight: "700" }}>לבטל את כל השינויים ולשכוח את כל התשובות?</T>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <Button title="כן, לאפס" style={{ flex: 1, backgroundColor: t.bad }} onPress={() => { resetAll(); setConfirmReset(false); }} />
                  <Button kind="ghost" title="ביטול" style={{ flex: 1 }} onPress={() => setConfirmReset(false)} />
                </View>
              </>
            ) : <Button kind="ghost" title="איפוס כל ניהול הקטלוג" onPress={() => setConfirmReset(true)} />}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const PAGE = 40;

/** Every change of one task: before → after, with undo (and approve for links). */
function Review({ kind }: { kind: TaskKind }) {
  const t = useTheme();
  const router = useRouter();
  const { rawCatalog } = useData();
  const cur = useCuration();
  const [shown, setShown] = useState(PAGE);
  const [filter, setFilter] = useState<"all" | "awaiting" | "undone">(kind === "links" ? "awaiting" : "all");
  const all = useMemo(() => (rawCatalog ? changes(rawCatalog, cur, kind) : []), [rawCatalog, cur, kind]);
  const list = all.filter(c => filter === "all" || (filter === "awaiting" ? c.awaiting : c.undone));
  const chip = (id: typeof filter, label: string) => (
    <Pressable key={id} onPress={() => { setFilter(id); setShown(PAGE); }} accessibilityRole="button" accessibilityState={{ selected: filter === id }}
      style={{ paddingHorizontal: 12, minHeight: 32, justifyContent: "center", borderRadius: 999, backgroundColor: filter === id ? t.ink : t.surface2 }}>
      <T style={{ color: filter === id ? t.bg : t.ink, fontSize: 12.5, fontWeight: "600" }}>{label}</T>
    </Pressable>
  );
  return (
    <View style={{ gap: 8, borderTopWidth: 1, borderTopColor: t.line, paddingTop: 10 }}>
      <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
        {chip("all", `הכל (${all.length})`)}
        {kind === "links" ? chip("awaiting", `מחכים לאישור (${all.filter(c => c.awaiting).length})`) : null}
        {chip("undone", `בוטלו (${all.filter(c => c.undone).length})`)}
        {kind === "links" && filter === "awaiting" && list.length ? (
          <Pressable onPress={() => list.forEach(c => approveLink(c.code, true))} accessibilityRole="button" style={{ paddingHorizontal: 12, minHeight: 32, justifyContent: "center", borderRadius: 999, backgroundColor: t.brandSoft }}>
            <T style={{ color: t.brand, fontSize: 12.5, fontWeight: "700" }}>אישור הכל</T>
          </Pressable>
        ) : null}
      </View>
      {!list.length ? <T style={{ color: t.ink2, fontSize: 12.5 }}>אין כאן כלום.</T> : null}
      {list.slice(0, shown).map(c => <Row key={c.code} c={c} open={() => router.push(`/product/${encodeURIComponent(c.code)}`)} />)}
      {list.length > shown ? <Button kind="ghost" title={`עוד ${Math.min(PAGE, list.length - shown)}`} onPress={() => setShown(s => s + PAGE)} /> : null}
    </View>
  );
}

function Row({ c, open }: { c: Change; open: () => void }) {
  const t = useTheme();
  const label = c.kind === "links" ? "אותו מוצר כמו" : c.kind === "cats" ? "לקטגוריה" : "שם חדש";
  return (
    <View style={{ backgroundColor: c.awaiting ? t.warn + "14" : t.surface2, borderRadius: 10, padding: 10, gap: 4, opacity: c.undone ? 0.6 : 1 }}>
      <Pressable onPress={open} accessibilityRole="link">
        <T style={{ fontSize: 13, color: t.ink2, textDecorationLine: c.undone ? "none" : c.kind === "names" ? "line-through" : "none" }}>{c.from}{c.fromWhere ? ` · ${c.fromWhere}` : ""}</T>
        <T style={{ fontSize: 14, fontWeight: "700" }}>{label}: {c.to}</T>
        {c.toWhere ? <T style={{ fontSize: 12, color: t.ink2 }}>{c.toWhere}</T> : null}
      </Pressable>
      <View style={{ flexDirection: "row", gap: 8, justifyContent: "flex-end" }}>
        {c.awaiting ? (
          <>
            <SmallBtn title="אישור" color={t.good} onPress={() => approveLink(c.code, true)} />
            <SmallBtn title="לא אותו מוצר" color={t.bad} onPress={() => approveLink(c.code, false)} />
          </>
        ) : <SmallBtn title={c.undone ? "שחזור" : "ביטול"} color={c.undone ? t.brand : t.ink2} onPress={() => toggleUndo(c.kind, c.code)} />}
      </View>
    </View>
  );
}

function SmallBtn({ title, color, onPress }: { title: string; color: string; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={title} hitSlop={6}
      style={({ pressed }) => ({ paddingHorizontal: 12, minHeight: 32, justifyContent: "center", borderRadius: 8, borderWidth: 1, borderColor: color, backgroundColor: t.surface, opacity: pressed ? 0.8 : 1 })}>
      <T style={{ color, fontSize: 12.5, fontWeight: "700" }}>{title}</T>
    </Pressable>
  );
}
