# Phase 16 Action 9c — スタミナ消費の仕様 3 点修正（F1/F2/F3）と隠れセルゲート（A10）

- 手順書: `prompts/phase16-action9c-cost-spec-and-photo-gate.md`（2026-10-02 承認済み）
- 実施: 2026-10-02 ／ 変更ファイル: `src/timeline/buffs.ts`（F1）・`src/timeline/engine.ts`（F2）・
  `src/sim/build.ts`（F3）・`tools/audit_hidden_cells.mjs`＋`tools/audit_hidden_cells_sim.ts`（A10 新設）・
  `package.json`（`audit:hidden`）・`AGENTS.md`・テスト 5 本（`goldenPhotoNames` の明示供給）
- 生ログ: `phase16_action9c_out_baseline.txt` / `_F1.txt` / `_F2.txt` / `_F3.txt` / `_F3legacy.txt`
  （ハーネス `phase16_action9c_cost_spec_harness.ts` の出力）／
  `phase16_action9c_t5_golden_stages.txt`（T5 ゴールデンの段階別記録）／
  `phase16_action10_audit_out_preF3.txt`（F3 前・FAIL）・`phase16_action10_audit_out.txt`（F3 後・PASS）／
  `phase16_action9c_models_S1S2S3.txt`・`phase16_action9c_models_S1S2S3_after_F3.txt`（基準ハーネスの出力）

---

## 1. 結論（受け入れ 8 項目はすべて充足）

| # | 検査 | 基準 | 実測（最終） | 判定 |
|---|---|---|---|---|
| 1 | S1 総合 | `+0.25%` 級（1% 以内） | sim 116,829,040 / 実測 116,537,513 = **+0.25%** | ✅ |
| 2 | S1 L1 スタミナ系列 | 176/176 一致（F2 後に b60 を再確認） | **176/176 完全一致**（F2 で達成・A10 `--ledger` では S1 全 5 レーン 100%: 176/175/176/176/172） | ✅ |
| 3 | b70×L5 | sim が `stamina_short` で 0 | `A:こりごり二日酔い **FAIL**(stamina_short)`・セルスコア **0** | ✅ |
| 4 | b4×L2 / b34×L2 / b169×L3 | sim が発動・pop 実測と同オーダー | cost 1,131 / 1,131 / 492 で発動・セル **2,318,611 / 3,096,117 / 2,329,970**（実測 2.3M / 2.9M / 2.5M） | ✅ |
| 5 | S3 総合 | 乖離の絶対値が −1.32% 以内 | sim 78,485,270 / 実測 79,411,389 = **−1.17%** | ✅ |
| 6 | S2 総合 | 乖離の絶対値が +37.40% 以内 | sim 74,895,810 / 実測 77,732,383 = **−3.65%**（37.40% 以内） | ✅ |
| 7 | vitest 全件 + typecheck | 全て緑 | **41 files / 519 passed / 1 skipped**・typecheck 0 errors | ✅ |
| 8 | `audit_audience.mjs` / `dump_lane_pops.mjs` | 既存検査が緑のまま | 両方 exit 0（＋新設 `npm run audit:hidden` = **PASS / exit 0**） | ✅ |

- **T5 ゴールデンは 4 段階すべて不変**（下記 §4-1）。
- 「−1.32%」「+37.40%」は**9b 手順書の値が再現しない**ため、基準ハーネスで測り直した値を上の表に使った（§6-2・§6-3）。

---

## 2. 実装した修正

### F1: 消費スタミナのブースト副効果は**属性不問**（全属性の段数合計）

- `src/timeline/buffs.ts` の `consumptionMultiplierPermil(snapshot, attr?)` を
  `consumptionMultiplierPermil(snapshot)` に変更し、ブースト項を
  `vocal_boost + dance_boost + visual_boost` の**合計**にした（`attr` 引数は撤去）。
- 呼び出し側: `engine.ts` の `staminaCostOf(skill, snap, stageWeightPermil?, attr?)` からも `attr` を撤去し、
  2 箇所（`tryActivate` / `settleSkillNote`）を更新。JSDoc の「自属性ブーストのみ」記述を実測確定へ差し替え。
- **証拠（`phase16_action9c_out_F2/F3.txt` §[7]・§[6]）**:
  - S3 L3 b13/b73: 実測 **2,085** = `floor(662×3)×1.05` に対し engine も **2,085**（旧 1,986 で不一致）
  - S3 L1 b51: A **1,159** / P **1,449** = `368×3×1.05` / `460×3×1.05`（旧 1,104 / 1,380）
  - 系列一致率の改善: S3 **L1 48/169 → 167/169**・**L3 10/169 → 162/169**（S1 L2-L5 は元から 100%）
  - **回帰セル（自属性ブーストの特殊例・不変）**: S3 L4 b1/b3/b14/b42/b61 = **1884 / 1939 / 1386 / 1272 / 1884**（1 の位まで一致）
