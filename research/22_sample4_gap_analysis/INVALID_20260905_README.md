# 【2026-09-05 無効化】research/22_sample4_gap_analysis — サンプル4 乖離分析一式

このディレクトリの内容は**すべて無効**である（2026-09-05・ユーザー決定）。

## 無効化の理由

サンプル4（qt-ex-tower-004-054）の実測キャプチャには、カメラ自動遷移により
「あるビートの全 5 フレームでカメラが目的のレーンを向いていない」事象が**全レーンで発生**していた
（レーン別ポップ遡及 research/12 §5 で確定）。カメラ自動遷移のため、非フォーカスレーンの
ポップ・状態はそのビートのフレームから取得できず、本分析（measured_data・timeline・
critical_flags・fable2 検証等）はレーン単位の検証（λ・off-attr・フォト重複規則・クリティカル等）に
**体系的な欠落**がある。

## 処置

- **履歴改変はしない**（git revert / 削除なし）。本 README を置いて無効を明示し、
  中身は証跡として保持する
- 由来データ `aipura_nox/サンプル4/` は `aipura_nox/サンプル4_invalid_capture_20260905/` に隔離
  （無効部分のみ。deck.json・communication_levels.json・ディレクトリ直下の画像・skill_order/ は
  機能しているため新 `サンプル4/` に残置 — 2026-09-05 ユーザー判定）
- src への S4 確定仕様実装（commit 809838f）もロールバック済み
  （`src/timeline/engine.ts`・`buffs.ts`・`types.ts` を 809838f 直前へ復元・
  `tests/unit/timeline/sample4-specs.test.ts` → `tests/invalidated/`・
  `tools/verify_sample4_beats.ts` → `tools/invalidated/`・`examples/sample4.json` →
  `examples/invalidated/`）
- research/23（クロスサンプル文書）は S4 由来の節のみ INVALID マーカー追記（S2/S3 節は有効）
- research/12 の S4 関連エントリに【2026-09-05 無効化】注記（末尾エントリ参照）

## 再検証について

S4 由来の仕様（強化効果譲渡 move 化・譲渡時の低下効果除外・延長の強化のみ対象化・
FAIL 時 comboReset トレース等）は**一旦リセット**。新データ（フォーカス検収付き再撮影）での
検証を通ってから再実装する。

## 関連

- 進捗: `../22_sample4_rollback/progress.md`（一次情報）
- 撮影知見の保全: `../22_sample4_rollback/capture_knowledge_notes.md`
- プロンプト: `../../prompts/rollback-recapture-sample4.md`

## 内容物（無効・証跡）

- `issues.md` / `measured_data_summary.md` — 旧 S4 解析の知見記録（#5/#6 の撮影知見は
  `../22_sample4_rollback/capture_knowledge_notes.md` に原文保全済み）
- `pack/`（01-06）— 分析用スリム分割パック
- `fable2/`（doc_1-8）— Fable 5.1 検証資料
- `trace_dump.ts` / `sim_skills.json` / `sim_trace_full.json` / `verify_beats.json`
