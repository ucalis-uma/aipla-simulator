# -*- coding: utf-8 -*-
"""リコン: サンプル各種のディレクトリ構造・JSON構造を確認する（読み取り専用）"""
import json, os, sys

sys.stdout.reconfigure(encoding="utf-8")

SAMPLES = {
    "T5": r"C:\Users\umaro\Documents\アイプラ\スコア分析サンプル",
    "S1": r"C:\Users\umaro\Documents\aipura_nox\サンプル1",
    "S2": r"C:\Users\umaro\Documents\aipura_nox\サンプル2",
    "S3": r"C:\Users\umaro\Documents\aipura_nox\サンプル3",
    "S4": r"C:\Users\umaro\Documents\aipura_nox\サンプル4",
}


def brief(v, n=700):
    s = json.dumps(v, ensure_ascii=False)
    return s[:n] + ("...(truncated)" if len(s) > n else "")


for name, d in SAMPLES.items():
    print("=" * 30, name)
    if not os.path.isdir(d):
        print("  MISSING DIR")
        continue
    print(" top-level:", sorted(os.listdir(d)))
    for L in range(1, 6):
        ld = os.path.join(d, f"lane{L}")
        if os.path.isdir(ld):
            pngs = sorted(f for f in os.listdir(ld) if f.lower().endswith((".png", ".jpg", ".jpeg")))
            print(f"  lane{L}: {len(pngs)} images, first={pngs[0] if pngs else None}, last={pngs[-1] if pngs else None}")
    dp = os.path.join(d, "deck.json")
    if os.path.exists(dp):
        with open(dp, encoding="utf-8") as f:
            deck = json.load(f)
        print("  deck.json:", brief(deck, 1600))
    for jf in ("measured_data.json", "measured_data_v2.json"):
        p = os.path.join(d, jf)
        if not os.path.exists(p):
            continue
        with open(p, encoding="utf-8") as f:
            data = json.load(f)
        print(f"  -- {jf} --")
        beats = None
        if isinstance(data, dict):
            for k, v in data.items():
                if isinstance(v, list) and v and isinstance(v[0], dict):
                    print(f"    {k}: list[{len(v)}] first={brief(v[0])}")
                    if k in ("beats", "beat_data", "results", "notes"):
                        beats = v
                elif isinstance(v, dict):
                    print(f"    {k}: dict keys={list(v.keys())[:20]}")
                else:
                    print(f"    {k} = {brief(v, 200)}")
        elif isinstance(data, list):
            beats = data
            print(f"    root list[{len(data)}] first={brief(data[0])}")
        if beats:
            n = len(beats)
            keys_hist = {}
            for b in beats:
                if isinstance(b, dict):
                    for k in b.keys():
                        keys_hist[k] = keys_hist.get(k, 0) + 1
            print(f"    beat-entry key histogram: {json.dumps(keys_hist, ensure_ascii=False)}")
