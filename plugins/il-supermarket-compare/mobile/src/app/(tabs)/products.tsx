import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useLocalSearchParams, useRouter } from "expo-router";
import { memo, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Platform, Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from "react-native";
import { AddBtn, Button, DealBadge, IconBtn, Num, PriceTag, ProductImage, Stepper, T, canScan, useTheme } from "../../components/ui";
import { bestDeal, dealText, money, search, storeKm, type BestDeal, type PriceInfo, type Sort } from "../../lib/compare";
import { FollowButton } from "../../components/WatchBits";
import { sizeOf, sortByUnitPrice, unitPrice, unitText } from "../../lib/units";
import { useData } from "../../lib/store";
import type { Catalog, Product } from "../../lib/types";

type UiSort = Sort | "unit";

// Kashrut is not in the price files; some names say it. Only those are matched, and the filter says so.
const KOSHER = /מהדרין|בד["״']?ץ|גלאט|חת["״']?ם סופר|לנדא|רובין|חב["״']?ד|שארית/;
const SORTS: { id: UiSort; label: string }[] = [
  { id: "pop", label: "נפוצים" }, { id: "cheap", label: "הכי זול" }, { id: "gap", label: "פער מחירים" }, { id: "unit", label: "הכי זול ליחידה" },
];

type View_ = "list" | "grid";
const VIEW_KEY = "salzol:view";

/** Browse and search: every product the nearby branches share, cheapest price first in each row. */
export default function Products() {
  const t = useTheme();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { catalog, products, active, cart, setQty, toggleStore, place, ready, sync, deals } = useData();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("all");
  const [sort, setSort] = useState<UiSort>("pop");
  const [view, setView] = useState<View_>("list");
  const [showTop, setShowTop] = useState(false);
  const [onSale, setOnSale] = useState(false);
  const [onlyIL, setOnlyIL] = useState(false);
  const [kosher, setKosher] = useState(false);
  const [showStores, setShowStores] = useState(false);
  const listRef = useRef<FlatList<[Product, PriceInfo]>>(null);
  const inputRef = useRef<React.ComponentRef<typeof TextInput>>(null);
  // The home screen sends people here with a category, or to type: ?cat=dairy, ?focus=1 (t makes repeats count).
  const params = useLocalSearchParams<{ cat?: string; focus?: string; t?: string }>();
  useEffect(() => {
    if (params.cat) { setCat(params.cat); setQ(""); listRef.current?.scrollToOffset({ offset: 0, animated: false }); }
    if (params.focus) { const id = setTimeout(() => inputRef.current?.focus(), 250); return () => clearTimeout(id); }
  }, [params.cat, params.focus, params.t]);
  const dq = useDeferredValue(q);
  const list = useMemo(() => {
    const keep = onSale || onlyIL || kosher
      ? (p: Product) => (!onlyIL || !!p.meta?.il) && (!kosher || KOSHER.test(p.name)) && (!onSale || !!bestDeal(p, active, deals))
      : undefined;
    const rows = search(products.values(), active, dq, cat, sort === "unit" ? "pop" : sort, keep);
    // cheapest per 100 g / litre / piece: grouped by kind, products with no known size last
    return sort === "unit" ? sortByUnitPrice(rows, ([p, pi]) => unitPrice(sizeOf(p), pi.lo!)) : rows;
  }, [products, active, dq, cat, sort, onSale, onlyIL, kosher, deals]);

  // The compact list is the default: comparing prices means scanning many items, and a list shows
  // about five times as many per screen as the grid. The choice is remembered.
  useEffect(() => { AsyncStorage.getItem(VIEW_KEY).then(v => { if (v === "grid" || v === "list") setView(v); }).catch(() => {}); }, []);
  const chooseView = (v: View_) => { setView(v); AsyncStorage.setItem(VIEW_KEY, v).catch(() => {}); };
  const cols = view === "grid" ? Math.max(2, Math.min(6, Math.floor((width - 24) / 190))) : Math.max(1, Math.floor(width / 480));

  if (!catalog) {
    return (
      <View style={{ flex: 1, padding: 24, alignItems: "center", justifyContent: "center", gap: 14 }}>
        {sync.running || !ready ? <ActivityIndicator size="large" color={t.brand} /> : null}
        <T style={{ fontSize: 18, fontWeight: "700", textAlign: "center" }}>{sync.running ? "מוריד את המחירונים של היום…" : ready && !place ? "איפה אתם קונים?" : "טוען…"}</T>
        {sync.running ? <T style={{ color: t.ink2, textAlign: "center" }}>בפעם הראשונה זה לוקח כמה שניות.</T> : null}
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
    <View style={{ flex: 1 }}>
      {/* Pinned: the search stays in reach however far down the list you are. */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: t.bg, borderBottomWidth: 1, borderBottomColor: t.line }}>
        <View style={{ flex: 1, flexDirection: "row", alignItems: "center", backgroundColor: t.surface2, borderRadius: 22, paddingHorizontal: 14, height: 44, gap: 8, minWidth: 0 }}>
          <Ionicons name="search" size={18} color={t.ink2} />
          <TextInput ref={inputRef} value={q} onChangeText={setQ} placeholder="חיפוש: חלב, עגבניות, במבה…" placeholderTextColor={t.ink2}
            style={[{ flex: 1, color: t.ink, textAlign: "right", fontSize: 15, height: 44 }, Platform.OS === "web" && ({ outlineStyle: "none" } as object)]} returnKeyType="search" accessibilityLabel="חיפוש מוצר" />
          {q ? <Pressable onPress={() => setQ("")} accessibilityRole="button" accessibilityLabel="ניקוי החיפוש" hitSlop={10}><Ionicons name="close-circle" size={20} color={t.ink2} /></Pressable> : null}
        </View>
        <IconBtn icon="list" label="הדבקת רשימת קניות" onPress={() => router.push("/list")} />
        {canScan() ? <IconBtn icon="barcode-outline" label="סריקת ברקוד" onPress={() => router.push("/scan")} /> : null}
      </View>

      <FlatList
        ref={listRef}
        key={`${view}-${cols}`}
        data={list}
        numColumns={cols}
        keyExtractor={([p]) => p.code}
        initialNumToRender={view === "list" ? 10 : 12}
        windowSize={7}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        onScroll={e => { const y = e.nativeEvent.contentOffset.y; if ((y > 900) !== showTop) setShowTop(y > 900); }}
        scrollEventThrottle={100}
        contentContainerStyle={{ padding: 12, gap: 10, paddingBottom: 40 }}
        columnWrapperStyle={cols > 1 ? { gap: 10 } : undefined}
        ListHeaderComponent={
          <View style={{ gap: 10, marginBottom: 2 }}>
            <Chips items={[{ id: "all", name: "הכל" }, ...catalog.categories]} value={cat} onChange={setCat} />
            {/* One scrolling line: which branches, filters, then the sort order. */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, alignItems: "center" }}>
              <Pressable onPress={() => setShowStores(v => !v)} accessibilityRole="button" accessibilityState={{ expanded: showStores }} accessibilityLabel={`${active.length} מתוך ${catalog.stores.length} סניפים בהשוואה. בחירת סניפים`}
                style={{ flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, minHeight: 36, borderRadius: 999, borderWidth: 1, borderColor: active.length < catalog.stores.length ? t.brand : t.line, backgroundColor: active.length < catalog.stores.length ? t.brandSoft : t.surface }}>
                <Ionicons name="storefront-outline" size={15} color={t.ink2} />
                <Text style={{ color: t.ink, fontWeight: "600", fontSize: 13 }}>{active.length < catalog.stores.length ? `${active.length} מתוך ${catalog.stores.length} סניפים` : `${active.length} סניפים`}</Text>
                <Ionicons name={showStores ? "chevron-up" : "chevron-down"} size={14} color={t.ink2} />
              </Pressable>
              <Filter on={onSale} label="במבצע" icon="pricetag-outline" onPress={() => setOnSale(v => !v)} />
              <Filter on={onlyIL} label="תוצרת הארץ" icon="flag-outline" onPress={() => setOnlyIL(v => !v)} />
              <Filter on={kosher} label="מהדרין/בד״ץ (לפי השם)" icon="star-outline" onPress={() => setKosher(v => !v)} />
              <View style={{ width: 1, height: 22, backgroundColor: t.line, marginHorizontal: 2 }} />
              <Text style={{ color: t.ink2, fontSize: 13 }}>מיון:</Text>
              {SORTS.map(s => (
                <Pressable key={s.id} onPress={() => setSort(s.id)} accessibilityRole="button" accessibilityState={{ selected: sort === s.id }} accessibilityLabel={`מיון: ${s.label}`}
                  style={{ paddingHorizontal: 12, minHeight: 36, justifyContent: "center", borderRadius: 999, backgroundColor: sort === s.id ? t.ink : t.surface2 }}>
                  <Text style={{ color: sort === s.id ? t.bg : t.ink, fontSize: 13, fontWeight: "600" }}>{s.label}</Text>
                </Pressable>
              ))}
            </ScrollView>
            {showStores ? <StoreChips catalog={catalog} active={active} onToggle={toggleStore} /> : null}
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <T style={{ color: t.ink2, fontSize: 13 }}><Num style={{ fontWeight: "700", color: t.ink, fontSize: 13 }}>{list.length.toLocaleString("he-IL")}</Num> מוצרים</T>
              <Pressable onPress={() => chooseView(view === "list" ? "grid" : "list")} accessibilityRole="button" accessibilityLabel={view === "list" ? "תצוגת כרטיסים" : "תצוגת רשימה"} hitSlop={8}
                style={{ flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, height: 32, borderRadius: 10, backgroundColor: t.surface2 }}>
                <Ionicons name={view === "list" ? "grid-outline" : "list-outline"} size={16} color={t.ink} />
                <Text style={{ color: t.ink, fontSize: 12.5, fontWeight: "600" }}>{view === "list" ? "כרטיסים" : "רשימה"}</Text>
              </Pressable>
            </View>
          </View>
        }
        ListEmptyComponent={<T style={{ color: t.ink2, textAlign: "center", padding: 30 }}>{kosher ? "רק מוצרים ששמם מציין מהדרין, בד״ץ או גלאט. רוב המוצרים הכשרים לא מציינים זאת בשם, אז הרשימה חלקית." : onSale || onlyIL ? "אין מוצר כזה עם המסננים שבחרתם. נסו להסיר מסנן." : "לא מצאנו מוצר כזה. נסו מילה קצרה יותר, למשל ״קוטג״."}</T>}
        renderItem={({ item: [p, pi] }) => {
          const deal = bestDeal(p, active, deals);
          const props = { p, pi, deal, dealChain: deal ? catalog.stores[deal.i].chain : "", chain: catalog.stores[pi.at]?.chain ?? "", qty: cart[p.code] ?? 0, setQty, open: () => router.push(`/product/${encodeURIComponent(p.code)}`) };
          return <View style={{ flex: 1 / cols }}>{view === "list" ? <Row {...props} /> : <Card {...props} />}</View>;
        }}
      />

      {showTop ? (
        <Pressable onPress={() => listRef.current?.scrollToOffset({ offset: 0, animated: true })} accessibilityRole="button" accessibilityLabel="חזרה לראש הרשימה"
          style={{ position: "absolute", bottom: 16, left: 16, width: 46, height: 46, borderRadius: 23, backgroundColor: t.ink, alignItems: "center", justifyContent: "center", shadowColor: "#000", shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 4 }}>
          <Ionicons name="arrow-up" size={22} color={t.bg} />
        </Pressable>
      ) : null}
    </View>
  );
}

