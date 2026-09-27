# Phase 15 引継ぎプロンプト（Phase 14-F 採用後の残課題）

作成: 2026-09-27（Phase 14-F 採用セッション）。次セッション（どのエージェントでも可）の
手順書兼チェックリスト。作業開始前に AGENTS.md / PLAN.md / `research/12_implementation_log.md` 末尾（Phase 14-F）を読む。

## 0. 現在の状態（出発点の確定値）

| 項目 | 値 |
|---|---|
| T5 golden（replay 総合・`t5-scores.golden.test.ts`） | **17,521,599,508**（実測 17,529,132,014 に対し誤差 0.043%） |
| T5 golden（confirmed・`cli-myphotos` / `ui-pipeline` / `buff-snapshots.audit`） | **2,581,114,209** |
| バフ監査一致率 | **3層定義に更新**（`research/25_buff_audit/match_rate_definition.md`）。strict: S1 95.75% / S2 89.76% / S3 91.73% / T5 78.83% → **adjusted: 4サンプルとも100%・residual 0件** |
| テスト | `npx vitest run` **504 passed / 1 skipped**（41 ファイル）、`npm run typecheck` 0エラー |
| 単一HTML UI | `dist/aipura_simulator.html` は **2026-09-27 再ビルド済み（14-E/14-F 反映・4,454KB）**。UI確定値 golden は `2,447,170,546` / `112,669,861`（旧 2,446,493,589 / 112,623,系） |

基準値の根拠: `research/12_implementation_log.md` Phase 14-F、`research/26_data_integrity/phase14f_revival_audit.md`。
**この 2 値を変えたくなった場合は、まず §規律 を読むこと**（スコア合わせのフィッティングは禁止）。

### 0-2. 現行監査の残不一致の内訳（2026-09-27 再生成分・次の作業は「ここを減らす／意味を決める」）

各 diff JSON は `summary.category_counts` に理由タグを持ち、`diffs[]` の `note` にも同じタグが入る。
**S1〜S3 の残不一致はすべて理由タグ付きで `DECAY_TIMING_LAG` は 0 件**（＝減衰タイミングの未説明ズレは解消済み）。

| サンプル | 比較した measured / sim trace | セル | 一致 | 一致率 | 残不一致の内訳 |
|---|---|---|---|---|---|
| S1 | `../aipura_nox/サンプル1/measured_data.json` / `research/17_sample1_gap_analysis/sim_trace_full.json` | 1,695 | 1,623 | 95.75% | PHASE_LAG_ACTIVATION 72 |
| S2 | `research/26_data_integrity/measured_data_s2_v3.json` / `research/20_sample2_gap_analysis/sim_trace_full.json` | 1,367 | 1,227 | 89.76% | PERSISTENT_SP_BUFF 74 / EXTREME_DISPLAY_VS_EFFECTIVE 36 / PHASE_LAG 30 |
| S3 | `research/26_data_integrity/measured_data_s3_v3.json` / `research/21_sample3_gap_analysis/sim_trace_full.json` | 1,668 | 1,530 | 91.73% | EXTREME_DISPLAY_VS_EFFECTIVE 85 / PHASE_LAG 53 |
| T5 | `スコア分析サンプル/measured_data_v3.json` / `research/25_buff_audit/t5_sim_trace_full.json` | 3,411 | 2,689 | 78.8% | FLAG_NOT_STAGED（`combo_continue`）653 / PHASE_LAG 69 |

- **T5 の 722 件のうち 653 件は `combo_continue`（段数を持たないフラグ系バフ）**。`research/25_buff_audit/run_audit_v3.py`
  は `summary.category_counts` を出力しておらず、タグは `diffs[].note` の先頭（`FLAG_NOT_STAGED`）にのみ存在する。
  段数比較が成立しないセルを不一致に計上している可能性が高く、**78.8% という見かけの低さはほぼこれが原因**
  → 15-2/15-3 で「一致率の定義」を直す第一候補（エンジン修正ではなく監査側の分類整理から始める）。
- S3 の EXTREME_DISPLAY 85 件は L4 `visual_up_extreme` が大半（b14 以降の超化系の表示段数）。
  S2 の PERSISTENT_SP_BUFF 74 件は L3 `sp_skill_score_up`（b94 以降）。どちらも表示仕様側の問題が主とみられる。
- **S1 に `DECAY_TIMING_LAG` が 1 件も無い**ことは 15-1 の前提を変える（下記 15-1 を参照）。


## 1. 残課題（優先度順）

### 15-1 S1 b136 における「Step 11 では満了バフが復活しない」仮定の独立検証 ✅完了(2026-09-27)

