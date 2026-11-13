# Scores "same product?" decisions against the hand labels: our rules vs d1 (English / Hebrew instructions).
import json, sys
pairs = {p["id"]: p for p in json.load(open(sys.argv[1]))}
labels = {}
for f in sys.argv[3:]:
    for tok in open(f).read().split():
        k, v = tok.split(":"); labels[int(k)] = int(v)
out = {r["id"]: r for r in json.load(open(sys.argv[2]))}
ids = [i for i in labels if i in out]

def stats(pred):
    tp = sum(1 for i in ids if pred[i] and labels[i]); fp = sum(1 for i in ids if pred[i] and not labels[i])
    fn = sum(1 for i in ids if not pred[i] and labels[i]); tn = sum(1 for i in ids if not pred[i] and not labels[i])
    prec = tp / (tp + fp) if tp + fp else 0; rec = tp / (tp + fn) if tp + fn else 0
    acc = (tp + tn) / len(ids)
    return f"precision {prec:.2f}  recall {rec:.2f}  accuracy {acc:.2f}  (tp {tp} fp {fp} fn {fn} tn {tn})"

print("pairs scored:", len(ids), " same:", sum(labels[i] for i in ids))
print("rules           ", stats({i: pairs[i]["rule"] for i in ids}))
# p_* is the model's distribution over [no, yes] or [yes, no]: work out which from its own answers
for lang in ("en", "he"):
    agree = sum(1 for i in ids if (out[i][f"p_{lang}"][1] > 0.5) == out[i][lang])
    yes_idx = 1 if agree >= len(ids) / 2 else 0
    py = {i: out[i][f"p_{lang}"][yes_idx] for i in ids}
    print(f"d1 {lang} answer    ", stats({i: out[i][lang] for i in ids}))
    best = None
    for th in [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95]:
        s = stats({i: py[i] >= th for i in ids})
        print(f"   {lang} p(yes)>={th:<4}", s)
    # combined: rules OR confident model, and rules AND model
    print(f"   rules AND d1-{lang}  ", stats({i: pairs[i]["rule"] and py[i] >= 0.5 for i in ids}))
    print(f"   rules OR d1-{lang}>=0.9", stats({i: pairs[i]["rule"] or py[i] >= 0.9 for i in ids}))
    from statistics import mean
    print(f"   mean p(yes) on same {mean(py[i] for i in ids if labels[i]):.2f}, on different {mean(py[i] for i in ids if not labels[i]):.2f}")
