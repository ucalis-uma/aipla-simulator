# -*- coding: utf-8 -*-
"""
レーン別スコアポップ読取用クロップシート生成（全フレームモード）

各フレーム(beat_NNN[_M].PNG)から 3 クロップを 1 ブロックに合成する:
  pop  : フォーカス中レーンのスコアポップ領域（大きく表示されるカードの右上・固定位置）
  name : フォーカス中アイドル名＋ステータス行（同カード下部）→ レーン同定用
  beat : 譜面右の BEAT カウンタ → ファイル名 beat_NNN との照合用
ブロック 9 個/シート (3x3)。manifest.json（シート→ブロック対応）を併せて出力する。

使い方: python tools/backfill/make_pop_sheets.py <sample_dir> <out_dir> --prefix S4
"""
import json, os, re, sys, argparse
from PIL import Image, ImageDraw, ImageFont

# 1080x1920 用クロップ座標（S4 スクショで実測）
CROPS = {
    "pop":  (600, 90, 1078, 265),
    "name": (30, 380, 730, 455),
    "beat": (940, 780, 1080, 935),
}
SCALE = 0.85
PER_SHEET = 9  # 3x3
BLOCK_W = 700
LABEL_H = 26
GAP = 4
COLS = 3


def load_font(size):
    try:
        return ImageFont.load_default(size)
    except TypeError:
        return ImageFont.load_default()


def frames_index(sample_dir):
    """folder_lane -> [ファイル名...]（beat 番号昇順・素の beat_NNN を先に）"""
    out = {}
    for L in range(1, 6):
        ld = os.path.join(sample_dir, f"lane{L}")
        if not os.path.isdir(ld):
            continue
        fs = []
        for f in os.listdir(ld):
            if re.match(r"^beat_\d+(?:_\d+)?\.PNG$", f):
                fs.append(f)
        fs.sort(key=lambda f: (int(re.match(r"^beat_(\d+)", f).group(1)), f))
        out[L] = fs
    return out


def make_block(img, label, font):
    crops = [img.crop(CROPS[k]) for k in ("pop", "name", "beat")]
    h = LABEL_H + sum(c.height for c in crops) + GAP * (len(crops) + 1)
    block = Image.new("RGB", (BLOCK_W, h), "white")
    d = ImageDraw.Draw(block)
    d.rectangle([0, 0, BLOCK_W - 1, LABEL_H - 1], fill=(20, 20, 20))
    d.text((6, 4), label, fill="white", font=font)
    y = LABEL_H + GAP
    for c in crops:
        block.paste(c, (0, y))
        y += c.height + GAP
    return block.resize((int(block.width * SCALE), int(block.height * SCALE)), Image.LANCZOS)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("sample_dir")
    ap.add_argument("out_dir")
    ap.add_argument("--prefix", required=True)
    ap.add_argument("--beats", default=None, help="カンマ区切り beat 番号でフレームを絞る（例: 0,1,2,14）")
    args = ap.parse_args()

    sys.stdout.reconfigure(encoding="utf-8")
    sheets_dir = os.path.join(args.out_dir, "sheets")
    os.makedirs(sheets_dir, exist_ok=True)

    with open(os.path.join(args.sample_dir, "measured_data.json"), encoding="utf-8") as f:
        data = json.load(f)
    idol_map = {str(ch["lane"]): ch["idol_name"] for ch in data.get("characters", []) if ch.get("lane")}

    idx = frames_index(args.sample_dir)
    if args.beats:
        wanted = {int(x) for x in args.beats.split(",")}
        idx = {L: [f for f in fs if int(re.match(r"^beat_(\d+)", f).group(1)) in wanted]
               for L, fs in idx.items()}
    font = load_font(22)

    entries = []
    for L in range(1, 6):
        for f in idx.get(L, []):
            entries.append({"block": f"L{L}_{f[:-4]}", "folder_lane": L, "file": f,
                            "path": os.path.join(args.sample_dir, f"lane{L}", f)})

    sheets = []
    for si in range(0, len(entries), PER_SHEET):
        chunk = entries[si:si + PER_SHEET]
        blocks = [make_block(Image.open(e["path"]), f"{e['block']} {e['file']}", font) for e in chunk]
        bw = max(b.width for b in blocks)
        bh = max(b.height for b in blocks)
        M = 8
        rows = (len(blocks) + COLS - 1) // COLS
        sheet = Image.new("RGB", (M + COLS * (bw + M), M + rows * (bh + M)), (230, 230, 230))
        for i, b in enumerate(blocks):
            r, c = divmod(i, COLS)
            sheet.paste(b, (M + c * (bw + M), M + r * (bh + M)))
        n_sheet = si // PER_SHEET + 1
        fname = f"{args.prefix}_sheet{n_sheet:03d}.png"
        sheet.save(os.path.join(sheets_dir, fname))
        sheets.append({"sheet": fname, "blocks": [e["block"] for e in chunk]})

    manifest = {"sample_dir": args.sample_dir, "prefix": args.prefix, "idol_map": idol_map,
                "n_frames": len(entries), "n_sheets": len(sheets), "sheets": sheets}
    with open(os.path.join(args.out_dir, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=1)
    print(json.dumps({"frames": len(entries), "sheets": len(sheets), "idol_map": idol_map,
                      "frames_per_folder": {k: len(v) for k, v in idx.items()},
                      "out_dir": args.out_dir}, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
