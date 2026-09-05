# -*- coding: utf-8 -*-
"""サンプルごとの detailed_profile 構造把握（読み取り専用・安全版）"""
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
    print("=" * 30, name)
    p = os.path.join(d, "measured_data.json")
    if not os.path.exists(p):
        print("  no measured_data.json")
    with open(p, encoding="utf-8") as f:
        data = json.load(f)
    tl = data.get("timeline") or []
    if tl:
        b0, b1, b2 = tl[0], tl[1], tl[2]
        print("  b0 lanes keys:", list(b0["lanes"].keys()))
        for lk, lv in list(b0["lanes"].items())[:2]:
            print(f"   b0 lane {lk}:", json.dumps(lv, ensure_ascii=False)[:200])
        # find first beat with a non-null pop
        found = 0
        for b in tl:
            for lk, lv in b["lanes"].items():
                gp = lv.get("gained_score_pop")
                gsd = lv.get("gained_score_displayed")
                if (isinstance(gp, dict) and gp.get("text")) or gsd:
                    print(f"   first pop at beat={b.get('beat')} lane={lk}: pop={gp} gsd={gsd}")
                    found += 1
                    break
            if found >= 3:
                break
    cf = data.get("critical_flags")
    if isinstance(cf, dict):
        print("  critical_flags format:", cf.get("format"))
        bl = cf.get("beats")
        if isinstance(bl, list):
            print("  cf.beats first:", json.dumps(bl[0], ensure_ascii=False)[:300])
        elif isinstance(bl, dict):
            ks = list(bl.keys())[:5]
            print("  cf.beats dict, first keys:", ks, "->", [bl[k] for k in ks])
