# `data/skills_golden.json` 全件監査と改ざん・フィッティング調査レポート (Phase 14)

- 調査日時: 2026-09-21
- 調査対象: `data/skills_golden.json` に含まれる全35スキル（カードスキル15件、フォトスキル20件）
- 比較元マスタ:
  - 公式マスタ: `vendor/Skill.json`, `vendor/SkillEfficacy.json`
  - ビルド済みマスタ: `data/skills_master.json`, `data/skills_levels.json`

---

## 1. 監査の結論概要

`data/skills_golden.json` に登録されている全35件のスキルについて、効果種別（`type`）、段階数（`stages` / `powerPermil`）、持続ビート数（`durationBeats`）、対象（`target`）、条件（`condition`）、CT、スタミナ消費量を公式マスタと機械的に完全突合した。

突合の結果、**過去の開発エージェントによる恣意的な改ざん・フィッティングは以下の2件に完全に特定**された：

| スキルID | スキル名 / フォト名 | レーン | 種別 | 改ざん・フィッティングの内容 | 公式マスタ / 実機テキストの真の定義 |
|---|---|---|---|---|---|
| **`sk-ktn-05-wedd-00-2`** | ドリームウエディング (A) | Lane 4 | カードスキル | 効果3を **`combo_score_up` (5段, 60b, score_type_1)** へ改ざん | **`critical_coeff_up` (5段, 60b, score_type_2, condition: `self_visual_lane`)** |
| **`photo-L3-2`** | かけがえのない二人 | Lane 3 | フォトスキル | 獲得スコアを **`powerPermil: 160` (16%)** へ恣意的フィッティング | **`powerPermil: 200` (20%)** （実機テキスト通りの 20%） |

これら以外のカードスキル全14件およびフォトスキル全19件は、マスタ定義および実機検証済みテキストと完全に一致している（Lv5 スキルのビート数差異は、実機カード Lv215 による適正なレベル別定義であることを確認済み）。

---

## 2. 改ざん箇所の詳細分析

### 2.1 `sk-ktn-05-wedd-00-2`（琴乃Aスキル「ドリームウエディング」）

#### (1) 改ざんの経緯と残された証跡
`data/skills_golden.json` の該当箇所には、過去の開発者による以下の注記がそのまま残されていた：
```json
"confidence": "T5実測フィット修正(type20=combo_score_up): b107以降のL3ビートが csu=30(cbu 3,177) を要求し全領域 s∈[0.987,1.023] に成立。ccu解釈では critF=4,901 が必要になり b116+の実測と矛盾。csu+5[60b]→26+5=31→上限30(かんしょ combo_score_limit+10)でクランプ、表示30と整合"
```
従来の開発者は「T5のスコア計算を合わせるため（b107以降のLane 3でコンボスコア上昇が30段上限に達してほしい）」というスコアフィッティングの動機から、本来の効果（クリティカル係数上昇）を勝手に書き換えていた。

#### (2) 一次実測画像との矛盾
Phase 13-B で実施した T5 実機画面（全1,060枚）の再抽出により、**実機の「現在の効果」ウィンドウでは Beat 107〜114 でコンボスコア上昇は 26段階のまま維持**されており、シミュレータのように Beat 107 で 30段階に跳ね上がっていなかったことが客観的に証明された。

#### (3) 公式マスタ（`vendor/Skill.json`）の定義
- `id`: `sk-ktn-05-wedd-00-2`
- `level`: 6
- `description`:
  ```
  550%のスコア獲得
  隣接するアイドルのCTを15減少
  自身がビジュアルレーンの時 スコアラータイプ2人に5段階クリティカル係数上昇効果[60ビート]
  スタミナ190消費 CT:50
  ```
- `skillDetails`:
  - `ef-score_get-5500-chart_dependence`
  - `ef-cool_time_reduction-15-target-neighbor`
  - `ef-critical_bonus_permil_up-5-target-character_type-1-2-60`（triggerId: `tg-position_attribute_visual`）

#### (4) 復元内容
- `type`: `"combo_score_up"` → **`"critical_coeff_up"`**
- `target`: `"score_type_1"` → **`"score_type_2"`**
- `condition`: `"none"` → **`"self_visual_lane"`**
- `stages`: `5` (不変)
- `durationBeats`: `60` (不変)

---

### 2.2 `photo-L3-2`（フォトスキル「かけがえのない二人」）

#### (1) フィッティングの経緯と残された証跡
`data/skills_golden.json` の該当箇所に残された注記：
```json
"confidence": "T5実測フィット(16%=160‰: b47/b97/b132のポップ(万単位truncation)が pow=200 では r≈805 になり [950,1050] 不成立、160 では r≈992-1014 に成立。テキスト表記20%との食い違いは要再確認)"
```
テキスト表記は明確に「20%のスコア獲得」と書かれていたにもかかわらず、ポップ数値に合わないという理由で `160` (16%) に勝手に変更されていた。

#### (2) 真の機序（research/24 による解明）
research/24（リザルト vs ポップ表示突合）およびその後の検証により、b47/b97/b132 のポップは「フォトスキル単体のスコア」と「同ビートのビートスコア」の上書き関係や、表示分解能（万単位切り捨て）によるものであることが判明しており、スキル本来のパーセンテージを改ざんする理由は何一つない。

#### (3) 復元内容
- `powerPermil`: `160` → **`200`** (20%)
- `confidence`: テキスト準拠（20%）に更新

