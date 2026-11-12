import { memo } from "react";
import { Pressable, Text, View } from "react-native";
import { dealText, money } from "../lib/compare";
import { endLabel, isEndingSoon, type DealItem } from "../lib/dealsFeed";
import { unitText } from "../lib/units";
import { Button, Num, PriceTag, ProductImage, Stepper, T, useTheme } from "./ui";

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

/**
 * One promotion as a card. It answers three things and no more: what you pay (per unit, and the
 * terms), whether it is really cheap (one line, measured against the cheapest regular price nearby),
 * and where and until when.
 */
export const DealCard = memo(function DealCard({ d, catalogStores, now, qty, add, setQty, open, width }: Props) {
  const t = useTheme();
  const p = d.product;
  const chainOf = (i: number) => catalogStores[i]?.chain ?? "";
  const soon = isEndingSoon(d, now);
  const end = endLabel(d.endMs, now);
  const real = d.verdict === "real";
  // the headline percentage is the honest one when there is something to compare with
  const pct = Math.round(real ? d.realPct : d.savePct);
  const verdict = real ? "זול מכל מחיר רגיל סביבכם"
    : d.verdict === "notCheapest" ? `זול יותר ב${chainOf(d.cheapestAt)}: ${money(d.cheapest)} ₪`
    : "רק בסניף אחד, אין השוואה";
  const where = d.stores.length > 1 ? `${d.chainLabel} · ${d.stores.length} סניפים` : `${d.chainLabel}${catalogStores[d.rep]?.branch ? ` · ${catalogStores[d.rep].branch}` : ""}`;
  return (
    <View style={[{ backgroundColor: t.surface, borderRadius: 14, padding: 10, gap: 7 }, width ? { width } : null]}>
      <Pressable onPress={() => open(p.code)} accessibilityRole="button" accessibilityLabel={`${p.name}. ${dealText(d.promo)} ב${d.chainLabel}. ${verdict}`} style={{ gap: 7 }}>
        <View>
          <ProductImage p={p} size="fill" />
          {pct > 0 ? (
            <View style={{ position: "absolute", top: 6, left: 6, backgroundColor: real ? t.bad : t.ink2, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2 }}>
              <Text style={{ color: "#fff", fontWeight: "800", fontSize: 13, fontVariant: ["tabular-nums"] }}>−{pct}%</Text>
            </View>
          ) : null}
        </View>
        <T numberOfLines={2} style={{ fontWeight: "600", fontSize: 14, minHeight: 37, lineHeight: 18.5 }}>{p.name}</T>
      </Pressable>
      <View style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 6 }}>
        <PriceTag agorot={Math.round(d.unit)} />
        <Num style={{ fontSize: 13, color: t.ink2, textDecorationLine: "line-through" }}>{money(d.shelf)} ₪</Num>
      </View>
      <T numberOfLines={1} style={{ fontSize: 12.5, fontWeight: "700", color: t.bad }}>
        {d.qty > 1 ? dealText(d.promo) : "מחיר מבצע"}{d.club ? " · מועדון" : ""}{d.max ? ` · עד ${d.max} יח׳` : ""}
      </T>
      <T numberOfLines={1} style={{ fontSize: 12, color: real ? t.good : d.verdict === "notCheapest" ? t.warn : t.ink2, fontWeight: real ? "700" : "500" }}>{verdict}</T>
      <View style={{ gap: 1 }}>
        <T numberOfLines={1} style={{ fontSize: 12.5, fontWeight: "600" }}>{where}</T>
        <T numberOfLines={1} style={{ fontSize: 12, color: soon ? t.bad : t.ink2, fontWeight: soon ? "700" : "400" }}>
          {end ? `${end}${soon ? " · נגמר בקרוב" : ""}` : "ללא תאריך סיום"}{d.unitPrice && !soon ? ` · ${unitText(d.unitPrice)}` : ""}
        </T>
      </View>
      {qty ? <Stepper p={p} qty={qty} onChange={q => setQty(p.code, q)} /> : <Button title={d.qty > 1 ? `הוספת ${d.qty} לסל` : "הוספה לסל"} onPress={() => add(d)} style={{ height: 40, paddingHorizontal: 8 }} />}
    </View>
  );
});
