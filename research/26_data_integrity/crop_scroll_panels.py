"""
research/26_data_integrity/crop_scroll_panels.py

Lane 3 および Lane 4 のスクロール対象ビートについて、
beat_NNN.PNG と beat_NNN_2.PNG の「現在の効果」ウィンドウ（y≈460〜740, x≈20〜980）
をクロップして保存する。
"""

import os
from PIL import Image

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
S3_DIR = os.path.abspath(os.path.join(REPO_ROOT, "../aipura_nox/サンプル3"))
CROP_DIR = os.path.join(REPO_ROOT, "research/26_data_integrity/crops_s3")
os.makedirs(CROP_DIR, exist_ok=True)

# クロップ範囲: x: 30〜970, y: 455〜745
BOX = (30, 455, 970, 745)

for lane in ["3", "4"]:
    lane_dir = os.path.join(S3_DIR, f"lane{lane}")
    if not os.path.exists(lane_dir):
        continue
    for f in os.listdir(lane_dir):
        if "_2.PNG" in f or "_2.png" in f:
            base_name = f.replace("_2.PNG", "").replace("_2.png", "")
            # p1
            p1_path = os.path.join(lane_dir, f"{base_name}.PNG")
            if not os.path.exists(p1_path):
                p1_path = os.path.join(lane_dir, f"{base_name}.png")
            # p2
            p2_path = os.path.join(lane_dir, f)
            
            if os.path.exists(p1_path):
                im1 = Image.open(p1_path).crop(BOX)
                im1.save(os.path.join(CROP_DIR, f"L{lane}_{base_name}_p1.png"))
            if os.path.exists(p2_path):
                im2 = Image.open(p2_path).crop(BOX)
                im2.save(os.path.join(CROP_DIR, f"L{lane}_{base_name}_p2.png"))

print(f"Cropped images saved to {CROP_DIR}")
