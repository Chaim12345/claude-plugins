import { readFileSync, writeFileSync } from "node:fs";
import { toProducts } from "../../mobile/src/lib/compare.ts";
import { typeKeys, swapIndex } from "../../mobile/src/lib/swaps.ts";
import { sizeOf, similarSize, withoutSize } from "../../mobile/src/lib/units.ts";
const c = JSON.parse(readFileSync(process.argv[2], "utf8"));
const ps = [...toProducts(c).values()].filter(p => !p.weighted);
const words = (n: string) => new Set(withoutSize(n).replace(/[^\p{L}\p{N}% ]/gu, " ").split(/\s+/).filter(w => w.length > 1 && !/^\d+$/.test(w)));
const W = new Map(ps.map(p => [p.code, words(p.name)]));
const rule = (a: any, b: any) => { const ka = typeKeys(a.name), kb = typeKeys(b.name); if (!ka || !kb) return false;
  return ka.strict === kb.strict || (!!ka.loose && ka.loose === kb.loose); };
const byCat = new Map<string, any[]>();
for (const p of ps) { const s = sizeOf(p); if (!s) continue; (byCat.get(p.cat) ?? byCat.set(p.cat, []).get(p.cat)!).push({ p, s }); }
const pairs: any[] = [];
for (const [cat, list] of byCat) {
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = list[i], b = list[j];
    if (a.s.packs !== b.s.packs || !similarSize(a.s, b.s)) continue;
    const wa = W.get(a.p.code)!, wb = W.get(b.p.code)!;
    let inter = 0; for (const w of wa) if (wb.has(w)) inter++;
    const jac = inter / (wa.size + wb.size - inter || 1);
    if (jac < 0.34) continue;
    pairs.push({ a: a.p.code, b: b.p.code, an: a.p.name, bn: b.p.name, cat, jac: +jac.toFixed(2), rule: rule(a.p, b.p) });
  }
}
// deterministic sample: all rule-yes up to 120, and rule-no spread over jaccard
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const yes = pairs.filter(p => p.rule).sort(() => rnd() - 0.5).slice(0, 110);
const no = pairs.filter(p => !p.rule).sort(() => rnd() - 0.5).slice(0, 190);
const sample = [...yes, ...no].sort(() => rnd() - 0.5).map((p, i) => ({ id: i, ...p }));
console.log("candidate pairs", pairs.length, "rule yes", pairs.filter(p => p.rule).length, "sample", sample.length);
writeFileSync("pairs.json", JSON.stringify(sample, null, 0));
