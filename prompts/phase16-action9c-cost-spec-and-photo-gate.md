# Phase 16 Action 9c — 消費スタミナ仕様の 3 修正（F1 / F2 / F3）と T5 ゴールデン再取得

> このプロンプトは **Action 9b の続きを次セッションで実施するための手順書**。9b の分析は完了済みで、
> **ユーザー承認も取得済み**（下記 §0）。9b のセッションのコンテキストは無い前提で書いてある。

## 0. 承認状況（重要）

ユーザーの回答（2026-10-02・9b レポート提示後）:

| 論点 | ユーザー回答 |
|---|---|
| **F1** 2 種類のブーストが同時に乗ったときの扱い | **「手元で確認したところ、足し算でした。2 件サンプルでどちらも足し算」** → **合計（sum）で確定**。【Unknown】は解消済み |
| **F2** 持続の最終ビートの扱い | 「最後のビートもいつも通りの発動順でいい気もするが、最後だけ特殊仕様かもしれない。ちゃんと調べるには同一譜面で別編成を組む必要がありそう。**実機にそぐう形での修正で構いません**」→ 実装は §3-2 の案でよい。追加観測が取れたら見直す |
| **F3** カード枠フォトの発動 | **「お願いします」** → 実施 |
| 優先順位 | **「全部修正してしまって構いません。優先順位はお任せします」** → §4 の順序で実施 |
| **engine.ts 編集の承認** | **本プロンプトで承認済みとみなしてよい**（9b 手順書 §1 T4 の「ユーザー承認後」を満たす）。T5 ゴールデンが動くことをユーザーは承知している |

## 1. 前提（9b で確定した仕様。ここが設計の土台）

### 1-1. 実測から確定した消費スタミナ式

```
スタミナ消費 = floor( 原価 × ステージ重み / 1000 × (1000 + 10n) / 1000 )
n = その act が発火した瞬間にレーンに有効な「ブースト」段数の合計
    ★ 属性は問わない（ボーカル/ダンス/ビジュアルのブーストを全部足す＝ユーザー確認で「足し算」確定）
    ★ act 自身が付与する boost は不算入（付与はコスト計算より後）
    ★ 実機が表示している最終ビートの boost は有効（＝そのビート後半の発動でも数える）
```

- 検証済み: クリーンにコストが読めた **34 act（S1 25 件 + S3 9 件）を厳密再現**（`research/23_beat_score_analysis/phase16_action9b_selfbuff_separation_out.txt` §[3]）。
- 属性不問の直接証拠（visual レーンに **vocal** ブースト 5 段）:
  S3 L3 b13 photo 2,085 = 662×3×1.05 / S3 L3 b73 2,085 / S3 L1 b51 P 1,449 = 460×3×1.05 / S3 L1 b51 A 1,159 = 368×3×1.05。
  同時に engine は 1,986 / 1,380（＝自属性ブースト 0 段とみなして ×1.00）を出している。
- 旧確定事項「消費のブースト副効果は自属性ブーストのみ」（`research/12_implementation_log_archive_phase0-12.md` §Phase12 追補3）は
  **反証済み**（当時の L4 の visual_boost 3/6/9 段＝×1.03/1.06/1.09 は、この新式でも同じ値になる特殊例だった）。実装時にこの記述も訂正すること。

### 1-2. 実機のノック（9b で特定した 2 つの欠陥）

| # | 欠陥 | 実測との差 |
|---|---|---|
| **F1** | `consumptionMultiplierPermil(snapshot, attr)` が **自属性のブーストしか数えない** | 他属性ブーストのセルで engine が安い（上記 3 セル×5 段） |
| **F2** | **phase=last（ビート後半発動）のコストが step10 の減算後**の状態で評価される | S1 L1 b60 photo: engine 662 / 実測 681（3 段ぶん）。実機の表示は b60 が最終ビートで b61 に消える |
| **F3** | **実機に無いカード枠フォトのスキルを sim が発動**させ、スタミナを余計に食う | S3 の 4 セル（b70×L5 が成功してしまう／b4×L2・b34×L2・b169×L3 が `stamina_short`） |

F1・F2 は**コスト式**の問題、F3 は**発動選択（入力のフォト参照）**の問題で、原因も直し方も独立。

## 2. 対象ファイルと行の手がかり（9b 時点のコード）

