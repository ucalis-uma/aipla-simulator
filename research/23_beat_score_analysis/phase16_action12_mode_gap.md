# Phase 16 Action12 タスク0: 2 つの公式ハーネスの口径差（mode gap）の帰属と裁定

対象: `tools/analyze_beat_score_models.ts`（以下 **legacy 口径**＝`audience` のみ）と
`tools/audit_hidden_cells_sim.ts`（既定 **lanefans 口径**＝`laneFans` + 満員ガード）。
計測は `research/23_beat_score_analysis/phase16_action12_mode_probe.ts`（同一プロセス内で
legacy / lanefans / mentalOverride 有無の 4 変種を回して差を帰属させる）による。

---

## 1. 実測との突合（プロンプトの数値と完全一致を確認）

| サンプル | 実測 | legacy sim | lanefans sim | Δ(lanefans−legacy) | legacy 乖離 | lanefans 乖離 |
|---|---:|---:|---:|---:|---:|---:|
| S1 | 116,537,513 | 116,829,040 | 114,162,150 | **−2,666,890** | +0.25% | **−2.04%** |
| S2 | 77,732,383 | 74,895,810 | 74,669,710 | **−226,100** | −3.65% | **−3.94%** |
| S3 | 79,411,389 | 78,485,270 | 77,425,702 | **−1,059,568** | −1.17% | **−2.50%** |

プロンプト記載の 6 数値（legacy 116,829,040 / 114,162,150、S2 74,895,810 / 74,669,710、
S3 78,485,270 / 77,425,702）とすべて一致。

## 2. 差を生む経路（ファイル＋行）

両ハーネスは**同じエンジン**を呼ぶ。差は入力の作り方だけに由来する:

| # | 差分 | legacy | lanefans | 帰属する処理 |
|---|---|---|---|---|
| 1 | `laneFans[]` を渡すか | 渡さない | 渡す（S1 `[19,19,18,22,22]` / S2 `[11996,13543,13741,13255,13496]` / S3 `[8515,7748,8535,8518,6684]`） | `src/sim/build.ts` L~751-780 が `laneFanFactorPermil` を注入 → `src/formula/fan.ts` L97-124（満員ガード L112-123） |
| 2 | 段階型 fan の分岐 | `fanFactorPermilByAttraction(fanBaseCount, focus, stealth, others)`（引力式・`src/timeline/buffs.ts` L628-641） | `laneFanF` を**そのまま**採用（`src/timeline/engine.ts` L2240-2243・スキルノート側は L2007-2023） | 後述 §3 |
| 3 | `mentalOverride` | **渡していない**（S2） | 渡す（S2 `{"1":5596,…}`） | **差 0**（4 変種すべてで Δ=0 を確認） |

→ 差は 100% **ファンボーナス係数の経路**。#3 は無効、#1 と #2 が本質。

## 3. 差の帰属（イベント単位・実測）

`mode_probe` は legacy / lanefans の全イベントを突き合わせ、Δ を持つイベントを数える:

| サンプル | sourceKind | イベント数 | Δスコアを持つ | `fanFactorPermil` が違う | Δスコア |
|---|---|---:|---:|---:|---:|
| S1 | beat | 795 | 695 | **695** | −2,666,890 |
| S2 | beat | 745 | 745 | **745** | −226,100 |
| S3 | beat | 745 | 745 | **745** | −1,059,568 |
| S1/S2 | active・special | 16/2 ほか | 少数 | 同数 | 0（差は beat 由来） |
| S2 | special | 2 | 2 | **1** | +36,393 |

- **Δ を持つイベントは例外なく fan 係数だけが違う**（ファン係数以外の因子は全一致）。
- 唯一の例外は S2 の `special` 1 件（2 件中 1 件は fan が同じなのに Δ を持つ）。これは
  `score_get_by_score_ratio` 系（累積スコア比例）で、**先行ビートの fan 差が累積スコアを通じて
  波及した**もの（独立機構ではない）。

### 3.1 何が落ちているのか（実測 fan 係数の対比）

| サンプル | レーン | legacy の fan（順不同の観測値） | lanefans の fan |
|---|---|---|---|
| S1 | 満員（cap/5 = 20） | 1,001 / 1,043 / 1,052 | **1,002 一律** |
| S2 | 空席（レーン別来場） | 1,549 / 1,564 / 1,661 | **[1,539, 1,570, 1,574, 1,565, 1,569]** |
| S3 | 満員（cap/5 = 8,000） | 1,356 / 1,361 / 1,363 / 1,462 / 1,542 / 1,568 | **1,375 一律** |

legacy の係数は**時間方向に動く**（focus/stealth の段数で変化）。lanefans は**定数**。
つまり lanefans 経路は

- (a) 素点の差: 表引き（`fanBonusPermil`）と式（`fanBonusPermilFromCount`）の差
- (b) **focus/stealth の動的項が丸ごと落ちる**（`focusFanBonusPermil`・`stealthFanBonusPermil`）

