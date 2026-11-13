// Re-scores the pairs with the current rules (typeKeys) and with the full app check (equivalents-style: same pack count, size ±15%).
import { readFileSync } from "node:fs";
import { typeKeys } from "../../mobile/src/lib/swaps.ts";
const pairs = JSON.parse(readFileSync("pairs.json", "utf8"));
const lab: Record<number, number> = {};
for (const f of ["labels.txt"]) for (const t of readFileSync(f, "utf8").split(/\s+/).filter(Boolean)) { const [k, v] = t.split(":"); lab[+k] = +v; }
const out = JSON.parse(readFileSync("d1_out.json", "utf8")); const py: Record<number, number> = {};
for (const r of out) py[r.id] = r.p_en[1] > 0.5 === r.en ? r.p_en[1] : r.p_en[0];
const rule = (a: string, b: string) => { const x = typeKeys(a), y = typeKeys(b); return !!x && !!y && (x.strict === y.strict || (!!x.loose && x.loose === y.loose)); };
const st = (name: string, f: (p: any) => boolean) => {
  let tp = 0, fp = 0, fn = 0, tn = 0;
  for (const p of pairs) { const y = f(p), l = lab[p.id]; if (y && l) tp++; else if (y) fp++; else if (l) fn++; else tn++; }
  console.log(name.padEnd(26), `precision ${(tp / (tp + fp)).toFixed(2)} recall ${(tp / (tp + fn)).toFixed(2)} accuracy ${((tp + tn) / pairs.length).toFixed(2)} (fp ${fp} fn ${fn})`);
};
st("rules v1 (before)", p => p.rule);
st("rules v2 (keep numbers)", p => rule(p.an, p.bn));
st("rules v2 AND d1>=0.5", p => rule(p.an, p.bn) && py[p.id] >= 0.5);
for (const p of pairs) if (rule(p.an, p.bn) && !lab[p.id]) console.log("  still wrong:", p.an, "||", p.bn);
for (const p of pairs) if (p.rule && !rule(p.an, p.bn) && lab[p.id]) console.log("  newly missed:", p.an, "||", p.bn);