| 目的 | 場所 |
|---|---|
| F1 の本体 | `src/timeline/buffs.ts:473` `consumptionMultiplierPermil(snapshot, attr)`（`1000 − 50×stamina_cost_down + 50×stamina_cost_up + 10×自属性boost`） |
| F1 の呼び出し元 | `src/timeline/engine.ts:1435-1436`（`snapshotOf` → `staminaCostOf`）。他に消費を出す経路があれば全部洗う（`grep -n consumptionMultiplierPermil src`） |
| F2 のコスト評価 | `src/timeline/engine.ts` の `tryActivate`（1400-1629 付近）と `snapshotOf`（230-450 付近） |
| F2 の減算（step10） | `src/timeline/engine.ts:322` `effect.remainingBeats -= 1`（＋ `remainingBeats <= 0` を `expiredThisBeat` へ退避: 245-248・287-296、ビート 0 での除去） |
| 発動フェーズ（前半/後半） | `src/timeline/engine.ts:793-902` `activatePhaseSkills`（P とフォト。photos は P-first=step7 / P-last=step11）・`2274` `settleSkillNote`（A/SP=step8） |
| F3 のフォト組み立て | `src/sim/build.ts:577-594`（`lanePhotos`）・`366-405` `goldenPhotoSkillApplies`・`options.goldenPhotoNames` |
| スコア用スナップショット（触らない） | `src/timeline/engine.ts:272` 付近の `buffSnapshots`（step7 の**採点用**スナップショット。実機の表示と一致しているので**この意味論は変えない**） |

## 3. 修正仕様

### 3-1. F1: 属性フィルタの撤去（全属性のブースト段数を合計）

- `consumptionMultiplierPermil` の `+ 10×自属性boost` を **`+ 10×(vocal+dance+visual のブースト段数合計)`** に変更する。
- `attr` 引数は不要になるので、**呼び出し元を全部直して引数を削る**（互換のため残すなら `attr` を無視する実装にし、JSDoc に「属性不問（実測確定 2026-10-02）」と明記）。
- 注意: `stamina_cost_down` / `stamina_cost_up` の項は**そのまま**（実測で確認できたのは boost の属性だけ。down/up の存在は別途の確定事項に従う）。
- 期待される変化（S3）: L3 b13/b73 が 1,986→2,085、L1 b51 の A/P が 1,104→1,159・1,380→1,449（いずれも実測一致）。
- **回帰の見どころ**: S4 の visual_boost 3/6/9 段セル（×1.03/1.06/1.09）は**値が変わらない**はず（自属性 boost なので）。ここが動いたら実装ミス。

### 3-2. F2: phase=last のコストを「そのビートの表示状態」で評価

実機にそぐう形（＝実機の表示に一致させる）:

- 実機は、**そのビートに表示されている boost が、そのビート中の発動（後半発動を含む）に効く**。
  実測例: S1 L1 b60 の `ボーカルブースト 3` は b60 に表示・b61 で消滅し、b60 の後半発動フォトの消費は 681（＝3 段込み）。
- 実装案（最小・影響 1 セルに閉じる）:
  1. step10 の減算の**直前**に「コスト評価用のバフ集計」を保持する（`state.effects` の集計をコピーするか、`remainingBeats > 0` の判定を
     「`remainingBeats > 0` **または** そのビートの step10 で 0 になった」に緩める）。
  2. step11（後半 P/フォト）の発動では、その保持した集計を使ってコストを出す。step7/step8 の経路は現状のままでよい（減算前なので同じ値になる）。
  3. **`buffSnapshots`（採点用・step7）と、ビートをまたぐ表示意味論（b61 で消えている）は絶対に変えない**。
- 期待される変化: S1 L1 b60 photo 662→681（+19）。9b の全件走査では**条件該当はこの 1 件のみ**（S1 の他 175 ビートは不変、S2/S3 は該当なし）。
- **未確定点（ユーザー指摘）**: 「最後のビートも通常どおりの発動順ではないか」という可能性は残る。
  切り分けには**同一譜面・別編成**（ブーストの最終ビートが後半発動スキルと重なる編成）の追加観測が必要。
  追加観測が取れたら、この実装（最終ビートを有効にする）か「減算順序そのものを後半発動の後へ動かす」かを選び直す。
  撮影条件の追記先は `prompts/measure-new-sample.md`（**自分で撮影しない**＝ライブチケット保護。ユーザーに依頼する形で書く）。
- **【要確認】**: 受け入れ #2 の「S1 L1 スタミナ系列 176/176 一致」（A6 の基準）と、この +19 の両立。
  実機の b60 は 681 で確定（act 行: b50 発動後 8,041 → b60 発動後 7,360、間の timeline は 8,041 定常＝回復混入なし）なので、
  F2 適用後に S1 L1 の系列を**全ビートで再比較**し、b60 の扱い（および A6 基準の比較区間）を確定すること。

### 3-3. F3: カード枠フォトのゲート（実機に無い発動を止める）

