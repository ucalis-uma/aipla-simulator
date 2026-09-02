# 18. type36（条件参照スコア）係数の突合表

- 作成日: 2026-09-01（係数表の運用開始）
- 目的: 「スキルパワーを○○状態の段階数/コンボ数/種類数等で上昇」系スキル（type36）の
  係数を、**スキル単位**で 出典別（やるキ士docs / Peing / T5 実測フィット）に突合し、
  現在の計算機がどの値をどこから借りているかを一元管理する。
- **出典の信頼性方針（2026-09-01 ユーザー指摘）**: 倍率（乗算係数）は docs を信頼できるが、
  **上限値（強化効果種類数の 9 等）は初期から二度仕様変更されており docs は参考値に過ぎない**。
  → 上限なしで実装し、現行値の同定にはゲーム内実測が必要（要検証タグ）。
- 元データ（機械可読）: `data/type36_coefficients.json`（スキル別上書き）
  / `tools/importers/build_data_phase6.mjs` の `CONDITIONAL_SCALE_DEFAULTS`（効果型別既定倍率）
  / 生 docs: `research/sheets/type36_coefficients.csv`（`python tools/sheet_fetch.py 1LUicvnDjzaWudpMjEizAPKnn8RpFnZIwWD4p-JpdErI --gid 806980235 --name type36_coefficients`）。

---

## 1. 係数（実装済み値）

### 1-1. スキル別（`data/type36_coefficients.json` の skillOverrides = 最優先）

| スキル | 式 | 倍率 | 出典 | 確度 |
|---|---|---|---|---|
| それが勇気になるから（L3 SP） | linear（段階数） | **+7.0%/段**（ref=focus_stages） | Peing id=1187772111「集目10時1921% = Lv6 1130%×1.7」＋docs gid=806980235 | **Confirmed**（2026-09-01 ユーザー確認。但しサンプル1 b143 の逆算（700% 相当）とは未解明の差→Lv5 係数か逆算側要因かは未確定） |
| 新たな衣装と新たな決意（L3 A） | comboLessQuad | **+200%×((150−発動前コンボ)/150)²** | docs gid=806980235 | **Confirmed**（基準値 150 は docs が正・2026-09-01 ユーザー確認。係数 200% はサンプル1 逆算が小さい値を示すため較正対象として維持） |
| **瑠依の予感（天動瑠依 A・CT30・280%@Lv1）** | linear | **+6.0%/段**（ref=vocal_up_stages） | docs gid=806980235 ＋ **簡易検証 2026-09-01（0 段/19 段/20 段の b115 イベント実測）** | **Confirmed**（検算: 0段 123.8K = 33212×2.8×b1×combo×fan×r(≈0.947・非crit) / 19段 1.1M = 64763×2.8×…×2.14×critF(1.765) ≈1,093,792 / 20段 ≈1,153,294 — いずれも表示 K の丸め精度内で一致。**星見プロの 0.3%/段 と同一でないことが実証 = スキル別係数**） |
| 星見プロ全国ツアーin愛知（T5 L3 A） | linear | **+6.0%/段**（ref=vocal_up_stages・**超化は参照しない**） | docs gid=806980235 ＋ **簡易検証 2026-09-01**（0 段 +2.5M（r=0.9565）・19 段 +10.3M（比から k=5.9%）） | **Confirmed**（**旧 T5 フィット 3.0‰/段・超化込み ref 25/30 は誤りと判明** → T5 ゴールデンは再検証待ち） |
| 『成宮すず』なのですわ！（T5 L3 SP） | linear | **+6.0%/段**（ref=vocal_up_stages・**超化は参照しない**） | docs ＋ **簡易検証 2026-09-01**（b143・voc_up 7 段・vue 10 段は無視: 22.5M = モデル 21,608,759（r=1.041）） | **Confirmed**（旧フィット 11‰/段 は誤り） |

