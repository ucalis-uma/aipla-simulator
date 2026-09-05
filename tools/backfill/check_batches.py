# -*- coding: utf-8 -*-
"""バッチ JSON の検収: ブロック網羅性・focus_lane・displayed 形式を確認する"""
import json, sys
from collections import Counter

sys.stdout.reconfigure(encoding="utf-8")


def check(sample_prefix, manifest_path, batches_dir, batch_ids, sheets_total, sheets_per_batch=10):
    man = json.load(open(manifest_path, encoding="utf-8"))
    sheet2blocks = {s["sheet"]: s["blocks"] for s in man["sheets"]}
    for batch in batch_ids:
        n0 = (batch - 1) * sheets_per_batch + 1
        n1 = min(n0 + sheets_per_batch - 1, sheets_total)
        exp = []
        for n in range(n0, n1 + 1):
            exp += sheet2blocks[f"{sample_prefix}_sheet{n:03d}.png"]
        p = f"{batches_dir}/batch{batch:02d}.json"
        try:
            raw = open(p, encoding="utf-8").read().strip()
            try:
                arr = json.loads(raw)
            except json.JSONDecodeError:
                arr = [json.loads(ln) for ln in raw.splitlines() if ln.strip()]
        except FileNotFoundError:
            print(f"batch{batch:02d}: FILE NOT FOUND")
            continue
        got = [e.get("block") for e in arr]
        missing = [b for b in exp if b not in got]
        extra = [b for b in got if b not in exp]
        dup = len(got) != len(set(got))
        n_num = sum(1 for e in arr if e.get("readable") and e.get("displayed"))
        n_lane = Counter(e.get("focus_lane") for e in arr if e.get("focus_lane"))
        bad_lane = [e.get("block") for e in arr if e.get("focus_lane") is None]
        bad_fmt = [e.get("displayed") for e in arr if e.get("displayed") and not str(e.get("displayed")).startswith("+")]
        colors = Counter(e.get("color") for e in arr if e.get("displayed"))
        notes = Counter((e.get("note") or "")[:24] for e in arr if not e.get("displayed"))
        print(f"batch{batch:02d}: entries={len(arr)} expected={len(exp)} missing={len(missing)} extra={len(extra)} dup={dup}")
        if missing:
            print("   missing:", missing[:12])
        if extra:
            print("   extra:", extra[:8])
        print(f"   numeric={n_num} lanes={dict(n_lane)} focus_null={len(bad_lane)} nonplus={bad_fmt[:5]} colors={dict(colors)}")
        if notes:
            print(f"   notes={dict(notes)}")


if __name__ == "__main__":
    check("S4",
          r"C:/Users/umaro/AppData/Local/Temp/lane_pops/S4/manifest.json",
          r"C:/Users/umaro/AppData/Local/Temp/lane_pops/S4/batches",
          [1, 2, 3], 112)
