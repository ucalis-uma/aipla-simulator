"""
research/26_data_integrity/investigate_scroll_bug.py

S3 のスクロール撮影（_2.PNG）における JSON 欠落バグの徹底検証スクリプト。
"""

import json
import os
import re

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
S3_DIR = os.path.abspath(os.path.join(REPO_ROOT, "../aipura_nox/サンプル3"))

meas3 = json.load(open(os.path.join(S3_DIR, "measured_data_v2.json"), "r", encoding="utf-8"))
sim3 = json.load(open(os.path.join(REPO_ROOT, "research/21_sample3_gap_analysis/sim_trace_full.json"), "r", encoding="utf-8"))
diff3 = json.load(open(os.path.join(REPO_ROOT, "research/26_data_integrity/diff_s3_v2.json"), "r", encoding="utf-8"))

# _2.PNG があるビートとレーンを特定
scroll_beats = {"3": [], "4": []}
for lane in ["3", "4"]:
    lane_dir = os.path.join(S3_DIR, f"lane{lane}")
    if os.path.exists(lane_dir):
        for f in os.listdir(lane_dir):
            m = re.match(r"beat_(\d+)_2\.PNG", f, re.IGNORECASE)
            if m:
                scroll_beats[lane].append(int(m.group(1)))
    scroll_beats[lane].sort()

print(f"Scroll beats in Lane 3 ({len(scroll_beats['3'])} beats): {scroll_beats['3']}")
print(f"Scroll beats in Lane 4 ({len(scroll_beats['4'])} beats): {scroll_beats['4']}")

# DECAY_TIMING_LAG とスクロールビートの一致を検証
decay_lags = [d for d in diff3["diffs"] if "DECAY_TIMING_LAG" in d["note"]]
print(f"\nTotal DECAY_TIMING_LAG in S3: {len(decay_lags)}")

decay_on_scroll = []
decay_not_on_scroll = []

for d in decay_lags:
    lane_str = str(d["lane"])
    beat = d["beat"]
    if lane_str in scroll_beats and beat in scroll_beats[lane_str]:
        decay_on_scroll.append(d)
    else:
        decay_not_on_scroll.append(d)

print(f"DECAY_TIMING_LAG on scroll beats (_2.PNG exists): {len(decay_on_scroll)} ({len(decay_on_scroll)/len(decay_lags)*100:.1f}%)")
print(f"DECAY_TIMING_LAG on non-scroll beats: {len(decay_not_on_scroll)}")

print("\n--- Breakdown of DECAY_TIMING_LAG on scroll beats ---")
from collections import Counter
print("By key:", dict(Counter(d["key"] for d in decay_on_scroll)))
print("By lane:", dict(Counter(d["lane"] for d in decay_on_scroll)))

print("\n--- Details of DECAY_TIMING_LAG on NON-scroll beats ---")
for d in decay_not_on_scroll:
    print(f"  b{d['beat']} L{d['lane']} {d['key']}: meas={d['measured_stage']}, sim={d['sim_stage']}")
