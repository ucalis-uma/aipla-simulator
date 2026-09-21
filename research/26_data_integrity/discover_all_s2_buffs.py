import os, cv2, json
import numpy as np

def cv_imread(p):
    return cv2.imdecode(np.fromfile(p, dtype=np.uint8), cv2.IMREAD_COLOR)

def cv_imwrite(p, img):
    _, ext = os.path.splitext(p)
    cv2.imencode(ext, img)[1].tofile(p)

repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
s2_nox_path = os.path.abspath(os.path.join(repo_root, "../aipura_nox/サンプル2"))
tmpl_dir = os.path.abspath(os.path.join(repo_root, "research/26_data_integrity/templates"))
box = (30, 455, 970, 745)

# スロット固定座標（1ページ目）
# 行1: y=29, 行2: y=101, 行3: y=173
# 左列: x=18, 右列: x=486
SLOT_POSITIONS = [
    (18, 29),
    (486, 29),
    (18, 101),
    (486, 101),
    (18, 173),
    (486, 173),
]

# 現在登録済みのテンプレートを読み込む
KNOWN_TEMPLATES = {
    # 既存 S3 由来
    "focus_6.png": ("集目", 6),
    "focus_10.png": ("集目", 10),
    "skill_success_3.png": ("スキル成功率上昇", 3),
    "skill_success_6.png": ("スキル成功率上昇", 6),
    "visual_up_11.png": ("ビジュアル上昇", 11),
    "visual_extreme_10.png": ("ビジュアル上昇超化", 10),
    "visual_limit_10.png": ("ビジュアル上昇上限開放", 10),
    # 今回追加したもの
    "score_up_3.png": ("スコア上昇", 3),
    "score_up_4.png": ("スコア上昇", 4),
    "a_score_4.png": ("Aスキルスコア上昇", 4),
    "sp_score_6.png": ("SPスキルスコア上昇", 6),
    "visual_up_4.png": ("ビジュアル上昇", 4),
    "visual_up_5.png": ("ビジュアル上昇", 5),
    "visual_up_7.png": ("ビジュアル上昇", 7),
    "crit_rate_8.png": ("クリティカル率上昇", 8),
    "crit_rate_15.png": ("クリティカル率上昇", 15),
    "crit_coeff_8.png": ("クリティカル係数上昇", 8),
    "crit_coeff_extreme_10.png": ("クリティカル係数上昇超化", 10),
}

tmpl_imgs = {}
for fname, info in KNOWN_TEMPLATES.items():
    p = os.path.join(tmpl_dir, fname)
    if os.path.exists(p):
        tmpl_imgs[fname] = cv_imread(p)

print(f"Loaded {len(tmpl_imgs)} known templates.")

# 全画像をスキャンして、既知テンプレートでマッチしない「未マッチの有効スロット」を洗い出す
unmatched_slots = []

for lane in range(1, 6):
    lane_dir = os.path.join(s2_nox_path, f"lane{lane}")
    files = sorted(os.listdir(lane_dir))
    for f in files:
        if not f.endswith(".PNG"): continue
        im = cv_imread(os.path.join(lane_dir, f))
        if im is None: continue
        crop = im[box[1]:box[3], box[0]:box[2]]
        
        is_p2 = "_2" in f
        # スキャンする行の y 座標
        # p2 の場合も列全体スキャンで対応できるが、まずは代表スロット位置を調査
        # 列ごとにスキャン
        col_left = crop[5:245, 10:470]
        col_right = crop[5:245, 475:935]
        
        for col_idx, (col_img, x_offset) in enumerate([(col_left, 10), (col_right, 475)]):
            # 有効なスロット（青いアイコンまたは超アイコン）を探す
            # スロットの高さを 60px として、y を 0 から step 10 で探索
            for y in range(10, col_img.shape[0] - 60, 20):
                slot_candidate = col_img[y:y+60, 8:442]
                icon = slot_candidate[8:52, 10:55]
                # 有効アイコン判定
                b_ch = icon[:, :, 0]
                r_ch = icon[:, :, 2]
                is_icon = (np.mean(b_ch) > 80 and np.mean(b_ch.astype(int) - r_ch.astype(int)) > 25) or np.std(icon) > 35
                if not is_icon:
                    continue
                
                # 既知テンプレートとの最大マッチ度を計算
                max_score = 0.0
                best_t = None
                for tname, tmpl in tmpl_imgs.items():
                    res = cv2.matchTemplate(slot_candidate, tmpl, cv2.TM_CCOEFF_NORMED)
                    score = float(res[0, 0]) if res.shape == (1, 1) else float(np.max(res))
                    if score > max_score:
                        max_score = score
                        best_t = tname
                
                if max_score < 0.88:
                    unmatched_slots.append({
                        "lane": lane,
                        "file": f,
                        "col": col_idx,
                        "y": y,
                        "x": x_offset,
                        "max_score": max_score,
                        "best_t": best_t,
                        "slot_img": slot_candidate
                    })

print(f"Total unmatched candidate occurrences: {len(unmatched_slots)}")

# 未マッチ候補を重複排除（似た画像ごとにグループ化）して保存
out_unmatched = os.path.abspath(os.path.join(repo_root, "research/26_data_integrity/unmatched_slots"))
os.makedirs(out_unmatched, exist_ok=True)

saved_groups = []
for item in unmatched_slots:
    s_img = item["slot_img"]
    # 既存の saved_groups と比較
    matched = False
    for g_idx, g_img in enumerate(saved_groups):
        res = cv2.matchTemplate(s_img, g_img, cv2.TM_CCOEFF_NORMED)
        if np.max(res) > 0.90:
            matched = True
            break
    if not matched:
        saved_groups.append(s_img)
        idx = len(saved_groups)
        fn = f"unmatched_{idx:02d}_L{item['lane']}_{item['file']}_y{item['y']}_best_{item['best_t']}_{item['max_score']:.2f}.png"
        cv_imwrite(os.path.join(out_unmatched, fn), s_img)
        print(f"Found new unique unmatched slot -> saved as {fn}")

print(f"\nDiscovered {len(saved_groups)} unique new slot types.")
