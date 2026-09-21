import os, cv2, json, sys
import numpy as np

sys.stdout.reconfigure(encoding="utf-8")

repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
s2_nox_path = os.path.abspath(os.path.join(repo_root, "../aipura_nox/サンプル2"))
tmpl_dir = os.path.abspath(os.path.join(repo_root, "research/26_data_integrity/templates"))
s2_sim_path = os.path.join(repo_root, "research/20_sample2_gap_analysis/sim_trace_full.json")
box = (30, 455, 970, 745)

TEMPLATES = {
    "focus_10.png": {"name": "集目", "stage": 10},
    "focus_6.png": {"name": "集目", "stage": 6},
    "score_up_7.png": {"name": "スコア上昇", "stage": 7},
    "score_up_4.png": {"name": "スコア上昇", "stage": 4},
    "score_up_3.png": {"name": "スコア上昇", "stage": 3},
    "score_up_2.png": {"name": "スコア上昇", "stage": 2},
    "stamina_rec_3.png": {"name": "スタミナ継続回復", "stage": 3},
    "a_score_4.png": {"name": "Aスキルスコア上昇", "stage": 4},
    "a_score_2.png": {"name": "Aスキルスコア上昇", "stage": 2},
    "sp_score_6.png": {"name": "SPスキルスコア上昇", "stage": 6},
    "crit_rate_15.png": {"name": "クリティカル率上昇", "stage": 15},
    "crit_rate_8.png": {"name": "クリティカル率上昇", "stage": 8},
    "crit_rate_7.png": {"name": "クリティカル率上昇", "stage": 7},
    "crit_rate_5.png": {"name": "クリティカル率上昇", "stage": 5},
    "crit_coeff_13.png": {"name": "クリティカル係数上昇", "stage": 13},
    "crit_coeff_11.png": {"name": "クリティカル係数上昇", "stage": 11},
    "crit_coeff_10.png": {"name": "クリティカル係数上昇", "stage": 10},
    "crit_coeff_8.png": {"name": "クリティカル係数上昇", "stage": 8},
    "crit_coeff_extreme_10.png": {"name": "クリティカル係数上昇超化", "stage": 10},
    "vocal_boost_5.png": {"name": "ボーカルブースト", "stage": 5},
    "vocal_up_7.png": {"name": "ボーカル上昇", "stage": 7},
    "vocal_up_5.png": {"name": "ボーカル上昇", "stage": 5},
    "vocal_up_3.png": {"name": "ボーカル上昇", "stage": 3},
    "skill_success_6.png": {"name": "スキル成功率上昇", "stage": 6},
    "skill_success_3.png": {"name": "スキル成功率上昇", "stage": 3},
    "visual_boost_3.png": {"name": "ビジュアルブースト", "stage": 3},
    "visual_extreme_10.png": {"name": "ビジュアル上昇超化", "stage": 10},
    "visual_limit_10.png": {"name": "ビジュアル上昇上限開放", "stage": 10},
    "visual_up_20.png": {"name": "ビジュアル上昇", "stage": 20},
    "visual_up_16.png": {"name": "ビジュアル上昇", "stage": 16},
    "visual_up_13.png": {"name": "ビジュアル上昇", "stage": 13},
    "visual_up_11.png": {"name": "ビジュアル上昇", "stage": 11},
    "visual_up_9.png": {"name": "ビジュアル上昇", "stage": 9},
    "visual_up_8.png": {"name": "ビジュアル上昇", "stage": 8},
    "visual_up_7.png": {"name": "ビジュアル上昇", "stage": 7},
    "visual_up_5.png": {"name": "ビジュアル上昇", "stage": 5},
    "visual_up_4.png": {"name": "ビジュアル上昇", "stage": 4},
}

def cv_imread(p):
    return cv2.imdecode(np.fromfile(p, dtype=np.uint8), cv2.IMREAD_COLOR)

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
    # 高スコア順に重複排除
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
    crop = img[box[1]:box[3], box[0]:box[2]]
    col_left = crop[0:285, 10:470]
    col_right = crop[0:285, 475:935]
    res_left = scan_column(col_left, 10)
    res_right = scan_column(col_right, 475)
    all_res = res_left + res_right
    all_res.sort(key=lambda x: (x["y"] // 50, x["x"]))
    return all_res

def extract_beat_lane_buffs(lane, beat):
    p1_path = os.path.join(s2_nox_path, f"lane{lane}", f"beat_{beat:03d}.PNG")
    p2_path = os.path.join(s2_nox_path, f"lane{lane}", f"beat_{beat:03d}_2.PNG")
    
    p1_res = scan_image(p1_path)
    p2_res = scan_image(p2_path) if os.path.exists(p2_path) else []
    
    # マージ
    all_detected = {}
    for x in p1_res + p2_res:
        name = x["name"]
        if name not in all_detected or x["score"] > all_detected[name]["score"]:
            all_detected[name] = x
            
    # 整列して出力
    res = []
    for name, info in sorted(all_detected.items()):
        res.append({
            "name": name,
            "stage": info["stage"],
            "score": round(info["score"], 3)
        })
    return res

# テスト実行
with open(s2_sim_path, "r", encoding="utf-8") as f:
    sim_data = json.load(f)
sim_beats = {b["beat"]: b for b in sim_data.get("beats", [])}

NAME_MAP = {
    "ビジュアル上昇": "visual_up",
    "クリティカル率上昇": "critical_rate_up",
    "クリティカル係数上昇": "critical_coeff_up",
    "スコア上昇": "score_up",
    "Aスキルスコア上昇": "a_skill_score_up",
    "SPスキルスコア上昇": "sp_skill_score_up",
    "スキル成功率上昇": "skill_success_up",
    "集目": "focus",
    "クリティカル係数上昇超化": "critical_coeff_limit",
    "ビジュアル上昇超化": "visual_up_extreme",
    "ビジュアル上昇上限開放": "visual_limit",
}

test_beats = [1, 2, 5, 10, 15, 20, 28, 35, 45, 47, 72, 85, 90, 105, 120, 150]
print("=== S2 Buffer Extraction Test on Sample Beats ===")

for b in test_beats:
    print(f"\n--- Beat {b:03d} ---")
    sb = sim_beats.get(b, {})
    for lane in range(1, 6):
        extracted = extract_beat_lane_buffs(lane, b)
        s_snap = sb.get("buffSnapshots", [{} for _ in range(5)])[lane - 1]
        
        # 比較
        ext_summary = {NAME_MAP.get(x["name"], x["name"]): x["stage"] for x in extracted}
        sim_summary = {k: v for k, v in s_snap.items() if v > 0}
        
        if ext_summary or sim_summary:
            print(f"  Lane {lane}:")
            print(f"    Measured Extracted: {ext_summary}")
            print(f"    Simulator Expected: {sim_summary}")
