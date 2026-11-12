import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { DealCard } from "../../components/DealCard";
import { Button, T, useTheme } from "../../components/ui";
import { chainKey } from "../../lib/compare";
import { bestOfWeek, cartQty, defaultFilters, endingSoon, endingSoonCount, filterDeals, mineOf, sortDeals, type Basis, type ClubMode, type DealItem, type DealSort } from "../../lib/dealsFeed";
import { dealFeed } from "../../lib/feed";
import { useData } from "../../lib/store";

const SORTS: { id: DealSort; label: string }[] = [
  { id: "pct", label: "אחוז חיסכון" }, { id: "save", label: "חיסכון ב־₪" }, { id: "ending", label: "נגמר בקרוב" }, { id: "unit", label: "הכי זול ליחידה" },
];

export default function DealsScreen() {
  const t = useTheme();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { catalog, products, active, cart, club, ready, place, setQty, addMany } = useData();
  const [cat, setCat] = useState("all");
  const [chain, setChain] = useState("all");
  const [clubMode, setClubMode] = useState<ClubMode>("none");
  const [mineOnly, setMineOnly] = useState(false);
  const [onlyReal, setOnlyReal] = useState(true);
  const [sort, setSort] = useState<DealSort>("pct");
  const basis: Basis = "cheapest"; // savings are always measured against the cheapest regular price nearby
  const clubTouched = useRef(false);
  const cols = Math.max(2, Math.min(6, Math.floor((width - 24) / 190)));

  const feed = useMemo(() => (catalog?.promos ? dealFeed(catalog, products, active, club) : null), [catalog, products, active, club]);
  const now = feed?.now ?? 0;
  const all = feed?.items ?? [];
  const hasClub = Object.values(club).some(Boolean);
  // follow the user's club settings until they choose by hand
  useEffect(() => { if (ready && !clubTouched.current) setClubMode(hasClub ? "club" : "none"); }, [ready, hasClub]);

  const mine = useMemo(() => (mineOnly ? mineOf(cart, products) : null), [mineOnly, cart, products]);
  const filters = useMemo(() => ({ ...defaultFilters, cat, chain, club: clubMode, onlyReal, mine }), [cat, chain, clubMode, onlyReal, mine]);
  const f = useMemo(() => filterDeals(all, filters), [all, filters]);
  const list = useMemo(() => sortDeals(f.items, sort, basis), [f.items, sort, basis]);
  // the top sections ignore the category / chain / cart filters and the "real only" switch (they are real-only by construction)
  const base = useMemo(() => filterDeals(all, { ...defaultFilters, club: clubMode, onlyReal: false }).items, [all, clubMode]);
  const best = useMemo(() => bestOfWeek(base, 10), [base]);
  const soon = useMemo(() => endingSoon(base, now, 10), [base, now]);
  const soonTotal = useMemo(() => endingSoonCount(base, now), [base, now]);
  const sections = cat === "all" && chain === "all" && !mineOnly;

  const chains = useMemo(() => {
    const m = new Map<string, string>();
    if (catalog) for (const i of active) { const s = catalog.stores[i]; const k = chainKey(s.id); if (!m.has(k)) m.set(k, k === "shufersal" ? "שופרסל" : s.chain); }
    return [...m].map(([id, name]) => ({ id, name }));
  }, [catalog, active]);

  const add = useCallback((d: DealItem) => addMany({ [d.code]: cartQty(d) }), [addMany]);
  const open = useCallback((code: string) => router.push(`/product/${encodeURIComponent(code)}`), [router]);

  if (!catalog) {
    return (
      <View style={{ flex: 1, padding: 24, alignItems: "center", justifyContent: "center", gap: 14 }}>
        <T style={{ fontSize: 18, fontWeight: "700", textAlign: "center" }}>{ready && !place ? "איפה אתם קונים?" : "טוען מבצעים…"}</T>
        {ready && !place ? <Button title="בחירת מיקום" onPress={() => router.push("/location")} /> : null}
      </View>
    );
  }
  if (!catalog.promos) {
    return <View style={{ flex: 1, padding: 24, alignItems: "center", justifyContent: "center" }}><T style={{ textAlign: "center", color: t.ink2 }}>במחירון הזה אין נתוני מבצעים. עדכנו את המחירים כדי לטעון אותם.</T></View>;
  }

  const card = (d: DealItem, w?: number) => (
    <DealCard d={d} catalogStores={catalog.stores} now={now} qty={cart[d.code] ?? 0} add={add} setQty={setQty} open={open} width={w} />
  );
  const row = (title: string, sub: string, items: DealItem[], more?: () => void) => items.length ? (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
        <T style={{ fontSize: 18, fontWeight: "800" }}>{title}</T>
        {more ? <Pressable onPress={more}><T style={{ color: t.brand, fontWeight: "700", fontSize: 13 }}>הכל</T></Pressable> : null}
      </View>
      <T style={{ color: t.ink2, fontSize: 12 }}>{sub}</T>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingVertical: 4 }}>
        {items.map(d => <View key={d.id}>{card(d, 176)}</View>)}
      </ScrollView>
    </View>
  ) : null;

  return (
    <FlatList
      key={cols}
      data={list}
      numColumns={cols}
      keyExtractor={d => d.id}
      initialNumToRender={10}
      windowSize={7}
      contentContainerStyle={{ padding: 12, gap: 10, paddingBottom: 40 }}
      columnWrapperStyle={{ gap: 10 }}
      ListHeaderComponent={
        <View style={{ gap: 12, marginBottom: 2 }}>
          <View style={{ gap: 2 }}>
            <T style={{ fontSize: 22, fontWeight: "800" }}>מבצעים</T>
            <T style={{ color: t.ink2, fontSize: 13, lineHeight: 19 }}>{all.length.toLocaleString("he-IL")} מבצעים פעילים ב־{active.length} סניפים. האחוז על כל כרטיס נמדד מול המחיר הרגיל הזול ביותר סביבכם, לא מול מחיר המדף של אותו סניף.</T>
          </View>
          {sections ? row("הכי שווים השבוע", "זולים גם מהמחיר הרגיל בכל סניף אחר, אחד לכל מוצר", best, () => setSort("pct")) : null}
          {sections ? row("נגמרים בקרוב", `מסתיימים ב־48 השעות הקרובות (${soonTotal.toLocaleString("he-IL")} מבצעים)`, soon, () => setSort("ending")) : null}

          <Chips items={[{ id: "all", name: "כל הקטגוריות" }, ...catalog.categories]} value={cat} onChange={setCat} />
          <Chips items={[{ id: "all", name: "כל הרשתות" }, ...chains]} value={chain} onChange={setChain} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, alignItems: "center" }}>
            <Toggle on={clubMode === "club"} check label="גם מבצעי מועדון" onPress={() => { clubTouched.current = true; setClubMode(m => (m === "club" ? "none" : "club")); }} />
            <Toggle on={mineOnly} check label="רק מה שקשור לסל שלי" onPress={() => setMineOnly(v => !v)} />
            <Toggle on={onlyReal} check label="רק הנחה אמיתית" onPress={() => setOnlyReal(v => !v)} />
          </ScrollView>
          {clubMode === "club" && !hasClub ? <T style={{ color: t.ink2, fontSize: 12 }}>סמנו ״יש לי כרטיס מועדון״ בסל כדי לראות מבצעי מועדון.</T> : null}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, alignItems: "center" }}>
            <Text style={{ color: t.ink2, fontSize: 13 }}>מיון:</Text>
            {SORTS.map(s => (
              <Pressable key={s.id} onPress={() => setSort(s.id)} accessibilityRole="button" accessibilityState={{ selected: sort === s.id }} accessibilityLabel={`מיון: ${s.label}`}
                style={{ paddingHorizontal: 12, minHeight: 36, justifyContent: "center", borderRadius: 999, backgroundColor: sort === s.id ? t.ink : t.surface2 }}>
                <Text style={{ color: sort === s.id ? t.bg : t.ink, fontSize: 13, fontWeight: "600" }}>{s.label}</Text>
              </Pressable>
            ))}
          </ScrollView>
          {sort === "unit" ? <T style={{ color: t.ink2, fontSize: 12 }}>לפי סוג: מחיר ל־100 גרם, אחר כך לליטר, אחר כך ליחידה.</T> : null}
          <T style={{ color: t.ink2, fontSize: 13 }}>
            <Text style={{ fontWeight: "700", color: t.ink }}>{list.length.toLocaleString("he-IL")}</Text> מבצעים
            {f.hiddenNotReal ? ` · ${f.hiddenNotReal.toLocaleString("he-IL")} הוסתרו: לא זולים מהמחיר הרגיל בסניף אחר` : ""}
          </T>
        </View>
      }
      ListEmptyComponent={<T style={{ color: t.ink2, textAlign: "center", padding: 30 }}>אין מבצעים שמתאימים לסינון. נסו להסיר מסנן.</T>}
      renderItem={({ item }) => <View style={{ flex: 1 / cols }}>{card(item)}</View>}
    />
  );
}

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

function Toggle({ on, label, onPress, check, small }: { on: boolean; label: string; onPress: () => void; check?: boolean; small?: boolean }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole={check ? "checkbox" : "radio"} accessibilityState={check ? { checked: on } : { selected: on }}
      style={{ paddingHorizontal: small ? 10 : 12, paddingVertical: small ? 4 : 6, borderRadius: 999, borderWidth: 1, borderColor: on ? t.brand : t.line, backgroundColor: on ? t.brandSoft : t.surface }}>
      <Text style={{ color: t.ink, fontWeight: "600", fontSize: small ? 12 : 13 }}>{on && check ? "✓ " : ""}{label}</Text>
    </Pressable>
  );
}
