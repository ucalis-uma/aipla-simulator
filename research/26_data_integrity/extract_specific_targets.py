import os, cv2, json
import numpy as np

def cv_imread(p):
    return cv2.imdecode(np.fromfile(p, dtype=np.uint8), cv2.IMREAD_COLOR)

def cv_imwrite(p, img):
    _, ext = os.path.splitext(p)
    cv2.imencode(ext, img)[1].tofile(p)

repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
s2_nox_path = os.path.abspath(os.path.join(repo_root, "../aipura_nox/サンプル2"))
out_dir = os.path.abspath(os.path.join(repo_root, "research/26_data_integrity/target_crops"))
os.makedirs(out_dir, exist_ok=True)
box = (30, 455, 970, 745)

# 調査したいビート
# b15: crit_coeff_13
# b28: visual_up_16
# b35: visual_up_13
# b45: crit_rate_7
# b47: visual_up_9
# b72: visual_up_20
# b85: visual_up_8
beats = [15, 28, 35, 45, 47, 72, 85]

for b in beats:
    p1 = os.path.join(s2_nox_path, "lane3", f"beat_{b:03d}.PNG")
    if os.path.exists(p1):
        im = cv_imread(p1)[box[1]:box[3], box[0]:box[2]]
        cv_imwrite(os.path.join(out_dir, f"L3_b{b:03d}_p1.png"), im)
    p2 = os.path.join(s2_nox_path, "lane3", f"beat_{b:03d}_2.PNG")
    if os.path.exists(p2):
        im2 = cv_imread(p2)[box[1]:box[3], box[0]:box[2]]
        cv_imwrite(os.path.join(out_dir, f"L3_b{b:03d}_p2.png"), im2)

print("Saved target beat crops to", out_dir)
