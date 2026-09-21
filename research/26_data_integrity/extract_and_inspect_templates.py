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

# テンプレート切り出し関数: crop_img の (x, y) から (w=434, h=60) を切り出す
def extract_tmpl(crop_img, x, y):
    return crop_img[y:y+60, x:x+434]

# 1. 既に確定している画像の読み込みと切り出し
# L4_b010: 行1左=a_score_4, 行1右=score_up_4
im_l4_b10 = cv_imread(os.path.join(s2_nox_path, "lane4/beat_010.PNG"))[box[1]:box[3], box[0]:box[2]]
cv_imwrite(os.path.join(tmpl_dir, "a_score_4.png"), extract_tmpl(im_l4_b10, 18, 29))
cv_imwrite(os.path.join(tmpl_dir, "score_up_4.png"), extract_tmpl(im_l4_b10, 486, 29))

# L1_b005: 行1左=visual_up_5
im_l1_b5 = cv_imread(os.path.join(s2_nox_path, "lane1/beat_005.PNG"))[box[1]:box[3], box[0]:box[2]]
cv_imwrite(os.path.join(tmpl_dir, "visual_up_5.png"), extract_tmpl(im_l1_b5, 18, 29))

# L5_b005: 行1左=visual_up_4
im_l5_b5 = cv_imread(os.path.join(s2_nox_path, "lane5/beat_005.PNG"))[box[1]:box[3], box[0]:box[2]]
cv_imwrite(os.path.join(tmpl_dir, "visual_up_4.png"), extract_tmpl(im_l5_b5, 18, 29))

# L3_b020:
# 行1右=visual_up_7
# 行2左=crit_rate_15
# 行2右=crit_coeff_8
# 行3右=score_up_3
im_l3_b20 = cv_imread(os.path.join(s2_nox_path, "lane3/beat_020.PNG"))[box[1]:box[3], box[0]:box[2]]
cv_imwrite(os.path.join(tmpl_dir, "visual_up_7.png"), extract_tmpl(im_l3_b20, 486, 29))
cv_imwrite(os.path.join(tmpl_dir, "crit_rate_15.png"), extract_tmpl(im_l3_b20, 18, 101))
cv_imwrite(os.path.join(tmpl_dir, "crit_coeff_8.png"), extract_tmpl(im_l3_b20, 486, 101))
cv_imwrite(os.path.join(tmpl_dir, "score_up_3.png"), extract_tmpl(im_l3_b20, 486, 173))

# L3_b020_p2:
# スクロール画像の下段: y≈153, x=18
im_l3_b20_p2 = cv_imread(os.path.join(s2_nox_path, "lane3/beat_020_2.PNG"))[box[1]:box[3], box[0]:box[2]]
# y位置を探索してベストな位置で切り出す
# 'クリティカル係数上昇超化' のアイコンとテキスト
# 試しに y=153 で切り出し
cv_imwrite(os.path.join(tmpl_dir, "crit_coeff_extreme_10.png"), extract_tmpl(im_l3_b20_p2, 18, 153))

# L3_b120:
# 行2右=sp_score_6 (SPスキルスコア上昇 6段階)
im_l3_b120 = cv_imread(os.path.join(s2_nox_path, "lane3/beat_120.PNG"))[box[1]:box[3], box[0]:box[2]]
cv_imwrite(os.path.join(tmpl_dir, "sp_score_6.png"), extract_tmpl(im_l3_b120, 486, 101))

# L3_b001:
# 行1左: skill_success_3 (既にあるが確認)
# 行1右: visual_up_4 (L5_b5のvisual_up_4と照合用)
# 行2左: crit_rate_8
# 行2右: crit_coeff_8
im_l3_b1 = cv_imread(os.path.join(s2_nox_path, "lane3/beat_001.PNG"))[box[1]:box[3], box[0]:box[2]]
cv_imwrite(os.path.join(tmpl_dir, "crit_rate_8.png"), extract_tmpl(im_l3_b1, 18, 101))

print("Initial set of S2 templates created successfully.")
