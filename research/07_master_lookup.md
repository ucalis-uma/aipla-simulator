# 07. マスタデータ照合レポート（STAGE19 完全実測ライブ）

- 役割: マスタデータ照合担当
- 実施日: 2026-08-29
- データソース: https://github.com/MalitsPlus/ipr-master-diff （raw: `https://raw.githubusercontent.com/MalitsPlus/ipr-master-diff/main/<Table>.json`）
- データバージョン: `!version.txt` = `641f4aa886984c66c0393972e31f969fd4e24b3f9724e650b0bdedee57e2f364`（ダウンロード日 2026-08-29 現在最新）
- 照合対象: ローカル実測データ（`スコア分析サンプル/verification_data.md/.json`、`scratch/all_skill_orders.json` 82件の発動ログ）
- 構造化データ: `research/fixes/master_extract.json`（計算機入力用。本レポートの数値はすべてここから機械可読に取り出せる）
- 原則: 値はすべてマスタ引用。推測・解釈は「解釈」/「Unknown」と明記する。

---

## 1. STAGE19 クエスト特定と全パラメータ【確度: Confirmed】

### 1.1 クエスト特定

`Quest.json`（全 5,916 件）のうち `musicId=music-hsm-004` かつデイリーライブ（area-daily-003）は 20 件（STAGE1〜20）。実測（Lv286 / 来場者 80,000 / 総ビート 156）に合致するのは **1 件のみ**:

| フィールド | 値 |
|---|---|
| id | **qt-daily-003-19** |
| areaId | area-daily-003 |
| stageId | stage-live-dome-01-04（横浜スカイスタジアム） |
| musicId | music-hsm-004（`Music.json` で「The Sun, Moon and Stars」确认。作詞 利根川貴之 / 作曲・編曲 沖井礼二 / 歌 星見プロダクション） |
| name | STAGE19 |
| difficultyLevel | **286** |
| order | 19 |

候補の絞り込み過程: 同曲のデイリークエストは Lv31/51/71/91/111/131/141/153/161/171/181/191/201/221/241/261/271/281/**286**/291 の 20 段階で、Lv286 は STAGE19 のみ。maxCapacity も 80,000 で実測来場者表示と一致。

### 1.2 STAGE19 全パラメータ（Quest.json qt-daily-003-19）

| パラメータ | 値 | 備考 |
|---|---|---|
| **musicChartPatternId** | **chart-hsm-004-001** | -001 と -002 の両方がマスタに存在。採用根拠は §1.4 |
| position1AttributeType | **2**（vocal） | position1 = センター（§1.3） |
| position2AttributeType | **2**（vocal） | |
| position3AttributeType | **1**（dance） | |
| position4AttributeType | **2**（vocal） | |
| position5AttributeType | **2**（vocal） | |
| beatVocalWeightPermil | **600** | 標準値 |
| beatDanceWeightPermil | **250** | 標準値 |
| beatVisualWeightPermil | **150** | 標準値 |
| activeSkillWeightPermil | **1000** | |
| specialSkillWeightPermil | **1000** | |
| skillStaminaWeightPermil | **1000** | |
| staminaRecoveryWeightPermil | 0 | |
| **maxCapacity** | **80,000** | 実測来場者表示 80,000 人と一致 |
| mentalThreshold | **3,681** | |
| questPressureId | quest_pressure-2 | `QuestPressure.json`: name=**「普通」**, weightPermil=999 |
| questAudienceAdvantageId | quest_audience_advantage_1 | §3 |
| questCharacterAdvantageId | ""（なし） | |
| clearScore | 685,000,000 | |
| moodType / liveSkipType / ticketAmount | 0 / 2 / 1 | |
| unlockConditionId | cd-manager_level_gte-280 | |

