import os, cv2, json
import numpy as np

def cv_imread(p):
    return cv2.imdecode(np.fromfile(p, dtype=np.uint8), cv2.IMREAD_COLOR)

repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
cand_dir = os.path.join(repo_root, "research/26_data_integrity/slot_candidates")
tmpl_dir = os.path.join(repo_root, "research/26_data_integrity/templates")

# 既存テンプレート
TEMPLATES = {
    "focus_10.png": ("集目", 10),
    "focus_6.png": ("集目", 6),
    "score_up_7.png": ("スコア上昇", 7),
    "score_up_2.png": ("スコア上昇", 2),
    "stamina_rec_3.png": ("スタミナ継続回復", 3),
    "a_score_2.png": ("Aスキルスコア上昇", 2),
    "crit_rate_5.png": ("クリティカル率上昇", 5),
    "vocal_boost_5.png": ("ボーカルブースト", 5),
    "vocal_up_3.png": ("ボーカル上昇", 3),
    "vocal_up_5.png": ("ボーカル上昇", 5),
    "vocal_up_7.png": ("ボーカル上昇", 7),
    "skill_success_6.png": ("スキル成功率上昇", 6),
    "skill_success_3.png": ("スキル成功率上昇", 3),
    "visual_up_11.png": ("ビジュアル上昇", 11),
    "crit_coeff_10.png": ("クリティカル係数上昇", 10),
    "crit_coeff_11.png": ("クリティカル係数上昇", 11),
    "visual_boost_3.png": ("ビジュアルブースト", 3),
    "visual_extreme_10.png": ("ビジュアル上昇超化", 10),
    "visual_limit_10.png": ("ビジュアル上昇上限開放", 10),
}

# アイコン + テキスト部分（段階数の青四角以外）でバフ種別を特定する
# x: 135〜350 はバフ名テキスト
# 既存テンプレートからテキスト領域を切り出してバフ名辞書を作成
text_tmpls = {}
for fname, (name, stage) in TEMPLATES.items():
    p = os.path.join(tmpl_dir, fname)
    if os.path.exists(p):
        t_img = cv_imread(p)
        # テキスト領域: y: 15..50, x: 135..350
        # 名前ごとに代表1つを保持
        if name not in text_tmpls:
            text_tmpls[name] = t_img[15:50, 135:350]

print("Text templates available:", list(text_tmpls.keys()))

# 各 candidate について、テキスト領域でバフ名を推定
results = []
for f in sorted(os.listdir(cand_dir)):
    if not f.endswith(".png"): continue
    im = cv_imread(os.path.join(cand_dir, f))
    icon = im[8:52, 10:55]
    if np.std(icon) < 25:
        continue
    
    # テキストマッチング
    cand_text = im[15:50, 135:350]
    best_name = None
    best_score = -1.0
    for name, t_crop in text_tmpls.items():
        # サイズを合わせる
        h = min(cand_text.shape[0], t_crop.shape[0])
        w = min(cand_text.shape[1], t_crop.shape[1])
        c_sub = cand_text[:h, :w]
        t_sub = t_crop[:h, :w]
        res = cv2.matchTemplate(c_sub, t_sub, cv2.TM_CCOEFF_NORMED)
        score = float(res[0, 0])
        if score > best_score:
            best_score = score
            best_name = name
            
    results.append((f, best_name, best_score))

print(f"\nClassified {len(results)} valid candidate slots.")
# 結果のサンプル表示
for f, name, score in results[:30]:
    print(f"  {f:25s} -> {name} (score={score:.2f})")
