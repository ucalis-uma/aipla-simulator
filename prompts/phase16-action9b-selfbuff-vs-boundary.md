# Phase 16 アクション9b 手順書 — ①自己バフ課金 vs ②持続境界の分離 ＋ A9 の残件を閉じる

- 前提: **A9 は完了条件を全部は満たさずに終了している**（実装ログ §Phase16 / Action 9・コミット `3feefc7`）。
  成果物（`phase16_action9_photo_ledger.ts` / `_out.txt` / `phase16_action9_photo_cost_conclusion.md`）はコミット済み。
  未達は「完了条件 4（T3 予測→模擬）」「6（`phase16_action9_report.md`）」「7（コミット）」＋
  「2（α/β/γ の裁定）」「3（±6% 成因 4 候補の全潰し）」の不足分。
- 出発点の確定値: T5 golden **2,581,114,209** ／ `npx vitest run` = **41 files / 518 passed / 1 skipped** ／
  `npm run typecheck` 0 エラー ／ `node tools/audit_audience.mjs` = NG 1 件（S1 の既知の audience 誤入力のみ）
- 目的: A9 が「①発動 act 自身の boost を自 act の cost に織り込む」と「②boost 持続境界が実機で 1 ビート長い（off-by-one）」
  の**2 仮説を分離できずに終えた**のを、既存データだけで 1 つに寄せる。そのうえで engine 修正の可否を判断できる形にする。

## 0. A9 が確定させたこと（なぞらない・ここから始める）

- engine の cost は**発火時点の live 状態**で決まる（`src/timeline/engine.ts:1435-1436` の `snapshotOf`）。
  一方 Harness が見る `buffSnapshots` は **scoring 時点＝そのビートの全 act 後**（`engine.ts:272`）。
  → A6 の「±6% 揺らぎ」は**この live/snapshot の取り違えが入口**だった（同じ値の比較ではなかった）。
- act 単位の実測 cost から逆算する段数模型は `cost = 原価 × ステージ重み/1000 × (1000+10n)/1000`（n = 自属性 boost 段数）。
- 照合 6 件 / 差ゼロ以外 5 件 / **±6% 帯域内の残差は 2 件だけ**:
  - **S1 b60 L1 伊吹渚 6/22**: engine **662**（発動時 0 段）vs 実測 **681** = `662 × 1030‰` → ①②のどちらでも出る（**分離不能**）
  - **S3 b13 L3 成宮すず 6/24**: engine **1986** vs 実測 **2085**（+4.98%）→ self-buff を足しても足りない【未説明】
- 帯域外 3 件（S3 b1 L5 +47.8% / S3 b2 L5 +200.0% / S2 b1 L3 −39.2%）は「揺らぎ」ではなく
  台帳原価・実測の読み取り・sim の boost 源欠落の別問題。**混ぜない**。
- 「同一ビート内の他 act との発動順」が原因の act は S1/S2/S3 で **0 件**（A6 の「発動順ズレ」は不支持）。

## 1. 既知の欠陥（**先に直す。A9 の [B] の数値を鵜呑みにしない**）

A9 台帳 `[B]` が出す「deck→sim の供給対照: **原価一致 0 / 不一致 n**」は**実データの誤りではない**。
比較が**添字合わせ**になっているため:

```
phase16_action9_photo_ledger.ts:548
  for (let i = 0; i < pairs; i++) { if (simL[i].stock === deckL[i].stock) same++; else diff++; }
```

`simL` はカード枠フォトを含む**レーンの全 stock**、`deckL` は**マイフォトのみ**なので添字がずれる。
出力から機械的に確認できる（`_out.txt` の S3 節）:

| レーン | deckL（マイフォト） | simL（カード枠が先頭） | 出力 |
|---|---|---|---|
| S3 L1 | 成宮すず 3/7 [662] | 私たちらしく[764], 屋外プール[1563], おはよう[879], **成宮すず 3/7[662]** | i=0 同士で 764≠662 → 不一致 1 |
| S3 L5 | 神崎莉央[266], 早坂芽衣[733], 佐伯遙子[540], 小美山愛[706] | カード枠 4 件（180/180/2016/904）→ **その後**にマイフォト 4 件 | 4 組すべて不一致 |

→ **名前＋持続（`dur`）＋原価で対応づけ直してから** α/β/γ を裁定すること。
同種の添字依存が `[T2]` の「厳密一致 6/8」集計にも混ざっていないか必ず確認する（`[C]` の `hit`/`near` は
`pool` を全走査しているので影響は限定的だが、確かめずに使わない）。

## 2. タスク

### T1 ①②の分離実験（**本アクションの中核・読み取り専用・engine を触らない**）

`phase16_action9_photo_ledger.ts` をコピーして `phase16_action9b_selfbuff_separation.ts` を作る
（自前で deck/stage/chart を組まない。既存ハーネスの `buildSimulateInput` 経路をそのまま使う）。