の 2 つを同時に抱えている。

## 4. 第一容疑（クリティカル注入の口径差）の検定 → **棄却**

§3 のとおり、Δ を持つイベントは fan 以外の因子がすべて一致する。crit セル集合は
両口径で同一（`criticalProvider` は両ツールとも実測フラグを注入）。したがって
「S1・S3 は総スコアの 71〜96% がクリティカルセルだから crit 口径差が主因」という
第一容疑は**数値で棄却**される。

## 5. どちらが正しいか（実測裁定）

### 5.1 focus/stealth 項は「実在する」= lanefans 側が項を落としている

`phase16_action12_focusprobe.ts`（beat 単独・pop 可読セル・同一レーン内で focus 段数別に集計）:

| サンプル | レーン | focus 段数 | セル数 | **実測が要求する fan − laneFan** | 規則（`focusFanBonusPermil`） |
|---|---|---:|---:|---:|---:|
| S1 | L3 | 0 | — | +7.9‰ | 0 |
| S1 | L3 | 7 | — | **+39.3‰** | +41 |
| S1 | L3 | 10 | — | **+51.4‰** | +50 |

S1 L3（focus 付き 139/158 セル）では、実測要求は **加算式の focus ボーナスと 1.4‰ 以内で一致**する。
一方 lanefans（動的項なし）は系統的に +4.34% ずれる。**focus 項を落とす lanefans 口径は機構として誤り**。

### 5.2 ただし素点（満員時の一律 f(cap/5)）は lanefans 側が正しい

`fan.png` の実測は 5 サンプル 25/25 で「満員なら全レーン = `f(cap/5)`、空席ならレーン別来場の表引き」
（`research/23_beat_score_analysis/phase16_action3b_fan_full_house.md` = A4 確定）。legacy の
引力式は満員でもレーン別に分配するため、S3 では 1,356〜1,568 とばらつく（実測は一律 1,375）。

### 5.3 裁定

> **正しい口径は「A4 の表引き（満員ガード付き）＋ 動的な focus/stealth 項」であり、
> 現存の 2 ハーネスはどちらもそれを実装していない。**
> - legacy: focus/stealth 項はあるが**素点が式**（満員でも分配してしまう）
> - lanefans: 素点は正しいが**focus/stealth 項が無い**

総スコアの実測一致では legacy が優る（S1 +0.25% vs −2.04% / S3 −1.17% vs −2.50%。
ただし S2 は legacy −3.65% / lanefans −3.94% でどちらも悪い）。理由は S1・S3 が満員会場で、
かつ focus/stealth の寄与が動的項の方が素点差より大きいため。

**したがって当面の受け入れ口径は legacy を維持する**（プロンプト §1 手順 4 の既定案どおり）。
ただし以下を併記する:

- A10 の隠れセル監査は既定 lanefans。lanefans は総スコアを **低く**出す側なので、
  上側ゲート（過剰配置）は**緩く**、下側ゲート（説明不足）は**厳しく**出る。
  この非対称は口径を揃えるまで残る（Action12 タスク2 の下側ゲートは既定 lanefans での判定）。
- 満員ガードを「効かせれば legacy と一致する」という A10 の想定は**誤り**だった
  （§3.1 のとおり legacy は満員でも一律ではない）。

## 6. 未解明として残るもの（口径とは独立）

focus 窓と focus=0 窓の**両方**に、レーン別のデッキ依存オフセットが残る
（例: S1 要求/laneFan −5.81%（L1）〜+4.34%（L3）、S2 +1.07〜+20.06%、S3 −6.57〜+7.89%）。
focus=0 のセルでも同じ符号・同じ大きさで出るので、**fan の口径の問題ではない**（A11 の未解決項）。
S3 L3 だけは要求超過が加算 focus 則（+38/+41/+50）を超える（focus 6/7/10 で +57.9/+111.8/+135.4）が、
引力式の再分配（+87/+167/+193）にも一致しない。**満員・大来場での focus の効き方は未確定**。

## 7. 再現コマンド

```powershell
npx tsx research/23_beat_score_analysis/phase16_action12_mode_probe.ts S1,S2,S3 --out=research/23_beat_score_analysis/phase16_action12_mode_probe.json
npx tsx research/23_beat_score_analysis/phase16_action12_focusprobe.ts S1,S2,S3 --out=research/23_beat_score_analysis/phase16_action12_focusprobe.json
npx tsx research/23_beat_score_analysis/phase16_action12_cellcmp.ts S1,S2,S3 --out=research/23_beat_score_analysis/phase16_action12_cellcmp.json
node tools/analyze_beat_score_models.ts --samples S1,S2,S3 --json research/23_beat_score_analysis/phase16_action12_legacy_totals.json
npx tsx tools/audit_hidden_cells_sim.ts research/23_beat_score_analysis/phase16_action12_sim_cells.json S1,S2,S3
```
