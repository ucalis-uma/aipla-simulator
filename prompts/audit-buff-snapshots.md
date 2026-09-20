# バフスナップショット全件監査・修正セッション用プロンプト

## 0. 前提（最初に読む）

1. リポジトリルートの `AGENTS.md`（データ出典規律・作業終了規律が大元）
2. `PLAN.md` 末尾（Phase 13・S4 ロールバック中）
3. `research/12_implementation_log.md` 末尾（research/24 まで）
4. `research/22_sample4_rollback/progress.md`（S4 は全面無効・触れない）

このプロンプトは 2026-09-20 のセッション（S1・b8/b132 のヤル気士式手計算の中で発覚）からの引継ぎである。

## 1. 背景・発端（必読）

S1（ハイスコア1・`qt-area-1-001`）の 132 回目・3 番目の人のコンボ上昇について、
実測とシミュレータが食い違っている：

- 実測（`aipura_nox/サンプル1/measured_data.json`・timeline b132・L3 lanes effects）：コンボスコア上昇 **6段**
- シミュレータ（`research/17_sample1_gap_analysis/sim_trace_full.json`・b132・buffSnapshots[2]）：`combo_score_up: 16`

16 の出どころは時系列で特定済み（sim トレースの L3 `combo_score_up` 推移）：
b40 の L4 A（隣に 6 段）で 6 → b51 の本人 A（自分に 3 段）で 7（+1 しか増えない）→
b66・b123 の L1 A（増強・値 3。`sk-kkr-05-mizg-02-1` の `effect_amplify` 定義通り）で +3 ずつ →
b130 の L4 A 再発動で +6 が既存 10 に加算され **b131・b132 のみ 16** → b133 に 6 に戻る。

5 番目の人は実測 6 段・予測 6 段で一致している（L4 の付与だけが効く形）。
3 番目も実測は 6 段なので、本人分 3 段や増強分は実機では積み上がっていない。
すなわち `src/timeline/buffs.ts:384` の重ね合わせ加算（`snapshot[key] += stages`）が
実機と矛盾する疑いが濃い。ただし b51 の +1 止まり（上限クランプの疑い）など
付与ルール全体に未解明が残るため、単なる上書き変更で済むかは不明。

影響の大きさ：6 段で計算し直すと L3 は 69,153 点（表示 +71.3K に対し約 1031）、
回合計は約 1029 で範囲内に収まる。b132 の外れはこの重ね合わせで説明できる。
逆に言えば、従来の「回合計スコア比 ±5%」テストはこの種のバグを検出できない。
T5 ゴールデンも乱数を解いて合わせる方式なので、バフのズレを乱数が吸収する。
ステータス値の一致はステータス系バフしか縛らない。スコア系バフ（csu/cru/score_up 等）の
段数は一度も全件突合されていない。これが本タスクの穴である。

## 2. 完了条件（すべて満たすまで終わりにしない）

1. T5・S1・S2・S3 の全ビート×全レーンについて、実測の効果段数と sim スナップショットの
   差分表（CSV/JSON）を `research/25_buff_audit/` に出力し、不一致件数を数えること
2. 不一致の各件について、元スクショ（`aipura_nox/サンプルN/` の `L*_beat_*` 系フレーム）で
   実測側の正誤を確認し、measured 側の誤りは追記ファイルのみで訂正すること
   （既存 measured ファイルの削除・改名・上書きは禁止。aipura_nox 側規律を遵守）
3. sim 側の誤りと確定した箇所を修正し、不一致が 0 件か、残件すべてに理由付き注記がある状態にすること
4. バフ段数レベルの厳格なテストを追加すること（回合計テストの水増し・緩和は禁止。
   既存テストを弱めて通すことは禁止）
5. `npx vitest run` 全件 PASS＋`npm run typecheck` エラー 0＋T5 ゴールデン不変
   （`tests/golden/t5-scores.golden.test.ts`）をすべて満たすこと