**「ライブ特徴表示は要求メンタル：普通のみ」というユーザー確定情報との整合**【Confirmed】
- questPressure-2 の name が「普通」→ 虫眼鏡の「要求メンタル：普通」と一致。
- ビート重みが標準 600/250/150‰、A/SP 重みも 1000（=100%）→ スコア倍率系の特徴表示が無いことと整合。
- 変則値は **一切なし**（重み・スキル重みすべて標準）。

### 1.3 レーン色・表示レーン↔position 対応【確度: High（本レポートの最重要新知見）】

**enum 確定**（3 ソースが完全整合）:
1. `Accessory.json` 624 行: classification（dance/vocal/visual/stamina/mental/technique）と param1Type が **全行で** 1対1 対応 → **1=dance, 2=vocal, 3=visual, 4=stamina, 5=mental, 6=technique(=クリティカル)**
2. `StatusEffectName.json`: statusEffectType **1=ダンス上昇, 2=ボーカル上昇, 3=ビジュアル上昇**
3. research/03_data_sources.md が引用した同一リポジトリ系 `types/proto/proto_enum.ts` の `ParameterType {Unknown=0, Dance=1, Vocal=2, Visual=3, Stamina=4, Mental=5, Technique=6}`

→ STAGE19 のレーン色は **position1=ボーカル / position2=ボーカル / position3=ダンス / position4=ボーカル / position5=ボーカル**（ボーカル4 + ダンス1、ビジュアルレーンなし）。

**表示レーン（verification_data.md の Lane1〜5）↔マスタ position の対応は identity ではない。** 譜面ノートの position と発動ログの突合により **次の対応が証明された**:

| 表示Lane | アイドル | マスタposition | レーン色 | 証拠 |
|---|---|---|---|---|
| Lane1 | 鈴村優 | **position4** | ボーカル | Aノーツ#5/10/14（position4）でハスハスしてる優ちゃんが発火 |
| Lane2 | 白石沙季(から紅) | **position2** | ボーカル | Aノーツ#4/9/12（position2）でやすらぎ/私が恋が発火。私が恋の「ボーカルレーン時」効果が適用 |
| Lane3 | 白石千紗（センター） | **position1** | ボーカル | Aノーツ#1/7/16（position1）で星見プロが発火。SPノーツ#103（position1）で『成宮すず』発火。逆襲のドッキリ企画（ボーカルレーン条件）4回発火 |
| Lane4 | 長瀬琴乃 | **position3** | **ダンス** | Aノーツ#2/8/11（position3）で花嫁の心得/ドリームウエディングが発火。SPノーツ#49（position3）で「SP FAIL スキル未習得」（琴乃はSP未習得）。ドリームの「ビジュアルレーン時」効果は不発 |
| Lane5 | 白石沙季(胸に秘め) | **position5** | ボーカル | Aノーツ#3/6/13（position5）で殻をやぶる/アイドルの掟が発火 |

- **position1 = センター**（さらけ出す等の「センター」対象がすべて千紗=position1 に着弾）。position 番号はセンターピボットのステージ配置（表示左→右 = p4, p2, p1, p3, p5）。
- 「隣接（neighbor）」は**表示レーンの隣接**（例: position3 の隣接 = position1 と position5。結婚への願望の回復対象が千紗+沙季(L5) と実測ログで一致）。
- SPノーツはノートごとに position（レーン）を持ち、**そのレーンのメンバーのSPスキルが発動試行される**。ノート49→position3（琴乃、SP未習得→FAIL）、ノート103→position1（千紗、発火）。実測ログの beat 49 FAIL / beat 103 発火と完全一致。
- Aノーツ16個のノート番号 `[2,23,30,38,47,60,69,80,86,94,106,115,128,136,144,156]` は発動ログのAスキル16発火ビートと **16/16 完全一致**。

> 計算機への要求: レーン色・隣接・A/SPノーツ処理は「表示レーン順 [p4,p2,p1,p3,p5]」で組むこと。verification_data.md のレーン色表記（L1/L2/L3/L5=ボーカル、L4=ダンス）は上表どおり **全て正しかった**（L4 に「SP」表記が重複していたのは SPノーツ#49 の FAIL ポップアップ由来と推定）。

