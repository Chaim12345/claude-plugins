import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { memo, useDeferredValue, useMemo, useState } from "react";
import { FlatList, Platform, Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from "react-native";
import { Button, Num, PriceTag, ProductImage, Stepper, T, useTheme } from "../../components/ui";
import { search, storeKm, type PriceInfo, type Sort } from "../../lib/compare";
import { useData } from "../../lib/store";
import type { Catalog, Product } from "../../lib/types";

const SORTS: { id: Sort; label: string }[] = [
  { id: "pop", label: "נפוצים" }, { id: "cheap", label: "הכי זול" }, { id: "gap", label: "פער מחירים" },
];

export default function Shop() {
  const t = useTheme();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { catalog, products, active, cart, setQty, toggleStore, place, ready, sync } = useData();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("all");
  const [sort, setSort] = useState<Sort>("pop");
  const dq = useDeferredValue(q);
  const list = useMemo(() => search(products.values(), active, dq, cat, sort), [products, active, dq, cat, sort]);
  const cols = Math.max(2, Math.min(6, Math.floor((width - 24) / 190)));

  if (!catalog) {
    return (
      <View style={{ flex: 1, padding: 24, alignItems: "center", justifyContent: "center", gap: 14 }}>
        <T style={{ fontSize: 18, fontWeight: "700", textAlign: "center" }}>{sync.running ? "מוריד את המחירונים של היום…" : ready && !place ? "איפה אתם קונים?" : "טוען…"}</T>
        {ready && !place && !sync.running ? (
          <>
            <T style={{ color: t.ink2, textAlign: "center" }}>בחרו כתובת או מיקום נוכחי, ונשווה את הסופרמרקטים שסביבכם לפי המחירונים הרשמיים של הרשתות.</T>
            <Button title="בחירת מיקום" onPress={() => router.push("/location")} />
          </>
        ) : null}
        {sync.error ? <T style={{ color: t.bad, textAlign: "center" }}>{sync.error}</T> : null}
      </View>
    );
  }

  return (
    <FlatList
      key={cols}
      data={list}
      numColumns={cols}
      keyExtractor={([p]) => p.code}
      initialNumToRender={12}
      windowSize={7}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 12, gap: 10, paddingBottom: 40 }}
      columnWrapperStyle={{ gap: 10 }}
      ListHeaderComponent={
        <View style={{ gap: 10, marginBottom: 2 }}>
          <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: t.surface2, borderRadius: 22, paddingHorizontal: 14, height: 44, gap: 8 }}>
            <Ionicons name="search" size={18} color={t.ink2} />
            <TextInput value={q} onChangeText={setQ} placeholder="חיפוש: חלב, עגבניות, במבה…" placeholderTextColor={t.ink2}
              style={[{ flex: 1, color: t.ink, textAlign: "right", fontSize: 15, height: 44 }, Platform.OS === "web" && ({ outlineStyle: "none" } as object)]} returnKeyType="search" accessibilityLabel="חיפוש מוצר" />
            {q ? <Pressable onPress={() => setQ("")} accessibilityLabel="ניקוי"><Ionicons name="close-circle" size={18} color={t.ink2} /></Pressable> : null}
          </View>
          <Chips items={[{ id: "all", name: "הכל" }, ...catalog.categories]} value={cat} onChange={setCat} />
          <StoreChips catalog={catalog} active={active} onToggle={toggleStore} />
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <T style={{ color: t.ink2, fontSize: 13 }}><Num style={{ fontWeight: "700", color: t.ink, fontSize: 13 }}>{list.length.toLocaleString("he-IL")}</Num> מוצרים</T>
            <View style={{ flexDirection: "row", gap: 6 }}>
              {SORTS.map(s => (
                <Pressable key={s.id} onPress={() => setSort(s.id)} style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, backgroundColor: sort === s.id ? t.ink : "transparent" }}>
                  <Text style={{ color: sort === s.id ? t.bg : t.ink2, fontSize: 13, fontWeight: "600" }}>{s.label}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        </View>
      }
      ListEmptyComponent={<T style={{ color: t.ink2, textAlign: "center", padding: 30 }}>לא מצאנו מוצר כזה. נסו מילה קצרה יותר, למשל ״קוטג״.</T>}
      renderItem={({ item: [p, pi] }) => (
        <View style={{ flex: 1 / cols }}>
          <Card p={p} pi={pi} chain={catalog.stores[pi.at]?.chain ?? ""} qty={cart[p.code] ?? 0} setQty={setQty} open={() => router.push(`/product/${encodeURIComponent(p.code)}`)} />
        </View>
      )}
    />
  );
}