### 1-2. 効果型別の既定倍率（`CONDITIONAL_SCALE_DEFAULTS`。スキル別上書きがなければこれ）

| 効果型（raw efficacy type） | 実装式 | 式（docs gid=806980235） | 上限 |
|---|---|---|---|
| `score_get_by_less_combo_count` コンボ数が少ない程 | comboLessQuad | 200% × ((150 − 発動前コンボ)/150)² | コンボ 150 で 0% |
| `score_get_by_more_combo_count` コンボ数が多い程 | comboMoreLinear | +(10/11)%/コンボ | なし |
| `score_get_by_strength_effect_count` 強化効果が多い程 | effectCount | +14%/種類 | **上限 9 種類**（2026-09-01 ユーザー確認: 現行も 9 段階・**上限解放キャラが存在**。2022-06-20 正午後 9 種類が現行まで維持。vendor の `…_strength_effect_count_limit_increase` 変種 = 上限解放側の挙動と推定・未対応→要検証） |
| `score_get_by_more_stamina` 残スタミナが多い程 | staminaRatioQuad（残率²） | 80% × (発動後スタミナ率)² | +80% |
| `score_get_by_less_stamina` 残スタミナが少ない程 | staminaRatioQuad（消費率²） | 80% × (発動後スタミナ消費率)² | +80% |
| `score_get_by_more_stamina_use` / `score_get_and_stamina_consumption_by_more_stamina_use` | staminaConsumedLinear | 0.011%/スタミナ | なし |
| `score_get_by_skill_activation_count` 発動スキル数が多い程 | skillCountLinear | +9.7%/回（フォト含む） | なし |

### 1-3. 現在ごまだ未実装（要検証タグ or 未対応）

| 効果型 | docs の式 | 状態 |
|---|---|---|
| `score_get_by_status_effect_type_grade`（段階数系） | **+6.0%/段（Vo/Da/Vi UP/ブースト）/ +16.0%/段（テンション）/ +6.7%/段（クリ率）** | スキル別係数のみ実装。**+6%/段 等の「家族既定値」は T5 フィット（0.3%/段・星見プロ）と 20 倍の差があるためスキル別に確定するまで付けない**（docs は 2022 年時点のため現在のゲームとは係数スキームが変わった可能性大）。ref 自体（vocal_up_stages 等）は importer の TYPE36_STATUS_TO_REF が分解済み |
| `score_get_by_more_fan_engage` コアファン率が多い程 | 180% × (コアファン率)² | コアファン率の入力がシミュレータにないため未実装（要追加実測・要入力設計） |
| `score_get_by_less_fan_amount` 観客数割合が少ない程 | （docs に式なし） | 未実装（Unknown） |
| `score_get_by_character_count` / `score_get_by_trigger` / `score_get_by_skill_success_rate_up` | docs 該当なし | 未実装 |
| `score_get_by_strength_effect_count_limit_increase-*` | 強化効果種類数+上限増加付き | **未対応効果（importer の unsupported リスト）**。上限の実態解明の鍵になり得るため次回調査対象 |

---

## 2. 実装経路（データの流れ）

```
vendor/Skill.json（効能 id 内の係数は持たない）
  → tools/importers/build_data_phase6.mjs
      ・type36: status（末尾 chart_dependence 正規化）→ ref 分解（TYPE36_STATUS_TO_REF）
      ・条件参照系: CONDITIONAL_SCALE_DEFAULTS（docs 倍率）+ data/type36_coefficients.json の
        skillOverrides（Peing/T5 値）で scaling を組み立て
  → data/skills_master.json / data/skills_levels.json（sc フィールド）
  → src/timeline/engine.ts  scaledSkillPowerPermil()
      linear / comboLessQuad / comboMoreLinear / effectCount /
      staminaRatioQuad / staminaConsumedLinear / skillCountLinear
      （丸め: 0.1% = permil floor。docs 明記と一致）
```

