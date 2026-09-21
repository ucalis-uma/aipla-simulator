"""
research/26_data_integrity/build_templates.py

各種バフスロットのテンプレート画像を保存する。
"""

import os
from PIL import Image

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
CROP_DIR = os.path.join(REPO_ROOT, "research/26_data_integrity/crops_s3")
TMPL_DIR = os.path.join(REPO_ROOT, "research/26_data_integrity/templates")
os.makedirs(TMPL_DIR, exist_ok=True)

# スロット位置
SLOTS = [
    (18, 14, 452, 74),   # 0: 行1左
    (486, 14, 920, 74),  # 1: 行1右
    (18, 86, 452, 146),  # 2: 行2左
    (486, 86, 920, 146), # 3: 行2右
    (18, 158, 452, 218), # 4: 行3左
    (486, 158, 920, 218) # 5: 行3右
]

# 代表画像からテンプレートを切り出し
# 1. L3_beat_024_p1
im = Image.open(os.path.join(CROP_DIR, "L3_beat_024_p1.png"))
im.crop(SLOTS[0]).save(os.path.join(TMPL_DIR, "focus_10.png"))            # 集目 10
im.crop(SLOTS[1]).save(os.path.join(TMPL_DIR, "score_up_7.png"))          # スコア上昇 7
im.crop(SLOTS[2]).save(os.path.join(TMPL_DIR, "stamina_rec_3.png"))       # スタミナ継続回復 3
im.crop(SLOTS[3]).save(os.path.join(TMPL_DIR, "a_score_2.png"))           # Aスキルスコア上昇 2
im.crop(SLOTS[4]).save(os.path.join(TMPL_DIR, "crit_rate_5.png"))         # クリティカル率上昇 5
im.crop(SLOTS[5]).save(os.path.join(TMPL_DIR, "vocal_boost_5.png"))       # ボーカルブースト 5

# 2. L3_beat_024_p2
im2 = Image.open(os.path.join(CROP_DIR, "L3_beat_024_p2.png"))
im2.crop(SLOTS[4]).save(os.path.join(TMPL_DIR, "vocal_up_3.png"))         # ボーカル上昇 3

# 3. L4_beat_024_p1
im4 = Image.open(os.path.join(CROP_DIR, "L4_beat_024_p1.png"))
im4.crop(SLOTS[0]).save(os.path.join(TMPL_DIR, "skill_success_6.png"))    # スキル成功率上昇 6
im4.crop(SLOTS[1]).save(os.path.join(TMPL_DIR, "visual_up_11.png"))       # ビジュアル上昇 11
im4.crop(SLOTS[2]).save(os.path.join(TMPL_DIR, "score_up_2.png"))         # スコア上昇 2
im4.crop(SLOTS[3]).save(os.path.join(TMPL_DIR, "crit_coeff_10.png"))      # クリティカル係数上昇 10
im4.crop(SLOTS[4]).save(os.path.join(TMPL_DIR, "visual_boost_3.png"))     # ビジュアルブースト 3
im4.crop(SLOTS[5]).save(os.path.join(TMPL_DIR, "visual_extreme_10.png"))  # ビジュアル上昇超化 10

# 4. L4_beat_024_p2
im4_2 = Image.open(os.path.join(CROP_DIR, "L4_beat_024_p2.png"))
im4_2.crop(SLOTS[4]).save(os.path.join(TMPL_DIR, "vocal_up_5.png"))       # ボーカル上昇 5

# 5. L4_beat_053_p1
im53 = Image.open(os.path.join(CROP_DIR, "L4_beat_053_p1.png"))
im53.crop(SLOTS[2]).save(os.path.join(TMPL_DIR, "crit_coeff_11.png"))     # クリティカル係数上昇 11
im53.crop(SLOTS[4]).save(os.path.join(TMPL_DIR, "visual_limit_10.png"))    # ビジュアル上昇上限開放 10

# 6. L4_beat_053_p2
im53_2 = Image.open(os.path.join(CROP_DIR, "L4_beat_053_p2.png"))
im53_2.crop(SLOTS[4]).save(os.path.join(TMPL_DIR, "skill_success_3.png")) # スキル成功率上昇 3

# 7. L4_beat_060_p2
im60_2 = Image.open(os.path.join(CROP_DIR, "L4_beat_060_p2.png"))
im60_2.crop(SLOTS[1]).save(os.path.join(TMPL_DIR, "vocal_up_7.png"))       # ボーカル上昇 7

# 8. L3_beat_066_p1
im66 = Image.open(os.path.join(CROP_DIR, "L3_beat_066_p1.png"))
im66.crop(SLOTS[4]).save(os.path.join(TMPL_DIR, "focus_6.png"))           # 集目 6

print("Saved all templates successfully.")