### 1.4 譜面（chart-hsm-004-001 確定）

`MusicChartPattern.json` の id=chart-hsm-004-001（268 グリッド）:

| type | MusicChartType enum | 個数 | 意味 |
|---|---|---|---|
| 0 | （休止） | 112 | ノートなし |
| 1 | Beat | **138** | 通常ノーツ（ビートスコア対象） |
| 2 | ActiveSkill | **16** | Aノーツ |
| 3 | SpecialSkill | **2** | SPノーツ（ノート番号 49: position3 / 103: position1） |

- ノート総数 = 138+16+2 = **156** ＝ 実測「総ビート156」【一致】。最大コンボ 155 は実測 results.combo。
- chart-hsm-004-002 は Aノーツ12個で発火ログ16個と不一致 → **-001 で確定**（ダブルチェックで Confirmed）。
- `Music.json` の volumePermyriads / vocalVolumePermyriads は **268 要素**（グリッド数 268 = bars 67 × 4拍 と一致）。ビートスコアの音量加重に使うデータと推定（解釈。要実装側検証）。
- 効果IDの接尾辞 `-chart_dependence`（全スコア獲得系に付与）は「譜面（音量等）依存でスケールする」ことを示すと推定（解釈・未検証）。

---

## 2. QuestAudienceAdvantage（来場者ボーナス）【確度: Confirmed】

`QuestAudienceAdvantage.json`（1,000 行、id は quest_audience_advantage_1 のみ。audienceAmount 10〜50,000・50人刻み中心）:

| audienceAmount | advantagePermil | | audienceAmount | advantagePermil |
|---|---|---|---|---|
| 15,750 | 1,615 | | **16,000** | **1,620** |
| 15,800 | 1,616 | | 16,050 | 1,621 |
| 15,850 | 1,617 | | 16,100 | 1,622 |
| 15,900 | 1,618 | | 16,150 | 1,623 |
| 15,950 | 1,619 | | 16,200 | 1,624 |

- **16,000 人 → 1,620‰ = +62.0%**。実測「スコアボーナス +62.0%」と **完全一致**。
- テーブル範囲: 10人→1,001‰（+0.1%）〜 **50,000人→2,000‰（+100.0%）**（上限）。全行は `master_extract.json` の `audience_table.rows`（1,000行）。

---

## 3. ComboAdvantage（コンボボーナス）【確度: Confirmed】

`ComboAdvantage.json` 全 7 行（id=combo_advantage_1。`Music.json` の comboAdvantageId 経由で楽曲に紐付く）:

| comboCount | advantagePermil |
|---|---|
| 10 | 1,050 |
| 20 | 1,100 |
| 30 | 1,150 |
| 40 | 1,200 |
| 50 | 1,250 |
| 70 | 1,300 |
| **100** | **1,500** |

- comboCount はしきい値（コンボ数が行の値以上のとき適用と解釈）。
- **コンボ 155 → 最上位しきい値 100 の行が適用 → 1,500‰ = +50.0%**。
- 注意: 「コンボ50=+25%」等の通説より低めのテーブル。実数値はこの表どおり（+10%〜+50%）。

---

## 4. StaffLevel（スタッフ育成ボーナス）【確度: Confirmed — 6種すべて実測レベルで完全一致】

`StaffLevel.json`（420 行 = parameterType 6種 × Lv1〜70、`advantage` は累積値）。

**enum 対応**（§1.3 と同じ parameterType。Accessory classification で機械的に確定）:

| parameterType | 名前 | 曲線 | 実測ボーナス | 一致レベル | Lvでの値 |
|---|---|---|---|---|---|
| 2 | ボーカル（ボイストレーナー） | A | **+29,195** | **Lv65** | 29,195 ✓ |
| 1 | ダンス（振付師） | A（type2/3と同一） | **+27,884** | **Lv64** | 27,884 ✓ |
| 3 | ビジュアル（スタイリスト） | A（type1/2と同一） | **+27,884** | **Lv64** | 27,884 ✓ |
| 4 | スタミナ（フィジカルコーチ） | B | **+5,086** | **Lv67** | 5,086 ✓ |
| 5 | メンタル（セラピスト） | C | **+5,165** | **Lv60** | 5,165 ✓ |
| 6 | クリティカル＝Technique（演出家） | C（type5と同一） | **+2,705** | **Lv48** | 2,705 ✓ |

- **6種すべて「実測の表示レベルで実測値とピッタリ一致」**（誤差 0）。累積値解釈（advantage = そのレベルまでの合計）で正しいことを実測が裏付け。
- 同一曲線グループ: {type1,2,3}（最大 36,316 @Lv70）、{type4}（最大 5,785）、{type5,6}（最大 8,150）。
- `StaffLevelLimitBreakRank.json`: parameterType 別 rank0〜9 で levelLimit 60→69（rank消費で上限開放、最大 Lv70）。
- 全 70 レベルの累積配列を `master_extract.json` の `staff_cumulative.parameterTypes` に格納（例: vocal Lv60〜70 = 23,019 / 24,179 / 25,376 / 26,611 / 27,884 / **29,195** / 30,544 / 31,930 / 33,354 / 34,816 / 36,316）。

---

## 5. 実測使用スキル 15 件の完全抽出【確度: Confirmed（CT・消費スタミナ 15/15 一致）】

`Card.json` → skillId1〜3（5カードとも skillId4 は空）→ `Skill.json`。`categoryType`: **1=SP, 2=A(アクティブ), 3=P(パッシブ)**。全スキル `probabilityPermil=1000`（成功率100%表示と整合）。

### Lane3 白石千紗（card-chs-05-fest-03 / role type1=スコアラー）

| スキル | Lv | CT | 消費 | 効果（Skill.json levels[使用Lv] description 全文・改行→/） |
|---|---|---|---|---|
| [SP] 『成宮すず』なのですわ！ | 6 | **0** | **1,201** | 1570%のスコア獲得、ボーカル上昇状態の段階数が多い程効果上昇 / 自身の獲得スコアの12%のスコア獲得 / スタミナ1201消費 |
| [A] 星見プロ全国ツアーin愛知 | 6 | **30** | **404** | 400%のスコア獲得、ボーカル上昇状態の段階数が多い程効果上昇 / 自身にボーカル上昇超化効果[36ビート] / [ライブバトルのみ]同じレーンの相手のCTを10増加 / スタミナ404消費 CT:30 |
| [P] 逆襲のドッキリ企画 | 6 | **50** | **866** | 自身がボーカルレーンの時 自身に7段階ボーカル上昇効果[43ビート]とスタミナを2560回復 / スタミナ866消費 CT:50 |

- skillId: `sk-chs-05-fest-03-1/2/3`
- 効果ID: SP → `ef-score_get_by_status_effect_type_grade-vocal_up-15700-chart_dependence`（type36）＋ `ef-score_get_by_score_ratio-120-target-self`（type70）/ A → 同 type36 の `-4000-`（400%）＋ `ef-add_effect_value_vocal_up-10-target-self-36`（type95、ボーカル上昇超化 10段階・36ビート）＋ `ef-cool_time_increase-10-target-opponent_same_position`（type50、ライブバトル専用）/ P → `ef-vocal_up-7-target-self-43`（type14、maxGrade20・上限解放30）＋ `ef-fix_stamina_recovery-2560-target-self`（type23）
- レベル別数値（SP）: L1 950%+7% / L2 1070%+8% / L3 1190%+9% / L4 1310%+10% / L5 1440%+11% / L6 **1570%+12%**（stamina 718→1201）

