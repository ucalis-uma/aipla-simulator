# Phase 16 Action 10 — 「隠れセル検収ゲート」の恒久化

- 手順書: `prompts/phase16-action10-hidden-cell-gate.md`
- 実施: 2026-10-02（A9c と同一セッション。**engine を触る前にゲートを先に通し**、F3 の安全弁として使用）
- 成果物:
  - `tools/audit_hidden_cells.mjs`（ゲート本体・実測側 + 判定 + exit code）
  - `tools/audit_hidden_cells_sim.ts`（sim 側: 実 engine を回して「pop 読込不能セル」のスコアだけを JSON 化）
  - `package.json` に **`npm run audit:hidden`** ／ `AGENTS.md` の実効検査の行に追記
  - 実行ログ: `phase16_action10_audit_out_preF3.txt`（**F3 前 = 赤・exit 1**）・
    `phase16_action10_audit_out.txt`（**F3 後 = 緑・exit 0**。既定パスなので `npm run audit:hidden` もここに書く）
  - 参考: `research/23_beat_score_analysis/phase16_action9c_report.md`（F1/F2/F3 の本体）

---

## 1. 結論

| 完了条件（手順書 §2） | 結果 |
|---|---|
| 1. 15 レーンを表出し **S3 L5 だけを FAIL**・A8 と同値（4,039,884 / 525,474 / 7.69） | ✅ **F3 前の実行で一致**（下記 §3。内生口径 7.69× と統合口径 12.49× の両方を明示） |
| 2. 4 系統の閉包チェックが 3/3 サンプルで緑（1 の位まで一致） | ✅ S1/S2/S3 すべて **差 0**（`116,537,513` / `77,732,383` / `79,411,389`） |
| 3. `--ledger` で S1 L1 = **176/176**・他 4 レーンも現状値 | ✅ L1 176/176・L2 175/175・L3 176/176・L4 176/176・L5 172/172（A6 §2 と同値） |
| 4. `npm run audit:hidden` が**違反時に exit 1** | ✅ F3 前: `node tools/audit_hidden_cells.mjs S1,S2,S3` = **exit 1**・`npm run audit:hidden` = **exit 1**。F3 後は両方 **exit 0** |
| 5. `npx vitest run` 全件 + `npm run typecheck` 緑 + コミット | ✅ 41 files / 519 passed / 1 skipped・typecheck 0 errors |

- **ゲートは基準を緩めずに赤→緑になった**。赤の原因（`goldenPhotoNames` 未指定時の素通り）を
  **実装側（F3）で直した**結果として緑になった（閾値・分母・口径は F3 の前後で一切変えていない）。
- F3 後は素の既定（off）と受け入れ経路（on）が同値になり、`off` は常時走るので
  **素通りが再導入されたら即座に再び赤くなる**（回帰検出の実効性は維持）。

---

## 2. 実装

- **実測側**: `phase16_action8_pop_vs_lane_total.mjs` のロジックを移植
  （内生 pop `timeline[].lanes[].gained_score_pop` ＋ `lane_pops_backfill.json` の統合、
  K 表記の切り捨て＝下界、レーン合計は `results.scores_by_lane` / `lane_scores`、
  A8 の 4 系統閉包チェック）。**A5 出力のテキストを正規表現で読む旧方式は廃止**。
- **sim 側**: `phase16_action8_sim_hidden_cells.ts` を `tools/audit_hidden_cells_sim.ts` に移植。
  `buildSimulateInput`（`audience` / `laneFans` / サンプル固有修正付き）→ `simulateTimeline` を直接呼び、
  セル単位（`beat:lane`）のスコア・スタミナ・警告を JSON 出力する。node の TS 直接実行は
  `.js` 指定子を解決できず失敗するため、`.mjs` 側から `npx --no-install tsx` を起動する。
- **判定**: 比 = `sim(pop読込不能セル) ÷ 隠れ枠(上限)`。
  - Σpop は **統合**（内生＋遡及＝全サンプルで使える・既定）と **内生のみ**（A8 の T5 表と同口径）を併記。
  - sim は **photo-gate off**（素の既定）と **on**（受け入れ経路）を併記。
  - **全組み合わせの最悪値**で `≥2.0 = FAIL`／`1.5〜2.0 = WARN`／それ未満 = OK。FAIL があれば **exit 1**。
- 引数: `[S1,S2,S3] [--ledger] [--mode=lanefans|legacy] [--photo-gate=off|on|both] [--sim=<file.json>] [--no-sim] [--out=<file>]`。
  S4 は既定から除外（無効撮影回・理由を出力）・S5 も除外理由を出力。
- **モードの明示**: 表の見出しに `mode=` を必ず出す。laneFans と legacy は総合が違う
  （S3: 77,425,702 / 78,485,270。A5 表=legacy・A8 の T5=laneFans 系）。本ゲートの既定は `lanefans`。

---

## 3. F3 前の実行（初期台帳 = A8 の再現）— `phase16_action10_audit_out_preF3.txt`