type ItemProps = { p: Product; pi: PriceInfo; deal: BestDeal | null; dealChain: string; chain: string; qty: number; setQty: (c: string, q: number) => void; open: () => void };

const spread = (pi: PriceInfo) => (pi.hi! > pi.lo! ? Math.round((pi.hi! / pi.lo! - 1) * 100) : 0);

/** One compact line per product: photo, name, where it's cheapest, price and add. */
const Row = memo(function Row({ p, pi, deal, chain, qty, setQty, open }: ItemProps) {
  const t = useTheme();
  const unit = unitPrice(sizeOf(p), pi.lo!);
  return (
    <Pressable onPress={open} accessibilityRole="button" accessibilityLabel={`${p.name}, ${money(pi.lo!)} ₪ ב${chain}. פתיחת המחירים בכל הסניפים`}
      style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: t.surface, borderRadius: 14, padding: 10, opacity: pressed ? 0.92 : 1 })}>
      <ProductImage p={p} size={64} />
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <T numberOfLines={2} style={{ fontWeight: "600", fontSize: 14.5, lineHeight: 19 }}>{p.name}</T>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
          <T numberOfLines={1} style={{ fontSize: 12.5, color: t.ink2, flexShrink: 1 }}>{chain} · {pi.n} סניפים</T>
          <FollowButton code={p.code} name={p.name} compact />
        </View>
        {unit ? <T numberOfLines={1} style={{ fontSize: 12, color: t.ink2 }}>{unitText(unit)}</T> : null}
        {deal ? <DealBadge text={dealText(deal.promo)} club={deal.promo.club} /> : null}
      </View>
      <View style={{ alignItems: "flex-end", gap: 6 }}>
        <PriceTag agorot={pi.lo!} />
        {qty ? <Stepper p={p} qty={qty} onChange={q => setQty(p.code, q)} compact width={104} /> : <AddBtn onPress={() => setQty(p.code, 1)} />}
      </View>
    </Pressable>
  );
});