## 3. 手順

### Step 1：差分表の機械生成

- 入力（存在確認してから使う。なければその旨を記録して進める）：
  - S1：`research/17_sample1_gap_analysis/sim_trace_full.json`（buffSnapshots）＋
    `aipura_nox/サンプル1/measured_data.json`（timeline[].lanes[].effects[]・`{name, stage}`）
  - S2：`research/20_sample2_gap_analysis/sim_trace_full.json`＋
    `aipura_nox/サンプル2/measured_data_v2.json`
  - S3：`research/21_sample3_gap_analysis/sim_trace_full.json`＋
    `aipura_nox/サンプル3/measured_data.json`（＋`measured_data_v2.json`）
  - T5：lane pops 遡及は 785 セル確定済みだが、効果段数の実測有無と sim トレース有無を
    先に確認すること。なければ S1〜S3 を先行し、T5 は対象可否を報告すること
- 実測の効果名（日本語）と sim のキー（英語）の対応表を作ってから突合すること。
  対応が取れない効果名は Unknown として数え、捏造しないこと
- 注意：PowerShell の `Get-Content` 既定では日本語が文字化けする。
  JSON は必ず UTF-8 明示で読むこと（`python -c "json.load(open(...,'utf-8'))"` 等）。
  文字化けをデータ誤りと誤認しないこと
- S4（`qt-ex-tower-004-054`）は全面無効化済み。混入禁止

### Step 2：実測側の検証（画像確認）

- 不一致件について、`aipura_nox/サンプルN/` の対応フレームを目視し、
  実測 effects の段数が正しいか確認する（効果ウィンドウ・バフドットの読み）
- 実測の誤りは追記ファイルのみ（`measured_data*_fix.json` 形式。S2 の OCR 修正の前例参照）。
  元ファイルは変更しない

### Step 3：sim 側の特定・修正

- 既知の容疑箇所：`src/timeline/buffs.ts` の `aggregateBuffs`（重ね合わせ加算）、
  上限クランプ、`engine.ts` の `amplifyLongestOfKey`（増強 +3/+5）、付与タイミング
  （発動回は旧値・翌回から反映。b40→b41 の適用パターン）
- b51 の +1 止まり（上限クランプの疑い）と b66/b123 の増強 +3 の整合性を先に解明し、
  それから b130 の積み上げ可否を判定すること。単独ビートの修正で終わらせないこと

### Step 4：厳格なテスト

- 全サンプルの全ビート×全レーンのバフ段数をゴールデン化する方向で追加する
  （少なくとも不一致だったキー種別は全件カバー）
- 回合計テストは残してよいが、バフ段数テストなしに回合計テストだけで OK としないこと

## 4. 前セッションの副産物（参照用・結論のみ）

- S1・b8 のヤル気士式（`basicSum × 1/20`＋フォト beat% 合計＋固定値 L1+1300/L2+230/L4+639）は
  全 5 レーン範囲内（約 954〜1040）。ファン内訳：会場 100 人→個人 20 人、引力配分
  （L3 focus7=1350・他 1000）で L1 等 19 人（+0.1%=1→1001）、L3 25 人（+0.2%=2＋注目加算 41→1043）
- S1 全 174 回のヤル気士式スキャンでは 11 回が範囲外だが、すべてクリ・スキル回で、
  外れは L3 クリ倍率に集中（b132 等）。b8（唯一の完全クリーン回）は完全適合
- 一時スクリプトが `C:\Users\umaro\AppData\Local\Temp\opencode\` に残っている
  （`s1_yaru_scan.py`・`s1_b132.py` 等）。Temp のため消えている可能性があり、
  あれば参考、なければ本プロンプトの数値から再導出すること

## 5. 検証コマンド

- `npx vitest run`（全件 PASS・1 skipped まで許容）
- `npm run typecheck`（エラー 0）
- T5 ゴールデン：`npx vitest run tests/golden/t5-scores.golden.test.ts`
