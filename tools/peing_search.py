#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
質問箱（Peing）アーカイブ検索ツール。

アイプラの未解明仕様を peing_raw_qa.json（約6,800件のQ&A）から
キーワード検索・分析して自己解決するためのユーティリティ。

使い方:
  python tools/peing_search.py クリティカル 上限            # AND検索（Q+A本文）
  python tools/peing_search.py クリ率 --any                 # いずれかを含む（OR）
  python tools/peing_search.py 発生率 --q-only              # 質問文のみ対象
  python tools/peing_search.py テンション --limit 50        # 表示件数制限
  python tools/peing_search.py 率 --regex                   # 正規表現
  python tools/peing_search.py ... --out out.txt            # UTF-8 ファイルにも保存

出力は Windows コンソール（cp932）でも文字化けしないよう UTF-8 で強制する。
"""
import argparse
import io
import json
import os
import re
import sys

DEFAULT_QA_PATH = r"C:\Users\umaro\Documents\aipra_peing\peing_data\peing_raw_qa.json"

# Windows コンソールの文字化け対策: stdout/stderr を UTF-8 に強制
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")


def load_qa(path: str) -> list[dict]:
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, list):
        raise SystemExit(f"unexpected JSON structure: {type(data)}")
    return data


def entry_text(entry: dict, q_only: bool = False, a_only: bool = False) -> str:
    parts = []
    if not a_only:
        parts.append(str(entry.get("question") or ""))
    if not q_only:
        parts.append(str(entry.get("answer") or ""))
    return "\n".join(parts)


def main() -> None:
    ap = argparse.ArgumentParser(description="Peing QA keyword search")
    ap.add_argument("keywords", nargs="+", help="search keywords")
    ap.add_argument("--any", action="store_true", help="OR search (default: AND)")
    ap.add_argument("--q-only", action="store_true", help="search question text only")
    ap.add_argument("--a-only", action="store_true", help="search answer text only")
    ap.add_argument("--regex", action="store_true", help="treat keywords as regex")
    ap.add_argument("--limit", type=int, default=80, help="max entries to display")
    ap.add_argument("--context", type=int, default=90, help="context chars around match")
    ap.add_argument("--out", help="also write results to this file (UTF-8)")
    ap.add_argument("--qa-path", default=DEFAULT_QA_PATH)
    ap.add_argument("--json", action="store_true", help="output matched entries as JSON")
    args = ap.parse_args()

    data = load_qa(args.qa_path)
    flags = 0
    if args.regex:
        flags |= re.IGNORECASE
        patterns = [re.compile(k, flags) for k in args.keywords]
    else:
        # 大文字小文字を無視した部分一致（ひらがな/カタカナはそのまま）
        patterns = [re.compile(re.escape(k), re.IGNORECASE) for k in args.keywords]

    def hit(text: str) -> bool:
        if args.any:
            return any(p.search(text) for p in patterns)
        return all(p.search(text) for p in patterns)

    matches = []
    for entry in data:
        text = entry_text(entry, q_only=args.q_only, a_only=args.a_only)
        if hit(text):
            matches.append(entry)

    # 新しい順にソート（created_at 降順）
    matches.sort(key=lambda e: str(e.get("created_at") or ""), reverse=True)

    lines: list[str] = []
    lines.append(f"# Peing search: {args.keywords} (mode={'OR' if args.any else 'AND'})")
    lines.append(f"# total={len(data)} matches={len(matches)} (showing up to {args.limit})")
    for entry in matches[: args.limit]:
        text = entry_text(entry)
        # 最初のマッチ位置の周辺を表示
        span = None
        for p in patterns:
            m = p.search(text)
            if m:
                span = (m.start(), m.end())
                break
        if span:
            s = max(0, span[0] - args.context)
            e = min(len(text), span[1] + args.context)
            snippet = ("…" if s > 0 else "") + text[s:e].replace("\n", " ") + ("…" if e < len(text) else "")
        else:
            snippet = text[: args.context * 2]
        lines.append(f"--- id={entry.get('id')} {str(entry.get('created_at'))[:10]}")
        lines.append(f"Q: {str(entry.get('question') or '').replace(chr(10), ' ')}")
        lines.append(f"A: {str(entry.get('answer') or '').replace(chr(10), ' ')}")
        lines.append(f"   >> {snippet}")

    out_text = "\n".join(lines) + "\n"
    print(out_text)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            f.write(out_text)
        print(f"[saved] {args.out}", file=sys.stderr)
    if args.json:
        print(json.dumps(matches[: args.limit], ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