### Lane1 鈴村優（card-yu-05-birt-02 / type3=サポーター）

| スキル | Lv | CT | 消費 | 効果 |
|---|---|---|---|---|
| [A] ハスハスしてる優ちゃん | 6 | **30** | **157** | 450%のスコア獲得 / スコアラータイプ2人に8段階クリティカル係数上昇効果[47ビート]と10段階クリティカル係数上昇上限解放効果[47ビート] / スタミナ157消費 CT:30 |
| [P] かんしょ〜かい | 6 | **50** | **279** | スコアラータイプ1人に6段階コンボスコア上昇効果[44ビート]と10段階コンボスコア上昇上限解放効果[44ビート] / スタミナ279消費 CT:50 |
| [P] これぞ深夜の背徳感 | **5** | **50** | **289** | 自身がビジュアルレーンの時 / スコアラータイプ1人に5段階Aスキルスコア上昇効果[34ビート]と10段階Aスキルスコア上昇上限解放効果[34ビート] / スタミナ289消費 CT:50 |

- 効果ID: ハスハス → `ef-score_get-4500-chart_dependence`（type1）＋ `ef-critical_bonus_permil_up-8-target-character_type-1-2-47`（type20）＋ `ef-limit_break_critical_bonus_permil_up-10-...`（type81）/ かんしょ → `ef-combo_score_up-6-target-character_type-1-1-44`（type41）＋ type86 上限解放 / これぞ深夜 → `ef-active_skill_score_up-5-target-character_type-1-1-34`（type18）＋ type80 上限解放、**スキルレベル triggerId = `tg-position_attribute_visual`**
- **これぞ深夜の背徳感は本ライブで一度も発火していない**（発動ログ82件に不在。Pスキルはビジュアルレーン条件 → Lane1=ボーカルなので不発が正しい。条件検証として有用）

### Lane2 白石沙季（card-ski-05-onep-00 / type2=バッファー）

| スキル | Lv | CT | 消費 | 効果 |
|---|---|---|---|---|
| [A] やすらぎの贈り物 | 6 | **50** | **187** | 480%のスコア獲得 / スコアラータイプ1人に5段階テンションUP上限解放効果[46ビート]と強化効果を3段階増強 / スタミナ187消費 CT:50 |
| [A] 私が恋をするのなら | 6 | **50** | **202** | 510%のスコア獲得 / 自身がボーカルレーンの時 ボーカルが高い1人の強化効果を10延長と9段階クリティカル率上昇効果[46ビート] / スタミナ202消費 CT:50 |
| [P] 気持ちを和歌に乗せて | **5** | **50** | **262** | スコアラータイプ1人に3段階テンションUP効果[40ビート]と3段階ボーカルブースト効果[40ビート] / スタミナ262消費 CT:50 |

- 効果ID: やすらぎ → type1 `-4800-` ＋ type85 ＋ type26 / 私が恋 → type1 `-5100-` ＋ `ef-strength_effect_count_increase-10-target-vocal_higher-1`（type25）＋ `ef-critical_rate_up-9-target-vocal_higher-1-46`（type19）— 後半2効果に効果単位で `tg-position_attribute_vocal` 付与 / 和歌 → `ef-tension_up-3-...-40`（type38）＋ `ef-vocal_boost-3-...-40`（type56）

### Lane4 長瀬琴乃（card-ktn-05-wedd-00 / type3=サポーター）

| スキル | Lv | CT | 消費 | 効果 |
|---|---|---|---|---|
| [A] 花嫁の心得 | 6 | **50** | **187** | 530%のスコア獲得 / 全員にコンボ継続効果[75ビート] / 全員に8段階消費スタミナ低下効果[75ビート] / スタミナ187消費 CT:50 |
| [A] ドリームウエディング | 6 | **50** | **190** | 550%のスコア獲得 / 隣接するアイドルのCTを15減少 / 自身がビジュアルレーンの時 スコアラータイプ2人に5段階クリティカル係数上昇効果[60ビート] / スタミナ190消費 CT:50 |
| [P] 結婚への願望 | **5** | **40** | **273** | 隣接するアイドルのスタミナを3600回復 / [ライブバトルのみ]同じレーンの相手のスタミナを2200消費 / スタミナ273消費 CT:40 |

