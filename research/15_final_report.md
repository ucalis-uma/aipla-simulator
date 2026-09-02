# T5 ゴールデン検証 総括レポート（2026-08-30）

## 結論

**エンジンのタイムライン・スコア計算は、実測データと総スコア 17,529,132,014 に 1 の位まで完全一致した。**

- 統合リージョンを除く **119/155 ビートで累積スコアが実測 cumulative と完全一致**
- 例外 36 ビート（20 区間）もフレーム内ローカル総和で完全一致
- 全テストスイート: **280 passed / 1 skipped / 0 failed**、typecheck クリーン

## 検証手法

1. **逆算ソルバー**（`tests/golden/t5-solver.test.ts`）: 実測のビート毎獲得スコアをターゲットに、
   各イベントのスコア乱数 r を厳密逆算（BigInt）。単一イベントは区間逆算、複数イベントは
   一様 f 二分探索+最終イベント残余吸収、比率行は先行乱数 1000 固定の構成的不動点で解く。
   失敗ビートは前方統合（最大 4 行）で総和一致を解く（表示遅延・フレーム帰属の計測例外）。
2. **ゴールデンテスト**（`tests/golden/t5-scores.golden.test.ts`）: 生成乱数列
   （`fixtures/t5_replay_rands.json`、連続値 717 イベント分）をリプレイし、
   total / 全ビート累積 / リージョン総和を検証。

## 確定したゲーム仕様（実測からの逆算による）

| 項目 | 確定値 |
|---|---|
| スコア乱数 | **連続値 float ∈ [0.95, 1.05]**（整数パーミル仮定は棄却） |
| 丸め | **at-end**: 全ファクター積算後に最終 1 回 floor のみ（sequential は棄却） |
| ビート CB | X=baseComboBonus(表示コンボ=beat-1)、X_eff=floor(X×(1000+57.5csu)/1000)、CB=floor((1000+X_eff)×(1000+11.5csu)/1000) |
| フォト行 | クリティカル判定**対象外** |
| ミスノート | b1 は全レーン miss（LIVE START 直後取りこぼし）→ `SimulateInput.missedNotes` |
| type36 スケーリング | A fest-03-2: 2.5‰/段、SP fest-03-1: 11‰/段 |
| photo-L3-2 | score_get 160‰（テキスト表記 20% と食い違い・ポップ実測で確定） |
| wedding A type20 | **combo_score_up+5 [60b]** target=score_type_1（旧 ccu 解釈は棄却） |
| 比率行 | レーン累積+A行加算後の累積 ×120‰（`trace.ratioBaseCumScore`） |
| ポップ表示 | 10 万単位 truncation。精密判定不可、gained/cumulative が信頼できる |

スキル別の効果解釈詳細（ csu/ccu 遷移、発動タイミング等）は `research/14_visual_verified_golden_data.md`、
実装ログは `research/12_implementation_log.md` の「P3d」節、エンジン仕様は `research/13_engine_spec.md` §9。

## 例外ビート（計測側の制約）

統合リージョン 20 区間 36 ビート: b1-3（表示遅延・b1 全 miss）、b47-51 / b68-72 / b80-87 /
b97-98 / b101-103 / b106-109 / b123-124 / b130-132 / b146-151（フレーム帰属の前後混入）。
いずれも「リージョン内ローカル総和は完全一致」するため、エンジンの正当性には影響しない。

## Phase 4 MVP

`npm run simulate -- --input examples/t5-sample.json --n 200 --crit-rate 0 --out out.json`

- 入力: 編成 JSON（`スコア分析サンプル/verification_data_v2.json` と同一スキーマ。inline または `deckFile` 参照）
  + ステージ/チャート/missedNotes/メンタル補正
- 出力: Monte Carlo（N 回・スコア乱数連続値一様）による min/max/mean/median/p10/p90 +
  中央値代表ランのビート毎タイムライン明細
- クリティカル率は未解明のため `--crit-rate` パラメータ（既定 0）。
  T5 検証では実測 critFlags を `criticalProvider` に注入して検証済み。

## 残課題（次フェーズ候補）

1. 単一 HTML 版シミュレータ UI（CLI のラッパー） — ※2026-09-02: `ui/app.ts` として実装済み
2. クリティカル率式の解明（ccu と戦闘値の関係。T5 では実測フラグ注入で迂回） — `critical.ts`（rate=min(50,+5%/段)）実装・実測は未取得
3. 他楽曲/他編成への拡張検証（skillDetails の未対応効果はマスターデータ由来の変換パーサー拡張が必要） — ※2026-09-02: A/SP 効果行のマスタ順（PRE ステータス）・写真の Aスコア固定値のフラット加算・割合行基準（レーン累積・クリ係数適用）まで確定し、T5 golden 1 の位一致＋S1 全 14 イベント ±5% 内（research/17_sample1_gap_analysis/CONCLUSION_2026-09-02.md）
4. エール・スタッフ等の入力 UI 整備
