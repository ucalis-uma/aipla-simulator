# extract-s2-measured-buffs.md — サンプル2（S2）実測バフ自動抽出 & 突合指示書

このプロンプトは、**サンプル2（S2: タワー680 / qt-tower-680）の実機スクショからバフ一覧を自動抽出し、measured_data_v3.json を生成してバフ突合を行うセッション**用の指示書である。

作業開始前に必ず `AGENTS.md`（データ規律・テスト保証・終了規律）を読むこと。

---

## 1. 背景と目的

現在、S1・S3・T5 では全ビート・全レーンのバフ突合が完了し、バフ減衰モデルの検証が進んでいる。
しかし、**サンプル2（S2）** は `aipura_nox/サンプル2/measured_data_v2.json` において各ビートの `effects`（バフ段階数）が一切記録されておらず（空配列）、バフ突合セル 1,278 件がすべて `MISSING_MEASURED_EFFECTS` となっている。

実機スクショフォルダ `aipura_nox/サンプル2/`（`lane1/` 〜 `lane5/`）には、各ビートの画像（`beat_NNN.PNG`）およびスクロール画像（`beat_NNN_2.PNG` が存在する場合）が保存されている。

S3 で確立された **OpenCV 列スキャンマッチング技術**（`research/26_data_integrity/` のテンプレート群および適正化クロップ枠 `BOX = (30, 455, 970, 745)`）を活用し、S2 の実機スクショから全レーン・全ビートのバフ一覧（バフ名と段数）を高精度で自動抽出し、S2 初のバフ突合と Decay 検証を実現する。

---

## 2. 作業手順

### Step 1: S2 実機画像の構造とスクロール画像の事前調査
1. `C:\Users\umaro\Documents\aipura_nox\サンプル2\` 配下の各レーンフォルダ（`lane1/` 〜 `lane5/`）の画像ファイル一覧を確認。
2. 総ビート数（167 ビート）および `_2.PNG`（スクロール画像）の有無を特定。
3. S2 のデッキ構成（`deck.json`）を確認し、登場するバフ種別（ダンス上昇、Vo上昇、Vi上昇、クリ率、スコア上昇等）をリストアップ。

### Step 2: テンプレートの確認と拡充（必要に応じて）
1. `research/26_data_integrity/templates/` の既存 19 種テンプレート（集目、スコア上昇、クリ率、Vo/Vi系等）を確認。
2. S2（ダンス・ボーカル・ビジュアル等）で未登録のバフ・段数アイコンがあれば、S2 の実機スクショからクロップしてテンプレートに追加。

### Step 3: 全レーン・全ビートのバフ自動抽出スクリプトの作成と実行
1. クロップ範囲 `BOX = (30, 455, 970, 745)` でウィンドウを切り出し、列スキャンマッチング（左列 x:10〜470, 右列 x:475〜935、閾値 0.85）を実行。
2. `_2.PNG`（2ページ目）が存在するビートについては、1ページ目と2ページ目のバフを重複なくユニオンマージする（S3 で判明した上書き欠落バグを完全に防止）。
3. 抽出結果の異常値（スコア < 0.85、予期しないバフ等）をサニティチェック。

### Step 4: measured_data_v3.json の新規作成
1. `aipura_nox/サンプル2/measured_data_v2.json` をディープコピー。
2. 既存ファイルは一切変更せず、新規ファイル **`aipura_nox/サンプル2/measured_data_v3.json`**（およびリポジトリ内コピー `research/26_data_integrity/measured_data_s2_v3.json`）として保存。

### Step 5: S2 バフ再突合の実行と評価
1. S2 の最新 Sim トレース（`research/20_sample2_gap_analysis/sim_trace_full.json`）と突合を実行。
2. 差分表 **`research/26_data_integrity/diff_s2_v3.json`** および **`diff_s2_v3.csv`** を出力。
3. S2 における完全一致率、`DECAY_TIMING_LAG` の件数を集計し、新バフ減衰モデルの整合性を評価。
4. レポート `research/26_data_integrity/samples_decay_audit.md` および `research/12_implementation_log.md` を更新。

---

## 3. 完了条件

1. **S2 の全レーン（Lane 1〜5）・全ビート（1〜167）のバフ一覧が抽出され、`measured_data_v3.json` が安全に生成されていること**（v2等の既存ファイル無傷）。
2. **S2 のバフ突合が実行され、`diff_s2_v3.json` / `diff_s2_v3.csv` が生成されていること**。
3. **`samples_decay_audit.md` に S2 の突合結果（一致率、DECAY_TIMING_LAG 等）が反映され、全サンプル（T5, S1, S2, S3）の完全網羅が達成されていること**。
4. **`npm run typecheck` 0エラー、`npx vitest run` 485 passed（全件 PASS）が維持されていること**。