- テスト: `tests/unit/timeline/buffs.test.ts`（多属性合計の 1 件を追加）・
  `tests/unit/timeline/sample3-specs.test.ts`（「自属性のみ」前提の 3 アサーションを実測確定へ差し替え）

### F2: 最終ビート（phase=last）の消費は「そのビートに表示されているブースト」で課金

- `engine.ts` に `snapshotOf(state, includeExpiredThisBeat = false)` を追加。`true` のとき
  **当ビートのステップ10で `remainingBeats` が 0 になったインスタンス**（＝実機でそのビートに表示され、
  翌ビートで消える boost）も集計に含める（`aggregateBuffs` は rem>0 を要求するため rem=1 として渡す）。
- `tryActivate` で `const costSnap = phase === "last" ? snapshotOf(state, true) : snap;` とし、
  **コスト評価だけ**を表示状態に合わせた（採点用 `buffSnapshots`＝ステップ7 の意味論は不変）。
- **証拠**: S1 L1 b60 photo = **681**（実測 681 = 662×1030‰。旧 engine 662）。b120（寿命途中）は従来どおり 681 で不変。
  **S1 L1 系列が 59/176 → 176/176 に回復**（F2 前の不一致は b60 以降の +19 の定数ずれ＝この 1 件のみ）。
  9b の全件走査どおり**該当はこの 1 セルだけ**（S1 の他 175 ビート・S2/S3 は不変）。
- **【Unknown】残る未確定点**: 「最後のビートも通常どおりの発動順ではないか」は依然として未確定。
  切り分けには**同一譜面・別編成**（ブースト最終ビートが後半発動と重なる編成）の追加観測が必要で、
  撮影条件は `prompts/measure-new-sample.md` に依頼形で追記する（本アクションでは撮影しない）。

### F3: カード枠フォトのゲートを**既定 off** に（実機に無い発動を止める）

- `src/sim/build.ts` の `goldenPhotoSkillApplies` を `goldenNames === undefined ⇒ return false` に変更
  （旧: `⇒ return true`＝未指定なら全件注入）。オプション `goldenPhotoNames` と関数の JSDoc を実測確定へ更新。
- 実測再現側は**必ず名前を渡す**（CLI `loadGoldenPhotoNames()` / UI `GOLDEN_PHOTO_NAMES` /
  `tools/analyze_beat_score_models.ts` は元から渡している。S1 は deck の `disabledSkillIds` で無効化）。
- テスト側の供給を明示（F3 で挙動が変わる 5 本）:
  `tests/golden/t5-scores.golden.test.ts`・`tests/unit/sim/ui-pipeline.test.ts`・`tests/unit/sim/build.test.ts`・
  `tests/unit/timeline/buff-snapshots.audit.test.ts`（T5 節）・`tests/unit/photo-link.test.ts`
  （＋「未指定なら注入しない」を新アサーションとして追加）。
- **供給元の洗い出し（`goldenPhotoNames` を grep）**: 実測再現側はすべて渡している
  （`src/cli/simulate.ts` の `loadGoldenPhotoNames()`・`ui/app.ts` の `GOLDEN_PHOTO_NAMES`・
  `tools/analyze_beat_score_models.ts`（4 箇所すべて）・`tools/dump_samples_trace.ts`・
  `tools/audit_hidden_cells_sim.ts`・`research/23` の 9c ハーネス）。
  `src/optimizer/index.ts` は `options.goldenPhotoNames` をそのまま素通しする設計（未指定＝ゲート off が正しい既定）。
  `tools/t5_solver.ts` は T5 実測デッキを使うのに未指定だったため、**F3 で名前を渡すよう修正**した
  （テストと同じ「デッキ自身のフォト名＝T5 実測名」）。**過去の診断用ツール**
  （`tools/debug_*`・`tools/dump_*`・`tools/trace_*`・`research/17〜22` の trace）は未指定のままなので、
  F3 後は golden フォトスキルが入らない。これらの出力を実測と比べるときは名前を渡す改造が要る（歴史的成果物は再実行しない限り影響なし）。
- **証拠（A10 の sim ダンプ・同条件）**: photo-gate=off（素の既定）と on（受け入れ経路）が
  **S1 114,162,150 / S2 74,669,710 / S3 77,425,702 で完全一致**（F3 前は off 側が
  S2 100,896,903・S3 73,020,495 と大きく違っていた）。研究ハーネスの `--legacy` も F3 後は既定と同一値。
- 除外したのは**スキル（発動）だけ**。フォトの統計値は `equipmentForScore` 経路のまま温存（Phase 12 の確定事項に反しない）。

