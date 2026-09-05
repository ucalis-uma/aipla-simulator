# -*- coding: utf-8 -*-
"""S4: 数値ポップ欠損ビート×レーンの「レーンのどのフォルダに beat が存在するか」を調べる"""
import json, os, sys
from collections import Counter

sys.stdout.reconfigure(encoding="utf-8")

d = r"C:\Users\umaro\Documents\aipura_nox\サンプル4"
with open(os.path.join(d, "measured_data.json"), encoding="utf-8") as f:
    data = json.load(f)
tl = data["timeline"]

# numeric-pop missing cells
missing_cells = set()
for b in tl:
    for lk, lv in b["lanes"].items():
        gp = lv.get("gained_score_pop")
        if not (isinstance(gp, dict) and gp.get("text") and str(gp.get("text")).startswith("+")):
            missing_cells.add((b["beat"], int(lk)))

# scan lane folders for beat files
def scan_lane(L):
    ld = os.path.join(d, f"lane{L}")
    m = {}
    for f in os.listdir(ld):
        if not f.lower().endswith(".png"):
            continue
        base = f[:-4]
        bt = None
        if base.startswith("beat_"):
            stem = base[5:]
            parts = stem.split("_")
            if parts[0].isdigit():
                bt = int(parts[0])
        if bt is not None:
            m.setdefault(bt, []).append(f)
    return m

presence = {L: scan_lane(L) for L in range(1, 6)}

# for each missing cell, which lanes have the beat?
report = Counter()
no_frame_at_all = []
for (bt, L) in sorted(missing_cells):
    lanes_with = [x for x in range(1, 6) if bt in presence[x]]
    if not lanes_with:
        no_frame_at_all.append((bt, L))
    for l2 in lanes_with:
        report[(L, l2)] += 1

print("missing cells:", len(missing_cells))
print("cells with NO frame in any lane folder:", len(no_frame_at_all))
print("no-frame list:", no_frame_at_all[:40])
print()
print("availability matrix (target_lane x folder_lane -> count of cells):")
for L in range(1, 6):
    row = [report.get((L, l2), 0) for l2 in range(1, 6)]
    print(f"  lane{L}: {row}")

# How many cells are covered by lane2/lane3 folders?
cov23 = sum(1 for (bt, L) in missing_cells if bt in presence[2] or bt in presence[3])
print("cells coverable by lane2/lane3 folders:", cov23)
# per target lane
for L in range(1, 6):
    cells = [(bt, l) for (bt, l) in missing_cells if l == L]
    cov = sum(1 for (bt, l) in cells if bt in presence[2] or bt in presence[3])
    print(f"  lane{L}: missing={len(cells)} coverable_by_23={cov}")