const Card = memo(function Card({ p, pi, deal, dealChain, chain, qty, setQty, open }: ItemProps) {
  const t = useTheme();
  const gap = spread(pi);
  const unit = unitPrice(sizeOf(p), pi.lo!);
  return (
    <View style={{ backgroundColor: t.surface, borderRadius: 14, padding: 10, gap: 8, shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 1 }}>
      <Pressable onPress={open} accessibilityRole="button" accessibilityLabel={`מחירים בכל הסניפים: ${p.name}`} style={{ gap: 8 }}>
        <ProductImage p={p} size="fill" />
        <T numberOfLines={2} style={{ fontWeight: "600", fontSize: 14.5, minHeight: 38, lineHeight: 19 }}>{p.name}</T>
      </Pressable>
      <View style={{ position: "absolute", top: 14, right: 14 }}><FollowButton code={p.code} name={p.name} compact /></View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", gap: 6 }}>
        <PriceTag agorot={pi.lo!} />
        <View style={{ flexShrink: 1, alignItems: "flex-start" }}>
          <Text style={{ fontSize: 11.5, color: t.ink2 }}>הכי זול ב</Text>
          <Text numberOfLines={1} style={{ fontSize: 12.5, fontWeight: "700", color: t.ink }}>{chain}</Text>
        </View>
      </View>
      {deal ? (
        <View style={{ gap: 2 }}>
          <DealBadge text={dealText(deal.promo)} club={deal.promo.club} />
          <T numberOfLines={1} style={{ fontSize: 11.5, color: t.ink2 }}>{deal.promo.desc} · {dealChain}</T>
        </View>
      ) : null}
      {unit ? <T style={{ fontSize: 12, color: t.ink2 }}>{unitText(unit)}</T> : null}
      <T numberOfLines={1} style={{ fontSize: 12, color: t.ink2 }}>{pi.n} סניפים{gap >= 15 ? ` · פער ${gap}%` : ""}</T>
      {qty ? <Stepper p={p} qty={qty} onChange={q => setQty(p.code, q)} /> : <Button title="הוספה לסל" onPress={() => setQty(p.code, 1)} style={{ height: 40 }} />}
    </View>
  );
});

