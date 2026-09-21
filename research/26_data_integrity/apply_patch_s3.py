"""
research/26_data_integrity/apply_patch_s3.py

measured_data_v2.json を元に、スクロール画像（_2.PNG）のバフ統合を行い、
measured_data_v3.json を新規作成する。
※ measured_data_v2.json をはじめとする既存ファイルは一切変更しない。
"""

import os
import json
import copy

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
S3_DIR = os.path.abspath(os.path.join(REPO_ROOT, "../aipura_nox/サンプル3"))
PLAN_PATH = os.path.join(REPO_ROOT, "research/26_data_integrity/patch_plan_s3.json")

v2_path = os.path.join(S3_DIR, "measured_data_v2.json")
v3_nox_path = os.path.join(S3_DIR, "measured_data_v3.json")
v3_repo_path = os.path.join(REPO_ROOT, "research/26_data_integrity/measured_data_s3_v3.json")

# 1. v2 データのロード
with open(v2_path, "r", encoding="utf-8") as f:
    data_v2 = json.load(f)

# 2. パッチ計画のロード
with open(PLAN_PATH, "r", encoding="utf-8") as f:
    patch_plan = json.load(f)

# 3. ディープコピーしてパッチ適用
data_v3 = copy.deepcopy(data_v2)
data_v3["version"] = "v3"
data_v3["description"] = "Sample 3 with scroll pane (_2.PNG) buffs merged for Lane 3 & Lane 4"

# timeline の beat をキーにした参照作成
tl_map = {b["beat"]: b for b in data_v3.get("timeline", [])}

applied_count = 0
for key, patch in patch_plan.items():
    b_num = patch["beat"]
    lane_str = str(patch["lane"])
    to_add = patch["to_add"]
    
    beat_data = tl_map.get(b_num)
    if not beat_data:
        print(f"Warning: beat {b_num} not found in timeline")
        continue
    
    lane_data = beat_data.get("lanes", {}).get(lane_str)
    if not lane_data:
        print(f"Warning: lane {lane_str} not found in beat {b_num}")
        continue
    
    effects = lane_data.setdefault("effects", [])
    existing_names = {e["name"] for e in effects}
    
    for item in to_add:
        if item["name"] not in existing_names:
            effects.append({
                "name": item["name"],
                "stage": item["stage"]
            })
            applied_count += 1

print(f"Applied {applied_count} restored buff entries across {len(patch_plan)} beats.")

# 4. 新規保存（v2 は一切変更しない）
with open(v3_nox_path, "w", encoding="utf-8") as f:
    json.dump(data_v3, f, ensure_ascii=False, indent=2)
print(f"Saved: {v3_nox_path}")

with open(v3_repo_path, "w", encoding="utf-8") as f:
    json.dump(data_v3, f, ensure_ascii=False, indent=2)
print(f"Saved: {v3_repo_path}")
