import cv2, os, numpy as np

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
CROP_DIR = os.path.join(REPO_ROOT, "research/26_data_integrity/crops_s3")
TMPL_DIR = os.path.join(REPO_ROOT, "research/26_data_integrity/templates")

def cv_imread(p):
    return cv2.imdecode(np.fromfile(p, dtype=np.uint8), cv2.IMREAD_COLOR)

tmpls = {}
for f in os.listdir(TMPL_DIR):
    if f.endswith(".png"):
        tmpls[f] = cv_imread(os.path.join(TMPL_DIR, f))

for b in [61, 70]:
    p = os.path.join(CROP_DIR, f"L4_beat_{b:03d}_p2.png")
    img = cv_imread(p)
    print(f"=== BEAT {b} p2 ===")
    matches = []
    for name, tmpl in tmpls.items():
        res = cv2.matchTemplate(img, tmpl, cv2.TM_CCOEFF_NORMED)
        min_v, max_v, min_l, max_l = cv2.minMaxLoc(res)
        if max_v > 0.6:
            matches.append((name, max_v, max_l))
    matches.sort(key=lambda x: -x[1])
    for m in matches[:10]:
        print(f"  {m[0]}: score={m[1]:.3f} at {m[2]}")
