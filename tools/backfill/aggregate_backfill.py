# -*- coding: utf-8 -*-
"""
バッチ読取結果の集約 → lane_pops_backfill.json 生成（ドラフト。sample dir へは --write で出力）

使い方: python tools/backfill/aggregate_backfill.py <sample_key> [--write]
  sample_key: S4 / S2 / S3 / S1 / T5（WORK/SAMPLE_DIR の対応は下表）
出力:
  - 標準出力に検証レポート（色×既存フラグ不一致・合計ズレ・競合）
  - --write 時: <sample_dir>/lane_pops_backfill.json を新規作成（既存ファイルは触らない）
"""
import json, os, re, sys
from collections import Counter, defaultdict

sys.stdout.reconfigure(encoding="utf-8")

WORK = {
    "S4": (r"C:/Users/umaro/AppData/Local/Temp/lane_pops/S4", r"C:/Users/umaro/Documents/aipura_nox/サンプル4", "サンプル4"),
    "S2": (r"C:/Users/umaro/AppData/Local/Temp/lane_pops/S2", r"C:/Users/umaro/Documents/aipura_nox/サンプル2", "サンプル2"),
    "S3": (r"C:/Users/umaro/AppData/Local/Temp/lane_pops/S3", r"C:/Users/umaro/Documents/aipura_nox/サンプル3", "サンプル3"),
    "S1": (r"C:/Users/umaro/AppData/Local/Temp/lane_pops/S1", r"C:/Users/umaro/Documents/aipura_nox/サンプル1", "サンプル1"),
}


def parse_displayed(d):
    """'+12.8K' -> (12800, slack)。+ と K/M 必須。失敗は None"""
    m = re.match(r"^\+([\d,]+(?:\.\d+)?)([KM]?)$", d)
    if not m:
        return None
    num = float(m.group(1).replace(",", ""))
    unit = m.group(2)
    if unit == "K":
        v = num * 1000
        dec = len(m.group(1).split(".")[1]) if "." in m.group(1) else 0
        slack = 50 if dec else 500
    elif unit == "M":
        v = num * 1_000_000
        dec = len(m.group(1).split(".")[1]) if "." in m.group(1) else 0
        slack = 50_000 if dec else 500_000
    else:
        v = num
        slack = max(500, v * 0.005)
    return v, slack


def lane_key_to_int(k):
    return int(k) if str(k).isdigit() else int(str(k).replace("lane", ""))