- 効果ID: 花嫁 → type1 `-5300-` ＋ `ef-combo_continuation-target-all-75`（type12）＋ `ef-stamina_consumption_reduction-8-target-all-75`（type11）/ ドリーム → type1 `-5500-` ＋ `ef-cool_time_reduction-15-target-neighbor`（type27）＋ `ef-critical_bonus_permil_up-5-target-character_type-1-2-60`（type20、**効果単位**で tg-position_attribute_visual）/ 結婚 → `ef-fix_stamina_recovery-3600-target-neighbor`（type23）＋ `ef-stamina_consumption-2200-target-opponent_same_position`（type49、ライブバトル専用）

### Lane5 白石沙季（card-ski-05-waso-00 / type2=バッファー）

| スキル | Lv | CT | 消費 | 効果 |
|---|---|---|---|---|
| [A] 殻をやぶる | 6 | **50** | **186** | 570%のスコア獲得 / ボーカルタイプ2人に6段階クリティカル率上昇効果[60ビート] / スタミナ186消費 CT:50 |
| [A] アイドルの掟への反抗 | 6 | **50** | **173** | 510%のスコア獲得 / 隣接するアイドルに6段階ボーカル上昇効果[38ビート] / 誰かが集目状態の時 センターに4段階ボーカル上昇効果[38ビート] / スタミナ173消費 CT:50 |
| [P] さらけ出す | **5** | **60** | **280** | センターに9段階の集目効果[38ビート] / センターの強化効果を11延長 / スタミナ280消費 CT:60 |

- 効果ID: 殻 → type1 `-5700-` ＋ `ef-critical_rate_up-6-target-vocal-2-60`（type19）/ 掟 → type1 `-5100-` ＋ `ef-vocal_up-6-target-neighbor-38`（type14）＋ `ef-vocal_up-4-target-center-38`（**効果単位で** `tg-someone_status-audience_amount_increase`）/ さらけ出す → `ef-audience_amount_increase-9-target-center-38`（type21）＋ `ef-strength_effect_count_increase-11-target-center`（type25）

### 照合結果サマリ

- **CT・消費スタミナ: 15/15 スキルが実測値（verification_data.md）と完全一致**（例: SP 消費1201/CT0、星見プロ 404/CT30、これぞ深夜 289/CT50、結婚への願望 273/CT40、さらけ出す 280/CT60）。
- Aノーツ16発火ビートと譜面Aノーツ16個が完全一致（§1.4）→ 発火ログのビート番号はノート番号。

### 特記項目の回答

**(a) 『成宮すず』の効果値・係数・上限**
- 基礎スコア: **1570%**（Lv6。efficacyId 埋め込み値 15700）。type36「ボーカル上昇状態の段階数が多い程効果上昇」付き。
- 追加: **自身の獲得スコアの12%**（`ef-score_get_by_score_ratio-120-target-self`、type70。id 値 120 = 12%）。
- **段階数スケーリングの係数・上限はマスタに存在しない**（efficacy 行に数値フィールドなし、grade/maxGrade=0）→ **Unknown（ゲーム内部定数）**。実装では実測フィッティングが必要。
- 12%効果の上限値もマスタになし → Unknown。

**(b) 星見プロ全国ツアーin愛知の係数**
- 基礎スコア **400%**（type36、`-4000-`）＋ 同じ「ボーカル上昇段階数」スケーリング（係数は同様に Unknown）。
- 付属効果: ボーカル上昇**超化**10段階・36ビート（type95。超化=効果値加算方式への切り替え）。[ライブバトルのみ]CT+10 はデイリーでは無効。
- SP と A が同じ type36 スケーリング機構を共有する点に注意。

