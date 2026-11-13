import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { SectionHead } from "../../components/blocks";
import { DealCard } from "../../components/DealCard";
import { Button, T, useTheme } from "../../components/ui";
import { chainKey } from "../../lib/compare";
import { biggestSavings, cartQty, dealScore, defaultFilters, endingSoon, endingSoonCount, filterDeals, mineOf, onMine, sortDeals, stockUp, type ClubMode, type DealItem, type DealSort } from "../../lib/dealsFeed";
import { dealFeed } from "../../lib/feed";
import { affinity } from "../../lib/recommend";
import { useData } from "../../lib/store";
import { useWatch } from "../../lib/watchctx";

const SORTS: { id: DealSort; label: string }[] = [
  { id: "useful", label: "הכי שווה לכם" }, { id: "save", label: "חיסכון ב־₪" }, { id: "pct", label: "אחוז הנחה" }, { id: "ending", label: "נגמר בקרוב" }, { id: "unit", label: "זול ליחידה" },
];

/** Below this real saving (agorot, for the quantity the deal needs) a deal is noise, hidden unless asked for. */
const TRIVIAL = 100;

/**
 * Deals, organised by what helps: deals on what you buy, what is worth stocking up on, the biggest
 * savings in shekels and what ends soon; then the full list, ordered by how useful each deal is to
 * this shopper. Every number is measured against the cheapest regular price around them, and deals
 * whose numbers need checking say so.
 */