def main():
    key = sys.argv[1]
    do_write = "--write" in sys.argv
    work, sdir, sname = WORK[key]
    with open(os.path.join(work, "manifest.json"), encoding="utf-8") as f:
        man = json.load(f)
    idol_map = {int(k): v for k, v in man["idol_map"].items()}

    with open(os.path.join(sdir, "measured_data.json"), encoding="utf-8") as f:
        md = json.load(f)
    tl = md["timeline"]
    bgs = {int(b["beat"]): b.get("beat_gained_score") for b in tl}
    # 既存ポップ（数値を持つものは維持対象。HIT/CRITICAL のみのものは色照合に使う）
    existing = {}
    for b in tl:
        for lk, lv in b["lanes"].items():
            L = lane_key_to_int(lk)
            gp = lv.get("gained_score_pop")
            gsd = lv.get("gained_score_displayed")
            val = None
            if isinstance(gp, dict) and gp.get("text"):
                val = gp["text"]
            elif gsd:
                val = gsd
            word = None
            if isinstance(gp, dict) and gp.get("text") in ("HIT", "CRITICAL"):
                word = gp["text"]
            existing[(int(b["beat"]), L)] = {"existing_value": val, "existing_word": word}

    # critical flags（サンプル形式の違いを吸収）
    flags = {}
    cf = md.get("critical_flags")
    if isinstance(cf, dict):
        bl = cf.get("beats")
        if isinstance(bl, list):  # S4/S3: [{beat, lanes:[bool*5]}]
            for e in bl:
                if isinstance(e, dict) and "beat" in e:
                    for i, v in enumerate(e.get("lanes", []), start=1):
                        flags[(int(e["beat"]), i)] = bool(v)
        elif isinstance(bl, dict):  # S1: beat -> {lane: 'critical'|'normal'|null}
            for bt, lanes in bl.items():
                for L, v in lanes.items():
                    flags[(int(bt), int(L))] = (v == "critical")
    elif isinstance(cf, dict) or cf is None:
        pass
    if not flags and isinstance(cf, dict):  # S2: bNNN_LK -> bool
        for k, v in cf.items():
            m = re.match(r"^b(\d+)_L(\d)$", k)
            if m:
                flags[(int(m.group(1)), int(m.group(2)))] = bool(v)

    # バッチ読み込み
    frames = []
    bdir = os.path.join(work, "batches")
    for fn in sorted(os.listdir(bdir)):
        if not re.match(r"batch\d+\.json$", fn):
            continue
        raw = open(os.path.join(bdir, fn), encoding="utf-8").read().strip()
        try:
            arr = json.loads(raw)
        except json.JSONDecodeError:
            arr = [json.loads(ln) for ln in raw.splitlines() if ln.strip()]
        for e in arr:
            frames.append(e)
    print(f"frames loaded: {len(frames)}")

    # フレーム → セル帰属
    by_cell = defaultdict(list)  # (beat, lane) -> [entry]
    no_focus = []
    beat_mismatch = []
    for e in frames:
        bt = int(e["beat"])
        fl = e.get("focus_lane")
        if fl is None:
            no_focus.append(e["block"])
            continue
        # BEAT カウンタ照合は note ベースで記録されているものを拾う
        note = (e.get("note") or "")
        if "不一致" in note:
            beat_mismatch.append({"block": e["block"], "note": note})
        by_cell[(bt, int(fl))].append(e)

    pops = []
    conflicts = []
    flag_review = []
    sum_issues = []
    existing_contradictions = []
    stats = Counter()
    by_lane_stats = defaultdict(Counter)
    for b in tl:
        bt = int(b["beat"])
        for lk in b["lanes"].keys():
            L = lane_key_to_int(lk)
            entries = by_cell.get((bt, L), [])
            readable = [e for e in entries if e.get("readable") and e.get("displayed")]
            entry_out = {"beat": bt, "lane": L, "displayed": None, "color": None,
                         "readable": False, "note": None, "source_frames": [e["block"] for e in entries]}
            ex = existing.get((bt, L), {})
            if readable:
                vals = Counter(e["displayed"] for e in readable)
                best, cnt = vals.most_common(1)[0]
                colors = Counter(e.get("color") for e in readable if e.get("displayed") == best)
                color = colors.most_common(1)[0][0]
                entry_out.update(displayed=best, color=color, readable=True)
                if len(vals) > 1:
                    conflicts.append({"beat": bt, "lane": L, "values": dict(vals), "chosen": best})
                stats["readable"] += 1
                by_lane_stats[L]["readable"] += 1
                if len(readable) > 1:
                    stats["multi_frame_confirmed"] += 1
            else:
                notes = [ (e.get("note") or "") for e in entries ]
                if entries:
                    kinds = Counter("blocked" if "遮蔽" in n else ("判読不能" if "判読不能" in n else ("word" if ("HIT" in n or "CRITICAL" in n) else "none")) for n in notes)
                    kind = kinds.most_common(1)[0][0]
                    if kind == "blocked":
                        entry_out["note"] = f"遮蔽（{'; '.join(n for n in notes if '遮蔽' in n)[:80]}）"
                        stats["blocked"] += 1; by_lane_stats[L]["blocked"] += 1
                    elif kind == "判読不能":
                        entry_out["note"] = "判読不能"
                        stats["unreadable"] += 1; by_lane_stats[L]["unreadable"] += 1
                    elif kind == "word":
                        ws = [n for n in notes if ("HIT" in n or "CRITICAL" in n)]
                        entry_out["note"] = ws[0][:60] if ws else "word_only"
                        # word_only の色は既存 word との整合用に保持
                        for e in entries:
                            if e.get("color") in ("white", "yellow"):
                                entry_out["color"] = e["color"]
                                break
                        stats["word_only"] += 1; by_lane_stats[L]["word_only"] += 1
                    else:
                        entry_out["note"] = f"popなし（{len(entries)}フレームで確認）"
                        stats["no_pop"] += 1; by_lane_stats[L]["no_pop"] += 1
                else:
                    entry_out["note"] = "該当フレームなし（全フォルダのこのビートで他レーンがフォーカス）"
                    stats["no_frame"] += 1; by_lane_stats[L]["no_frame"] += 1
            # 色照合（既存 flag）
            obs_color = entry_out["color"]
            flg = flags.get((bt, L))
            if obs_color in ("white", "yellow") and flg is not None:
                expect = "yellow" if flg else "white"
                if obs_color != expect:
                    flag_review.append({
                        "beat": bt, "lane": L,
                        "existing_flag": flg,
                        "existing_word": ex.get("existing_word"),
                        "observed": obs_color,
                        "confidence": "high" if len(readable) >= 2 else "medium",
                        "note": "既存フラグとポップ色が不一致（既存 JSON は変更せず記録のみ）",
                    })
            # 既存数値 text との矛盾照合（S3 等・既存があるサンプル用）
            exv = ex.get("existing_value")
            if entry_out["readable"] and exv and str(exv).startswith("+"):
                pv_new = parse_displayed(entry_out["displayed"])
                pv_old = parse_displayed(str(exv))
                if pv_new and pv_old:
                    diff = abs(pv_new[0] - pv_old[0])
                    if diff > max(pv_new[1], pv_old[1]):
                        existing_contradictions.append({
                            "beat": bt, "lane": L, "existing": str(exv),
                            "new": entry_out["displayed"],
                            "diff": int(diff),
                            "note": "既存 text と新読取が乖離（両者を併記・要確認）",
                        })
            pops.append(entry_out)

    # 合計照合
    vals_by_beat = defaultdict(list)
    for p in pops:
        if p["readable"]:
            pv = parse_displayed(p["displayed"])
            if pv:
                vals_by_beat[p["beat"]].append((p["lane"], pv[0], pv[1]))
    n_checked = 0
    for bt, lst in sorted(vals_by_beat.items()):
        actual = bgs.get(bt)
        if actual is None:
            continue
        s = sum(v for _, v, _ in lst)
        slack = sum(sl for _, _, sl in lst) + 300
        n_checked += 1
        n_lanes = len(lst)
        if abs(s - actual) > slack:
            over = s > actual
            # 全レーン揃っていても欠けていても報告（欠けなら under は正当化されるが大きすぎたら要確認）
            sum_issues.append({"beat": bt, "lanes_read": n_lanes, "sum": int(s),
                               "beat_gained_score": actual, "diff": int(s - actual),
                               "over": over})

    print(json.dumps({
        "cells": len(pops), "stats": dict(stats),
        "by_lane": {str(k): dict(v) for k, v in sorted(by_lane_stats.items())},
        "conflicts": conflicts, "flag_review_n": len(flag_review),
        "existing_contradictions": existing_contradictions,
        "no_focus_frames": len(no_focus), "beat_mismatch_notes": beat_mismatch,
        "sum_check": {"beats_checked": n_checked, "violations": sum_issues[:40],
                      "n_violations": len(sum_issues)},
    }, ensure_ascii=False, indent=1))

    if do_write:
        out = {
            "sample": sname,
            "source_screenshots": "lane1〜5/beat_NNN.PNG 全フレーム（クロップシート経由）",
            "method": "LLM 画像目視（3領域クロップ合成シート・OCR 不使用・フォーカスは名前帯で判定）",
            "pops": pops,
            "critical_flag_review": flag_review,
            "conflicts": conflicts,
            "existing_contradictions": existing_contradictions,
            "summary": {
                "readable": stats["readable"], "blocked": stats["blocked"],
                "no_pop": stats["no_pop"], "unreadable": stats["unreadable"],
                "word_only": stats["word_only"],
                "no_frame": stats["no_frame"],
                "by_lane": {str(k): dict(v) for k, v in sorted(by_lane_stats.items())},
            },
            "meta": {
                "created": "2026-09-05",
                "agent": "zcode (main) + general-purpose subagents",
                "notes": "既存 measured_data*.json は未変更。既存 text と矛盾がなければ本データが優先情報源。sum_check の詳細は issues.md 参照",
                "scripts": "tools/backfill/make_pop_sheets.py, tools/backfill/aggregate_backfill.py",
            },
        }
        path = os.path.join(sdir, "lane_pops_backfill.json")
        assert not os.path.exists(path), "lane_pops_backfill.json は既に存在する（上書き禁止）"
        with open(path, "w", encoding="utf-8") as f:
            json.dump(out, f, ensure_ascii=False, indent=1)
        print("WROTE", path)


if __name__ == "__main__":
    main()
