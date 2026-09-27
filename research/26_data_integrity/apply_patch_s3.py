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

# 3.5 【Phase 14-F / 2026-09-21】観測不能セル（キー単位）の記録
# 以下は実機スクショ上で該当バフ行が観測できない（=0 ではなく「不確実」）セル。
# 突合（run_audit_post_decay.py）では比較対象から除外される。値の捏造ではなく未観測の明示。
# 証拠（全て aipura_nox/サンプル3/lane4/ 配下の実画像を目視確認済み）:
# - b56 skill_success_up: beat_056.PNG は先頭6行のみ表示（7行目のスキル成功率上昇は折りたたみ
#   直下）。beat_056_2.PNG のスクロール位置では同上行がテンプレートマッチ不成立
#   （dbg_scan_s3_crops.py: b56 p1/p2 とも skill_success_* が 0.80 未満）。
#   前後ビート（b53-55・b57-60）では 3段が連続して観測されており、b56 単発の欠落は
#   撮影・走査の欠損（実機で消滅・復活する発動イベントは存在しない）。
# - b61 visual_boost: beat_061_2.PNG がライブボーナス発動バナー
#   （「ビジュアルが高い2人のCTを減少」）を撮影しており効果リストが写っていない
#   （dbg_scan_s3_crops.py: b61 p2 はマッチ 0 件）。b62_2 では「3段階 ビジュアルブースト」を確認。
# - b63 visual_boost: beat_063_2.PNG が miho（L5）の P スキル発動パネル
#   （「獲得スキル-スタミナ多」Aスキルスコア上昇2/スタミナ継続回復3 のみ表示）を撮影。
# - b70 visual_boost: beat_070_2.PNG が miho の A スキル FAIL（スタミナ不足）パネル
#   （現在の効果ペイン空）を撮影。
# いずれも visual_boost 3段は b62, b64-69, b71 で連続観測されており単発欠落は観測欠損。
data_v3["unobserved_effects"] = [
    {"beat": 56, "lane": 4, "key": "skill_success_up",
     "reason": "スクロール2頁目の走査不成立（折りたたみ直下の行が未捕捉）。b53-55/b57-60 で3段が連続"},
    {"beat": 61, "lane": 4, "key": "visual_boost",
     "reason": "beat_061_2.PNG がライブボーナスバナー撮影フレームで効果リスト非表示。b62 で3段確認"},
    {"beat": 63, "lane": 4, "key": "visual_boost",
     "reason": "beat_063_2.PNG が miho P スキル発動パネル撮影フレームで L4 効果リスト非表示"},
    {"beat": 70, "lane": 4, "key": "visual_boost",
     "reason": "beat_070_2.PNG が miho A スキル FAIL（スタミナ不足）パネル撮影フレームで効果ペイン空"},
]

# 4. 新規保存（v2 は一切変更しない）
# 【Phase 14-F / 2026-09-21】AGENTS.md の規律「aipura_nox 側の既存ファイルは上書きしない」
# に従い、nox 側 measured_data_v3.json が既に存在する場合は上書きしない。
# （初回生成時のみ書き込む。OCR誤認パッチ除去後の再生成は repo 側のみに出力する。
#   nox 側の v3 には誤認データが残っている点に注意 → repo 側 v3 が正。）
if os.path.exists(v3_nox_path):
    print(f"Skipped (exists, 上書き禁止規律): {v3_nox_path}")
else:
    with open(v3_nox_path, "w", encoding="utf-8") as f:
        json.dump(data_v3, f, ensure_ascii=False, indent=2)
    print(f"Saved: {v3_nox_path}")

with open(v3_repo_path, "w", encoding="utf-8") as f:
    json.dump(data_v3, f, ensure_ascii=False, indent=2)
print(f"Saved: {v3_repo_path}")