---

## 3. A10: 隠れセルゲート（新設・F3 の安全弁）

`prompts/phase16-action10-hidden-cell-gate.md` の要求どおり、A8 の 2 本
（実測側 `phase16_action8_pop_vs_lane_total.mjs` / sim 側 `phase16_action8_sim_hidden_cells.ts`）を
**1 コマンドに移植**した（テキスト出力の正規表現読みは廃止し、sim 側は engine を直接叩いて JSON を得る）。

- 追加: `tools/audit_hidden_cells.mjs`（ゲート本体）・`tools/audit_hidden_cells_sim.ts`（sim セルダンプ）・
  `package.json` の **`audit:hidden`**・`AGENTS.md` の実効検査行・詳報 `phase16_action10_report.md`
- ゲート: 比 = `sim(pop読込不能セル) ÷ (レーン合計 − Σpop)`、**≥2.0 = FAIL / 1.5〜2.0 = WARN / FAIL で exit 1**。
  Σpop は「統合（内生＋遡及）」と「内生のみ（A8 口径）」、sim は photo-gate off/on を併記し、**最悪値**で判定（閾値は緩めない）。
- **F3 前（`phase16_action10_audit_out_preF3.txt`）**: photo-gate=off で
  **S3 L5 = sim(隠れ) 4,039,884 / 隠れ枠 525,474 = 7.69×（A8 と同値・内生口径）**、
  統合口径では 3,801,360 / 304,474 = 12.49× → **FAIL / exit 1**（S3 sim 合計 73,020,495 = A8 と一致）。
- **F3 後（`phase16_action10_audit_out.txt`）**: off ≡ on となり
  **S3 L5 = 262,374 / 304,474 = 0.86×（統合）・500,898 / 525,474 = 0.95×（内生）→ PASS / exit 0**。
  off モードは常時走るので、**素通りが再導入されたらこのゲートは再び FAIL する**。
- `--ledger` でスタミナ系列も同時検査（**S1 L1 176/176**・S1 全レーン 100%）。

---

## 4. 段階別の記録

### 4-1. T5 ゴールデン（`npx tsx src/cli/simulate.ts --input examples/t5-sample.json --n 0 --crit-rate 0`）

| 段階 | confirmed 確定値 | 備考 |
|---|---|---|
| 9b 時点（基準） | 2,581,114,209 | — |
| **F1 適用後** | **2,581,114,209** | 不変 |
| **F2 適用後** | **2,581,114,209** | 不変 |
| **F3 適用後（最終）** | **2,581,114,209** | 不変 |

- `tests/golden/t5-scores.golden.test.ts` のリプレイ **17,521,599,508** も不変・緑（F3 後も名前を渡す経路のため）。

### 4-2. サンプル総合（基準ハーネス `tools/analyze_beat_score_models.ts --samples S1,S2,S3`・legacy 経路）

| 段階 | S1 | S2 | S3 |
|---|---|---|---|
| 9b/A9 時点（今回の再測・F1 前） | 116,829,040 = **+0.25%** | 74,895,810 = **−3.65%** | 78,485,270 = **−1.17%** |
| F1 後 | 116,829,040（不変） | 74,895,810（不変） | 78,485,270（不変） |
| F2 後 | 116,829,040（不変） | 74,895,810（不変） | 78,485,270（不変） |
| F3 後 | 116,829,040（不変） | 74,895,810（不変） | 78,485,270（不変） |

（9c ハーネスの既定＝同じ legacy 経路でも同値。`--lanefans` の A4 経路は別値: S1 114,162,150 / S2 74,669,710 / S3 77,425,702
＝A10 の表はこちらを使う。**モードを混同しないこと**）

### 4-3. スタミナ系列の一致率（A6 規約: sim `staminaAfter[beat]` vs 実測 `current_stamina[beat]`）

| 段階 | S1 L1 | S3 L1 | S3 L3 | S3 L4 | S3 L5 |
|---|---|---|---|---|---|
| F1 前（基準） | 59/176 | 48/169 | 10/169 | 169/169 | 167/169 |
| F1 後 | 59/176 | **167/169** | **162/169** | 169/169 | 167/169 |
| F2 後 | **176/176** | 167/169 | 162/169 | 169/169 | 167/169 |
| F3 後 | 176/176 | 167/169 | 162/169 | 169/169 | 167/169 |

### 4-4. T3 の 4 セル（F3 前後で不変・F3 前から期待どおり）

