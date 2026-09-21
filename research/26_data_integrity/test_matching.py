"""
research/26_data_integrity/test_matching.py

全テンプレートと各スロットのテンプレートマッチングテスト。
"""

import os
import cv2
import numpy as np

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
CROP_DIR = os.path.join(REPO_ROOT, "research/26_data_integrity/crops_s3")
TMPL_DIR = os.path.join(REPO_ROOT, "research/26_data_integrity/templates")

SLOTS = [
    (18, 14, 452, 74),   # 0: 行1左
    (486, 14, 920, 74),  # 1: 行1右
    (18, 86, 452, 146),  # 2: 行2左
    (486, 86, 920, 146), # 3: 行2右
    (18, 158, 452, 218), # 4: 行3左
    (486, 158, 920, 218) # 5: 行3右
]

TEMPLATES = {
    "focus_10.png": {"name": "集目", "stage": 10},
    "focus_6.png": {"name": "集目", "stage": 6},
    "score_up_7.png": {"name": "スコア上昇", "stage": 7},
    "score_up_2.png": {"name": "スコア上昇", "stage": 2},
    "stamina_rec_3.png": {"name": "スタミナ継続回復", "stage": 3},
    "a_score_2.png": {"name": "Aスキルスコア上昇", "stage": 2},
    "crit_rate_5.png": {"name": "クリティカル率上昇", "stage": 5},
    "vocal_boost_5.png": {"name": "ボーカルブースト", "stage": 5},
    "vocal_up_3.png": {"name": "ボーカル上昇", "stage": 3},
    "vocal_up_5.png": {"name": "ボーカル上昇", "stage": 5},
    "vocal_up_7.png": {"name": "ボーカル上昇", "stage": 7},
    "skill_success_6.png": {"name": "スキル成功率上昇", "stage": 6},
    "skill_success_3.png": {"name": "スキル成功率上昇", "stage": 3},
    "visual_up_11.png": {"name": "ビジュアル上昇", "stage": 11},
    "crit_coeff_10.png": {"name": "クリティカル係数上昇", "stage": 10},
    "crit_coeff_11.png": {"name": "クリティカル係数上昇", "stage": 11},
    "visual_boost_3.png": {"name": "ビジュアルブースト", "stage": 3},
    "visual_extreme_10.png": {"name": "ビジュアル上昇超化", "stage": 10},
    "visual_limit_10.png": {"name": "ビジュアル上昇上限開放", "stage": 10},
}

def cv_imread(p):
    return cv2.imdecode(np.fromfile(p, dtype=np.uint8), cv2.IMREAD_COLOR)

tmpl_imgs = {}
for fname, info in TEMPLATES.items():
    p = os.path.join(TMPL_DIR, fname)
    tmpl_imgs[fname] = cv_imread(p)

def recognize_slot(slot_img):
    # 背景一様チェック（空スロット）
    std = np.std(slot_img)
    if std < 10:
        return None
        
    best_score = -1
    best_match = None
    
    for fname, tmpl in tmpl_imgs.items():
        res = cv2.matchTemplate(slot_img, tmpl, cv2.TM_CCOEFF_NORMED)
        min_val, max_val, min_loc, max_loc = cv2.minMaxLoc(res)
        if max_val > best_score:
            best_score = max_val
            best_match = fname
            
    if best_score > 0.85:
        return TEMPLATES[best_match], best_score
    return None

def scan_crop(crop_path):
    img = cv_imread(crop_path)
    if img is None:
        return []
    results = []
    for i, (x1, y1, x2, y2) in enumerate(SLOTS):
        slot = img[y1:y2, x1:x2]
        rec = recognize_slot(slot)
        if rec:
            info, score = rec
            results.append((info["name"], info["stage"], score))
    return results

# L3 b24 p1 & p2 テスト
print("--- L3 b024 p1 ---")
for r in scan_crop(os.path.join(CROP_DIR, "L3_beat_024_p1.png")):
    print(" ", r)

print("--- L3 b024 p2 ---")
for r in scan_crop(os.path.join(CROP_DIR, "L3_beat_024_p2.png")):
    print(" ", r)

# L4 b060 p1 & p2 テスト
print("\n--- L4 b060 p1 ---")
for r in scan_crop(os.path.join(CROP_DIR, "L4_beat_060_p1.png")):
    print(" ", r)

print("--- L4 b060 p2 ---")
for r in scan_crop(os.path.join(CROP_DIR, "L4_beat_060_p2.png")):
    print(" ", r)
