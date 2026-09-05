# -*- coding: utf-8 -*-
"""
フォーカス検収用クロップシート生成（全ビート×全レーン）

各フレーム（lane1〜5/beat_NNN[_M|_NG].PNG）から 2 領域をクロップし 1 ブロックに合成する:
  name : アイドル名帯 (30,380)-(730,455) → フォーカス中レーンの判定用（主）
  beat : BEAT カウンタ (940,780)-(1080,935) → ファイル名 beat_NNN との照合用
ブロック 9 個/シート (3x3) + manifest.json（シート→ブロック対応）を出力する。

旧 S4 の遡及パイプライン tools/backfill/make_pop_sheets.py と同じ 1080×1920 座標・書式だが、
**measured_data.json に依存しない**（撮影直後・解析前でも検収できるのが目的）。

読取は LLM の画像目視（OCR 不使用）。読取結果は focus_result.json として
  {"L1_beat_000": 3, "L2_beat_001": null, ...}   # frame_id → フォーカス中レーン (1-5, 不明=null)
の形式で保存し、tools/recapture/focus_check.py --result に渡す。
（focus_check.py の自動判定 --auto で先行判定し、シート目視は抜き取り検証に使う運用を推奨）

使い方: python tools/recapture/make_focus_sheets.py <sample_dir> <out_dir> --prefix S4R [--beats 0,1,2]
"""
import json, os, re, sys, argparse
from PIL import Image, ImageDraw, ImageFont

# 1080x1920 用クロップ座標（旧 S4 スクショで実測・capture_knowledge_notes.md 保全値）
CROPS = {
    "name": (30, 380, 730, 455),
    "beat": (940, 780, 1080, 935),
}
SCALE = 0.85
PER_SHEET = 9  # 3x3
BLOCK_W = 700
LABEL_H = 26
GAP = 4
COLS = 3

FRAME_RE = re.compile(r"^beat_(\d+)(?:_(\d+))?(_NG)?\.PNG$", re.IGNORECASE)


def load_font(size):
    try:
        return ImageFont.load_default(size)
    except TypeError:
        return ImageFont.load_default()


def frames_index(sample_dir):
    """folder_lane -> [ファイル名...]（beat 番号昇順・素の beat_NNN を先に・NG を最後に）"""
    out = {}
    for L in range(1, 6):
        ld = os.path.join(sample_dir, f"lane{L}")
        if not os.path.isdir(ld):
            continue
        fs = []
        for f in os.listdir(ld):
            m = FRAME_RE.match(f)
            if m:
                fs.append(f)
        fs.sort(key=lambda f: (int(FRAME_RE.match(f).group(1)), f.endswith(("_NG.PNG", "_NG.png")), f))
        out[L] = fs
    return out


def make_block(img, label, font):
    crops = [img.crop(CROPS[k]) for k in ("name", "beat")]
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
    ap.add_argument("--beats", default=None, help="カンマ区切り beat 番号でフレームを絞る（例: 0,1,2）")
    args = ap.parse_args()

    sys.stdout.reconfigure(encoding="utf-8")
    sheets_dir = os.path.join(args.out_dir, "sheets")
    os.makedirs(sheets_dir, exist_ok=True)

    idx = frames_index(args.sample_dir)
    if args.beats:
        wanted = {int(x) for x in args.beats.split(",")}
        idx = {L: [f for f in fs if int(FRAME_RE.match(f).group(1)) in wanted]
               for L, fs in idx.items()}
    font = load_font(22)

    entries = []
    for L in range(1, 6):
        for f in idx.get(L, []):
            ng = bool(FRAME_RE.match(f).group(3))
            label = f"L{L}_{f[:-4]}" + (" [NG保存分]" if ng else "")
            entries.append({"block": f"L{L}_{f[:-4]}", "folder_lane": L, "file": f, "ng": ng,
                            "path": os.path.join(args.sample_dir, f"lane{L}", f)})

    sheets = []
    for si in range(0, len(entries), PER_SHEET):
        chunk = entries[si:si + PER_SHEET]
        blocks = [make_block(Image.open(e["path"]), label, font)
                  for e, label in zip(chunk, [f"{e['block']}{' [NG]' if e['ng'] else ''} {e['file']}" for e in chunk])]
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

    manifest = {"sample_dir": args.sample_dir, "prefix": args.prefix,
                "n_frames": len(entries), "n_sheets": len(sheets), "sheets": sheets}
    with open(os.path.join(args.out_dir, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=1)
    print(json.dumps({"frames": len(entries), "sheets": len(sheets),
                      "frames_per_folder": {k: len(v) for k, v in idx.items()},
                      "out_dir": args.out_dir}, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
