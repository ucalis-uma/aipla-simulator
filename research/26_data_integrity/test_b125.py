import os, cv2, json
import numpy as np

def cv_imread(p):
    return cv2.imdecode(np.fromfile(p, dtype=np.uint8), cv2.IMREAD_COLOR)

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
S2_NOX_DIR = os.path.abspath(os.path.join(REPO_ROOT, "../aipura_nox/サンプル2"))
TMPL_DIR = os.path.abspath(os.path.join(REPO_ROOT, "research/26_data_integrity/templates"))
BOX = (30, 455, 970, 745)

import importlib.util
spec = importlib.util.spec_from_file_location("extract_s2", os.path.join(REPO_ROOT, "research/26_data_integrity/extract_all_s2_buffs.py"))
ext_mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ext_mod)
TEMPLATES_INFO = ext_mod.TEMPLATES_INFO

tmpls = {}
for fname, info in TEMPLATES_INFO.items():
    p = os.path.join(TMPL_DIR, fname)
    if os.path.exists(p):
        tmpls[fname] = (cv_imread(p), info["name"], info["stage"])

p1_path = os.path.join(S2_NOX_DIR, "lane3", "beat_136.PNG")
crop = cv_imread(p1_path)[BOX[1]:BOX[3], BOX[0]:BOX[2]]
col_left = crop[0:285, 10:470]

res_left = ext_mod.scan_column(col_left, 10, tmpls)
print("Beat 125 Left Column Kept:")
for k in res_left:
    print(f"  {k['name']} stage={k['stage']} score={k['score']:.4f} at (x={k['x']}, y={k['y']})")
