# Runs LiquidAI d1-omni-600M on the labelled product pairs: "same product?" as a yes/no decision.
import json, sys, time
import torch
from transformers import AutoModel

pairs = json.load(open(sys.argv[1]))
out_path = sys.argv[2]
torch.set_num_threads(4)
t0 = time.time()
import os
model = AutoModel.from_pretrained(os.environ.get("D1_MODEL", "LiquidAI/d1-omni-600M"), trust_remote_code=True, dtype=torch.float32).to("cpu").eval()
print("loaded in", round(time.time() - t0, 1), "s", flush=True)

EN = {"type": "noul", "instructions": (
    "Product A and product B are two supermarket listings (names in Hebrew). Are they the same product for a shopper "
    "comparing prices: the same kind of product, the same variant (flavour, fat percentage, strength, scent, model), "
    "and about the same size? A different brand counts as the same only for basic staples such as milk, cheese, eggs, "
    "bread, rice, flour, sugar, oil, spices and vegetables.")}
HE = {"type": "noul", "instructions": (
    "מוצר A ומוצר B הם שני מוצרים בסופרמרקט. האם זה אותו מוצר לצורך השוואת מחירים: אותו סוג, אותו טעם/אחוז שומן/חוזק/ריח, "
    "ובערך אותו גודל? מותג אחר נחשב אותו מוצר רק במוצרי יסוד כמו חלב, גבינה, ביצים, לחם, אורז, קמח, סוכר, שמן ותבלינים.")}

res = []
t1 = time.time()
B = 16
for i in range(0, len(pairs), B):
    chunk = pairs[i:i + B]
    reqs = []
    for p in chunk:
        state = {"product_A": p["an"], "product_B": p["bn"]}
        reqs.append((state, {"en": EN, "he": HE}))
    ans = model.system_one_batch(reqs)
    probs = model.probabilities_batch([(r[0], [EN, HE]) for r in reqs])
    for p, a, pr in zip(chunk, ans, probs):
        res.append({"id": p["id"], "en": bool(a["answers"]["en"]), "he": bool(a["answers"]["he"]),
                    "p_en": [float(x) for x in pr[0]], "p_he": [float(x) for x in pr[1]]})
    print(f"{i + len(chunk)}/{len(pairs)} {time.time() - t1:.1f}s", flush=True)
json.dump(res, open(out_path, "w"))
print("per pair ms:", round((time.time() - t1) / len(pairs) * 1000), flush=True)
