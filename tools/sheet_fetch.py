#!/usr/bin/env python3
"""
やるキ士スプレッドシート等のタブ取得ツール（読み取り専用）。

Google Sheets の CSV エクスポート（export?format=csv&gid=...）を取得して
research/sheets/ へ保存する。URL は公開（リンクを知る全員閲覧）のものを想定。

使い方:
  python tools/sheet_fetch.py <sheet_id> --gid <gid> [--name <tab名>]
  例: python tools/sheet_fetch.py 1LUicvnDjzaWudpMjEizAPKnn8RpFnZIwWD4p-JpdErI --gid 806980235 --name type36_coefficients

  --gid 省略時は既定タブ（gid=0）を取得。出力は research/sheets/<name>.csv（既定: sheet_<gid>.csv）。

対象シート（プロジェクトで参照するもの）:
  - 親/目次: 18R2PLrCSsv-yj53RpP8YHGR2AAP_zwLmFXpaRg5H5OI（gid=1445281970）
  - スキル検証: 1LUicvnDjzaWudpMjEizAPKnn8RpFnZIwWD4p-JpdErI
    - gid=1254343412 ビートスコアの計算方法 / gid=825563775 スキルスコアの計算方法
    - gid=0 コンボのボーナス / gid=969532646 来場ファン数のボーナス
    - gid=1253229797 上昇・低下効果 / **gid=806980235 スコアを伸びる効果（type36 係数）**
  - スコア品質表: 1LPkEEtxWwtLbEk9WcapNzmqjSWr0KFmrAaD7h1YMrXw
"""
import argparse
import sys
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
OUT_DIR = REPO / "research" / "sheets"

UA = "aipura-score-calc/sheet_fetch (research, read-only)"


def fetch(sheet_id: str, gid: int) -> bytes:
    url = (
        f"https://docs.google.com/spreadsheets/d/{sheet_id}/export"
        f"?format=csv&gid={gid}"
    )
    req = urllib.request.Request(url, headers={"user-agent": UA})
    with urllib.request.urlopen(req, timeout=60) as res:
        return res.read()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("sheet_id", help="スプレッドシート ID（URL の /d/<id>/ 部分）")
    ap.add_argument("--gid", type=int, default=0, help="タブの gid（既定 0）")
    ap.add_argument("--name", default=None, help="出力ファイル名（既定 sheet_<gid>.csv）")
    ap.add_argument("--out", default=None, help="出力先（既定 research/sheets/<name>.csv）")
    args = ap.parse_args()

    try:
        data = fetch(args.sheet_id, args.gid)
    except Exception as exc:  # noqa: BLE001
        print(f"[error] 取得に失敗: {exc}", file=sys.stderr)
        return 1

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    name = args.name or f"sheet_{args.gid}"
    out = Path(args.out) if args.out else OUT_DIR / f"{name}.csv"
    out.write_bytes(data)
    print(f"[write] {out} ({len(data):,} bytes, {data.count(bytes(chr(10), 'utf-8')) + 1} lines)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
