# -*- coding: utf-8 -*-
"""crops_s3 の L4 b24/25/56/60/61/63/70 と L3 相当を既存スキャナで再スキャンし、
誤認（ボーカルブースト5段）のスコアと真のボーカル上昇5段のスコアを比較する。"""
import os
import json
import sys
import cv2
import numpy as np

sys.stdout.reconfigure(encoding="utf-8")

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
CROP_DIR = os.path.join(REPO_ROOT, "research/26_data_integrity/crops_s3")
TMPL_DIR = os.path.join(REPO_ROOT, "research/26_data_integrity/templates")

TEMPLATES = {
    "focus_10.png": "集目10",
    "score_up_7.png": "スコア上昇7",
    "score_up_2.png": "スコア上昇2",
    "stamina_rec_3.png": "スタミナ継続回復3",
    "a_score_2.png": "Aスキルスコア上昇2",
    "crit_rate_5.png": "クリティカル率上昇5",
    "vocal_boost_5.png": "ボーカルブースト5",
    "vocal_up_3.png": "ボーカル上昇3",
    "vocal_up_5.png": "ボーカル上昇5",
    "vocal_up_7.png": "ボーカル上昇7",
    "skill_success_6.png": "スキル成功率上昇6",
    "skill_success_3.png": "スキル成功率上昇3",
    "visual_up_11.png": "ビジュアル上昇11",
    "crit_coeff_10.png": "クリティカル係数上昇10",
    "crit_coeff_11.png": "クリティカル係数上昇11",
    "visual_boost_3.png": "ビジュアルブースト3",
    "visual_extreme_10.png": "ビジュアル上昇超化10",
    "visual_limit_10.png": "ビジュアル上昇上限開放10",
}


def cv_imread(p):
    return cv2.imdecode(np.fromfile(p, dtype=np.uint8), cv2.IMREAD_COLOR)


tmpl_imgs = {f: cv_imread(os.path.join(TMPL_DIR, f)) for f in TEMPLATES}


def scan(img_path):
    img = cv_imread(img_path)
    if img is None:
        return None
    out = []
    for x0, x1 in [(10, 470), (475, 935)]:
        col = img[0:285, x0:x1]
        for fname, tmpl in tmpl_imgs.items():
            if tmpl is None:
                continue
            res = cv2.matchTemplate(col, tmpl, cv2.TM_CCOEFF_NORMED)
            _, mx, _, mloc = cv2.minMaxLoc(res)
            out.append((TEMPLATES[fname], round(float(mx), 4), mloc[0] + x0, mloc[1], fname))
    out.sort(key=lambda r: -r[1])
    return out


for beat in [24, 25, 56, 60, 61, 63, 70]:
    for p in ["p1", "p2"]:
        path = os.path.join(CROP_DIR, f"L4_beat_{beat:03d}_{p}.png")
        if not os.path.exists(path):
            print(f"b{beat} {p}: NO CROP")
            continue
        rows = scan(path)
        top = [r for r in rows if r[1] >= 0.80]
        print(f"b{beat} {p}:", [(r[0], r[1], f"({r[2]},{r[3]})") for r in top])
