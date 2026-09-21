import os, cv2, json
import numpy as np

repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
crop_dir = os.path.join(repo_root, "research/26_data_integrity/crops_s2_preview")
tmpl_dir = os.path.join(repo_root, "research/26_data_integrity/templates")

def cv_imread(p):
    return cv2.imdecode(np.fromfile(p, dtype=np.uint8), cv2.IMREAD_COLOR)

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

tmpl_imgs = {}
for fname, info in TEMPLATES.items():
    p = os.path.join(tmpl_dir, fname)
    if os.path.exists(p):
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
    col_left = img[0:285, 10:470]
    col_right = img[0:285, 475:935]
    res_left = scan_column(col_left, 10)
    res_right = scan_column(col_right, 475)
    all_res = res_left + res_right
    all_res.sort(key=lambda x: (x["y"] // 50, x["x"]))
    return all_res

print("=== Test Scanning S2 Preview Crops with Existing Templates ===")
for crop_fn in sorted(os.listdir(crop_dir)):
    if not crop_fn.endswith(".png"): continue
    cp = os.path.join(crop_dir, crop_fn)
    matches = scan_image(cp)
    if matches:
        print(f"{crop_fn}:")
        for m in matches:
            print(f"  {m['name']} {m['stage']} (score={m['score']:.2f}, x={m['x']}, y={m['y']})")
