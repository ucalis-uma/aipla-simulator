"""
research/26_data_integrity/check_p1_p2.py
"""
import os
import json
import cv2
import numpy as np

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
CROP_DIR = os.path.join(REPO_ROOT, "research/26_data_integrity/crops_s3")
TMPL_DIR = os.path.join(REPO_ROOT, "research/26_data_integrity/templates")
S3_DIR = os.path.abspath(os.path.join(REPO_ROOT, "../aipura_nox/サンプル3"))

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
            })
            
    found.sort(key=lambda x: -x["score"])
    kept = []
    for c in found:
        if any(abs(c["y"] - k["y"]) < 20 for k in kept):
            continue
        kept.append(c)
        
    kept.sort(key=lambda x: x["y"])
    return kept

def scan_image(img_path):
    img = cv_imread(img_path)
    if img is None:
        return []
    col_left = img[5:245, 10:470]
    col_right = img[5:245, 475:935]
    
    res_left = scan_column(col_left, 10)
    res_right = scan_column(col_right, 475)
    
    all_res = res_left + res_right
    all_res.sort(key=lambda x: (x["y"] // 50, x["x"]))
    return [{"name": r["name"], "stage": r["stage"]} for r in all_res]

scroll_beats = {
    "3": [24, 25, 26, 27, 28, 29, 30, 31, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66],
    "4": [24, 25, 26, 27, 28, 53, 54, 55, 56, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71]
}

meas3 = json.load(open(os.path.join(S3_DIR, "measured_data_v2.json"), "r", encoding="utf-8"))
meas_tl = {b["beat"]: b for b in meas3.get("timeline", [])}

for lane in ["3", "4"]:
    print(f"\n================ LANE {lane} ================")
    for b in scroll_beats[lane]:
        p1 = scan_image(os.path.join(CROP_DIR, f"L{lane}_beat_{b:03d}_p1.png"))
        p2 = scan_image(os.path.join(CROP_DIR, f"L{lane}_beat_{b:03d}_p2.png"))
        curr = meas_tl.get(b, {}).get("lanes", {}).get(lane, {}).get("effects", [])
        
        curr_names = [x["name"] + str(x.get("stage", "")) for x in curr]
        p1_names = [x["name"] + str(x.get("stage", "")) for x in p1]
        p2_names = [x["name"] + str(x.get("stage", "")) for x in p2]
        
        # 統合バフ（p1 と p2 のユニオン）
        union_dict = {}
        for x in p1 + p2:
            union_dict[x["name"]] = x["stage"]
        
        # curr に欠けているもの
        missing_from_curr = {k: v for k, v in union_dict.items() if k not in [x["name"] for x in curr]}
        
        print(f"b{b:03d}:")
        print(f"  curr ({len(curr)}): {curr_names}")
        print(f"  p1   ({len(p1)}): {p1_names}")
        print(f"  p2   ({len(p2)}): {p2_names}")
        if missing_from_curr:
            print(f"  MISSING IN CURR: {missing_from_curr}")
        else:
            print(f"  MISSING IN CURR: NONE")