const Card = memo(function Card({ p, pi, chain, qty, setQty, open }: { p: Product; pi: PriceInfo; chain: string; qty: number; setQty: (c: string, q: number) => void; open: () => void }) {
  const t = useTheme();
  const gap = pi.hi! > pi.lo! ? Math.round((pi.hi! / pi.lo! - 1) * 100) : 0;
  return (
    <View style={{ backgroundColor: t.surface, borderRadius: 14, padding: 10, gap: 8, shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 1 }}>
      <Pressable onPress={open} accessibilityLabel={`מחירים בכל הסניפים: ${p.name}`} style={{ gap: 8 }}>
        <ProductImage p={p} size="fill" />
        <T numberOfLines={2} style={{ fontWeight: "600", fontSize: 14.5, minHeight: 38, lineHeight: 19 }}>{p.name}</T>
      </Pressable>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", gap: 6 }}>
        <PriceTag agorot={pi.lo!} />
        <View style={{ flexShrink: 1, alignItems: "flex-start" }}>
          <Text style={{ fontSize: 11.5, color: t.ink2 }}>הכי זול ב</Text>
          <Text numberOfLines={1} style={{ fontSize: 12.5, fontWeight: "700", color: t.ink }}>{chain}</Text>
        </View>
      </View>
      <T style={{ fontSize: 12, color: t.ink2 }}>{pi.n} סניפים{gap ? <Text> · עד <Text style={{ color: t.warn, fontWeight: "700" }}>+{gap}%</Text> במקום יקר</Text> : " · אותו מחיר"}</T>
      {qty ? <Stepper p={p} qty={qty} onChange={q => setQty(p.code, q)} /> : <Button title="הוספה לסל" onPress={() => setQty(p.code, 1)} style={{ height: 40 }} />}
    </View>
  );
});

function Chips({ items, value, onChange }: { items: { id: string; name: string }[]; value: string; onChange: (id: string) => void }) {
  const t = useTheme();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
      {items.map(c => (
        <Pressable key={c.id} onPress={() => onChange(c.id)} accessibilityState={{ selected: value === c.id }}
          style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12, backgroundColor: value === c.id ? t.brand : t.surface2 }}>
          <Text style={{ fontWeight: "600", color: value === c.id ? t.brandInk : t.ink }}>{c.name}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

function StoreChips({ catalog, active, onToggle }: { catalog: Catalog; active: number[]; onToggle: (id: string) => void }) {
  const t = useTheme();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
      {catalog.stores.map((s, i) => {
        const on = active.includes(i);
        const d = storeKm(catalog, i);
        return (
          <Pressable key={s.id} onPress={() => onToggle(s.id)} accessibilityState={{ checked: on }}
            style={{ flexDirection: "row", gap: 4, alignItems: "baseline", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, borderWidth: 1,
              borderColor: on ? t.ink : t.line, backgroundColor: on ? t.ink : t.surface, opacity: on ? 1 : 0.6 }}>
            <Text style={{ color: on ? t.bg : t.ink, fontWeight: "700", fontSize: 13, textDecorationLine: on ? "none" : "line-through" }}>{s.chain}</Text>
            <Text style={{ color: on ? t.bg : t.ink2, fontSize: 11.5 }}>{s.branch}{d != null ? ` · ${d.toFixed(1)} ק״מ${s.approx ? "~" : ""}` : ""}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
