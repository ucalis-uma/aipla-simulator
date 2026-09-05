# tools/invalidated/ — S4 由来ツールの隔離（2026-09-05）

`prompts/rollback-recapture-sample4.md` Step B による隔離。S4（qt-ex-tower-004-054）実測データの
全面無効化に伴い、S4 由来の解析ツールをここに移動した。**中身は証跡として保持**・解析には使用しない。

| ファイル | 元の場所 | 内容 |
|---|---|---|
| `verify_sample4_beats.ts.disabled` | `tools/verify_sample4_beats.ts` | S4 実測ビート検証ツール（Phase 13・commit 809838f で追加）。拡張子 .disabled により vitest（`tests/**/*.test.ts`）・typecheck（`tools/**/*.ts`）の対象外 |
| `recon_s4frames.py` | `tools/backfill/recon_s4frames.py` | S4 フレーム再構成解析（レーン別ポップ遡及の S4 部分） |
| `recon_s4pop.py` | `tools/backfill/recon_s4pop.py` | S4 ポップ解析 |

- `tests/invalidated/sample4-specs.test.ts.disabled`（S4 確定仕様テスト 423 行・commit 809838f）と
  `examples/invalidated/sample4.invalid.json`（S4 入力データ）も同時に隔離した（Step B 実績は
  `research/22_sample4_rollback/progress.md` 参照）
- `tools/backfill/` 自体は S2/S3 の backfill 成果と共用のため**無効化していない**
  （make_pop_sheets.py・aggregate_backfill.py 等は引き続き有効）
