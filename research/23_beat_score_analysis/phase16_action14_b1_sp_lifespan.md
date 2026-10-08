# Phase 16 Action14 / タスク B1: S2 L3 `sp_skill_score_up` の寿命 — マスタに持続指定なし・**スコア差 0**・実機窓は【Unknown】

作成: 2026-10-07。手順書 `prompts/phase16-action14-noshoot-backlog.md` §3 B1。`src/` は変更していない。
ハーネス: `research/23_beat_score_analysis/_b1_efficacy_series.mjs`（vendor マスタ全数解析）・
`_b1_sp_window.mjs`（A13 の `phase16_action13_buff_rows.json` から実機/sim の窓を引く）。

---

## 1. マスタ確認 → **持続ビートの指定は存在しない**

対象は S2 L2 `card-skr-05-fest-00` の P 枠 `sk-skr-05-fest-00-3`「胸いっぱいの勇気」
（「誰かがSPスキル発動前／対象1人にN段階SPスキルスコア上昇効果」）。

`vendor/Skill.json` の全レベル（抜粋）:

| Lv | efficacyId | 説明 | CT |
|---|---|---|---|
| 1 | `ef-special_skill_score_up-5-target-trigger-5` | 誰かがSPスキル発動前／対象1人に**5**段階SPスキルスコア上昇効果 | 70 |
| 2 | `ef-special_skill_score_up-6-target-trigger-5` | 同上 **6**段階 | 70 |

- **`[Nビート]` 表記は全レベルに無い**（`vendor/Skill.json` の `levels[].description`）。
- 同系列の全数解析（`skillDetails` 23,020 行）: `ef-special_skill_score_up-<段階>-target-trigger-5` は
  段階 5〜9 の**すべてで `[Nビート]=なし`**。
- **末尾の数値はビート数ではない**: 同じ `special_skill_score_up` 系列に `-999`（多数・`[Nビート]` 付きを含む）・
  `-5`（付き 3 件・なし 多数）・`-200` が併存する。`[Nビート]` 付きの `-trigger-5` も存在する
  （`ef-special_skill_score_up-3-target-trigger-5` = `[30ビート]`）ので、末尾コード≠持続ビート。
  → マスタは**この効果の持続を規定していない**（＝仕様が ID にも説明文にも現れない）。

## 2. sim 側の窓の出所（【Estimate】）

`tools/importers/build_data_phase6.mjs` L648-660:

```js
// duration は target 後の先頭数値（target の無い efficacy は duration を持たない）
for (const t of rest) if (/^\d+$/.test(t) && duration === null) duration = Number(t);
```

`...-target-trigger-5` の `5` を **durationBeats = 5** と読む（`data/skills_levels.json` の `d`）。
engine 側の減算規約（A/SP 付与は step10 減算をスキップ）を通ると表示は **b90–93**。
→ **sim の 4 ビートは importer の推定に由来する【Estimate】** であり、マスタに裏付けは無い。

## 3. 実機 vs sim（A13 の `winRows` より）

| サンプル | レーン | 実機 | sim | 差 |
|---|---|---|---|---|
| **S2** | L3 | **b90–167（6段・78 ビート）** | **b90–93（6段・4 ビート）** | **−74 ビート** |
| S1 | L3 | 143–149(2) / 150–175(3) / 176–176(6) | 143–150(2) / 151–176(3) | **各境界 ±1 ビートのみ** |
| S3 | — | 該当行なし | 該当行なし | — |

- **S2 の 74 ビート差はスコア差 0**: `sp_skill_score_up` は「SP スキル発動時に消費される」型で、
  S2 では L3 の SP が b90（L2 の付与 order 25 → L3 の SP order 26）に発動して**その場で効き切る**。
  裏付け: sim の SP 行は b1Permil **1397**（`special` の b1 式に SP スコア上昇が畳まれている）で、
  実測 SP セル 29,538,545 と比 0.9747（A2 §3）。以後 b167 まで SP は発動しない → 残りは死にバフ。
- **S1 は ±1 ビートの境界差のみ**（P 前半は step10 で減算＝表記−1、A/SP は減算スキップ、の既知規約どおり）。
  S2 のような寿命爆発は S1・S3 には無い → **S2 固有の観測**。

## 4. 裁定

- 決着させる材料が無いため、手順書の指示どおり **【Unknown】として明記**する:
  **「実機は b90–167・sim は b90–93・スコア差 0」**。実機 78 ビートを再現する式は**書かない**
  （マスタに持続指定が無く、`-5` を「5 ビート」と読む importer の推定としか突合できない。
  実機の 78 ビートは「次の SP まで保持」とも「曲末まで表示」とも解釈でき、どちらも裏付けが無い）。
- 現行実装（durationBeats = 末尾数値）は**スコアに影響しない**ため、変更しない。
  将来 SP を 2 回以上撃つサンプルが撮れたら、**b90 の SP 後に同じ行が残っているか**で
  「消費型」か「持続型」かを判別できる（＝再撮影が要る唯一の残件）。

## 5. 再現コマンド

```powershell
node research/23_beat_score_analysis/_b1_efficacy_series.mjs     # vendor 全数解析（末尾コード≠ビート数）
node research/23_beat_score_analysis/_b1_sp_window.mjs           # 実機/sim の窓（S1/S2/S3）
node -e "const j=require('./vendor/Skill.json');const s=j.find(x=>x.id==='sk-skr-05-fest-00-3');console.log(s.levels.map(l=>l.efficacyId+' '+l.description.split('\n')[1]).join('\n'))"
```
