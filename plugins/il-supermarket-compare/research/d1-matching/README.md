# Product matching: rules vs LiquidAI d1

**Question:** would a small on-device "decision" model match products across chains better than the app's rules? "Match" here means the same product for a shopper, the same kind and variant at about the same size. A different brand counts only for staples (milk, cheese, bread, rice, oil, spices…).

**Data:** 295 candidate pairs from the real Ramat Gan catalog of 13 Nov 2026 (`make_pairs.ts`): same category, pack size within 15%, overlapping name words. Each pair is labelled by hand in `labels.txt`: 101 the same, 194 different. Most of these are deliberately hard near-misses.

**Model:** [LiquidAI/d1-omni-600M](https://huggingface.co/LiquidAI/d1-omni-600M), a 587M-parameter decision model. It was asked "same product?" as a yes/no question, with the instructions in English and then in Hebrew (`run_d1.py`). It ran on CPU (4 cores) at about 1.9 s per pair.

## Results (13 Nov 2026)

| | Precision | Recall | Accuracy |
|---|---|---|---|
| App rules before | 0.86 | 0.89 | 0.91 |
| d1, English instructions, its own answer | 0.34 | 1.00 | 0.34 (answers "yes" to almost everything) |
| d1, English, p(yes) ≥ 0.8 | 0.87 | 0.40 | 0.77 |
| d1, Hebrew instructions | below chance | | |
| App rules before, then d1 as a veto (p ≥ 0.5) | 0.90 | 0.89 | 0.93 |
| **App rules now** (one- and two-digit variant numbers kept, "+" split, "2 ב 1") | **0.96** | **0.88** | **0.95** |
| App rules now, then d1 as a veto | 0.96 | 0.88 | 0.95 |

## Conclusions

- d1 does not read Hebrew product names well. Hebrew is not among its trained languages, and with Hebrew instructions it does worse than chance.
- As a second opinion after the old rules it removed a third of their wrong matches. Its own errors pointed at the cause: the rules dropped the numbers that tell variants apart, such as capsule strength 09 vs 14, spaghetti No. 3 vs 5, and nappy size 4 vs 4+.
- After that fix the rules alone are better than rules + d1, and they cost nothing on the phone. The app uses the rules; d1 is not shipped.
- Caveat: the same 295 pairs were used to find the rule fix. A fresh labelled set from another area would give an unbiased number.
- Where d1 could still help: its image and audio inputs, such as matching a photo of a shelf tag or a spoken shopping list to a catalog product. Those features are a separate experiment.

## Running it

Locally: `python run_d1.py pairs.json d1_out.json && python score.py pairs.json d1_out.json labels.txt`. It needs `torch`, `transformers>=5.15` and about 3 GB for the model.

On GitHub: the Actions tab → "d1 matching experiment" → Run workflow. You can choose another model id there, for example a fine-tuned one. The results come back as an artifact.

Rules only, no model (from this folder): `node --experimental-strip-types score_rules.ts`.
