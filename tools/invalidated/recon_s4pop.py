# -*- coding: utf-8 -*-
"""S4 の既存 gained_score_pop.text の値の分布を確認（数値 vs HIT など）"""
import json, os, sys, re
from collections import Counter

sys.stdout.reconfigure(encoding="utf-8")

d = r"C:\Users\umaro\Documents\aipura_nox\サンプル4"
with open(os.path.join(d, "measured_data.json"), encoding="utf-8") as f:
    data = json.load(f)
tl = data["timeline"]

c = Counter()
numeric = 0
for b in tl:
    for lk, lv in b["lanes"].items():
        gp = lv.get("gained_score_pop")
        if isinstance(gp, dict):
            t = gp.get("text")
            c[t if t is None else ("NUMERIC" if re.match(r"^\+[\d.]+[KM]?$", str(t)) else t)] += 1
        else:
            c["<null>"] += 1
print("S4 gained_score_pop.text distribution:", dict(c))

# S4 v2 critical_flags format
cf = data["critical_flags"]
print("cf beats type:", type(cf.get("beats")), "len:", len(cf["beats"]) if hasattr(cf.get("beats"), "__len__") else "?")
bl = cf["beats"]
if isinstance(bl, list):
    print("cf first 3:", bl[:3])
    print("cf around beat 17:", [x for x in bl if x.get("beat") in (16, 17, 18)])