function Filter({ on, label, icon, onPress }: { on: boolean; label: string; icon: React.ComponentProps<typeof Ionicons>["name"]; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="checkbox" accessibilityState={{ checked: on }} aria-checked={on} accessibilityLabel={label}
      style={{ flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, minHeight: 36, borderRadius: 999, borderWidth: 1, borderColor: on ? t.brand : t.line, backgroundColor: on ? t.brandSoft : t.surface }}>
      <Ionicons name={on ? "checkmark" : icon} size={15} color={on ? t.brand : t.ink2} />
      <Text style={{ color: t.ink, fontWeight: "600", fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
}

function Chips({ items, value, onChange }: { items: { id: string; name: string }[]; value: string; onChange: (id: string) => void }) {
  const t = useTheme();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
      {items.map(c => (
        <Pressable key={c.id} onPress={() => onChange(c.id)} accessibilityRole="button" accessibilityState={{ selected: value === c.id }}
          style={{ paddingHorizontal: 14, minHeight: 40, justifyContent: "center", borderRadius: 12, backgroundColor: value === c.id ? t.brand : t.surface2 }}>
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
          <Pressable key={s.id} onPress={() => onToggle(s.id)} accessibilityRole="checkbox" accessibilityState={{ checked: on }} aria-checked={on} accessibilityLabel={`${s.chain} ${s.branch}`}
            style={{ flexDirection: "row", gap: 4, alignItems: "baseline", paddingHorizontal: 10, paddingVertical: 8, borderRadius: 999, borderWidth: 1,
              borderColor: on ? t.ink : t.line, backgroundColor: on ? t.ink : t.surface, opacity: on ? 1 : 0.6 }}>
            <Text style={{ color: on ? t.bg : t.ink, fontWeight: "700", fontSize: 13, textDecorationLine: on ? "none" : "line-through" }}>{s.chain}</Text>
            <Text style={{ color: on ? t.bg : t.ink2, fontSize: 11.5 }}>{s.branch}{d != null ? ` · ${d.toFixed(1)} ק״מ${s.approx ? "~" : ""}` : ""}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
