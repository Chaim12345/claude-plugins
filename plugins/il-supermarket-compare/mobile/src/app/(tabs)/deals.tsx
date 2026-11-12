import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { DealCard } from "../../components/DealCard";
import { Button, T, useTheme } from "../../components/ui";
import { chainKey } from "../../lib/compare";
import { bestOfWeek, buildDeals, cartQty, defaultFilters, endingSoon, endingSoonCount, filterDeals, mineOf, sortDeals, type Basis, type ClubMode, type DealItem, type DealSort } from "../../lib/dealsFeed";
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
  const [basis, setBasis] = useState<Basis>("cheapest");
  const clubTouched = useRef(false);
  const cols = Math.max(2, Math.min(6, Math.floor((width - 24) / 190)));

  const now = useMemo(() => Date.now(), [catalog]); // eslint-disable-line react-hooks/exhaustive-deps
  const hasClub = Object.values(club).some(Boolean);
  // follow the user's club settings until they choose by hand
  useEffect(() => { if (ready && !clubTouched.current) setClubMode(hasClub ? "club" : "none"); }, [ready, hasClub]);

  const all = useMemo(() => (catalog ? buildDeals(catalog, products, { active, club, now }) : []), [catalog, products, active, club, now]);
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
        {items.map(d => <View key={d.id}>{card(d, 200)}</View>)}
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
            <T style={{ color: t.ink2, fontSize: 13 }}>{all.length.toLocaleString("he-IL")} מבצעים פעילים ב־{active.length} סניפים. האחוזים נמדדים גם מול מחיר המדף בסניף וגם מול המחיר הזול ביותר בכל הסניפים שבחרתם.</T>
          </View>
          {sections ? row("הדילים הכי טובים השבוע", "הנחה אמיתית מול המחיר הזול ביותר על המדף, אחד לכל מוצר", best, () => { setSort("pct"); setBasis("cheapest"); }) : null}
          {sections ? row("נגמרים בקרוב", `מסתיימים ב־48 השעות הקרובות (${soonTotal.toLocaleString("he-IL")} מבצעים)`, soon, () => setSort("ending")) : null}

          <Chips items={[{ id: "all", name: "כל הקטגוריות" }, ...catalog.categories]} value={cat} onChange={setCat} />
          <Chips items={[{ id: "all", name: "כל הרשתות" }, ...chains]} value={chain} onChange={setChain} />
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            <Toggle on={clubMode === "none"} label="בלי מועדון" onPress={() => { clubTouched.current = true; setClubMode("none"); }} />
            <Toggle on={clubMode === "club"} label="גם מבצעי מועדון" onPress={() => { clubTouched.current = true; setClubMode("club"); }} />
            <Toggle on={mineOnly} check label="רק על מה שבסל ובקטגוריות שלי" onPress={() => setMineOnly(v => !v)} />
            <Toggle on={onlyReal} check label="רק הנחה אמיתית" onPress={() => setOnlyReal(v => !v)} />
          </View>
          {clubMode === "club" && !hasClub ? <T style={{ color: t.ink2, fontSize: 12 }}>סמנו ״יש לי כרטיס מועדון״ בסל כדי לראות מבצעי מועדון.</T> : null}
          <View style={{ gap: 6 }}>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
              {SORTS.map(s => (
                <Pressable key={s.id} onPress={() => setSort(s.id)} accessibilityState={{ selected: sort === s.id }}
                  style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, backgroundColor: sort === s.id ? t.ink : "transparent" }}>
                  <Text style={{ color: sort === s.id ? t.bg : t.ink2, fontSize: 13, fontWeight: "600" }}>{s.label}</Text>
                </Pressable>
              ))}
            </View>
            {sort === "pct" || sort === "save" ? (
              <View style={{ flexDirection: "row", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                <T style={{ color: t.ink2, fontSize: 12 }}>החיסכון מול:</T>
                <Toggle small on={basis === "cheapest"} label="הזול ביותר בכל הסניפים" onPress={() => setBasis("cheapest")} />
                <Toggle small on={basis === "shelf"} label="המדף באותו סניף" onPress={() => setBasis("shelf")} />
              </View>
            ) : null}
            {sort === "unit" ? <T style={{ color: t.ink2, fontSize: 12 }}>ממוין לפי סוג: מחיר ל־100 גרם, אחר כך לליטר, אחר כך ליחידה. מוצרים בלי גודל ידוע בסוף.</T> : null}
          </View>
          <T style={{ color: t.ink2, fontSize: 13 }}>
            <Text style={{ fontWeight: "700", color: t.ink }}>{list.length.toLocaleString("he-IL")}</Text> מבצעים
            {f.hiddenNotReal ? ` · ${f.hiddenNotReal.toLocaleString("he-IL")} מוסתרים כי המחיר לא נמוך מהמדף בסניף אחר` : ""}
            {f.hiddenClub ? ` · ${f.hiddenClub.toLocaleString("he-IL")} מבצעי מועדון מוסתרים` : ""}
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
