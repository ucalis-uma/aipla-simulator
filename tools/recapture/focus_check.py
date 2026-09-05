# -*- coding: utf-8 -*-
"""
フォーカス検収（全ビート×全レーン「フォーカス済みフレームが存在するか」を自動判定）

S4 全面無効化の根本原因は「あるビートの全 5 フレームでカメラが目的レーンを向いていない」
事象（全レーンで発生）。本ツールは再撮影サンプルに対しこれを検収する:

  1. 各フレームのアイドル名帯 (70,393)-(235,437) を 5 レーン分のテンプレート
     （aipura_nox/templates/name_band/lane{1-5}.png もしくは <sample_dir>/focus_refs/）と
     マッチングし、フォーカス中レーンを自動判定する
     （判定器は旧 S4 の 909 フレーム・ラベル付きデータで精度 100%・最小マージン 0.45 を確認済み。
       テンプレートは capture_lane_focus_retake.py focus-setup が実画面から生成したものを使う）
  2. beat カウンタ領域の目視照合用に、怪しいフレーム（低マージン・不一致候補）のクロップ
     シートを attachments/ に出力する
  3. 検収レポート（lane×beat マトリクス・missing_frames・NG 保存分）を stdout と
     focus_check_report.json に出力する

判定結果の意味:
  OK     = 目的レーンのフォーカス済みフレームが存在する（= レーン別ポップが読める）
  MISSING= そのビート×レーンのフレーム自体が無い（撮影欠損 → repair サブコマンド）
  NOFOCUS= フレームはあるが全て非フォーカス（S4 事象の再発 → repair サブコマンド）
  NGFILE = _NG.PNG 保存分のみ存在（再取得必要 → repair サブコマンド）
  LOWMARGIN = 判定スコアが閾値未満（全体モード等。LLM 目視シートで確認）

使い方:
  python tools/recapture/focus_check.py "C:\\...\\aipura_nox\\サンプル4" [--report-dir OUT_DIR]
  python tools/recapture/focus_check.py <sample_dir> --beats 0,1,2   （部分検収）
  python tools/recapture/focus_check.py <sample_dir> --refs <refs_dir>  （テンプレート指定）
"""
import argparse
import json
import os
import re
import sys
from collections import defaultdict

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

sys.stdout.reconfigure(encoding="utf-8")

NAME_BAND = (70, 393, 235, 437)   # x0,y0,x1,y1（アイドル名のみの帯）
MATCH_THRESHOLD = 0.80
MARGIN_THRESHOLD = 0.20           # best と second の差がこれ未満なら「要目視」
MAX_BEATS_DEFAULT = 176           # 上限（実ビート数はフレームから推定する）

LANE_NAMES = {1: "白石千紗", 2: "一ノ瀬怜", 3: "伊吹渚", 4: "兵藤雫", 5: "成宮すず"}
FRAME_RE = re.compile(r"^beat_(\d+)(?:_(\d+))?(_NG)?\.PNG$", re.IGNORECASE)


def imread_u(path):
    return cv2.imdecode(np.fromfile(path, dtype=np.uint8), cv2.IMREAD_COLOR)


def band_gray(img_bgr):
    x0, y0, x1, y1 = NAME_BAND
    return cv2.cvtColor(img_bgr[y0:y1, x0:x1], cv2.COLOR_BGR2GRAY)


