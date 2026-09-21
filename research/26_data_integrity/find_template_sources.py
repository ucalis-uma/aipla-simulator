import os, json, cv2
import numpy as np

repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
s2_sim_path = os.path.join(repo_root, "research/20_sample2_gap_analysis/sim_trace_full.json")
s2_nox_path = os.path.abspath(os.path.join(repo_root, "../aipura_nox/サンプル2"))

with open(s2_sim_path, "r", encoding="utf-8") as f:
    sim_data = json.load(f)

# 各バフ・段階数について、それが存在する (lane, beat) の候補を収集
candidates = {}
for b in sim_data.get("beats", []):
    beat = b["beat"]
    for l_idx, snap in enumerate(b.get("buffSnapshots", [])):
        lane = l_idx + 1
        for k, v in snap.items():
            if v > 0:
                pair = (k, v)
                if pair not in candidates:
                    candidates[pair] = []
                candidates[pair].append((lane, beat))

print(f"Total distinct (buff_key, stage) in Sim: {len(candidates)}")
for (k, v), occurrences in sorted(candidates.items()):
    print(f"{k} stage {v}: {len(occurrences)} beats, e.g. lane {occurrences[0][0]} beat {occurrences[0][1]}")