**症状（実測との差）**: S3 L2 の実測 photo act は b1/b60 の 2 件（井川葵 6/23 = マイフォト）のみなのに、
sim は `photo-L2-1 星見市高台[1795]`・`photo-L2-2 びっくりした?[850]`・`photo-L2-3 みんなでBBQ[989]`・`photo-L2-4 明るく君を照らしたい[850]` を
b1/b2/b3/... と発動させ、L3 でも `photo-L3-1 かけがえのない二人[908]` を発動させる（L2 は b3 時点でスタミナ 671 まで枯れる／実測 b4 = 7,475）。

**原因の手がかり（9b の調査で判明）**:
- `src/sim/build.ts:322` のコメント曰く「golden フォトスキル（`photo-L*`）は**装着位置のフォトが T5 実測フォトと同一名**の場合のみ」付与される（`goldenPhotoSkillApplies`, 366-405）。
- ところが 9b のハーネスは `buildSimulateInput` に **`goldenPhotoNames` を渡していない**のに `photo-L2-1=星見市高台` が付いていた
  ＝ **未指定時はゲートが素通り**している（`build.ts:366-405` を読んで条件を確定すること。ここが F3 の核心）。
- 実測側の実データ: `../aipura_nox/サンプル3/deck.json` の `characters[].photos[]` は
  `井川葵 6/23 (Quality 140)`＋`フォト2/3/4 (Quality NNN)`（**統計値のみ・スキル名なし**）。名前付きスキルは T5 実測デッキ由来の golden が混ざったもの。

**やること**:
1. `goldenPhotoNames` の供給元を洗う（`grep -rn goldenPhotoNames src ui tools tests`）。CLI/UI/T5 ゴールデンがどう渡しているかを確認。
2. 未指定時の素通りをやめ、**「実測で発動が確認できたフォトスキルだけ**を付ける」既定にする（研究ハーネス側で各サンプルの実測フォト名リストを渡す形でもよい）。
3. **T5 ゴールデン `2,581,114,209` が不変であること**を最優先で確認（T5 デッキは名前付きフォトなので、ゲートを通せば従来どおり付与されるはず）。
4. 4 セルの再判定（期待値）:

| セル | 期待 | 9b の `--probe` 実測（カード枠フォトを L2/L3 で外しただけ） |
|---|---|---|
| b70×L5 | `stamina_short` で 0 | ✅ 佐伯遙子 7/5 FAIL・ふつつかものですが FAIL |
| b4×L2 | 発動（pop 2.3M と同オーダー） | ✅ A 新たな衣装とさらなる飛躍 cost **1,131**（実測 1,131 と一致） |
| b34×L2 | 発動（2.9M） | ✅ 同上 cost 1,131 |
| b169×L3 | 発動（2.5M） | ✅ A 殻をやぶる cost **492** |

5. **除外してよいのは「スキル（発動）」だけ**。フォトの**統計値（ステータス加算）は残す**（Phase 12 の「未装備フォト絞り込みの試行と撤回」＝統計寄与は実測に効く、という確定事項に反しないこと）。

## 4. 実装順序（推奨）

1. **F1**（コスト式・属性不問）→ `npx vitest run` で回帰確認。S4 の visual_boost セルが不変であることを確認。
2. **F2**（最終ビート）→ S1 L1 b60 が 681 になること・他 175 ビート不変・**S1 L1 系列の再比較**（§3-2 の【要確認】）。
3. T5 ゴールデンと受け入れ 8 項目の**再取得**（F1+F2 適用後の中間値として記録）。
4. **A10（隠れセルゲート）を通す**（`tools/audit_hidden_cells.mjs` / `npm run audit:hidden`。既知の赤 S3 L5 = 7.69× を**緩めて緑にしない**）。
5. **F3**（フォトゲート）→ 4 セルと T5 ゴールデンを再確認。
6. 受け入れ 8 項目の最終確認 → `research/12_implementation_log.md` に **§Phase16-A9c** 追記 → コミット。

理由: F1/F2 はコスト式の局所修正で影響範囲が読める（F2 は 1 セルのみ）。F3 は**発動選択**を変えるため最も影響が広く、
A10 を安全弁にしてから着手するのが安全。

## 5. 受け入れ（9b 手順書 §2 の 8 項目をそのまま使う）

| # | 検査 | 基準 |
|---|---|---|
| 1 | S1 総合 | `+0.25%` 級のまま（**1% 以内**） |
| 2 | S1 L1 スタミナ系列 | 176/176 一致を維持（**F2 適用後は b60 の扱いを再確認**・§3-2） |
| 3 | b70×L5 | sim が `stamina_short`（または実測 FAIL と同理由）で 0 |
| 4 | b4×L2 / b34×L2 / b169×L3 | sim が発動し、pop 実測（2.3M / 2.9M / 2.5M）と同オーダー |
| 5 | S3 総合 | 乖離の絶対値が現行 **−1.32% 以内** |
| 6 | S2 総合 | 乖離の絶対値が現行 **+37.40% 以内**（b90 は A7 で別途） |
| 7 | `npx vitest run` 全件 + `npm run typecheck` | 全て緑（9b 時点の基準: 41 files / 518 passed / 1 skipped・typecheck 0 errors） |
| 8 | `node tools/audit_audience.mjs` / `node tools/dump_lane_pops.mjs S1,S2,S3` | 既存検査が緑のまま |