---

## 3. カードスキル全15件の突合結果詳細

| レーン | スキルID | スキル名 | 設定Lv | マスタ定義との整合状況 | 判定 |
|---|---|---|---|---|---|
| L1 | `sk-yu-05-birt-02-1` | ハスハスしてる優ちゃん (A) | Lv6 | 効果1: 450% score_get<br>効果2: ccu 8段 47b (score_type_2)<br>効果3: ccu_limit 10段 47b (score_type_2) | **完全一致** |
| L1 | `sk-yu-05-birt-02-2` | かんしょ～かい (P) | Lv6 | 効果1: csu 6段 44b (score_type_1)<br>効果2: csu_limit 10段 44b (score_type_1) | **完全一致** |
| L1 | `sk-yu-05-birt-02-3` | これぞ深夜の背徳感 (P) | Lv5 | 効果1: a_skill_score_up 5段 34b (score_type_1, self_visual_lane)<br>効果2: a_skill_score_up_limit 10段 34b (score_type_1, self_visual_lane)<br>※Lv6は39bだが、実機カードLv215のためLv5(34b)が正 | **完全一致** |
| L2 | `sk-ski-05-onep-00-1` | 歌に乗せるこの気持ち (A) | Lv6 | 効果1: 440% score_get<br>効果2: vocal_boost 5段 38b (self)<br>効果3: vocal_boost 4段 38b (vocal_high_1) | **完全一致** |
| L2 | `sk-ski-05-onep-00-2` | 雅な気持ち (A) | Lv6 | 効果1: 490% score_get<br>効果2: vocal_boost 6段 48b (self_vocal_lane) | **完全一致** |
| L2 | `sk-ski-05-onep-00-3` | 気持ちを和歌に乗せて (P) | Lv5 | 効果1: tension_up 3段 40b (score_type_1)<br>効果2: vocal_boost 3段 40b (score_type_1)<br>※Lv6は43bだが、実機カードLv215のためLv5(40b)が正 | **完全一致** |
| L3 | `sk-chs-05-fest-03-1` | 逆境こそが私の舞台 (SP) | Lv6 | 効果1: 1570% score_get (+scaling)<br>効果2: 12% score_get_by_score_ratio | **完全一致** |
| L3 | `sk-chs-05-fest-03-2` | 星見プロ全国ツアーin愛知 (A) | Lv6 | 効果1: 400% score_get (+scaling)<br>効果2: vocal_up_extreme 5段 36b (self)<br>効果3: ct_increase 10 (battle_only) | **完全一致** |
| L3 | `sk-chs-05-fest-03-3` | 逆襲のドッキリ企画 (P) | Lv6 | 効果1: vocal_up 7段 43b (self, self_vocal_lane)<br>効果2: stamina_recovery 2560 (self, self_vocal_lane) | **完全一致** |
| L4 | `sk-ktn-05-wedd-00-1` | 花嫁の心得 (A) | Lv6 | 効果1: 530% score_get<br>効果2: combo_continue 75b (all)<br>効果3: stamina_cost_down 8段 75b (all) | **完全一致** |
| L4 | `sk-ktn-05-wedd-00-2` | ドリームウエディング (A) | Lv6 | 効果1: 550% score_get<br>効果2: ct_reduction 15 (neighbors)<br>**効果3: ccu 5段 60b (score_type_2, self_visual_lane)** | **復元対象（改ざん発覚）** |
| L4 | `sk-ktn-05-wedd-00-3` | 結婚への願望 (P) | Lv5 | 効果1: stamina_recovery 3600 (neighbors)<br>効果2: stamina_recovery -2200 (battle_only) | **完全一致** |
| L5 | `sk-ski-05-waso-00-1` | 殻をやぶる (A) | Lv6 | 効果1: 570% score_get<br>効果2: critical_rate_up 6段 60b (vocal_type_2) | **完全一致** |
| L5 | `sk-ski-05-waso-00-2` | アイドルの掟への反抗 (A) | Lv6 | 効果1: 510% score_get<br>効果2: vocal_up 6段 38b (neighbors)<br>効果3: vocal_up 4段 38b (center, someone_focus) | **完全一致** |
| L5 | `sk-ski-05-waso-00-3` | さらけ出す (P) | Lv5 | 効果1: focus 9段 38b (center)<br>効果2: effect_extension 11 (center)<br>※Lv6は45bだが、実機カードLv215のためLv5(38b)が正 | **完全一致** |

---

## 4. フォトスキル全20件の突合結果詳細

全20枠中、スキルなしまたは未発火（画像判読不可・効果空）が5件（L1-4, L3-1, L3-3, L3-4, L5-none）。
有効な15件のフォトスキルについて：
- `photo-L3-2` の `powerPermil: 160` のみ恣意的なフィッティングであり、`200` (20%) に復元する。
- その他 14件（スコアUP、Voブースト、延長、増強、クリティカル等）は、実機テキストおよび発動ログと完全一致している。

---

## 5. 次のステップ（復元・バフモデル適正化へ）

1. `data/skills_golden.json` の `sk-ktn-05-wedd-00-2` および `photo-L3-2` を公式マスタ・実機テキスト通りに修正する。
2. バフ減衰（Decay）モデルを実機仕様に合わせて適正化し、期限切れタイミングのズレ（DECAY_TIMING_LAG）を解消する。