```
FAIL（比 ≥ 2.0）= 1 件: S3 L5 12.49×
  -- 比 ≥ 2.0 の全行（photo-gate × Σpop 基準） --
    S3 L5 | photo-gate=off | Σpop=merged | sim(隠れ) 3,801,360 / 隠れ枠 304,474 = 12.49×（隠れセル 6）
    S3 L5 | photo-gate=off | Σpop=inline | sim(隠れ) 4,039,884 / 隠れ枠 525,474 = 7.69×（隠れセル 10）
  ゲート結果: FAIL（隠れセル過剰配置または系列不一致あり） — 閾値は緩めない
```

- **A8 の値と 1 円まで一致**（`4,039,884 / 525,474 = 7.69×`・sim レーン合計 `13,289,439`・
  統合口径 `3,801,360 / 304,474 = 12.49×`・S3 sim 合計 `73,020,495`）。
- **exit code の証拠**: `phase16_action10_audit_out_preF3_exitcheck.txt` は、F3 を一時的に旧実装
  （`goldenNames === undefined ⇒ true`）へ戻して撮った同一 FAIL の実行ログで、この状態で
  `node tools/audit_hidden_cells.mjs S1,S2,S3` = **exit 1**・`npm run audit:hidden` = **exit 1** を確認した
  （stdout/stderr を捨てて `$LASTEXITCODE` のみを見る形で測定。F3 は測定直後に復元済み）。
- 15 レーン中 **FAIL は S3 L5 ただ 1 つ**。WARN 0 件。副次的に S2 L5 が off モードで 1.48×（WARN 未満の最大）だった。
- **逆方向の A8 観測も再現**: S3 L3 = `114,603 / 2,635,445 = 0.04×`（sim が少なすぎる側）。
  手順書 §0 のとおり**下側ゲートは今回入れていない**（実測が読めない以上、下限の妥当ラインが未確定＝【Unknown】）。

### 赤の説明（「ゲートは正しく機能している。赤は実装側の実バグ」）

- **S3 L5 の 12.49× / 7.69×**: 原因は `buildSimulateInput` の `goldenPhotoNames` を渡していない経路で
  **T5 実測デッキ由来の golden フォトスキル（`photo-L5-*`）が素通りして注入**されていたこと。
  S3 L5 は実測で b70 が**スタミナ不足で不成立**（成否逆転＝A8 §5-1）なのに、sim は
  余分なフォトスキルのスコアを b50 付近の「pop が読めていないセル」に置いていた。
  **A9c の F3（ゲート既定 off）でこの素通りを消した** → F3 後は 0.86×（統合）/ 0.95×（内生）。
- 参考: S3 L5 の sim レーン合計が `13,289,439` → **`10,209,817`** に下がり、実測 `9,560,444` との差は
  約 0.65M（+6.8%）まで縮んだ。**b70×L5 の成否逆転そのものは A7/A8 の担当**
  （本アクションでは触っていない。基準ハーネス構成では F3 前から正しい＝9c レポート §4-4）。

---

## 4. F3 後の実行（更新値）— `phase16_action10_audit_out.txt`

| サンプル | photo-gate=off（素の既定） | photo-gate=on（受け入れ経路） |
|---|---|---|
| S1 | 114,162,150 | 114,162,150（S1 は deck の `disabledSkillIds` で無効化＝元から同一） |
| S2 | 74,669,710 | 74,669,710 |
| S3 | 77,425,702 | 77,425,702 |

- **off ≡ on になった**（F3 前: off は S2 100,896,903 / S3 73,020,495）。
- S3 L5: 統合 `262,374 / 304,474 = 0.86×`・内生 `500,898 / 525,474 = 0.95×` → **OK**。
- 判定 **FAIL 0 件 / WARN 0 件 → PASS / exit 0**（`npm run audit:hidden` も exit 0）。
- 閉包は 3/3 で差 0 のまま。`--ledger` は S1 全 5 レーン 100%（L1 176/176）。

---

## 5. 使い方（受け入れ検査として）

```powershell
npm run audit:hidden                                   # = node tools/audit_hidden_cells.mjs S1,S2,S3
node tools/audit_hidden_cells.mjs S1,S2,S3 --ledger     # スタミナ系列の安全弁つき（S1 L1 = 100% 必須）
node tools/audit_hidden_cells.mjs S1,S2,S3 --photo-gate=off   # 素の既定だけを見る（回帰検出用）
node tools/audit_hidden_cells.mjs S1,S2,S3 --no-sim      # 実測側（閉包・Σpop）だけ
echo $LASTEXITCODE                                       # 違反があれば 1
```

- **赤が出たら閾値・分母をいじらない**。まず「そのレーンの実測 pop が本当に読めていないか」
  （`node tools/dump_lane_pops.mjs S1,S2,S3` の n 層別）→「sim がどのスキルでそのセルに置いているか」
  （`--sim=` を再利用して JSON を眺める）の順に当たる。今回のケースは後者（フォトゲートの素通り）だった。
- 失敗の典型: 実測サンプルの `results.scores_by_lane` が空（閉包が先に落ちる）／
  `lane_pops_backfill.json` が無いサンプル（統合＝内生になる）／mode の取り違え（表の `mode=` を見る）。
