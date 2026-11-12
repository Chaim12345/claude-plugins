import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button, Num, T, useTheme } from "../components/ui";
import { fmtDate } from "../lib/compare";
import { useData } from "../lib/store";
import type { SavedList } from "../lib/saved";

const inputStyle = [{ flex: 1, height: 44, borderRadius: 12, borderWidth: 1, minWidth: 0, paddingHorizontal: 12, textAlign: "right" as const }, Platform.OS === "web" && ({ outlineStyle: "none" } as object)];

export default function Saved() {
  const t = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { cart, saved, saveCart, loadSaved, renameSaved, deleteSaved } = useData();
  const [name, setName] = useState("");
  const inCart = Object.keys(cart).length;

  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 18, paddingTop: insets.top + 12, paddingBottom: insets.bottom + 24, gap: 12 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <T style={{ fontSize: 22, fontWeight: "800" }}>רשימות שמורות</T>
        <Pressable onPress={() => router.back()} accessibilityLabel="סגירה" hitSlop={10}><Ionicons name="close" size={26} color={t.ink} /></Pressable>
      </View>

      {inCart ? (
        <View style={{ backgroundColor: t.surface, borderRadius: 14, padding: 14, gap: 10 }}>
          <T style={{ fontWeight: "700" }}>שמירת הסל הנוכחי ({inCart} פריטים)</T>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <TextInput value={name} onChangeText={setName} placeholder="שם, למשל קנייה שבועית" placeholderTextColor={t.ink2} accessibilityLabel="שם הרשימה"
              onSubmitEditing={() => { saveCart(name); setName(""); }}
              style={[...inputStyle, { borderColor: t.line, backgroundColor: t.surface2, color: t.ink }]} />
            <Button title="שמירה" onPress={() => { saveCart(name); setName(""); }} />
          </View>
        </View>
      ) : <T style={{ color: t.ink2 }}>הסל ריק. אפשר לטעון רשימה שמורה, או למלא את הסל ולשמור אותו כאן.</T>}

      {saved.length ? saved.map(l => <SavedRow key={l.id} l={l} canMerge={inCart > 0}
        onLoad={mode => { loadSaved(l.id, mode); router.dismissTo("/cart"); }} onRename={n => renameSaved(l.id, n)} onDelete={() => deleteSaved(l.id)} />)
        : <T style={{ color: t.ink2, textAlign: "center", padding: 20 }}>עוד אין רשימות שמורות.</T>}
    </ScrollView>
  );
}

function SavedRow({ l, canMerge, onLoad, onRename, onDelete }: { l: SavedList; canMerge: boolean; onLoad: (m: "replace" | "merge") => void; onRename: (n: string) => void; onDelete: () => void }) {
  const t = useTheme();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(l.name);
  const [sure, setSure] = useState(false); // Alert buttons don't exist on web: confirm with a second tap
  const n = Object.keys(l.items).length;
  const done = () => { onRename(draft); setEditing(false); };
  return (
    <View style={{ backgroundColor: t.surface, borderRadius: 14, padding: 14, gap: 10 }}>
      {editing ? (
        <View style={{ flexDirection: "row", gap: 8 }}>
          <TextInput value={draft} onChangeText={setDraft} autoFocus onSubmitEditing={done} accessibilityLabel="שם חדש"
            style={[...inputStyle, { borderColor: t.line, backgroundColor: t.surface2, color: t.ink }]} />
          <Button title="אישור" onPress={done} />
        </View>
      ) : (
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <T numberOfLines={1} style={{ fontWeight: "800", fontSize: 16 }}>{l.name}</T>
            <T style={{ color: t.ink2, fontSize: 12.5 }}><Num style={{ fontSize: 12.5, color: t.ink2 }}>{n}</Num> פריטים · {fmtDate(new Date(l.at).toISOString())}</T>
          </View>
          <Pressable onPress={() => { setDraft(l.name); setEditing(true); }} accessibilityLabel={`שינוי שם: ${l.name}`} hitSlop={8}><Ionicons name="pencil" size={20} color={t.ink2} /></Pressable>
          <Pressable onPress={() => (sure ? onDelete() : setSure(true))} accessibilityLabel={`מחיקה: ${l.name}`} hitSlop={8}
            style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Ionicons name="trash-outline" size={20} color={t.bad} />
            {sure ? <Text style={{ color: t.bad, fontWeight: "700" }}>למחוק?</Text> : null}
          </Pressable>
        </View>
      )}
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Button title={canMerge ? "החלפת הסל" : "טעינה לסל"} style={{ flex: 1 }} disabled={!n} onPress={() => onLoad("replace")} />
        {canMerge ? <Button kind="ghost" title="הוספה לסל" style={{ flex: 1 }} disabled={!n} onPress={() => onLoad("merge")} /> : null}
      </View>
    </View>
  );
}
