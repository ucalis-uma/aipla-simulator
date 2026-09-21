"""
research/26_data_integrity/test_robust_scan.py

列全体に対するテンプレートマッチング（y座標オフセットにロバストなスキャン）。
"""

import os
import cv2
import numpy as np

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
CROP_DIR = os.path.join(REPO_ROOT, "research/26_data_integrity/crops_s3")
TMPL_DIR = os.path.join(REPO_ROOT, "research/26_data_integrity/templates")

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

def scan_column(col_img, x_offset):
    found = []
    for fname, tmpl in tmpl_imgs.items():
        res = cv2.matchTemplate(col_img, tmpl, cv2.TM_CCOEFF_NORMED)
        loc = np.where(res >= 0.85)
        for pt in zip(*loc[::-1]):
            score = float(res[pt[1], pt[0]])
            info = TEMPLATES[fname]
            found.append({
                "name": info["name"],
                "stage": info["stage"],
                "score": score,
                "x": pt[0] + x_offset,
                "y": pt[1],
                "w": tmpl.shape[1],
                "h": tmpl.shape[0]
            })
            
    # 重複排除（y座標が近い同一候補は最大スコアのみ採用）
    found.sort(key=lambda x: -x["score"])
    kept = []
    for c in found:
        # 既存と y 座標が 20px 以内なら同一スロットの重複
        if any(abs(c["y"] - k["y"]) < 20 for k in kept):
            continue
        kept.append(c)
        
    kept.sort(key=lambda x: x["y"])
    return kept

def scan_image(img_path):
    img = cv_imread(img_path)
    if img is None:
        return []
    # 左列: x 10〜470, y 5〜240
    # 右列: x 475〜935, y 5〜240
    col_left = img[5:245, 10:470]
    col_right = img[5:245, 475:935]
    
    res_left = scan_column(col_left, 10)
    res_right = scan_column(col_right, 475)
    
    all_res = res_left + res_right
    all_res.sort(key=lambda x: (x["y"] // 50, x["x"]))
    return [(r["name"], r["stage"], round(r["score"], 2)) for r in all_res]

for name in ["L3_beat_024_p1.png", "L3_beat_024_p2.png", "L4_beat_024_p1.png", "L4_beat_024_p2.png", "L4_beat_060_p1.png", "L4_beat_060_p2.png"]:
    print(f"\n--- {name} ---")
    for r in scan_image(os.path.join(CROP_DIR, name)):
        print(" ", r)
