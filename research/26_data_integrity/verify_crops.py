"""
research/26_data_integrity/verify_crops.py

Lane 3 および Lane 4 のスクロール対象ビートについて、
p1 と p2 の画像の差異、および各ビートで何が写っているかを検証する。
"""

import os
import json
from PIL import Image
import numpy as np

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
CROP_DIR = os.path.join(REPO_ROOT, "research/26_data_integrity/crops_s3")

# Lane 3 の b24〜b31 を確認
print("=== Lane 3 b24-b31 ===")
for b in range(24, 32):
    p1 = os.path.join(CROP_DIR, f"L3_beat_{b:03d}_p1.png")
    p2 = os.path.join(CROP_DIR, f"L3_beat_{b:03d}_p2.png")
    print(f"b{b:03d}: p1 exists={os.path.exists(p1)}, p2 exists={os.path.exists(p2)}")

# Lane 3 の b50〜b66 を確認
print("\n=== Lane 3 b50-b66 ===")
for b in range(50, 67):
    p1 = os.path.join(CROP_DIR, f"L3_beat_{b:03d}_p1.png")
    p2 = os.path.join(CROP_DIR, f"L3_beat_{b:03d}_p2.png")
    print(f"b{b:03d}: p1 exists={os.path.exists(p1)}, p2 exists={os.path.exists(p2)}")

# Lane 4 の各区間を確認
print("\n=== Lane 4 ===")
for b in [24, 25, 26, 27, 28, 53, 54, 55, 56] + list(range(60, 72)):
    p1 = os.path.join(CROP_DIR, f"L4_beat_{b:03d}_p1.png")
    p2 = os.path.join(CROP_DIR, f"L4_beat_{b:03d}_p2.png")
    print(f"b{b:03d}: p1 exists={os.path.exists(p1)}, p2 exists={os.path.exists(p2)}")
