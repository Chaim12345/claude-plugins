import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { bestDeal, dealText, fmtDate, priceInfo } from "../lib/compare";
import { copyText, shareText, type ShareResult } from "../lib/shareAction";
import { DEFAULT_SHARE_URL, formatCart, formatProduct } from "../lib/shareText";
import { useSettings } from "../lib/settings";
import { useData } from "../lib/store";
import type { Product } from "../lib/types";
import { Button, T, useTheme } from "./ui";

const LINK = process.env.EXPO_PUBLIC_SALZOL_SHARE_URL || DEFAULT_SHARE_URL;

/** A short confirmation line that clears itself. */
function useNote() {
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    if (!note) return;
    const id = setTimeout(() => setNote(null), 3000);
    return () => clearTimeout(id);
  }, [note]);
  return [note, setNote] as const;
}

/** Share / copy the cart as text, and open the branch map. Sits at the top of the cart. */
export function CartShareBar() {
  const t = useTheme();
  const router = useRouter();
  const { catalog, comparison: c } = useData();
  const { t: tr, tx, dir } = useSettings();
  const [note, setNote] = useNote();
  if (!catalog || !c || !c.items.length) return null;

  const text = () => {
    const r = c.rows[0];
    const s = r ? catalog.stores[r.i] : null;
    return formatCart(
      c.items.map(([p, q]) => ({ name: p.name, qty: q, weighted: p.weighted })),
      r && s ? { chain: s.chain, branch: s.branch, total: r.total, missing: r.missing.length } : null,
      { link: LINK, priceDate: fmtDate(catalog.priceDate) },
    );
  };
  const done = (r: ShareResult) => setNote(r === "copied" ? tr("share.copied") : r === "failed" ? tr("share.failed") : null);

  return (
    <View style={{ gap: 6, direction: dir }}>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Button kind="ghost" title={tr("share.share")} style={{ flex: 1, height: 40 }} icon={<Ionicons name="share-outline" size={17} color={t.brand} />}
          onPress={async () => done(await shareText(text(), tr("share.cartTitle")))} />
        <Button kind="ghost" title={tr("share.copy")} style={{ flex: 1, height: 40 }} icon={<Ionicons name="copy-outline" size={17} color={t.brand} />}
          onPress={async () => setNote((await copyText(text())) ? tr("share.copied") : tr("share.failed"))} />
        <Button kind="ghost" title={tr("map.open")} style={{ flex: 1, height: 40 }} icon={<Ionicons name="map-outline" size={17} color={t.brand} />}
          onPress={() => router.push("/map")} />
      </View>
      {note ? <T accessibilityLiveRegion="polite" style={[tx, { color: t.ink2, fontSize: 12.5 }]}>{note}</T> : null}
    </View>
  );
}

/** Share one product's best price as text. */
export function ProductShareButton({ p }: { p: Product }) {
  const t = useTheme();
  const { catalog, active, deals } = useData();
  const { t: tr, tx } = useSettings();
  const [note, setNote] = useNote();
  const pi = priceInfo(p, active);
  if (!catalog || pi.lo == null) return null;

  const text = () => {
    const s = catalog.stores[pi.at];
    const d = bestDeal(p, active, deals);
    return formatProduct({
      name: p.name, chain: s.chain, branch: s.branch, price: pi.lo!, highest: pi.hi, branches: pi.n, weighted: p.weighted,
      deal: d ? { chain: catalog.stores[d.i].chain, text: dealText(d.promo) } : null,
    }, { link: LINK });
  };
  return (
    <View style={{ gap: 6 }}>
      <Button kind="ghost" title={tr("share.shareProduct")} icon={<Ionicons name="share-outline" size={17} color={t.brand} />}
        onPress={async () => { const r = await shareText(text(), p.name); setNote(r === "copied" ? tr("share.copied") : r === "failed" ? tr("share.failed") : null); }} />
      {note ? <T accessibilityLiveRegion="polite" style={[tx, { color: t.ink2, fontSize: 12.5 }]}>{note}</T> : null}
    </View>
  );
}
