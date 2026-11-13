import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useMemo } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { Card, MiniProduct, Pct, PctBar, RecCard, SearchButton, SectionHead } from "../../components/blocks";
import { DealCard } from "../../components/DealCard";
import { Button, CAT_ICON, CAT_TINT, IconBtn, Num, ProductImage, T, canScan, useTheme } from "../../components/ui";
import { fmtDate, money, priceInfo, storeKm } from "../../lib/compare";
import { bestOfWeek, cartQty, defaultFilters, filterDeals, type DealItem } from "../../lib/dealsFeed";
import { dealFeed } from "../../lib/feed";
import { useAiDeals } from "../../lib/ai";
import { dealsOnMine, priceIndex, recentlyChanged, regulars, staleFiles, summarizeChanges, topGaps } from "../../lib/insights";
import { dueBasket, recommend } from "../../lib/recommend";
import { useData } from "../../lib/store";
import { useWatch } from "../../lib/watchctx";

// One-line labels for the category tiles (the full names are on the products screen).
const SHORT: Record<string, string> = { produce: "פירות וירקות", meat: "בשר ודגים", dairy: "חלב וביצים", bakery: "לחם ומאפים", drinks: "משקאות", snacks: "חטיפים",
  pantry: "מזווה", frozen: "קפואים", cleaning: "ניקיון", care: "טיפוח", pets: "חיות מחמד", other: "שונות" };

/**
 * Home: what the price files say about the branches around you, before you search for anything.
 * Where it's cheapest overall, today's real deals, what you usually buy, what moved in price and
 * where comparing pays most.
 */
const NO_DEALS: DealItem[] = [];