**完了記録**: 専用ツール `tools/audit_s1_b136_step11.ts`（新規）で作成した対照2本
（`s1_b136_step11_audit.json` / `s1_b136_step11_audit_step11revival.json`）により、
**現行モデル（Step 11 は満了バフを復活させない）が b137〜b143 の一次実測 14 セルすべてと一致、
復活模型は 0/14**（実測 0 のセルに 3段・6段が立つ／中立スコアも +8.94% 膨らむ）と確定。
手順 A はクローズ。詳細と再現手順は `research/26_data_integrity/phase14f_revival_audit_appendix.md`。
対照実験で一時的に engine を編集したが、取得後に復元済み（`git status` に engine の差分なし）。

Phase 14-F の `expiredThisBeat` 復活は Step 7/8 だけを対象にし、Step 11（同ビート満了バフ延長）は
対象外にしている。この境界は **実装コメントの記述に依存**しており、S1 b136 の実測セルで直接
裏取りしていない（`phase14f_revival_audit.md` §6 手順 A が未実施）。

手順:
1. `npx tsx tools/debug_s1_l1_vocalup.ts` で S1 L1 vocal_up の付与・延長・消滅ビートを出力
2. 実測側の該当セルを直接参照（**measured_data の場所が3系統あって紛らわしい**）:
   - S1: `../aipura_nox/サンプル1/measured_data.json`（git 管理外。`run_audit_post_decay.py` L332 が読む現行のファイル）
   - S2: `research/26_data_integrity/measured_data_s2_v3.json` / S3: 同 `measured_data_s3_v3.json`（L338/L344）
   - T5: `スコア分析サンプル/measured_data_v3.json`（`research/25_buff_audit/run_audit_v3.py` L242 が読む）
   - 旧 `research/26_data_integrity/measured_data.json` は **S2 の旧データ**なので注意
3. b136 の実測段数が「延長なし（満了扱い）」なら Step 11 非復活は正しい → 監査メモへ証拠を追記してクローズ
   「延長あり」なら Step 11 にも復活ロジックが必要 → engine L726-735 に同型の復活を追加して再監査

**前提の更新（2026-09-27 再生成）**: S1 の残不一致はすべて `PHASE_LAG_ACTIVATION`（72件）で
`DECAY_TIMING_LAG` は 0 件。`fix-remaining-buff-mismatches.md` が挙げた b136〜b143 の延長過剰は
現状のモデルで解消している。したがって本項目は**スコアを動かさない「証拠の固定」**が目的
（実装コメント依存 → 一次 measured セル依存へ置き換える）。b136 で莉央 P3 の全員延長が
満了インスタンスを復活させていないことが測れていれば、`phase14f_revival_audit.md` §6 手順 A を
「実施済み」に更新してクローズしてよい。engine の行番号は動くので `expiredThisBeat` で検索すること。

### 15-2 PHASE_LAG_ACTIVATION の方針決定 ✅完了(2026-09-27・①採用)

**決定**: ①**監査側で許容**（エンジン側は PRE 保持を維持）。③（sim の位相を POST に寄せる）は不採用。
理由はスコア計算の発動→加算順と表示値の意味が二重にずれるため。詳細は
`research/25_buff_audit/match_rate_definition.md` §3。
実装は 3 層定義の **adjusted 層**として行い、位相セルは `explained_display_phase` に明示計上した
（S1 72 / S2 30 / S3 53 / T5 69 = 合計 224 セル）。規則は `display_spec_rules.json` の
`PHASE_LAG_ACTIVATION` / `PHASE_LAG_DECAY`（黙示 skip ではなく JSON 側の明示リスト）。

発動ビートのセルで measured=即時反映・sim=翌ビート反映となる差。実装上は意図的（バフは発動ビートの
スコアに反映され、表示は翌ビート）だが、監査では「不一致」として計上され続けている。
→ ①監査側で許容（表示位相の別カテゴリへ整理）②sim の snapshot 発行を1ビート早める ③実測の撮影位相を再定義
のいずれかを選んで**クローズ**する。決定は `research/25_buff_audit/` の監査スクリプトと md に記録。

### 15-3 EXTREME_DISPLAY_VS_EFFECTIVE / PERSISTENT_SP_BUFF の扱い ✅完了(2026-09-27・文書化＋明示除外)

