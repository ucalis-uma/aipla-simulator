"""
research/26_data_integrity/fix_patch_plan_s3.py

【Phase 14-F / 2026-09-21】patch_plan_s3.json の OCR 誤認エントリ除去。

確定事実（prompts/fix-remaining-buff-mismatches.md §1-1）:
S3 Lane 4 b24〜b28 のスクロール統合パッチが「ボーカルブースト 5段」
（confidence 0.876）を誤認追加していた。実機スクショ（beat_025.PNG / beat_025_2.PNG）
には「3段階 ビジュアルブースト」と「5段階 ボーカル上昇」のみで、ボーカルブースト行は
存在しない。マスタ確認済み: すずA2「アイドルの掟への反抗」に vocal_boost 行なし。

このスクリプトは b024_L4〜b028_L4 の to_add から当該エントリのみを除去し、
patch_plan_s3.json を上書きする（repo 側の作業ファイルの修正）。
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
PLAN_PATH = os.path.join(HERE, "patch_plan_s3.json")

TARGET_KEYS = [f"b{b:03d}_L4" for b in range(24, 29)]
TARGET_NAME = "ボーカルブースト"

with open(PLAN_PATH, "r", encoding="utf-8") as f:
    plan = json.load(f)

removed = 0
for key in TARGET_KEYS:
    patch = plan.get(key)
    if not patch:
        print(f"Warning: {key} not found in patch plan")
        continue
    before = len(patch["to_add"])
    patch["to_add"] = [
        item for item in patch["to_add"]
        if not (item["name"] == TARGET_NAME and item["stage"] == 5)
    ]
    removed += before - len(patch["to_add"])
    # 除去の経緯を記録（監査証跡）
    patch["removed_entries"] = patch.get("removed_entries", []) + [
        {
            "name": TARGET_NAME,
            "stage": 5,
            "reason": "OCR誤認（confidence 0.876）。実機スクショ beat_025.PNG/_2.PNG にボーカルブースト行なし。"
                      "すずA2「アイドルの掟への反抗」マスタ定義にも vocal_boost 行なし（Phase 14-F）",
        }
    ] if before != len(patch["to_add"]) else patch.get("removed_entries", [])

with open(PLAN_PATH, "w", encoding="utf-8") as f:
    json.dump(plan, f, ensure_ascii=False, indent=2)

print(f"Removed {removed} erroneous entries from {PLAN_PATH}")
