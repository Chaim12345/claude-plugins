import { Ionicons } from "@expo/vector-icons";
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { Linking, Platform, Pressable, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button, T, canScan, useTheme } from "../components/ui";
import { findByBarcode } from "../lib/barcode";
import { priceInfo } from "../lib/compare";
import { useData } from "../lib/store";

export default function Scan() {
  const t = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { products, active } = useData();
  const [perm, askPerm] = useCameraPermissions();
  const [focused, setFocused] = useState(true);
  const [miss, setMiss] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const locked = useRef(false);

  // One camera preview at a time: stop it while the product sheet is on top, and re-arm on return.
  useFocusEffect(useCallback(() => {
    setFocused(true);
    return () => setFocused(false);
  }, []));

  function lookup(data: string) {
    if (locked.current) return;
    locked.current = true;
    const p = findByBarcode(products, data);
    if (p && priceInfo(p, active).lo != null) {
      setMiss(null);
      router.push(`/product/${encodeURIComponent(p.code)}`);
      // re-arm after the sheet is closed (the screen regains focus)
      setTimeout(() => { locked.current = false; }, 1500);
    } else {
      setMiss(data.replace(/\D/g, "") || data);
    }
  }

  function again() { setMiss(null); locked.current = false; }

  const cameraOk = canScan();
  const showCamera = cameraOk && perm?.granted && focused;
  const manual = (
    <View style={{ gap: 8 }}>
      <T style={{ color: t.ink2, fontSize: 13 }}>או הקלידו את הספרות שמתחת לברקוד:</T>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <TextInput value={typed} onChangeText={v => setTyped(v.replace(/\D/g, ""))} keyboardType="number-pad" placeholder="7290000000000" placeholderTextColor={t.ink2}
          onSubmitEditing={() => typed && (again(), lookup(typed))} accessibilityLabel="ברקוד"
          style={[{ flex: 1, height: 44, borderRadius: 12, borderWidth: 1, borderColor: t.line, backgroundColor: t.surface2, paddingHorizontal: 12, color: t.ink, textAlign: "left", writingDirection: "ltr" }, Platform.OS === "web" && ({ outlineStyle: "none" } as object)]} />
        <Button title="חיפוש" disabled={typed.length < 6} onPress={() => { again(); lookup(typed); }} />
      </View>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <View style={{ paddingTop: insets.top + 12, paddingHorizontal: 18, paddingBottom: 10, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <T style={{ fontSize: 22, fontWeight: "800" }}>סריקת ברקוד</T>
        <Pressable onPress={() => router.back()} accessibilityLabel="סגירה" hitSlop={10}><Ionicons name="close" size={26} color={t.ink} /></Pressable>
      </View>

      <View style={{ flex: 1, marginHorizontal: 18, borderRadius: 18, overflow: "hidden", backgroundColor: "#000", alignItems: "center", justifyContent: "center" }}>
        {showCamera ? (
          <>
            <CameraView style={{ position: "absolute", top: 0, bottom: 0, left: 0, right: 0 }} facing="back"
              barcodeScannerSettings={{ barcodeTypes: ["ean13", "ean8", "upc_a", "upc_e"] }}
              onBarcodeScanned={(r: BarcodeScanningResult) => lookup(r.data)} />
            <View pointerEvents="none" style={{ width: "78%", height: 130, borderRadius: 14, borderWidth: 3, borderColor: "#ffffffcc" }} />
          </>
        ) : (
          <View style={{ padding: 24, gap: 12, alignItems: "center" }}>
            <Ionicons name="camera-outline" size={44} color="#ffffffaa" />
            {!cameraOk ? (
              <Text style={{ color: "#fff", textAlign: "center" }}>המצלמה לא זמינה בדפדפן הזה. אפשר להקליד את הברקוד למטה.</Text>
            ) : !perm ? (
              <Text style={{ color: "#fff", textAlign: "center" }}>בודק הרשאת מצלמה…</Text>
            ) : !perm.granted ? (
              <>
                <Text style={{ color: "#fff", textAlign: "center", lineHeight: 22 }}>
                  {perm.canAskAgain ? "כדי לסרוק ברקוד צריך לאפשר גישה למצלמה." : "הגישה למצלמה חסומה. אפשר לאשר אותה בהגדרות המכשיר, או להקליד את הברקוד למטה."}
                </Text>
                {perm.canAskAgain ? <Button title="אישור גישה למצלמה" onPress={askPerm} /> : Platform.OS !== "web" ? <Button title="פתיחת ההגדרות" onPress={() => Linking.openSettings()} /> : null}
              </>
            ) : null}
          </View>
        )}
      </View>

      <View style={{ padding: 18, paddingBottom: insets.bottom + 18, gap: 12 }}>
        {miss ? (
          <View style={{ backgroundColor: t.surface, borderRadius: 14, padding: 14, gap: 8, borderWidth: 1, borderColor: t.warn + "99" }}>
            <T style={{ fontWeight: "800", fontSize: 16 }}>המוצר לא נמצא בסניפים שנבחרו</T>
            <T style={{ color: t.ink2, fontSize: 13 }}>ברקוד {miss}. אולי המוצר לא נמכר בסניפים שהשוואה כוללת, או שהסניפים לא מדווחים עליו.</T>
            <Button title="סריקה נוספת" onPress={again} />
          </View>
        ) : (
          <T style={{ color: t.ink2, textAlign: "center" }}>כוונו את המצלמה אל הברקוד שעל האריזה.</T>
        )}
        {manual}
      </View>
    </View>
  );
}
