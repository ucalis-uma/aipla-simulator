# S1〜S3 新バフ減衰モデル再突合・影響分析セッション用プロンプト

## 0. 前提（最初に読む）

1. リポジトリルートの `AGENTS.md`（データ出典規律。「ゲームデータはマスタから確定」「推測・捏造の混入禁止」）
2. `PLAN.md`（Phase 14 完了済み）
3. `research/12_implementation_log.md` 末尾（Phase 14 完了ログ: スキル復元・実効N-1 Decay適正化）
4. `research/25_buff_audit/run_audit.py`（既存のS1〜S3/T5突合スクリプト）
5. `research/26_data_integrity/skills_audit.md`（Phase 14 スキル監査レポート）

---

## 1. 背景と目的

Phase 14 において、過去の開発エージェントによるスキルデータ改ざんを公式マスタ通りの効果・数値へ復元し、
さらに実機調査（T5, S1, S2, S3 全件検証）に基づきバフ減衰（Decay / 持続時間）モデルを適正化しました：

- **適正化された実機バフ減衰仕様**:
  - 表記 N ビートのバフは、発動ビート終了時（ステップ10）にも減算処理が走り、実質 N - 1 ビートしか存在しない。
  - A/SP スキル発動時の `skipFirstDecay = true` を廃止（`false` に統一）。
- **T5 での実績**:
  - `DECAY_TIMING_LAG`（バフ消滅遅延）が **22件 → 0件 に激減**。
  - S1 b131-132 において、旧10段バフが切れ実機通り 6段 になる挙動が既に確認済み。

本セッションの目的は、この新バフ減衰モデルを **S1（サンプル1）、S2（サンプル2）、S3（サンプル3）** の全実測データと再突合し、
バフ推移の消滅タイミングや段数一致率がどのように改善されたかを網羅的に検証・評価し、最新の監査レポートを作成することです。

---

## 2. 完了条件（すべて満たすまで終わりにしない）

1. **S1〜S3 の新シミュレーショントレース再生成**:
   - S1, S2, S3 の各構成（`verification_data` / `sample*.json`）から、最新エンジン（Phase 14 適正化モデル）によるシミュレーショントレース（全ビート・全レーンの `buffSnapshots` およびスコア）を再ダンプする。
2. **実測データとの網羅的再突合の実行**:
   - `research/25_buff_audit/run_audit.py` をベースにした再突合スクリプト（または更新スクリプト）を実行し、新トレースと実測バフデータの差分表（`diff_s1_v2.csv/json`, `diff_s2_v2.csv/json`, `diff_s3_v2.csv/json`）を出力する。
3. **Decay 改善効果と残差分析レポートの作成**:
   - 旧モデル（Phase 13-B 時点）と比較して、`DECAY_TIMING_LAG` が何件解消されたか、バフ一致率がどう向上したかを定量集計する。
   - スコア推移（各サンプルの確定値・リプレイ値、実測スコアに対する乖離率）への影響を評価する。
   - 分析レポート [`research/26_data_integrity/samples_decay_audit.md`](file:///c:/Users/umaro/Documents/アイプラ/research/26_data_integrity/samples_decay_audit.md) を出力する。
4. **テストスイートの健全性保証**:
   - `npm run typecheck` エラー 0
   - `npx vitest run` 全件 PASS（485 passed 維持）

---

## 3. 具体的な手順

### Step 1: S1〜S3 トレースの再ダンプスクリプト作成・実行
- `tools/dump_samples_trace.ts` を作成（または既存の dump ツールを活用）：
  - S1: `aipura_nox/サンプル1/verification_data.json`（または `tests/unit/timeline/buff-snapshots.audit.test.ts` の S1 実行関数 `runS1()` と同一条件）
  - S2: `examples/sample2.json`
  - S3: `examples/sample3.json`（または `runS3()` と同一条件）
  - 各サンプルの実行結果（`beats[].buffSnapshots` および `gainedScore`、累積スコア）を JSON 形式で保存。

### Step 2: 突合スクリプトの実行と新差分表の生成
- `research/25_buff_audit/run_audit.py` を更新（または `research/26_data_integrity/run_audit_post_decay.py` を新設）：
  - 新しくダンプしたトレースと、実測データ（S1: `aipura_nox/サンプル1/measured_data.json`、S3: `aipura_nox/サンプル3/measured_data.json`、S2: 記録状況の確認）を突合。
  - 発動位相差（PRE/POST）、Decayタイミングズレ、段階数不一致、増強/重複差分などを自動分類。
  - 新差分表（CSV / JSON）を出力。

### Step 3: 定量集計と分析
- 各サンプルにおける：
  - 総セル数、完全一致セル数、一致率（%）
  - `DECAY_TIMING_LAG` の旧モデル件数 vs 新モデル件数（減少数の確認）
  - S1 b131-132 以外のバフ消滅ビート（例: b67 の千紗ビーム消滅等）の実機一致確認
  - S3 の各バフ（超化・増強・上限解放）の消滅タイミング確認
- 各サンプルのスコア確定値と実測乖離率の推移評価。

### Step 4: レポートの作成とテスト確認
- 調査結果を `research/26_data_integrity/samples_decay_audit.md` にまとめる。
- `npm run typecheck` および `npx vitest run` を実行し、既存テストが全件 PASS することを確認。

---

## 4. 検証コマンド

```powershell
npm run typecheck
npx vitest run
```