| セル | sim | 実測 | 判定 |
|---|---|---|---|
| b70×L5 | `A:こりごり二日酔い FAIL(stamina_short)`・セル 0 | FAIL（スタミナ不足） | ✅ |
| b4×L2 | `A:新たな衣装とさらなる飛躍` cost 1,131・セル 2,318,611 | 成功（pop 2.3M） | ✅ |
| b34×L2 | `A:新たな衣装とさらなる飛躍` cost 1,131・セル 3,096,117 | 成功（pop 2.9M） | ✅ |
| b169×L3 | `A:殻をやぶる` cost 492・セル 2,329,970 | 成功（pop 2.5M） | ✅ |

- 4 セルは**基準ハーネス構成（goldenPhotoNames を渡す経路）では F1 前から既に正しい**。
  9b が「現行 ❌」と判定したのは 9b ハーネスが名前を渡していなかった（＝F3 の素通り）ためで、
  ゲートを渡す経路（`--probe` 相当）では 4 セルは正しい。F3 はこの「渡し忘れで壊れる」状態を既定から消した。

---

## 5. 回帰の観点（手順書 §5 追加分）

- **S3 L4 の visual_boost セル**: b1/b3/b14/b42/b61 = 1884/1939/1386/1272/1884 で**不変**（F1 の回帰セル）。
- **S1 の 176 ビート系列**: F2 後に全ビート 100%（L1-L5 合計 875/875）。
- **S4**: `サンプル4/` は measured_data が無い無効撮影回のため本アクションの対象外
  （A10 も「除外: S4 = 無効撮影回」と出力）。visual_boost の段数セルは S3 L4 で代替確認した。
- 9b 手順書 §8 の禁止事項は遵守（全局乗数 `STAM_*` は未変更・`../aipura_nox/サンプル*/` は読み取りのみ・
  `buffSnapshots` の意味論は不変・撮影なし）。

---

## 6. 調査で判明した事実（9b の記述の訂正を含む）

1. **9b の研究ハーネスはクリティカルが空だった**（`measured_data` の `critical_flags` ラッパーを見ておらず、
   `raw.beats` を直接読んでいた）。そのため 9b の総合値（S1 −51.49% 等）は**過小**で、比較に使えない。
   9c ハーネスで修正し、基準ハーネスと 1 円まで一致する総合値が出るようになった
   （S1 116,829,040 等）。**9b の §1 の総合値・9c の baseline 出力（クリ修正前）は参考値に格下げ**。
2. **受け入れの総合値の基準は `tools/analyze_beat_score_models.ts`**（`goldenPhotoNames`・`resolveAudience`・
   サンプル固有の修正を渡す唯一の経路）。9b 手順書の「S2 +37.40%」は S2 総合として再現せず
   （A8 の S3 L5 レーン比 72.8%→1/0.728 = 1.374 と同値。**S3 L5 のレーン比の派生値**とみられる）、
   実測可能な S2 総合は **−3.65%**。「S3 −1.32%」も現行は **−1.17%**（9b のログから動いている）。
3. **`laneFans`（A4 のレーン別来場数モード）と `audience`（legacy）は合計が違う**
   （S3: 77,425,702 / 78,485,270。S1: 114,162,150 / 116,829,040）。A10/A5 のレーン表は laneFans、
   受け入れ 8 項目の総合は legacy。**表にモードを必ず書く**。
4. **A6 の「S1 L1 176/176」は F2 前の engine では再現しない**（実測 59/176・b60 以降が +19 ずれ）。
   A9b §5-3 の【要確認】はこれで解決し、**F2 が 176/176 を成立させた**（F2 はこの 1 セルだけを直す）。
5. **S1 の deck は `disabledSkillIds` で `photo-L1-1`〜`photo-L5-4` を全部無効化している**
   ＝S1 だけは F3 の影響を受けない（off/on で同一）。S2/S3 は deck に無効化リストが無いため F3 の効果が大きい。
6. S3 の残る系列不一致（L1 b1/b51・L2 b60・L3 b1/b2/b13/b24/b73/b79・L5 b2/b50）は
   **A9c の 3 修正では動かない既知の未解決セル**（b1 の初期スタミナ・b13/b73 の写真コスト読取位置など）。
   F1 で L3 は 10/169 → 162/169 まで回復しており、残りは別アクションの対象。

---

## 7. 検証コマンド（最終実行・すべて緑）

```powershell
npx vitest run            # 41 files / 519 passed / 1 skipped
npm run typecheck         # 0 errors
node tools/audit_audience.mjs                 # exit 0（S1 の audience 誤読は従来どおり自動補正の表示）
node tools/dump_lane_pops.mjs S1,S2,S3,S4     # exit 0
npm run audit:hidden                          # A10 ゲート: PASS / exit 0（--ledger 相当は --ledger を付けて実行）
npx tsx research/23_beat_score_analysis/phase16_action9c_cost_spec_harness.ts F3   # 受け入れ表の再取得
npx tsx tools/analyze_beat_score_models.ts --samples S1,S2,S3                     # 公式総合値の再取得
```
