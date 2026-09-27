# -*- coding: utf-8 -*-
"""b53_2 / b55_2 / b56_2 の効果パネル領域をクロップして比較用に保存"""
import cv2
import os

BASE = '../aipura_nox/サンプル3/lane4'
OUT = 'research/26_data_integrity/target_crops'
os.makedirs(OUT, exist_ok=True)

for b in [53, 55, 56, 57]:
    p = os.path.join(BASE, f'beat_{b:03d}_2.PNG')
    if not os.path.exists(p):
        p = os.path.join(BASE, f'beat_{b:03d}.PNG')
    img = cv2.imread(p)
    if img is None:
        print(f'b{b}: read fail')
        continue
    h, w = img.shape[:2]
    crop = img[480:720, 0:w]  # 効果パネル帯
    out = os.path.join(OUT, f'stepb_b{b}_panel.png')
    cv2.imwrite(out, crop)
    print(f'b{b}: {img.shape} -> {out} src={p}')
