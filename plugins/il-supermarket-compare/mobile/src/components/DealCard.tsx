import { Ionicons } from "@expo/vector-icons";
import { memo } from "react";
import { Pressable, Text, View } from "react-native";
import { dealText, money } from "../lib/compare";
import { endLabel, isEndingSoon, type DealItem } from "../lib/dealsFeed";
import { useSettings } from "../lib/settings";
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
  mine?: boolean; // a product the user buys
};

/**
 * One deal, answering in order: how much do I actually save (in shekels, for the quantity the deal
 * needs, against the cheapest regular price around), what do I pay, is it trustworthy, and where and
 * until when.
 */
export const DealCard = memo(function DealCard({ d, catalogStores, now, qty, add, setQty, open, width, mine }: Props) {
  const t = useTheme();
  const { t: tr } = useSettings();
  const p = d.product;
  const chainOf = (i: number) => catalogStores[i]?.chain ?? "";
  const soon = isEndingSoon(d, now);
  const end = endLabel(d.endMs, now);
  const real = d.verdict === "real";
  const check = d.confidence === "check";
  const save = real ? d.realAgorot : d.saveAgorot; // agorot, for d.qty units
  const pct = Math.round(real ? d.realPct : d.savePct);
  const where = d.stores.length > 1 ? `${d.chainLabel} · ${d.stores.length} סניפים` : `${d.chainLabel}${catalogStores[d.rep]?.branch ? ` · ${catalogStores[d.rep].branch}` : ""}`;
  const headline = real
    ? `חוסכים ${money(save)} ₪${d.qty > 1 ? ` על ${d.qty}` : ""}`
    : d.verdict === "notCheapest" ? `זול יותר בלי מבצע ב${chainOf(d.cheapestAt)}` : `${pct}% מתחת למדף`;
  const detail = real ? `${pct}% מתחת לזול באזור` : d.verdict === "notCheapest" ? `${money(d.cheapest)} ₪ במחיר רגיל` : "רק בסניף אחד, אין השוואה";
  return (
    <View style={[{ backgroundColor: t.surface, borderRadius: 14, padding: 10, gap: 6, borderWidth: mine ? 1.5 : 0, borderColor: t.brand }, width ? { width } : null]}>
      <Pressable onPress={() => open(p.code)} accessibilityRole="button" accessibilityLabel={`${p.name}. ${dealText(d.promo)} ב${d.chainLabel}. ${headline}. ${detail}${check ? ". לבדוק בקופה" : d.ai === "yes" ? `. ${tr("deals.aiYes")}` : ""}`} style={{ gap: 6 }}>
        <View>
          <ProductImage p={p} size="fill" />
          {real && pct > 0 ? (
            <View style={{ position: "absolute", top: 6, left: 6, backgroundColor: check ? t.ink2 : t.bad, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2 }}>
              <Text style={{ color: "#fff", fontWeight: "800", fontSize: 13, fontVariant: ["tabular-nums"] }}>−{pct}%</Text>
            </View>
          ) : null}
          {mine ? (
            <View style={{ position: "absolute", top: 6, right: 6, backgroundColor: t.brand, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 }}>
              <Text style={{ color: t.brandInk, fontWeight: "800", fontSize: 11 }}>אתם קונים</Text>
            </View>
          ) : null}
        </View>
        <T numberOfLines={2} style={{ fontWeight: "600", fontSize: 14, minHeight: 37, lineHeight: 18.5 }}>{p.name}</T>
      </Pressable>
      <T numberOfLines={1} style={{ fontSize: 15, fontWeight: "800", color: real ? t.good : d.verdict === "notCheapest" ? t.warn : t.ink2 }}>{headline}</T>
      <View style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 6 }}>
        <PriceTag agorot={Math.round(d.unit)} />
        <Num style={{ fontSize: 12.5, color: t.ink2, textDecorationLine: "line-through" }}>{money(real ? d.cheapest : d.shelf)} ₪</Num>
      </View>
      <T numberOfLines={1} style={{ fontSize: 12, color: t.ink2 }}>
        {d.qty > 1 ? dealText(d.promo) : "ליחידה"}{d.club ? " · מועדון" : ""}{d.max ? ` · עד ${d.max}` : ""}
      </T>
      <T numberOfLines={1} style={{ fontSize: 12, color: t.ink2 }}>{detail}</T>
      {check ? (
        <View style={{ flexDirection: "row", gap: 4, alignItems: "flex-start", backgroundColor: t.warn + "1a", borderRadius: 8, padding: 6 }}>
          <Ionicons name="alert-circle-outline" size={14} color={t.warn} style={{ marginTop: 1 }} />
          <T numberOfLines={2} style={{ flex: 1, fontSize: 11.5, lineHeight: 15, color: t.warn }}>לבדוק בקופה: {d.why}{d.ai === "unclear" ? ` · ${tr("deals.aiUnclear")}` : ""}</T>
        </View>
      ) : d.ai === "yes" ? (
        <View style={{ flexDirection: "row", gap: 4, alignItems: "center" }}>
          <Ionicons name="sparkles-outline" size={13} color={t.good} />
          <T numberOfLines={1} style={{ flex: 1, fontSize: 11.5, color: t.good }}>{tr("deals.aiYes")}</T>
        </View>
      ) : null}
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
