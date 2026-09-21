"""
research/26_data_integrity/inspect_slots.py

スロット切り出しとテンプレートによる効果名・段階数の自動判定。
"""

import os
from PIL import Image
import numpy as np

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
CROP_DIR = os.path.join(REPO_ROOT, "research/26_data_integrity/crops_s3")
SLOT_DIR = os.path.join(REPO_ROOT, "research/26_data_integrity/slot_samples")
os.makedirs(SLOT_DIR, exist_ok=True)

# クロップ画像内のスロット位置（y: 10〜240, x: 20〜920）
# 各スロットはおよそ 幅 440, 高さ 60
SLOTS = [
    (18, 14, 452, 74),   # 0: 行1左
    (486, 14, 920, 74),  # 1: 行1右
    (18, 86, 452, 146),  # 2: 行2左
    (486, 86, 920, 146), # 3: 行2右
    (18, 158, 452, 218), # 4: 行3左
    (486, 158, 920, 218) # 5: 行3右
]

# テストでいくつかのスロットを保存
im = Image.open(os.path.join(CROP_DIR, "L3_beat_024_p1.png"))
for i, box in enumerate(SLOTS):
    slot_im = im.crop(box)
    slot_im.save(os.path.join(SLOT_DIR, f"test_slot_{i}.png"))

print("Saved test slots.")