- **golden 優先**: 適用対象カードに skills_golden（T5 実測較正）がある場合、build はそちらを優先する
  （T5 の星見プロ/成宮すず の係数も data 側に同値が入るが、実効は golden 側）。
- **検証**: `tests/unit/timeline/type36-scaling.test.ts`（13 件）
  + T5 ゴールデン（`npx vitest run tests/golden/t5-scores.golden.test.ts` 5 件）は不変。

## 3. 未解決・要較正（次サンプルで同定可能なもの）

1. それが勇気になるから（focus 参照・+7%/段）: サンプル1 b143 の実測は係数 1000%×(1+0.07×10)=1700%
   を支持せず（逆算 ~700% 相当）。**Lv5 の係数が Lv6 と異なる可能性** → Lv 別・focus 段数を変えた
   撮影で検証。
2. 新たな衣装（combo ≦150 参照）: サンプル1 の 3 点（cb 50/58/113）は docs 式より小さい →
   係数 200% についての較正（参照値 150 は docs 正・2026-09-01 ユーザー確認）。
3. 強化効果種類数（effectCount）: 上限 9 種類（現在・上限解放キャラあり）で実装済み。
   対象範囲（自身の強化効果か）と 上限解放時の挙動は _limit_increase 変種と併せて未検証。

## 4. T5 再フィットの結果（2026-09-01） — 再フィット完了・99.97% 一致

**実行**: `npm run solve:t5`。改定内容: ①type36 = +6%/段（voc_up のみ・超化非参照・家族値適用）
②**B2 = docs gid=0（「コンボのボーナス」）** — 旧実装は「(1+テーブル)×(1+0.1×csu)」で
csu を全体に二重乗算しており、実測ノート（IMG_1512/CJPH5507）との 2.1 倍定常誤差の正体。
docs の正式は「テーブル増分 × (1+0.1×csu)」（実測: 69 コンボ・csu 19 段 → 1725‰ 一致）。
③**ファン = docs 引力式（gid=969532646）** — 引力度（集目+5%/段・ステルス−5%/段）による
配分（自レーン来場 = 基礎×5×自/Σ）。T5 では集目 10 段 → 16,000 人 → 21,818 人 → 71.8%+5.0% =
1768‰（実測メモと完全一致）。

- **結果: 総合 17,523,631,776 vs 実測 17,529,132,014 → 差 −5,500,238（99.97%）**・okBeats 120/155。
- b69 A は **215,861,327（IMAG_1512 の計算値と完全一致）**・b156 A と b103 SP も乱数 ±5% 内。
- 乱数列（fixtures/t5_replay_rands.json）を再生成し **golden テストを 21/21 で再有効化**
  （総合 0.1% 未満の担保 + 再現値固定 + リージョン別一致）。
- **残る既知の未知**: ±1 ビート位相領域（b47-51・b97-102・b130-133・計 5.5M）。ソルバーの
  [UNSOLVED] 行はこの 3 領域のみ（他は緩和）。ビート（達成帯）の撮影/帰属で特定する。
- 完全一致（1 の位）への道筋: 位相の特定 → ソルバー再実行 → golden から除外リストを外す。

## 5. その後の進展（2026-09-01〜09-02）— 完全一致 + サンプル1 も全整合

- 位相の特定（スキル順計上ルール・b2 A 即時計上・skill_order 順）→ ソルバー再実行で
  **golden 17,521,461,739 = シミュ 17,521,461,739（1 の位まで完全一致・除外リスト撤去・5/5）**。
- サンプル1（S1）: **A/SP 効果行=マスタ順（スコア獲得→ステータスアップ・スコアは自身バフ適用前 PRE）**＋
  **写真の Aスコア固定値の平坦加算**（`aScoreAdditionalFlat`）で **全 14 イベント ±5% 内・合計 ×1.0163**。
  T5 は A スコア固定値 0（写真構成）で不変・golden 5/5 維持。詳細: research/17_sample1_gap_analysis/CONCLUSION_2026-09-02.md。
