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
        tmpls[fname] = (cv_imread(p), info['name'], info['stage'])

p1_path = os.path.join(S2_NOX_DIR, 'lane3', 'beat_085.PNG')
crop = cv_imread(p1_path)[BOX[1]:BOX[3], BOX[0]:BOX[2]]
col_right = crop[0:285, 475:935]

found = []
for fname, (tmpl, name, stage) in tmpls.items():
    res = cv2.matchTemplate(col_right, tmpl, cv2.TM_CCOEFF_NORMED)
    loc = np.where(res >= 0.85)
    for pt in zip(*loc[::-1]):
        score = float(res[pt[1], pt[0]])
        found.append({
            'fname': fname,
            'name': name,
            'stage': stage,
            'score': score,
            'x': pt[0] + 475,
            'y': pt[1],
        })

print(f"Total matches >= 0.85 on col_right: {len(found)}")
row1_matches = [m for m in found if 10 <= m['y'] <= 50]
row1_matches.sort(key=lambda x: -x['score'])
print("\nMatches at Row 1 (y ≈ 29):")
for m in row1_matches:
    print(f"  {m['fname']:22s} stage={m['stage']:2d} score={m['score']:.4f} at (x={m['x']}, y={m['y']})")

found.sort(key=lambda x: -x['score'])
kept = []
for c in found:
    if any(abs(c['y'] - k['y']) < 20 for k in kept):
        continue
    kept.append(c)

print("\nKept by scan_column:")
for k in kept:
    print(f"  {k['fname']:22s} {k['name']} stage={k['stage']:2d} score={k['score']:.4f} at (x={k['x']}, y={k['y']})")