export default function DealsScreen() {
  const t = useTheme();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { catalog, products, active, cart, club, ready, place, freq, baskets, setQty, addMany } = useData();
  const { state: watch } = useWatch();
  const [cat, setCat] = useState("all");
  const [chain, setChain] = useState("all");
  const [clubMode, setClubMode] = useState<ClubMode>("none");
  const [mineOnly, setMineOnly] = useState(false);
  const [onlyReal, setOnlyReal] = useState(true);
  const [showSmall, setShowSmall] = useState(false);
  const [sort, setSort] = useState<DealSort>("useful");
  const clubTouched = useRef(false);
  const cols = Math.max(2, Math.min(6, Math.floor((width - 24) / 190)));

  const feed = useMemo(() => (catalog?.promos ? dealFeed(catalog, products, active, club) : null), [catalog, products, active, club]);
  const now = feed?.now ?? 0;
  const all = feed?.items ?? [];
  const hasClub = Object.values(club).some(Boolean);
  // follow the user's club settings until they choose by hand
  useEffect(() => { if (ready && !clubTouched.current) setClubMode(hasClub ? "club" : "none"); }, [ready, hasClub]);

  const mine = useMemo(() => new Set([...Object.keys(cart), ...Object.keys(freq), ...watch.followed]), [cart, freq, watch.followed]);
  const aff = useMemo(() => affinity({ products, cart, freq, baskets }), [products, cart, freq, baskets]);
  const mineFilter = useMemo(() => (mineOnly ? mineOf(cart, products) : null), [mineOnly, cart, products]);
  const filters = useMemo(() => ({ ...defaultFilters, cat, chain, club: clubMode, onlyReal, mine: mineFilter }), [cat, chain, clubMode, onlyReal, mineFilter]);
  const f = useMemo(() => filterDeals(all, filters), [all, filters]);
  const small = useMemo(() => f.items.filter(d => d.verdict === "real" ? d.realAgorot < TRIVIAL : d.saveAgorot < TRIVIAL).length, [f.items]);
  const list = useMemo(() => {
    const items = showSmall ? f.items : f.items.filter(d => (d.verdict === "real" ? d.realAgorot : d.saveAgorot) >= TRIVIAL);
    if (sort !== "useful") return sortDeals(items, sort, "cheapest");
    const ctx = { mine, affinity: aff, now };
    return [...items].sort((a, b) => dealScore(b, ctx) - dealScore(a, ctx));
  }, [f.items, sort, showSmall, mine, aff, now]);

  // the sections ignore the category / chain / cart filters (they are trusted, real deals by construction)
  const base = useMemo(() => filterDeals(all, { ...defaultFilters, club: clubMode, onlyReal: false }).items, [all, clubMode]);
  const forMe = useMemo(() => onMine(base, mine, 12), [base, mine]);
  const stock = useMemo(() => stockUp(base, 10), [base]);
  const big = useMemo(() => biggestSavings(base, 10), [base]);
  const soon = useMemo(() => endingSoon(base, now, 10), [base, now]);
  const soonTotal = useMemo(() => endingSoonCount(base, now), [base, now]);
  const sections = cat === "all" && chain === "all" && !mineOnly;
  const checked = useMemo(() => base.filter(d => d.verdict === "real" && d.confidence === "check").length, [base]);

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
    <DealCard d={d} catalogStores={catalog.stores} now={now} qty={cart[d.code] ?? 0} add={add} setQty={setQty} open={open} width={w} mine={mine.has(d.code)} />
  );
  const row = (title: string, sub: string, items: DealItem[], more?: () => void) => items.length ? (
    <View style={{ gap: 8 }}>
      <SectionHead title={title} sub={sub} action={more ? "הכל" : undefined} onAction={more} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingVertical: 2 }}>
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
        <View style={{ gap: 16, marginBottom: 2 }}>
          <View style={{ gap: 4 }}>
            <T accessibilityRole="header" style={{ fontSize: 22, fontWeight: "800" }}>מבצעים</T>
            <T style={{ color: t.ink2, fontSize: 13, lineHeight: 19 }}>
              כל חיסכון נמדד מול המחיר הרגיל הזול ביותר בסניפים שסביבכם, לכמות שהמבצע דורש. מבצע שלא זול ממחיר רגיל בסניף אחר מסומן.
              {checked ? ` ${checked.toLocaleString("he-IL")} מבצעים מסומנים ״לבדוק בקופה״: הנתונים שלהם לא חד־משמעיים.` : ""}
            </T>
          </View>

          {sections ? row("במבצע ממה שאתם קונים", "מהסל, מהרגילים ומהמוצרים שאתם עוקבים אחריהם", forMe) : null}
          {sections ? row("שווה להצטייד", "מוצרים שמחזיקים מעמד, 20% ומעלה מתחת למחיר הרגיל הזול, וחיסכון של ₪3 לפחות", stock) : null}
          {sections ? row("החיסכון הגדול ביותר", "בשקלים, לכמות שהמבצע דורש", big, () => setSort("save")) : null}
          {sections ? row("נגמרים בקרוב", `מסתיימים ב־48 השעות הקרובות (${soonTotal.toLocaleString("he-IL")} מבצעים)`, soon, () => setSort("ending")) : null}

          <View style={{ gap: 10 }}>
            <SectionHead title="כל המבצעים" />
            <Chips items={[{ id: "all", name: "כל הקטגוריות" }, ...catalog.categories]} value={cat} onChange={setCat} />
            <Chips items={[{ id: "all", name: "כל הרשתות" }, ...chains]} value={chain} onChange={setChain} />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, alignItems: "center" }}>
              <Toggle on={clubMode === "club"} label="גם מבצעי מועדון" onPress={() => { clubTouched.current = true; setClubMode(m => (m === "club" ? "none" : "club")); }} />
              <Toggle on={mineOnly} label="רק מה שקשור לסל שלי" onPress={() => setMineOnly(v => !v)} />
              <Toggle on={onlyReal} label="רק הנחה אמיתית" onPress={() => setOnlyReal(v => !v)} />
              <Toggle on={showSmall} label="גם חיסכון קטן מ־₪1" onPress={() => setShowSmall(v => !v)} />
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
            {sort === "useful" ? <T style={{ color: t.ink2, fontSize: 12 }}>לפי כמה שקלים תחסכו באמת, עם עדיפות למה שאתם קונים, ופחות משקל למבצעים שצריך לבדוק או שמחייבים לקנות הרבה ממוצר שמתקלקל.</T> : null}
            {sort === "unit" ? <T style={{ color: t.ink2, fontSize: 12 }}>לפי סוג: מחיר ל־100 גרם, אחר כך לליטר, אחר כך ליחידה.</T> : null}
            <T style={{ color: t.ink2, fontSize: 13 }}>
              <Text style={{ fontWeight: "700", color: t.ink }}>{list.length.toLocaleString("he-IL")}</Text> מבצעים
              {f.hiddenNotReal ? ` · ${f.hiddenNotReal.toLocaleString("he-IL")} הוסתרו: לא זולים מהמחיר הרגיל בסניף אחר` : ""}
              {!showSmall && small ? ` · ${small.toLocaleString("he-IL")} עם חיסכון של פחות מ־₪1 מוסתרים` : ""}
            </T>
          </View>
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
        <Pressable key={c.id} onPress={() => onChange(c.id)} accessibilityRole="button" accessibilityState={{ selected: value === c.id }}
          style={{ paddingHorizontal: 14, minHeight: 38, justifyContent: "center", borderRadius: 12, backgroundColor: value === c.id ? t.brand : t.surface2 }}>
          <Text style={{ fontWeight: "600", color: value === c.id ? t.brandInk : t.ink }}>{c.name}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

function Toggle({ on, label, onPress }: { on: boolean; label: string; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="checkbox" accessibilityState={{ checked: on }} aria-checked={on}
      style={{ paddingHorizontal: 12, minHeight: 36, justifyContent: "center", borderRadius: 999, borderWidth: 1, borderColor: on ? t.brand : t.line, backgroundColor: on ? t.brandSoft : t.surface }}>
      <Text style={{ color: t.ink, fontWeight: "600", fontSize: 13 }}>{on ? "✓ " : ""}{label}</Text>
    </Pressable>
  );
}