export default function Home() {
  const t = useTheme();
  const router = useRouter();
  const { catalog, products, active, cart, club, place, ready, sync, freq, changes, baskets, recFeedback, dismissRec, acceptRec, setQty, addMany } = useData();
  const { state: watch } = useWatch();

  const index = useMemo(() => (catalog ? priceIndex(products.values(), active) : []), [catalog, products, active]);
  const feed = useMemo(() => (catalog?.promos ? dealFeed(catalog, products, active, club) : null), [catalog, products, active, club]);
  const checkedFeed = useAiDeals(feed?.items ?? NO_DEALS, feed?.now ?? 0);
  const usable = useMemo(() => {
    if (!feed) return [];
    const hasClub = Object.values(club).some(Boolean);
    return filterDeals(checkedFeed, { ...defaultFilters, club: hasClub ? "club" : "none", onlyReal: false }).items;
  }, [feed, checkedFeed, club]);
  const best = useMemo(() => bestOfWeek(usable, 8), [usable]);
  // deals on what this person buys: the cart, products bought on earlier days, followed products
  const mineSet = useMemo(() => new Set([...Object.keys(cart), ...Object.keys(freq), ...watch.followed]), [cart, freq, watch.followed]);
  const myDeals = useMemo(() => dealsOnMine(usable, mineSet, 10), [usable, mineSet]);
  const forYou = useMemo(() => {
    if (!catalog) return [];
    const drops = catalog ? summarizeChanges(changes, products, catalog, active).down.map(v => ({ p: v.p, pct: v.pct })) : [];
    return recommend({ products, active, cart, freq, baskets, deals: usable, drops, feedback: recFeedback, now: Date.now(), limit: 14 });
  }, [catalog, products, active, cart, freq, baskets, usable, changes, recFeedback]);
  const due = useMemo(() => dueBasket(forYou), [forYou]);
  const oldFiles = useMemo(() => (catalog ? staleFiles(catalog, active) : []), [catalog, active]);
  const mine = useMemo(() => regulars(freq, products, active, cart, 12), [freq, products, active, cart]);
  const moved = useMemo(() => (catalog ? summarizeChanges(changes, products, catalog, active) : null), [changes, products, catalog, active]);
  const dated = useMemo(() => (catalog ? recentlyChanged(products.values(), active, 7).total : 0), [catalog, products, active]);
  const gaps = useMemo(() => (catalog ? topGaps(products.values(), active, 5) : []), [catalog, products, active]);

  const open = (code: string) => router.push(`/product/${encodeURIComponent(code)}`);
  const browse = (cat?: string, focus?: boolean) => router.navigate({ pathname: "/products", params: { ...(cat ? { cat } : {}), ...(focus ? { focus: "1" } : {}), t: String(Date.now()) } });

  if (!catalog) {
    return (
      <View style={{ flex: 1, padding: 24, alignItems: "center", justifyContent: "center", gap: 14 }}>
        {sync.running || !ready ? <ActivityIndicator size="large" color={t.brand} /> : null}
        <T style={{ fontSize: 20, fontWeight: "800", textAlign: "center" }}>{sync.running ? "מוריד את המחירונים של היום…" : ready && !place ? "איפה אתם קונים?" : "טוען…"}</T>
        {sync.running ? <T style={{ color: t.ink2, textAlign: "center" }}>בפעם הראשונה זה לוקח כמה שניות.</T> : null}
        {ready && !place && !sync.running ? (
          <>
            <T style={{ color: t.ink2, textAlign: "center", lineHeight: 22 }}>בחרו כתובת או מיקום נוכחי, ונשווה את הסופרמרקטים שסביבכם לפי המחירונים הרשמיים של הרשתות.</T>
            <Button title="בחירת מיקום" onPress={() => router.push("/location")} />
          </>
        ) : null}
        {sync.error ? <T style={{ color: t.bad, textAlign: "center" }}>{sync.error}</T> : null}
      </View>
    );
  }

  const top = index.slice(0, 3);
  const worst = index.length > 3 ? index[index.length - 1] : null;
  const span = index.length ? Math.max(...index.map(r => Math.abs(r.pct))) : 1;
  const basis = index.length ? Math.max(...index.map(r => r.n)) : 0;

  return (
    <View style={{ flex: 1 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: t.bg, borderBottomWidth: 1, borderBottomColor: t.line }}>
        <SearchButton onPress={() => browse(undefined, true)} />
        <IconBtn icon="list" label="הדבקת רשימת קניות" onPress={() => router.push("/list")} />
        {canScan() ? <IconBtn icon="barcode-outline" label="סריקת ברקוד" onPress={() => router.push("/scan")} /> : null}
      </View>

      <ScrollView contentContainerStyle={{ padding: 12, gap: 18, paddingBottom: 40 }}>
        {top.length >= 2 ? (
          <Card>
            <SectionHead title="איפה הכי זול סביבכם" sub={`מחירי מדף של עד ${basis.toLocaleString("he-IL")} מוצרים שנמכרים בכמה סניפים, מול המחיר המקובל באזור`}
              action="כל הדירוג" onAction={() => router.push("/insights")} />
            {top.map((r, k) => {
              const s = catalog.stores[r.i];
              const d = storeKm(catalog, r.i);
              return (
                <Pressable key={s.id} onPress={() => router.push("/insights")} accessibilityRole="button"
                  accessibilityLabel={`מקום ${k + 1}: ${s.chain}, ${s.branch}. ${Math.abs(r.pct).toFixed(1)} אחוז ${r.pct <= 0 ? "מתחת" : "מעל"} למחיר המקובל`}
                  style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: k === 0 ? t.tag : t.surface2, alignItems: "center", justifyContent: "center" }}>
                    <Text style={{ fontWeight: "800", color: k === 0 ? t.tagInk : t.ink, fontVariant: ["tabular-nums"] }}>{k + 1}</Text>
                  </View>
                  <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                      <T numberOfLines={1} style={{ fontWeight: "700", fontSize: 15.5, flexShrink: 1 }}>{s.chain}</T>
                      <Pct pct={r.pct} />
                    </View>
                    <PctBar pct={r.pct} max={span} />
                    <T numberOfLines={1} style={{ color: t.ink2, fontSize: 12.5 }}>{s.branch}{d != null ? ` · ${d.toFixed(1)} ק״מ` : ""}</T>
                  </View>
                </Pressable>
              );
            })}
            {worst ? (
              <T style={{ color: t.ink2, fontSize: 12.5 }}>
                היקר ביותר: <Text style={{ fontWeight: "700", color: t.ink }}>{catalog.stores[worst.i].chain}</Text>, <Pct pct={worst.pct} size={12.5} />. הפער בין הזול ליקר: <Num style={{ fontWeight: "700", fontSize: 12.5 }}>{(worst.pct - index[0].pct).toFixed(1)}%</Num>.
              </T>
            ) : null}
          </Card>
        ) : null}

        {forYou.length ? (
          <View style={{ gap: 10 }}>
            <SectionHead title="בשבילך" sub={Object.keys(freq).length < 5 ? "כדאי להשוות: מוצרי יסוד עם פער מחירים גדול בין הסניפים. ככל שתקנו, ההמלצות ילמדו מכם." : "לפי מה שאתם קונים, מתי, ומה במבצע עכשיו. × מסתיר המלצה ומלמד אותנו."}
              action={Object.keys(due).length >= 2 ? `הסל הקבוע (${Object.keys(due).length})` : undefined} onAction={() => addMany(due)} />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
              {forYou.map(r => (
                <RecCard key={r.p.code} p={r.p} reason={r.reason} price={r.price} qty={r.qty} inCart={cart[r.p.code] ?? 0}
                  onAdd={() => acceptRec(r)} onDismiss={() => dismissRec(r)} onOpen={() => open(r.p.code)} />
              ))}
            </ScrollView>
          </View>
        ) : null}

        <View style={{ gap: 10 }}>
          <SectionHead title="קטגוריות" action="כל המוצרים" onAction={() => browse("all")} />
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {catalog.categories.map(c => (
              <Pressable key={c.id} onPress={() => browse(c.id)} accessibilityRole="button" accessibilityLabel={c.name}
                style={({ pressed }) => ({ width: "23%", flexGrow: 1, minWidth: 76, alignItems: "center", gap: 5, backgroundColor: t.surface, borderRadius: 14, paddingVertical: 10, paddingHorizontal: 2, opacity: pressed ? 0.85 : 1 })}>
                <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: (CAT_TINT[c.id] ?? CAT_TINT.other) + "55", alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name={CAT_ICON[c.id] ?? CAT_ICON.other} size={20} color={t.ink} />
                </View>
                <Text numberOfLines={1} style={{ color: t.ink, fontSize: 12, fontWeight: "600", textAlign: "center" }}>{SHORT[c.id] ?? c.name}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        {oldFiles.length ? (
          <Pressable onPress={() => router.push("/insights")} accessibilityRole="button"
            style={{ flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: t.warn + "1a", borderRadius: 14, padding: 12 }}>
            <Ionicons name="time-outline" size={22} color={t.warn} />
            <T style={{ flex: 1, fontSize: 13, lineHeight: 19 }}>
              {oldFiles.length === 1 ? `ל${catalog.stores[oldFiles[0].i].chain} (${catalog.stores[oldFiles[0].i].branch}) יש מחירון ישן` : `ל־${oldFiles.length} סניפים יש מחירון ישן`}
              {` (${Math.round(oldFiles[0].lag / 24)} ימים מאחורי האחרים). המחירים שם אולי כבר השתנו.`}
            </T>
          </Pressable>
        ) : null}

        {myDeals.length ? (
          <View style={{ gap: 10 }}>
            <SectionHead title="במבצע ממה שאתם קונים" sub="מהסל, מהרגילים ומהמוצרים שאתם עוקבים אחריהם" />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
              {myDeals.map(d => (
                <DealCard key={d.id} d={d} catalogStores={catalog.stores} now={feed!.now} qty={cart[d.code] ?? 0} width={176}
                  add={(x: DealItem) => addMany({ [x.code]: cartQty(x) })} setQty={setQty} open={open} />
              ))}
            </ScrollView>
          </View>
        ) : null}

        {mine.length ? (
          <View style={{ gap: 10 }}>
            <SectionHead title="הרגילים שלי" sub="מוצרים שהוספתם לסל בעבר. הקשה על + מוסיפה אחד."
              action={`הוספת כל ה־${mine.length} לסל`} onAction={() => addMany(Object.fromEntries(mine.map(p => [p.code, 1])))} />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
              {mine.map(p => {
                const pi = priceInfo(p, active);
                return <MiniProduct key={p.code} p={p} price={pi.lo!} note={catalog.stores[pi.at]?.chain} qty={cart[p.code] ?? 0} onOpen={() => open(p.code)} onAdd={() => setQty(p.code, (cart[p.code] ?? 0) + (p.weighted ? 0.5 : 1))} />;
              })}
            </ScrollView>
          </View>
        ) : null}

        {best.length ? (
          <View style={{ gap: 10 }}>
            <SectionHead title="מבצעים ששווה לדעת עליהם" sub="רק מבצעים שזולים גם מהמחיר הרגיל בכל סניף אחר סביבכם" action="כל המבצעים" onAction={() => router.navigate("/deals")} />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
              {best.map(d => (
                <DealCard key={d.id} d={d} catalogStores={catalog.stores} now={feed!.now} qty={cart[d.code] ?? 0} width={176}
                  add={(x: DealItem) => addMany({ [x.code]: cartQty(x) })} setQty={setQty} open={open} />
              ))}
            </ScrollView>
          </View>
        ) : null}

        {moved && (moved.down.length || moved.up.length) ? (
          <Card>
            <SectionHead title="מחירים שזזו" sub={moved.since ? `מאז ${fmtDate(moved.since)}, בסניפים שסביבכם` : undefined} action="לכל השינויים" onAction={() => router.push("/changes")} />
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Stat icon="trending-down" color={t.good} n={moved.down.length} label="הוזלו" />
              <Stat icon="trending-up" color={t.warn} n={moved.up.length} label="התייקרו" />
            </View>
            {moved.down.slice(0, 3).map(v => (
              <Pressable key={`${v.p.code}-${v.i}`} onPress={() => open(v.p.code)} accessibilityRole="button" style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <ProductImage p={v.p} size={40} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <T numberOfLines={1} style={{ fontWeight: "600", fontSize: 14 }}>{v.p.name}</T>
                  <T numberOfLines={1} style={{ color: t.ink2, fontSize: 12.5 }}>{catalog.stores[v.i].chain} · {money(v.from)} ← {money(v.to)} ₪</T>
                </View>
                <Pct pct={v.pct} />
              </Pressable>
            ))}
          </Card>
        ) : dated > 0 ? (
          <Card style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <Ionicons name="pulse-outline" size={24} color={t.brand} />
            <T style={{ flex: 1, fontSize: 13.5, lineHeight: 19 }}>
              הרשתות עדכנו <Num style={{ fontWeight: "800", fontSize: 13.5 }}>{dated.toLocaleString("he-IL")}</Num> מחירים בסניפים שלכם בשבוע האחרון. אחרי עדכון המחירים הבא נראה כאן מה הוזל ומה התייקר.
            </T>
          </Card>
        ) : null}

        {gaps.length ? (
          <Card>
            <SectionHead title="כאן הכי משתלם להשוות" sub="אותו מוצר, פער המחירים הגדול ביותר בין הסניפים שסביבכם" action="עוד" onAction={() => router.push("/insights")} />
            {gaps.map(g => (
              <Pressable key={g.p.code} onPress={() => open(g.p.code)} accessibilityRole="button" accessibilityLabel={`${g.p.name}: מ־${money(g.lo)} עד ${money(g.hi)} ₪`} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <ProductImage p={g.p} size={44} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <T numberOfLines={1} style={{ fontWeight: "600", fontSize: 14 }}>{g.p.name}</T>
                  <T numberOfLines={1} style={{ color: t.ink2, fontSize: 12.5 }}>הכי זול ב{catalog.stores[g.loAt].chain}{g.p.weighted ? " · לק״ג" : ""}</T>
                </View>
                <View style={{ alignItems: "flex-start" }}>
                  <Num style={{ fontWeight: "800", fontSize: 14.5 }}>{money(g.lo)}–{money(g.hi)} ₪</Num>
                  <T style={{ color: t.warn, fontSize: 12, fontWeight: "700" }}>פער {g.pct}%</T>
                </View>
              </Pressable>
            ))}
          </Card>
        ) : null}

        <T style={{ color: t.ink2, fontSize: 12, lineHeight: 17, textAlign: "center" }}>
          הנתונים מקובצי המחירים הרשמיים שהרשתות מפרסמות לפי חוק המזון, {fmtDate(catalog.priceDate)}.
        </T>
      </ScrollView>
    </View>
  );
}

function Stat({ icon, color, n, label }: { icon: React.ComponentProps<typeof Ionicons>["name"]; color: string; n: number; label: string }) {
  const t = useTheme();
  return (
    <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: color + "18", borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12 }}>
      <Ionicons name={icon} size={22} color={color} />
      <Num style={{ fontWeight: "800", fontSize: 20, color: t.ink }}>{n.toLocaleString("he-IL")}</Num>
      <T style={{ fontSize: 13.5, color: t.ink2 }}>{label}</T>
    </View>
  );
}