**(c) Pスキル6種の分類**
- スコア獲得型: **なし（全6種がバフ/回復型）**。詳細は `master_extract.json` の `skillNotes.pSkillClassification`。
  - 逆襲のドッキリ企画 = バフ＋回復（スキル単位でボーカルレーン条件）
  - かんしょ〜かい = バフのみ / これぞ深夜の背徳感 = バフのみ（スキル単位でビジュアルレーン条件・未発火）
  - 気持ちを和歌に乗せて = バフのみ / 結婚への願望 = 回復 / さらけ出す = バフ（集目）
- 条件付与の階層に注意: **スキルレベル triggerId**（スキル自体の発動条件: 逆襲/これぞ深夜）と **効果単位 triggerId**（効果の適用条件: 私が恋/ドリーム/アイドルの掟）の2階層が存在。

**(d) CT・消費スタミナの実測一致** → 15/15 一致（上記サマリ）。

---

## 6. フォト（PhotoAbility）構造【確度: 構造 Confirmed / 一部解釈】

`PhotoAbility.json`（374行）× `PhotoAbilitySet.json`（3,813行 = フォト Rarity ごとのアビリティ束）。

- **photoAbilityLevels**: `[{level, value}]` フォトLv→値。
  - **スキル系**（`skillId` を持つ、155種）: value = **参照先 Skill.json のスキルLv**。例: `pab-passive-skill_sk-phot-exchange-pvp-5-01` は Lv60→value1, Lv110→value2（フォトLv110でスキルLv2になる）。消費スタミナ/CT/効果は Skill.json 側。
  - **固定値系**（Aスコア等）: value = ボーナス値そのもの（例: pab-active-skill-score-up_add-1「Aスコア」Lv70→778）。
- **photoAbilityGrades**: `[{grade, bonusPermil, type, bonusValue}]` = フォトの grade（限界突破）ごとの効果値補正。例: grade1→1000‰, grade2→1040‰, grade3→1080‰（+4.0%/grade の例）→ 効果値 × bonusPermil/1000 と解釈。**type フィールドの意味は Unknown**。
- **実測の「スコア獲得スキル Lv1（40%のスコア獲得・スタミナ180消費 CT:70）」の同定**: Skill.json で stamina=180 & coolTime=70 は **1件のみ** → `sk-phot-exchange-pvp-5-01`「スコア獲得スキル」（categoryType3=P / `ef-score_get-400-chart_dependence` / 40%=4000）。実測 Lane5 の「スコア獲得スキル」6発火と整合【Confirmed】。
- abilityType 代表値: 1/3/5/9/11=ダンス/ボーカル/ビジュアル/メンタル/クリティカル固定値、2/4/6/8=割合、17/18=ビート固定/割合、19/20=Aスコア固定/割合、21/22=SPスコア固定/割合、23=クリティカルスコア割合、27〜33=CTカット等の特殊系。

---

## 7. LiveAbility / Accessory（アクセサリ固定値・%値）【確度: 構造 Confirmed / Pink系 Unknown】

- **Accessory.json（624行）** の構造: `param1Type`（§1.3 enum、classification 列と全行一致）/ `param1Value`（固定値）/ `param1Permil`（割合‰）/ `param2*`（第2効果）/ `limitBreakPhase`。標準アクセサリ（スピリット系・マイク系・シューズ系等 54ファミリー、★1〜★5、キャラ別スピリット含む）は **マスタで完全取得可能**。例: ac-1-dance-01「スポーツシューズ★1」= param1Type1（ダンス）+10 固定値。
- **実測の Pink Mic（+24,500/30%）/ Pink Potion（+35,500/35%）/ Pink Crystal（+35,500/35%）/ ピンクのマイクリボン / Green Heart（+2,750）/ 緑のハートのペンダント / ボーカル(+35,500/35%) / クリティカル(+3,550)**:
  - Accessory.json・Item.json の名称検索で **不命中**。固定値＋割合の複合パラメータを持つアクセサリは表中 0 件。
  - → **Unknown**（別システム〈EXアクセサリ等〉の可能性。実測値をそのまま計算機入力に使うこと）。