分離条件（結論メモ §4 が明記）: **「自バフを持つ photo が、他ソースのバフが切れた直後のビートで発動する」act** を探す。

1. 全 photo act を走査し、次を**全部**満たすものを抽出する:
   - 実測 cost がクリーンに取れている（`basis` が「同一ビート内」等。ビート跨ぎ・系列先頭は除外）
   - 当該レーンの**直前ビートまで他ソースの boost が存在**し、当該ビートで**満了**している（`buffSnapshots` の前後比較）
   - 自 photo が付与する boost 段数 n > 0（`defs.effects[].type == <attr>_boost` の `stages` から機械取得）
2. 判定（1 件でも当たれば決着）:
   - 実測 cost = `原価 × 重み × (1000+10n)/1000` → **①自己適用**（engine は `engine.ts:1435` で cost 計算→効果適用なので乗らない）
   - 実測 cost = `原価 × 重み × 1000/1000` → **②境界一致**（＝A9 の b60 は「持続境界 off-by-one」側）
   - どちらでもない → 【Unknown】（不足している観測を数値で明示）
3. 該当 act が **0 件**だった場合は「材料不足」を確定させる。そのときは
   **「他ソースのバフが切れた直後に自バフ photo が発動する」ビートを意図的に撮るための撮影条件**を書く
   （`prompts/measure-new-sample.md` に追記する形。勝手に撮影しない＝ライブチケット保護）。
4. 併せて **S3 b13（+4.98%・self-buff でも足りない）** を同じ物差しで再裁定する
   （実測 5 段 vs engine 0＋自前 3 段の 2 段差がどこから来るのか。sim の boost 源欠落の疑い）。

### T2 α/β/γ の裁定（A9 完了条件 2 の未達分）

§1 の欠陥を直した**三角照合表（S1/S2/S3 × 全レーン）**を作り、不一致を数値で振り分ける:

| 分類 | 意味 | 訂正場所 |
|---|---|---|
| (α) 入力データ誤り | `deck.json` の `photos` が実際の編成と違う | サンプルは**変更せず** `data/` 側オーバーライド＋ユーザー提示 |
| (β) 選択ロジック誤り | 登録は正しいが sim が別枠を発動している | `src/timeline/engine.ts`（T4 の承認ゲート後） |
| (γ) コスト式の誤り | 正しいフォトに対する sim の 1 件コストが違う（×3・二重換算・Lv 反映） | 同上 |

±6% 成因の 4 候補（①スタミナ消費削減系の `effect_lines`／②Lv バッジ誤読／③OCR 誤読＝`order_*.PNG` を直接確認・
元画像は変更しない／④現在値・最大値比例式）を**全部潰す**。1 つに寄らなければ【Unknown】明記。

### T3 予測 → 模擬 → 反転（A9 完了条件 4 の未達分・**engine を触る前の関門**）

1. T1/T2 の裁定が決まったら、**engine を編集する前に**「この訂正で
   **b70×L5 は FAIL 側**になり、**b4×L2 / b34×L2 / b169×L3 は成功側**になる」を**予測として文章で先に書く**。
2. 解析側のオーバーライド（フォト参照だけ差し替えた別実行）で模擬し、4 セルの成否が反転するかを見る。
3. 反転しない → 分類が wrong。T2 に戻る（**ここで engine に書き足さない**）。
   反転したが別のレーンが壊れる → 崩しを全レーンの末尾スタミナ表と pop 整合で特定してから報告。

### T4 engine 修正（**ユーザー承認ゲート・勝手に進めない**）

T3 が「4 セル反転＋他レーン崩れなし」を示したときだけ `src/timeline/engine.ts` を直す。
**①と②のどちらを採るか（あるいは両方か）はユーザーが決める**（どちらも T5 golden 2,581,114,209 が動く）。
golden が変わる場合は**差分を全件示して承認を得る**こと。

反映後の受け入れ（A9 手順書 §1 T5 の 8 項目をそのまま使う）:

| # | 検査 | 基準 |
|---|---|---|
| 1 | S1 総合 | `+0.25%` 級のまま（**1% 以内**） |
| 2 | S1 L1 スタミナ系列 | 176/176 一致を維持 |
| 3 | b70×L5 | sim が `stamina_short`（または実測 FAIL と同理由）で 0 |
| 4 | b4×L2 / b34×L2 / b169×L3 | sim が発動し、pop 実測（2.3M / 2.9M / 2.5M）と同オーダー |
| 5 | S3 総合 | 乖離の絶対値が現行 **−1.32% 以内** |
| 6 | S2 総合 | 乖離の絶対値が現行 **+37.40% 以内**（b90 は A7 で別途） |
| 7 | `npx vitest run` 全件 + `npm run typecheck` | 全て緑 |
| 8 | `node tools/audit_audience.mjs` / `node tools/dump_lane_pops.mjs S1,S2,S3` | 既存検査が緑のまま |

