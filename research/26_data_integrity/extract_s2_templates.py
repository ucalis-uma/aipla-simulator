import os, json, cv2
import numpy as np

def cv_imread(p):
    return cv2.imdecode(np.fromfile(p, dtype=np.uint8), cv2.IMREAD_COLOR)

def cv_imwrite(p, img):
    _, ext = os.path.splitext(p)
    cv2.imencode(ext, img)[1].tofile(p)

repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
s2_nox_path = os.path.abspath(os.path.join(repo_root, "../aipura_nox/サンプル2"))
out_dir = os.path.abspath(os.path.join(repo_root, "research/26_data_integrity/slot_candidates"))
os.makedirs(out_dir, exist_ok=True)

box = (30, 455, 970, 745)
slots = [
    (18, 14, 452, 74),   # 0: 行1左
    (486, 14, 920, 74),  # 1: 行1右
    (18, 86, 452, 146),  # 2: 行2左
    (486, 86, 920, 146), # 3: 行2右
    (18, 158, 452, 218), # 4: 行3左
    (486, 158, 920, 218) # 5: 行3右
]

# 切り出したい対象ビートとレーン
targets = [
    (4, 2, "L4_b002"),
    (4, 10, "L4_b010"),
    (1, 1, "L1_b001"),
    (1, 5, "L1_b005"),
    (5, 2, "L5_b002"),
    (5, 5, "L5_b005"),
    (3, 1, "L3_b001"),
    (3, 2, "L3_b002"),
    (3, 5, "L3_b005"),
    (3, 6, "L3_b006"),
    (3, 15, "L3_b015"),
    (3, 20, "L3_b020"),
    (3, 23, "L3_b023"),
    (3, 28, "L3_b028"),
    (3, 35, "L3_b035"),
    (3, 45, "L3_b045"),
    (3, 47, "L3_b047"),
    (3, 72, "L3_b072"),
    (3, 85, "L3_b085"),
    (3, 90, "L3_b090"),
    (3, 91, "L3_b091"),
    (3, 120, "L3_b120"),
]

for lane, b, tag in targets:
    p = os.path.join(s2_nox_path, f"lane{lane}", f"beat_{b:03d}.PNG")
    if not os.path.exists(p):
        continue
    img = cv_imread(p)
    crop = img[box[1]:box[3], box[0]:box[2]]
    for s_idx, (x1, y1, x2, y2) in enumerate(slots):
        s_img = crop[y1:y2, x1:x2]
        # 背景枠があるか簡易チェック（青色成分など）
        icon_area = s_img[8:52, 10:55]
        b_ch = icon_area[:, :, 0]
        r_ch = icon_area[:, :, 2]
        if np.mean(b_ch) > 80 and np.mean(b_ch - r_ch) > 30:
            fn = f"{tag}_slot{s_idx}.png"
            cv_imwrite(os.path.join(out_dir, fn), s_img)

# Lane 3 の p2 (スクロール画像) からも切り出す
for b in [15, 20, 28, 35, 90, 120]:
    p = os.path.join(s2_nox_path, "lane3", f"beat_{b:03d}_2.PNG")
    if not os.path.exists(p):
        continue
    img = cv_imread(p)
    crop = img[box[1]:box[3], box[0]:box[2]]
    for s_idx, (x1, y1, x2, y2) in enumerate(slots):
        s_img = crop[y1:y2, x1:x2]
        icon_area = s_img[8:52, 10:55]
        b_ch = icon_area[:, :, 0]
        r_ch = icon_area[:, :, 2]
        if np.mean(b_ch) > 80 and np.mean(b_ch - r_ch) > 30:
            fn = f"L3_b{b:03d}_p2_slot{s_idx}.png"
            cv_imwrite(os.path.join(out_dir, fn), s_img)

print("Saved slot candidates to", out_dir)
