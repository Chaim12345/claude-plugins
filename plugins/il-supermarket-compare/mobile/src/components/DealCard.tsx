import { memo } from "react";
import { Pressable, Text, View } from "react-native";
import { dealText, money } from "../lib/compare";
import { endLabel, isEndingSoon, verdictNote, type DealItem } from "../lib/dealsFeed";
import { unitText } from "../lib/units";
import { Button, DealBadge, Num, PriceTag, ProductImage, Stepper, T, useTheme } from "./ui";

type Props = {
  d: DealItem;
  catalogStores: { chain: string; branch: string }[];
  now: number;
  qty: number; // already in the cart
  add: (d: DealItem) => void;
  setQty: (code: string, q: number) => void;
  open: (code: string) => void;
  width?: number; // fixed width (horizontal sections); otherwise fills its grid cell
};

/** One promotion as a product card: terms, per-unit price, both savings, honesty note, store, expiry, add-to-cart. */
export const DealCard = memo(function DealCard({ d, catalogStores, now, qty, add, setQty, open, width }: Props) {
  const t = useTheme();
  const p = d.product;
  const chainOf = (i: number) => catalogStores[i]?.chain ?? "";
  const soon = isEndingSoon(d, now);
  const end = endLabel(d.endMs, now);
  const note = verdictNote(d, chainOf);
  const noteColor = d.verdict === "real" ? t.good : d.verdict === "notCheapest" ? t.warn : t.ink2;
  const rep = catalogStores[d.rep];
  return (
    <View style={[{ backgroundColor: t.surface, borderRadius: 14, padding: 10, gap: 7, shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 1 }, width ? { width } : null]}>
      <Pressable onPress={() => open(p.code)} accessibilityLabel={`מחירים בכל הסניפים: ${p.name}`} style={{ gap: 8 }}>
        <ProductImage p={p} size="fill" />
        <T numberOfLines={2} style={{ fontWeight: "600", fontSize: 14.5, minHeight: 38, lineHeight: 19 }}>{p.name}</T>
      </Pressable>
      <DealBadge text={dealText(d.promo)} club={d.club} />
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", gap: 6 }}>
        <View style={{ gap: 2 }}>
          <PriceTag agorot={Math.round(d.unit)} />
          <T style={{ fontSize: 11.5, color: t.ink2 }}>{d.qty > 1 ? `ליחידה, בקנייה של ${d.qty}` : "ליחידה"}</T>
        </View>
        <View style={{ alignItems: "flex-start" }}>
          <T style={{ fontSize: 11.5, color: t.ink2 }}>על המדף כאן</T>
          <Num style={{ fontSize: 13, color: t.ink2, textDecorationLine: "line-through" }}>{money(d.shelf)} ₪</Num>
        </View>
      </View>
      {d.unitPrice ? <T style={{ fontSize: 12, color: t.ink2 }}>{unitText(d.unitPrice)}</T> : null}
      <View style={{ gap: 1 }}>
        <T style={{ fontSize: 12.5, fontWeight: "700", color: t.bad }}>
          {Math.round(d.savePct)}% פחות מהמדף בסניף
          {d.verdict === "real" ? <Text style={{ color: t.ink2, fontWeight: "600" }}> · {Math.max(0, Math.round(d.realPct))}% פחות מהזול ביותר</Text> : null}
        </T>
        {note ? <T style={{ fontSize: 11.5, color: noteColor }}>{note}</T> : null}
      </View>
      <View style={{ gap: 1 }}>
        <T numberOfLines={1} style={{ fontSize: 12.5, fontWeight: "700" }}>{d.chainLabel}{rep?.branch ? ` · ${rep.branch}` : ""}</T>
        <T numberOfLines={1} style={{ fontSize: 11.5, color: t.ink2 }}>
          {d.stores.length > 1 ? `בכל ${d.stores.length} הסניפים שלהם שנבחרו` : "סניף אחד"}
        </T>
        <View style={{ flexDirection: "row", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {end ? <T style={{ fontSize: 12, fontWeight: soon ? "800" : "600", color: soon ? t.bad : t.ink2 }}>{end}{soon ? " · נגמר בקרוב" : ""}</T> : null}
          {d.max ? <T style={{ fontSize: 11.5, color: t.ink2 }}>עד {d.max} יחידות</T> : null}
        </View>
      </View>
      {qty ? <Stepper p={p} qty={qty} onChange={q => setQty(p.code, q)} /> : <Button title={d.qty > 1 ? `הוספה לסל · ${d.qty} יחידות` : "הוספה לסל"} onPress={() => add(d)} style={{ height: 40 }} />}
    </View>
  );
});