- **LiveAbility.json（544行）**: `levels[]` にレベル別効果。カードのライブアビリティ（lba-*）とライブボーナス（LiveBonus.json → live-lba-*）の実値はここ。本レポートの範囲では参照が必要な行なし（ライブエール +45%/+39%/+58% 等の実測エール値は複数ソースの合成と推定され単一行と同定できず → 詳細 Unknown、実測値を入力に使用）。

---

## 8. 発見した落とし穴（計算機実装への申し送り）

1. **Card.type は属性ではなく役割**（1=スコアラー/2=バッファー/3=サポーター）。カード属性は vocal/dance/visualRatioPermil の最大値スタットと推定（本5カードでは役割読み取り実測と整合、確度 Medium）。`target-vocal-2`（ボーカルタイプ2人）等の対象選択にはこちらを使う。
2. **position1 = センター**。表示レーン順は [p4, p2, p1, p3, p5]。neighbor は表示順の隣接（≠ position±1）。
3. **SPノーツはレーンを持つ**。そのレーンのメンバーのSPスキルが発動試行され、未習得なら FAIL（実測 beat49）。SPスキル持ちを SPノーツレーンに置いていないと失敗する。
4. 効果の条件は**スキル単位**（triggerId）と**効果単位**（skillDetails[].triggerId）の2階層。効果単位条件はスキル発動の可否と独立。
5. type36「段階数が多い程」の係数と type70「獲得スコアのn%」の上限はマスタ外（Unknown）→ 実測フィッティング領域。
6. コンボボーナスは +10%〜+50% の7段階しきい値（+50% はコンボ100以上）。
7. `Music.json` volumePermyriads（268要素=グリッド数）はビートスコアの音量加重候補。`-chart_dependence` 接尾辞と合わせ要検証。

## 9. 未解決（Unknown）一覧

| 項目 | 状況 |
|---|---|
| type36 スコア獲得の「段階数あたり上昇係数」とその上限 | マスタに数値なし。ゲーム内部定数 |
| type70「獲得スコアのn%」の上限 | マスタに数値なし |
| Pink Mic 等の実測アクセサリ8種 | Accessory/Item に不命中。別システムと推定 |
| photoAbilityGrades.type の意味 | 未確認（bonusPermil の挙動は +4%/grade を確認） |
| ライブエール実測値（Vo+45% 等）のマスタ上の構成要素 | 単一行と同定できず（複数ソース合成と推定）。実測値を入力に使用 |
| volumePermyriads のスコア式での使われ方 | 268グリッド音量データであることまで確認。式への入る形は要実装検証 |
| mentalThreshold=3,681 の具体的効用 | questPressure（要求メンタル表示）とは別フィールド。挙動未確認 |

---

### 付: 本照合で使用したダウンロードファイル

`C:\Users\umaro\AppData\Local\Temp\opencode\ipmaster\` 配下（元データは変更していない）: Quest / Music / MusicChartPattern / Stage / QuestPressure / QuestAudienceAdvantage / QuestCharacterAdvantage / ComboAdvantage / StaffLevel / StaffLevelLimitBreakRank / Skill / SkillEfficacy / SkillTrigger / SkillTarget / Condition / Card / CardParameter / PhotoAbility / PhotoAbilitySet / PhotoAbilityTarget / LiveAbility / LiveBonus / Accessory / Item / StatusEffectName（+README/!version.txt）

Condition.json（7.6MB）は照合の結果、本実測15スキルの trigger/efficacy からは参照されていないことを確認（SkillTrigger の行構造は id/type/characterIds のみ）。
