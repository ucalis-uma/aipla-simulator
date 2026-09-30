# Phase 16 アクション10 手順書 — 「隠れセル検収ゲート」の恒久化（過大生成を CI で自動捕捉する）

- 前提: **A8 が検出した穴の再発防止**。ポップが読めないセルで sim が実測の物理的上限を何倍も超える現象は
  **今回初めて存在が分かった**（既存のどの検査も捕捉していなかった）。同じ構造の穴はこれから毎回開く。
- 目的: **「実測で検証できないセル」に限定した受け入れ検査**を恒久ツール化し、`npm run` 一本で
  全サンプルの健全性を見るだけで過大/過小生成に気づけるようにする。
- **`src/`・`data/`・`tests/` は変更しない**（検収側だけの追加）。A9 / A7 と**同時実行してよい**（触るファイルが排他）。
  ただし A9 の engine 修正が入った後は**必ず再実行**し、ゲートの数値が動くので更新値をレポートに書くこと。

## 0. 既存の検査と、このゲートでないと捕まらないもの

| 既存検査 | 見ているもの | 捕れないもの |
|---|---|---|
| `node tools/audit_audience.mjs` | `deck.json` の `audience` が来場数か | 目標スコア誤入力の**再発は防ぐ**が得点の過大は分から |
| `node tools/dump_lane_pops.mjs S1,S2,S3` | レーン別ポップの読取充足率（n/5） | n が低くて sim が壊れているケース |
| T4/T5 golden（`npx vitest run`） | 出力の不変（＝**変化検知**） | 実測との整合では**ない**（壊れた値でも固まれば緑） |
| **A8 の T5（本アクションで昇格）** | **ポップ読込不能セルでの sim vs 実測の物理的上限** | ← これがないと S3 L5 の 7.69× が見えない |

A8 での測定値（**このゲートの初期台帳**）: sim(読込不能セル) / 実測の隠れ枠 =
**S3 L5 = 4,039,884 / 525,474 = 7.69×**（遡及 pop を差し引いた厳密値 **13.27×**）で **15 レーン中ただ 1 つの 2× 超違反**。
逆方向は **S3 L3 = 114,603 / ≤2,635,445 = 0.04×**（sim が少なすぎる）。**上側ゲートだけ入れても下側は出せない**
という設計上の非対称に注意（下側は「実測が読めない以上、下限の妥当ラインがまだ決まっていない」＝【Unknown】）。

## 1. 作業

### T1 `tools/audit_hidden_cells.mjs` の新設（A8 の検証済みロジックを昇格させる）

`research/23_beat_score_analysis/phase16_action8_pop_vs_lane_total.mjs` と
`phase16_action8_sim_hidden_cells.ts` の**実装をコピーして工具化する**（ロジックを再発明しない）。

- 引数: `node tools/audit_hidden_cells.mjs S1,S2,S3`（既定で S1,S2,S3。S4 は既知の無効回なので**既定から除外**し、
  明示指定時にだけ走る／走らせる場合は「無効回」と明記）。S5 は `fan.png` のみで除外理由を出す。
- レーンごとに次を出す: `Σpop（読込セル）` / `レーン合計（実測）` / `隠れ枠 = レーン合計 − Σpop` /
  `sim(読込セル)` / `sim(読込不能セル)` / **比 = sim(隠) / 隠れ枠** / 違反判定（`ratio > 2` で **FAIL**、
  `1.5 < ratio ≤ 2` は WARN）
- **exit code を返す**（違反 1 つでも `exit 1`）→ CI・`npm run` から使える。
- **K 表記の切り捨て**で隠れ枠が**過大**に見える（実測 pop は下界）ので、隠れ枠は「上限」として扱う。
  表示は `隠れ枠 ≤ 値` ではなく `隠れ枠(上限)` と明記して誤読を防ぐ。
- A8 が通した 4 系統の閉包チェック（5レーン合計 = `total_score` = Σ`beat_gained_score` = 末尾 `cumulative_score`）も
  この工具に**同居**させる（measured 側の欠損を先に落とせるようにする）。

### T2 S1 L1 の台帳不変条件を追加（A9 の退行テストの受け皿）

