# -*- coding: utf-8 -*-
"""各サンプルのレーン別ポップ記録率・欠損セルの統計を取る（読み取り専用）"""
import json, os, sys

sys.stdout.reconfigure(encoding="utf-8")

SAMPLES = {
    "T5": r"C:\Users\umaro\Documents\アイプラ\スコア分析サンプル",
    "S1": r"C:\Users\umaro\Documents\aipura_nox\サンプル1",
    "S2": r"C:\Users\umaro\Documents\aipura_nox\サンプル2",
    "S3": r"C:\Users\umaro\Documents\aipura_nox\サンプル3",
    "S4": r"C:\Users\umaro\Documents\aipura_nox\サンプル4",
}

for name, d in SAMPLES.items():
    print("=" * 30, name, d)
    p = os.path.join(d, "measured_data.json")
    with open(p, encoding="utf-8") as f:
        data = json.load(f)
    tl = data["timeline"]
    total_cells = 0
    have = 0
    missing = []
    for b in tl:
        bt = b["beat"]
        for lk, lv in b["lanes"].items():
            gp = lv.get("gained_score_pop")
            gsd = lv.get("gained_score_displayed")
            val = None
            if isinstance(gp, dict) and gp.get("text"):
                val = gp["text"]
            elif gsd:
                val = gsd
            total_cells += 1
            if val:
                have += 1
            else:
                missing.append((bt, lk))
    print(f"  cells={total_cells} have={have} missing={len(missing)}")
    # distribution per lane key
    per_lane = {}
    for bt, lk in missing:
        per_lane[lk] = per_lane.get(lk, 0) + 1
    print("  missing per lane-key:", per_lane)
    print("  first 30 missing:", missing[:30])
    print("  last 10 missing:", missing[-10:])
    # beat range
    print("  beats:", tl[0]["beat"], "..", tl[-1]["beat"], "entries:", len(tl))
    # beat_gained_score presence
    bgs = sum(1 for b in tl if b.get("beat_gained_score"))
    print(f"  beats with beat_gained_score>0: {bgs}")