## 3. 完了条件（この 6 件が揃うまでチャットに中間報告を書かない）

1. **T1 の探索結果**（条件該当 act の全件表）と **①②の裁定**（1 つに寄せる／【Unknown】なら必要材料を数値で）
2. **§1 の欠陥を直した三角照合表**と **α/β/γ の裁定**（根拠の数値つき）
3. **T3 の予測 → 模擬 → 反転有無**の 3 点セット（engine 編集前に書かれていること）
4. engine を触った場合は受け入れ 8 項目の数値、保留した場合は**保留理由とユーザーが決めるべき選択肢**
5. `research/23_beat_score_analysis/phase16_action9b_report.md`（判定表・生ログ添付・再実行コマンド。
   A9 で作られなかった `phase16_action9_report.md` の役割もここで兼ねる）
6. **コミット**（`npx vitest run` 全件と `npm run typecheck` の実行記録を報告に含める）

## 4. 制約・落とし穴

- **全局乗数（STAM_INIT / STAM_COST_MUL_PERMIL / STAM_REC_MUL_PERMIL）を触るのは禁止**（A6 で棄却済み:
  S1 L1 176/176 一致と両立しない）。
- `../aipura_nox/サンプル*/` は**読み取り専用**（`deck.json` を直さない／既存ファイルを削除・改名しない）。
- `engine.ts` は **1 ファイル 1 エージェント**。A7（S2 b90 の SP 上振れ）と**同時実行しない**（A9b が先）。
- **自前で `deck/stage/chart` を組まない**。`phase16_action5_lane_gap.ts` / `phase16_action6_stamina_ledger.ts` /
  `phase16_action9_photo_ledger.ts` をコピーして拡張する（engine の export は `simulateTimeline`、
  入力は `buildSimulateInput({ data, audience, laneFans, ... })`）。
- **PowerShell の `>` は文字化けする** → 生ログは UTF-8 で直接書き出す。
- `tsconfig.json` の `include` は `src` / `tests` / `tools` のみ → **`research/**` は typecheck 対象外**。
  ハーネスの妥当性は esbuild transform ＋ 実行成功 ＋ self-check（engine トレースとの突合）で担保する。
- 出典規律: スキル・原価は **Info Pride マスタ**で確定（`AGENTS.md`「ゲームデータの参照規則」）。スクショ読み取りで語らない。
  公式の値と実測が食い違ったら**両方を書く**（捏造禁止・読めない値は `null` + 理由）。

## 5. 参考ファイル

| ファイル | 内容 |
|---|---|
| `prompts/phase16-action9-photo-ledger-and-act-cost.md` | A9 の手順書（T1〜T5・受け入れ 8 項目の原典） |
| `research/23_beat_score_analysis/phase16_action9_photo_cost_conclusion.md` | A9 の結論と**分離条件**（§4）・未実施の選択肢（§6） |
| `research/23_beat_score_analysis/phase16_action9_photo_ledger.ts` / `_out.txt` | A9 のハーネスと生ログ（§1 の欠陥箇所は 548 行） |
| `research/23_beat_score_analysis/phase16_action6_stamina_ledger.ts` / `_out.txt` | スタミナ台帳の足場（`buildSimulateInput` 経路の実例） |
| `research/23_beat_score_analysis/phase16_action8_report.md` §5-1 | b70×L5 の成否逆転（`order_34.PNG`）と逆方向 11 セル |
| `research/12_implementation_log.md` | §Phase16-A6（**§6-1 のフィールド名訂正**）/ A8 / A9 |

## 6. 出力先

- 実装: `research/23_beat_score_analysis/phase16_action9b_selfbuff_separation.ts`（＋必要なら `..._override_probe.ts`）
- 生ログ: 同名 `_out.txt`（UTF-8 直書き）
- レポート: `research/23_beat_score_analysis/phase16_action9b_report.md`
- 実装を伴う場合: `src/timeline/engine.ts`（T4 の承認後）＋ `research/12_implementation_log.md` に §Phase16-A9b 追記

## 7. この後の順番（別セッションでよい）

1. **A9b（本手順書）** — engine.ts を触る可能性があるため最優先・単独。
2. **A10**（`prompts/phase16-action10-hidden-cell-gate.md`） — **読み取り専用なので A9b と並行可**。
   `tools/audit_hidden_cells.mjs` ＋ `npm run audit:hidden` ＋ S1 L1 の台帳不変条件。
   **既知の赤（S3 L5 = 7.69×）をゲート側を緩めて緑にしないこと**。A9b の engine 修正の安全弁になる。
3. **A7**（`prompts/phase16-action7-s2-l3-sp-b90-overpay.md`） — A9b の後（engine.ts の取り合いを避ける）。
4. **S4 再撮影 Step C**（`prompts/rollback-recapture-sample4.md`） — ライブチケット消費のため**要ユーザー確認**。