def find_refs(sample_dir, refs_arg):
    cands = []
    if refs_arg:
        cands.append(refs_arg)
    cands.append(os.path.join(sample_dir, "focus_refs"))
    cands.append(r"c:\Users\umaro\Documents\aipura_nox\templates\name_band")
    for d in cands:
        if all(os.path.exists(os.path.join(d, f"lane{L}.png")) for L in range(1, 6)):
            return d
    print("ERROR: refs not found in:", cands, file=sys.stderr)
    print("先に capture_lane_focus_retake.py <sample> focus-setup を実行してください。", file=sys.stderr)
    sys.exit(1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("sample_dir")
    ap.add_argument("--refs", default=None)
    ap.add_argument("--beats", default=None, help="カンマ区切り beat 番号で絞る")
    ap.add_argument("--report-dir", default=None)
    args = ap.parse_args()

    sample_dir = args.sample_dir
    out_dir = args.report_dir or os.path.join(
        r"C:\Users\umaro\Documents\アイプラ", "research", "22_sample4_rollback", "focus_check")
    sheets_dir = os.path.join(out_dir, "attachments")
    os.makedirs(sheets_dir, exist_ok=True)

    refs_dir = find_refs(sample_dir, args.refs)
    # refs は既に名前帯クロップ済み (165x44) の画像 → グレースケール化のみ
    refs = {L: cv2.cvtColor(imread_u(os.path.join(refs_dir, f"lane{L}.png")), cv2.COLOR_BGR2GRAY)
            for L in range(1, 6)}
    print(f"[refs] {refs_dir}")

    wanted = {int(x) for x in args.beats.split(",")} if args.beats else None

    # --- 各レーンフォルダを走査して判定 ---
    # 重要: フォルダ名とフォーカスは無関係（旧 S4 の backfill で実証済み）。
    #       セル (beat, lane) の判定は「そのビートの全フォルダのフレームのどこかに
    #       目的レーンのフォーカス済みフレームが存在するか」で行う
    frames_by_beat = defaultdict(list)   # beat -> [dict(file, folder, ng, focused, best, second, margin)]
    pass_stats = defaultdict(lambda: {"total": 0, "focused_own": 0})  # folder L -> pass 品質
    for L in range(1, 6):
        ld = os.path.join(sample_dir, f"lane{L}")
        if not os.path.isdir(ld):
            continue
        for f in sorted(os.listdir(ld)):
            m = FRAME_RE.match(f)
            if not m:
                continue
            beat = int(m.group(1))
            if wanted and beat not in wanted:
                continue
            img = imread_u(os.path.join(ld, f))
            if img is None:
                continue
            g = band_gray(img)
            scores = {k: float(cv2.matchTemplate(g, t, cv2.TM_CCOEFF_NORMED)[0][0]) for k, t in refs.items()}
            order = sorted(scores.items(), key=lambda kv: -kv[1])
            best, second = order[0], order[1]
            focused = best[0] if best[1] >= MATCH_THRESHOLD else None
            ng = bool(m.group(3))
            frames_by_beat[beat].append({
                "file": f, "folder": L, "variant": bool(m.group(2)) or ng, "ng": ng,
                "focused": focused, "best": best, "second": second,
                "margin": round(best[1] - second[1], 3), "scores": {k: round(v, 3) for k, v in scores.items()},
            })
            if not m.group(2):  # primary フレームのみ pass 品質に数える
                pass_stats[L]["total"] += 1
                if focused == L:
                    pass_stats[L]["focused_own"] += 1

    # --- セル判定（OK / MISSING / NOFOCUS / NGFILE / LOWMARGIN） ---
    # 実ビート数の推定: primary フレームの最大 beat 番号（新サンプルはビート 0..~166 前後）
    max_primary = 0
    for beat, frs in frames_by_beat.items():
        if any(not f["variant"] for f in frs):
            max_primary = max(max_primary, beat)
    max_beat = max_primary  # primary が揃っていれば全ビート存在するはず → 上限は最大番号
    beats_present = sorted(frames_by_beat)
    report_rows = []
    missing_frames, nofocus, ngfile, lowmargin = [], [], [], []
    ok_cells = []
    for L in range(1, 6):
        for beat in range(0, max_beat + 1):
            if wanted and beat not in wanted:
                continue
            frs = frames_by_beat.get(beat, [])
            if not frs:
                report_rows.append((L, beat, "MISSING"))
                missing_frames.append({"lane": L, "beat": beat})
                continue
            good = [f for f in frs if f["focused"] == L]
            if good:
                rep = "OK"
                ok_cells.append({"lane": L, "beat": beat, "file": good[0]["file"], "folder": good[0]["folder"]})
                if any(f["margin"] < MARGIN_THRESHOLD for f in good):
                    rep = "OK(LOWMARGIN)"
                    lowmargin.append({"lane": L, "beat": beat, "files": [f["file"] for f in good]})
            else:
                only_ng = all(f["ng"] for f in frs)
                if only_ng:
                    rep = "NGFILE"
                    ngfile.append({"lane": L, "beat": beat, "files": [f["file"] for f in frs]})
                else:
                    rep = "NOFOCUS"
                    nofocus.append({"lane": L, "beat": beat,
                                    "files": [f"{f['folder']}:{f['file']}(focus={f['focused']})" for f in frs]})
            report_rows.append((L, beat, rep))

    # --- 判定が OK 以外 or LOWMARGIN のフレームの目視確認シート ---
    check_frames = []
    for beat, frs in sorted(frames_by_beat.items()):
        for f in frs:
            if f["focused"] != f["folder"] or f["margin"] < MARGIN_THRESHOLD:
                check_frames.append((beat, f["folder"], f))
    font = None
    try:
        font = ImageFont.load_default(22)
    except TypeError:
        font = ImageFont.load_default()

    sheets = []
    PER = 9
    for si in range(0, len(check_frames), PER):
        chunk = check_frames[si:si + PER]
        blocks = []
        for beat, L, f in chunk:
            path = os.path.join(sample_dir, f"lane{L}", f["file"])
            img = Image.open(path).convert("RGB")
            name = img.crop((30, 380, 730, 455))
            bt = img.crop((940, 780, 1080, 935))
            h = 26 + name.height + bt.height + 12
            blk = Image.new("RGB", (700, h), "white")
            d = ImageDraw.Draw(blk)
            d.rectangle([0, 0, 699, 25], fill=(20, 20, 20))
            d.text((6, 4), f"L{L} beat{beat} {f['file']} focus={f['focused']} margin={f['margin']}", fill="white", font=font)
            blk.paste(name, (0, 30))
            blk.paste(bt, (0, 30 + name.height + 4))
            blocks.append(blk.resize((595, int(h * 0.85)), Image.LANCZOS))
        bw = max(b.width for b in blocks)
        bh = max(b.height for b in blocks)
        M = 8
        rows = (len(blocks) + 2) // 3
        sheet = Image.new("RGB", (M + 3 * (bw + M), M + rows * (bh + M)), (230, 230, 230))
        for i, b in enumerate(blocks):
            r, c = divmod(i, 3)
            sheet.paste(b, (M + c * (bw + M), M + r * (bh + M)))
        fname = f"check_sheet{si // PER + 1:03d}.png"
        sheet.save(os.path.join(sheets_dir, fname))
        sheets.append(fname)

    # --- レポート出力 ---
    verdict = {"OK": 0, "OK(LOWMARGIN)": 0, "MISSING": 0, "NOFOCUS": 0, "NGFILE": 0}
    for _l, _b, rep in report_rows:
        verdict[rep.split("(")[0] if rep != "OK(LOWMARGIN)" else "OK"] = verdict.get(rep.split("(")[0], 0)
    counts = defaultdict(int)
    for _l, _b, rep in report_rows:
        counts[rep] += 1

    total_cells = 5 * (len(beats_present) if wanted is None else len(wanted))
    print("\n===== FOCUS CHECK REPORT =====")
    print(f"sample: {sample_dir}")
    print(f"beats with any frame: {len(beats_present)}  (max={max(beats_present) if beats_present else '-'})")
    print(f"cells: OK={counts['OK']} OK(LOWMARGIN)={counts['OK(LOWMARGIN)']} MISSING={counts['MISSING']} "
          f"NOFOCUS={counts['NOFOCUS']} NGFILE={counts['NGFILE']}")
    print("pass quality (folder -> 自レーン フォーカス率・参考値):")
    for L in sorted(pass_stats):
        st = pass_stats[L]
        pct = (100 * st["focused_own"] / st["total"]) if st["total"] else 0
        print(f"  pass lane{L}: {st['focused_own']}/{st['total']} ({pct:.0f}%)")
    if missing_frames:
        by_lane = defaultdict(list)
        for x in missing_frames:
            by_lane[x["lane"]].append(x["beat"])
        print("missing_frames (repair targets):")
        for L in sorted(by_lane):
            print(f"  lane{L}: {by_lane[L]}")
    if nofocus:
        print("NOFOCUS (S4 事象の再発・repair 対象):")
        for x in nofocus[:20]:
            print(f"  lane{x['lane']} beat{x['beat']}: {x['files']}")
    if ngfile:
        print("NGFILE:")
        for x in ngfile[:20]:
            print(f"  lane{x['lane']} beat{x['beat']}: {x['files']}")
    print(f"visual-check sheets: {len(sheets)} -> {sheets_dir}")

    with open(os.path.join(out_dir, "focus_check_report.json"), "w", encoding="utf-8") as f:
        json.dump({
            "sample_dir": sample_dir, "refs_dir": refs_dir,
            "summary": {k: counts[k] for k in sorted(counts)},
            "pass_quality": {str(L): pass_stats[L] for L in sorted(pass_stats)},
            "ok_cells": ok_cells,
            "missing_frames": missing_frames, "nofocus": nofocus, "ngfile": ngfile,
            "lowmargin": lowmargin,
            "cells": [{"lane": L, "beat": b, "verdict": rep} for (L, b, rep) in report_rows],
            "check_sheets": sheets,
        }, f, ensure_ascii=False, indent=1)
    print(f"report json: {os.path.join(out_dir, 'focus_check_report.json')}")
    print("==============================")
    if missing_frames or nofocus or ngfile:
        print("→ repair 例: python capture_lane_focus_retake.py <sample> repair <lane> <beats カンマ区切り>")
    else:
        print("→ 検収 OK（全セルにフォーカス済みフレームあり）")


if __name__ == "__main__":
    main()