同じ工具に `--ledger` オプション（または別関数）で、**S1 L1 の全ビート スタミナ系列 = 実測**の一致率を出す。
A6 で **176/176 完全一致**が確認できた唯一の健全レーンなので、**一致率が 100% から 1 ビートでも落ちたら FAIL**。
（A9 が engine を触るとき、この検査が安全弁になる。**A9 より先にこれを入れる**こと。）

### T3 実行ファイルへの組み込みと文書化

- `package.json` に `"audit:hidden": "node tools/audit_hidden_cells.mjs S1,S2,S3"` を追加
  （`audit:audience` と並ぶ**受け入れ検査**の位置づけ。lint/test とは混ぜない）
- `AGENTS.md`「レーン別スコアポップ」の項にある**実効検査**の行に `node tools/audit_hidden_cells.mjs` を追記
- `prompts/readme.txt` と `research/12_implementation_log.md` に追記（どの条件で赤になるか、今赤いのはどれか）
- **既知の赤をレポートに明記**: 現時点で FAIL になるレーン（S3 L5）と、その理由（b70×L5 の成否逆転）を
  「**ゲートは正しく機能している。赤は実装側の実バグ**」として記録する。**ゲートの基準を緩めて緑にしないこと**

## 2. 完了条件（この 5 件）

1. `node tools/audit_hidden_cells.mjs S1,S2,S3` が 15 レーン分を表出し、**S3 L5 だけを FAIL** にする
   （**A8 の数値と一致すること**: sim(隠) 4,039,884 / 隠れ枠 525,474 / ratio 7.69）
2. 4 系統の閉包チェックが 3/3 サンプルで緑（1 の位まで一致）
3. `--ledger` で S1 L1 の一致率が **176/176**、他の 4 レーンは現状値が出る（A6 §2 と同じ値）
4. `npm run audit:hidden` が**違反時に exit 1**（`echo $?` / `$LASTEXITCODE` で確認して記録）
5. `npx vitest run` 全件 + `npm run typecheck` が緑のまま（`src/` 無変更）＋ コミット

## 3. 判定基準・落とし穴

- **S3 L5 を green にしない**。FAIL を FAIL と出せない検査は意味がない。基準をいじる前に A8 の数値と照合すること。
- sim 呼び出しは**既存ハーネスの形**を踏襲（`buildSimulateInput({ data, audience, laneFans, ... })` → `simulateTimeline`、
  export 名は `simulateTimeline`）。自前で `deck/stage/chart` を組むと起動に失敗する（前例あり）。
  **mode=legacy と mode=laneFans で sim 合計が違う**（S3 L5: 13,133,281 / 13,289,439）ので、
  どちらを表にするか**列名で明示**する（A5 の表は legacy / A8 の T5 は laneFans 系）。
- 出力は **UTF-8 直接書き出し**（PowerShell の `>` は文字化けする）。
- 実測サンプル（`../aipura_nox/サンプル*/`）は**読み取り専用**。ファイル追加・改名・上書きをしない。
- **S4 は既定の対象外**（`deck.json` が 5 レーン分無く、バー増分 0 の無効回）。S5 も同様（`fan.png` のみ）。

## 4. 参考ファイル

| ファイル | 内容 |
|---|---|
| `research/23_beat_score_analysis/phase16_action8_pop_vs_lane_total.mjs` / `_out.txt` | 昇格元の実装と期望値（T1 の答え合わせに使う） |
| `research/23_beat_score_analysis/phase16_action8_sim_hidden_cells.ts` / `_out.txt` | 実 engine から読込不能セルだけ取り出すコード（**推定値との一致が検証済み**） |
| `research/23_beat_score_analysis/phase16_action8_report.md` §5・§6-3 | ゲートの定義と「下側ゲートは要協議」の根拠 |
| `tools/audit_audience.mjs` / `tools/dump_lane_pops.mjs` | 工具の書き方・出力スタイルの手本 |
| `package.json` の `scripts` | `audit:audience` の並びに `audit:hidden` を入れる |

## 5. 出力先

- `tools/audit_hidden_cells.mjs` ／ `package.json`（scripts）／ `AGENTS.md`（実効検査の行）
- 実行ログ: `research/23_beat_score_analysis/phase16_action10_audit_out.txt`（UTF-8 直接書き出し）
- レポート: `research/23_beat_score_analysis/phase16_action10_report.md`（**現状の赤の一覧**と各赤の説明を含む）
- `research/12_implementation_log.md` に §Phase16-A10 追記
