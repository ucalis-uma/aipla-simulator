# Phase 16 Action14 / タスク A5: 正しい fan 口径（A12 の裁定式）をオフライン適用した受け入れ値の予測

作成: 2026-10-07。手順書 `prompts/phase16-action14-noshoot-backlog.md` §2 A5。**`src/` は変更していない**
（`tools/audit_hidden_cells_sim.ts` に focus/stealth の出力列を追加しただけ）。
ハーネス: `research/23_beat_score_analysis/_a5_fan_predict.mjs`（新規）・
入力 `phase16_action14_a5_lanefans_events.json`（`--events=S1,S2,S3` のセル別トレース）。

---

## 1. 方法（A12 の裁定式をオフラインで適用）

A12 §225-226 の裁定: lanefans 経路は `fanF = laneFanF`（A4 の満員ガード付き表引き）をそのまま使い、
**集目（focus）とステルス（他レーン）の動的項を落としている** → 正しい口径は

```
fanF' = laneFanF + focusFanBonusPermil(snap.focus) + Σ_{他4レーン} stealthFanBonusPermil(その stealth)
```

（`src/timeline/engine.ts` L2237 の legacy 分岐と同じ加算項。割合型スコアはファン不適用のため 1000 のまま。）

- `tools/audit_hidden_cells_sim.ts` の `--events=` 出力に `focus` / `stealth` / `focusBonusPermil` /
  `stealthBonusPermil`（engine と同じ関数で算出）を追加し、lanefans 口径の全イベントを取得した。
- `_a5_fan_predict.mjs` は各イベントのスコアを
  `multiplySequential([skillPower, b1, combo, fan, stage, rand, crit]) + flat` として再構成し、
  **fan 因子だけを `fanF'` に差し替えて** 再加算する（`Δ = f(fanF') − f(fanF)` は flat に依存しないため厳密）。
- **再構成の検証**: `gainedScore / 再構成スコア` は beat セルで **1.0000〜1.0004**（床関数の ±1 差のみ）、
  A/写真セルは 1.00〜1.31（フラット加算ぶん・想定どおり）。`ΣcellEvents == totalScore` は 3 サンプルで**差 0**。

## 2. 予測結果（**受け入れ値**）

| サンプル | 現行 lanefans | **修正口径** | Δ（対 現行） | 実測レーン合計 | 現行の乖離 | **修正後の乖離** | 改善 |
|---|---:|---:|---:|---:|---:|---:|---:|
| S1 | 114,162,150 | **116,243,426** | +2,081,276（+1.823%） | 116,537,513 | −2.038% | **−0.252%** | +1.786 pt |
| S2 | 74,886,541 | **75,078,540** | +191,999（+0.256%） | 77,732,383 | −3.661% | **−3.414%** | +0.247 pt |
| S3 | 77,425,702 | **77,892,728** | +467,026（+0.603%） | 79,411,389 | −2.501% | **−1.912%** | +0.588 pt |

- 変化は **全サンプルで L3 のみ**（focus/stealth を持つのが L3 だけのため。L1/L2/L4/L5 は Δ 0）:
  S1 L3 +2.550% / S2 L3 +0.399% / S3 L3 +2.811%。
- S1 は **−0.252%** まで収束し、目標 2.0% を大きく下回る（A12 の実測要求 +39.3/+51.4‰ 対 加算則
  +41/+50‰ がほぼ一致する会場＝空席ありのため、加算則が正しいことと整合）。
- S2 は **−3.414%**（A12 の概算「−3.94% → −3.79%」と同じ方向・同じ +0.2pt 台の改善幅。
  基準値が A13/A14 の修正で 74,669,710 → 74,886,541 に上がっているため絶対値は動いている）。
  **目標 2.0% には届かない**＝ A12 の結論（fan 口径だけでは S2 の不足は説明できない）を再確認。
- S3 は −2.501% → **−1.912%**。

## 3. 注意（【Estimate】の範囲）

- A12 §227-231 の未確定項: **満員・大来場（S3 型）での focus の効き方は未確定**で、実測の要求超過は
  focus 6/7/10 段で +57.9/+111.8/+135.4‰ と加算則（+38/+41/+50）を大きく上回る。
  → **S3（満員）と S1（満員・小規模）の予測値は「加算則で計算した場合の下限側」**であり、
  真の口径が引力式の再分配を含むなら乖離はさらに縮む可能性がある（＝この表の乖離は保守側）。
- 予測は「engine に 1 行（`fanF = laneFanF + focusFanBonusPermil(...) + stealthBonusOthers(...)`）を
  入れた場合」の値で、**実装はしていない**（手順書どおり `src/` 無変更）。実装する場合は
  **満員ガードの有無で focus の効き方が変わる**点の実測が先に必要（A12 §6 の残タスク）。

## 4. 再現コマンド

```powershell
npx tsx tools/audit_hidden_cells_sim.ts research/23_beat_score_analysis/phase16_action14_a5_lanefans_events.json S1,S2,S3 --events=S1,S2,S3
node research/23_beat_score_analysis/_a5_fan_predict.mjs research/23_beat_score_analysis/phase16_action14_a5_lanefans_events.json
```
