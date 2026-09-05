# -*- coding: utf-8 -*-
"""
T5（1668x2420・IMG_NNNN命名）専用ポップ読取シート生成。

S系 make_pop_sheets.py に触れず別ファイル化（S1並列セッションへの影響ゼロ）。
クロップ座標は実画像で目視検証済み（research/12 T5遡及エントリ参照）:
  pop  : フォーカス大カード右上（スコアポップ +63.9K 等 / なし時は「－」）
  name : 同カード下部のアイドル名帯（レーン同定用）
  beat : 譜面右の BEAT カウンタ（IMG↔beat対応の検証用）

使い方:
  python tools/backfill/make_pop_sheets_t5.py <worklist.json> <out_dir> --prefix T5
worklist.json は [{"beat","lane","file"(laneN/IMG_XXXX.PNG相対)}...] の配列。
"""
import json, os, sys, argparse
from PIL import Image, ImageDraw, ImageFont

# 1668x2420 用クロップ座標（目視検証済み）
CROPS = {
    "pop":  (1050, 90, 1660, 300),
    "name": (120, 450, 1150, 600),
    "beat": (1350, 850, 1668, 1130),
}
ZOOM = {"pop": 2.0, "name": 1.0, "beat": 2.0}
PER_SHEET = 9
COLS = 3
LABEL_H = 30
GAP = 6


def load_font(size):
    try:
        return ImageFont.load_default(size)
    except TypeError:
        return ImageFont.load_default()


def make_block(img, label, font):
    parts = []
    for k in ("pop", "name", "beat"):
        c = img.crop(CROPS[k])
        z = ZOOM[k]
        if z != 1.0:
            c = c.resize((int(c.width * z), int(c.height * z)), Image.LANCZOS)
        parts.append(c)
    w = max(parts[0].width, parts[1].width, parts[2].width)
    h = LABEL_H + sum(c.height for c in parts) + GAP * (len(parts) + 1)
    block = Image.new("RGB", (w, h), "white")
    d = ImageDraw.Draw(block)
    d.rectangle([0, 0, w - 1, LABEL_H - 1], fill=(20, 20, 20))
    d.text((6, 5), label, fill="white", font=font)
    y = LABEL_H + GAP
    for c in parts:
        block.paste(c, (0, y))
        y += c.height + GAP
    return block


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("worklist")
    ap.add_argument("out_dir")
    ap.add_argument("--prefix", default="T5")
    ap.add_argument("--sample_dir", default=None)
    args = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")

    with open(args.worklist, encoding="utf-8") as f:
        entries = json.load(f)
    sample_dir = args.sample_dir or r"C:\Users\umaro\Documents\アイプラ\スコア分析サンプル"
    sheets_dir = os.path.join(args.out_dir, "sheets")
    os.makedirs(sheets_dir, exist_ok=True)
    font = load_font(24)

    sheets = []
    for si in range(0, len(entries), PER_SHEET):
        chunk = entries[si:si + PER_SHEET]
        blocks = []
        for e in chunk:
            p = os.path.join(sample_dir, e["file"].replace("/", os.sep))
            label = f"L{e['lane']}_b{e['beat']}_{os.path.basename(e['file'])}"
            blocks.append(make_block(Image.open(p), label, font))
        bw = max(b.width for b in blocks)
        bh = max(b.height for b in blocks)
        M = 10
        rows = (len(blocks) + COLS - 1) // COLS
        sheet = Image.new("RGB", (M + COLS * (bw + M), M + rows * (bh + M)), (230, 230, 230))
        for i, b in enumerate(blocks):
            r, c = divmod(i, COLS)
            sheet.paste(b, (M + c * (bw + M), M + r * (bh + M)))
        fname = f"{args.prefix}_sheet{si // PER_SHEET + 1:03d}.png"
        sheet.save(os.path.join(sheets_dir, fname))
        sheets.append({"sheet": fname,
                       "blocks": [f"L{e['lane']}_b{e['beat']}_{os.path.basename(e['file'])}" for e in chunk],
                       "cells": [{"beat": e["beat"], "lane": e["lane"], "file": e["file"]} for e in chunk]})
        print(f"saved {fname} ({len(chunk)} blocks)")

    with open(os.path.join(args.out_dir, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump({"prefix": args.prefix, "n_cells": len(entries),
                   "n_sheets": len(sheets), "sheets": sheets}, f, ensure_ascii=False, indent=1)
    print(json.dumps({"cells": len(entries), "sheets": len(sheets), "out_dir": args.out_dir},
                     ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