**決定**: エンジンで模倣せず**文書化して明示除外**。除外リストは
`research/25_buff_audit/display_spec_rules.json`（v1・規則ごとに condition と evidence を持つ）。
`known_anomalies.json` は未作成で、同等の役割をこの rules JSON が担う（コード側に黙示 skip なし／
どの規則にも入らないセルは `UNCLASSIFIED` として residual に残る設計）。
ヒット数: 超化表示 S2 36 + S3 85 / SP永続表示 S2 74 / フラグ単位 T5 653（＝`combo_continue` は
**段数ではなく表示の有無で照合**し、有無が食い違えば `FLAG_PRESENCE_MISMATCH` として residual に落とす。
T5 は 653 セルすべて有無一致＝真の不一致 0）。

S3 `visual_up_extreme` L4 = 87件、S2 `sp_skill_score_up` L3 = 74件、S2 `PERSISTENT_SP_BUFF` = 74件が dominant。
表示仕様（上限 clamp・非表示バフ）側の問題でエンジン修正の余地は小さいとみられる。
→ **文書化して監査除外リストに入れる**か、エンジンで模倣するかの判断。除外する場合は
`known_anomalies.json` 方式で黙示 skip を作らず明示する（PLAN.md §16 の規律）。

### 15-4 Phase 14-F の S1 単独寄与の分離トレース
S2/S3 は HEAD/採用後でバフスナップショット差分 0セルを確認済み。S1 は HEAD でも b136 前後が
消えているため、14-F 単独の寄与を単独トレースで示せていない（`phase14f_revival_audit.md` §6 手順 B）。
→ HEAD と 14-F 採用後で S1 のみ trace を突き合わせ、差分セルを全件列挙してメモ化。

### 15-5 単一HTML UI の再ビルド ✅完了(2026-09-27)

`node tools/build_ui.mjs`（4,454KB）→ `npx vitest run tests/ui` **43 passed**。
エンジン変更（14-E/14-F）が UI バンドルに反映され、UI 確定値 golden が動いたため
`tests/ui/smoke.test.ts` の 3 箇所を更新（入力・撮影条件は同一で差分はエンジン側のみの寄与）:

| 箇所 | 旧（2026-09-21 ビルド） | 新（2026-09-27 ビルド） |
|---|---|---|
| T5 プリセット確定値 | 2,446,493,589 | **2,447,170,546**（+0.0277%・14-F の T5 寄与 +0.029% と同符号同 magnitude） |
| 設定 JSON import ケース | 112,623,系 | **112,669,861**（+0.04%） |

```
node tools/build_ui.mjs && npx vitest run tests/ui
```
Phase 14 完結時に一度ビルドしたきり。Phase 14-E/F のエンジン変更が未反映である旨を
`research/12_implementation_log.md` に記録して再ビルドする。

### 15-6 S4 の再撮影・取り込み（別系統・ユーザーのライブ実行あり）
`prompts/rollback-recapture-sample4.md` / `research/22_sample4_rollback/progress.md`。
`samples_decay_audit.md` の S4 列は「13-B相当が未実施」と書かれたまま。**撮影は aipura_nox 側作業で
ライブチケットを消費するため、ここだけ着手前にユーザーに確認する。**
レーン別スコアポップ記録は必須（AGENTS.md 最重要事項）。

## 2. 再実行コマンド（作業前後で必ず両方）

```
npx vitest run          # 504 passed / 1 skipped が基準
npm run typecheck       # 0 エラー
node --experimental-strip-types tools/dump_buff_snapshots_s1_s3.ts
python research/26_data_integrity/run_audit_post_decay.py   # ← python 実行（node ではない）
python research/25_buff_audit/run_audit_v3.py               # ← 同上
```

Phase 14-F の ON/OFF 比較をもう一度やる場合（15-1/15-4 で有用）:
`research/26_data_integrity/phase14f_revival_audit.md` §6（OFF 版 trace の作り方と
`audit_phase14f_divergence.mjs --off <OFF trace>` の実行例）。OFF 版 trace はリポジトリに置いていない。

## 3. 規律（過去に実際に失敗したこと）

- **スコアが動いたことを口実に `rands` を再取得し直さない**。スコア差分はバフセルの符号・件数で
  説明できるはず（Phase 14-F 監査 §5-3 がその失敗教訓）。
- 推測実装には【Estimate】/【Unknown】。読めない値の捏造禁止（null + 注記）。
- `aipura_nox/サンプル*/` の既存ファイルは変更・削除しない（修復は追記のみ）。
- BWIKI 由来データの数値利用禁止（`research/03_data_sources.md`）。
- 作業終了の規律（AGENTS.md）: 完了条件を満たすまでチャットに中間結果を書かない。
  途中結果は `research/` のメモ・JSON・ログ・todo に記録する。