- **T5 ゴールデンは必ず再取得して報告**（9b 時点の値: `2,581,114,209`）。F1/F2/F3 の**どの段階でいくつ動いたか**を段階別に記録する。
- 追加の回帰観点: S4（visual_boost の段数セル）と S1 の 176 ビート系列、S3 L4 の visual_boost セル。

## 6. 検証コマンド

```powershell
npx vitest run                      # 全件（基準 41 files / 518 passed / 1 skipped）
npm run typecheck                   # 0 errors
npx tsx research/23_beat_score_analysis/phase16_action9b_selfbuff_separation.ts          # 9b ハーネス（修正の効果測定）
npx tsx research/23_beat_score_analysis/phase16_action9b_selfbuff_separation.ts --probe  # F3 相当のオーバーライド
node tools/audit_audience.mjs
node tools/dump_lane_pops.mjs S1,S2,S3
node tools/audit_hidden_cells.mjs ; npm run audit:hidden     # A10 の安全弁
```

## 7. 出力先

- 実装: `src/timeline/buffs.ts`（F1）・`src/timeline/engine.ts`（F2）・`src/sim/build.ts`（F3）＋ 必要なら `src/cli/simulate.ts` / `ui/app.ts` の `goldenPhotoNames` 供給
- ハーネス更新: `research/23_beat_score_analysis/phase16_action9b_selfbuff_separation.ts`（そのまま使える。F3 用に実測フォト名リストを渡す改造をしてよい）
- レポート: `research/23_beat_score_analysis/phase16_action9c_report.md`（段階別の T5 ゴールデン・受け入れ 8 項目・生ログ添付）
- ログ: `research/12_implementation_log.md` に §Phase16-A9c 追記／`research/12_implementation_log_archive_phase0-12.md` §Phase12 追補3 の「自属性のみ」記述を訂正

## 8. 禁止事項・落とし穴

- **全局乗数（STAM_INIT / STAM_COST_MUL_PERMIL / STAM_REC_MUL_PERMIL）を触らない**（A6 で棄却済み: S1 L1 176/176 一致と両立しない）。
- `../aipura_nox/サンプル*/` は**読み取り専用**（`deck.json` を直さない・既存ファイルを削除/改名しない）。
- **`engine.ts` は 1 ファイル 1 エージェント**。A7（S2 L3 SP b90）と**同時に走らせない**。A10 は読み取り専用なので**先に通すのは可**。
- **`buffSnapshots`（採点用スナップショット）の意味論を変えない**。F2 はコスト評価だけに閉じる。
- 撮影（S4 再撮影・追加観測）は**勝手にやらない**（ライブチケット保護）。必要なら `prompts/measure-new-sample.md` に条件を書いてユーザーに依頼する。
- 読めない値は `null` + 注記（捏造禁止）。推測実装は【Estimate】/【Unknown】タグ。
- **作業終了の規律**: 完了条件（§5 の 8 項目＋T5 ゴールデンの段階別記録＋コミット）が揃うまでチャットに中間報告を書かない。
  ターンを終えてよいのは (a) 完了 (b) ユーザー判断が必要 (c) 材料不足 (d) 60 回/2 時間の暴走防止中断のみ。

## 9. 参考ファイル

| ファイル | 内容 |
|---|---|
| `research/23_beat_score_analysis/phase16_action9b_report.md` | **9b の結論**（①②の裁定・±6% の正体・α/β/γ・T3 4 セル反転・保留理由と選択肢 A〜D・受け入れ現況表） |
| `research/23_beat_score_analysis/phase16_action9b_selfbuff_separation.ts` / `_out.txt` | 9b のハーネスと生ログ（§[3] の 34 act 厳密再現表が F1 の一次証拠） |
| `research/23_beat_score_analysis/phase16_action9_photo_cost_conclusion.md` | A9 の結論（9b で一部を上書き済み。①自己バフの解釈は誤り） |
| `research/23_beat_score_analysis/phase16_action8_report.md` §5-1/§5-2 | b70×L5 の成否逆転と逆方向 11 セル |
| `prompts/phase16-action10-hidden-cell-gate.md` | F3 の安全弁（隠れセルゲート） |
| `prompts/phase16-action7-s2-l3-sp-b90-overpay.md` | engine.ts を取り合うため F3 完了後に実施 |
| `prompts/phase16-action9-photo-ledger-and-act-cost.md` | A9 の手順書（受け入れ 8 項目の原典） |
