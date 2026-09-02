# 13. タイムラインエンジン実装仕様（Phase 3b）

 PLAN.md §14 Phase 3 のエンジン実装仕様。実装対象: `src/timeline/engine.ts`。
 契約型: `src/timeline/types.ts` / `src/timeline/constants.ts` / `src/timeline/buffs.ts`（実装済み）。
 出典タグ方針は research/01〜11 と同じ。【Confirmed】=実測/複数ソース一致、【Estimate】=解釈あり要検証、【Unknown】=未解明。

## 1. エントリポイント

```ts
export function simulateTimeline(input: SimulateInput): TimelineResult
```

- 純粋関数。入力 `lanes` は必ず5レーン（L1..L5）、`notes` はビート昇順。
- 内部で `input.notes` を走査し、各ノートのビートで下記11段階を実行する。
- ビート番号は `ChartNote.beat`（1始まり・type≠0ノートの通し番号。data/charts 参照）。

## 2. レーン状態

各レーンが持つ可変状態:

| 状態 | 初期値 | 備考 |
|---|---|---|
| `stamina` | `deck.stamina` | 下限0クランプ【Estimate】上限は未観測のためクランプしない【Unknown】 |
| `combo` | 0 | レーン別（Lane2コンボ継続33件がレーン別コンボの根拠） |
| `activeEffects` | [] | `ActiveEffect`（buffs.ts）+ 内部拡張（付与ビート・対象レーン等） |
| `skillCt` | 全スキル 0 | skillId → 残CT。0=使用可 |
| `limitUsed` | 全フォト 0 | limitPerLive カウンタ |

- `activeEffects` の各要素は「付与先レーン」に紐づく（対象解決は付与時に完了させる）。
- `remainingBeats ≤ 0` の効果は無効（各ビート開始時に除去）。

## 3. ビート内処理順（research/01 §4【Confirmed】の実装規則）

各ノートビートで順に実行。`【A/SP時】`は noteType 2/3 のビートのみ。

1. **（A/SP時）移動（ワープ）効果** — 現データにワープ効果なし。実装はステップのみ用意し即returnでよい（将来拡張）。
2. **（A/SP時）発動アイドル決定・スキルチャンス譲渡** — 譲渡スキルは現データになし。スキップ。
3. **（A/SP時）スキル存在確認** — 各レーンが当該種別（A note→kind"A"、SP note→kind"SP"）のスキルを1つ以上持つか。左から=レーン順 `[1,2,3,4,5]`【Estimate】。
4. **（A/SP時）残スタミナ確認** — 消費 = `mulPermil(skill.staminaCost, consumptionMultiplierPermil(付与先レーンのスナップショット))`（切捨て）。不足レーンは FAIL `stamina_short`。research/01 §4-4【Confirmed】。
5. **（Aスキル時）CT確認** — `skillCt > 0` なら FAIL `in_ct`。SP も同様に CT チェックを行う（現データのSPはCT0のため常に通過。research/01 §4-5 はAのみ明記だがSPもCT概念は同一【Estimate】）。
6. **（バトル）発動権決定** — 非バトル（デイリーライブ）のためスキップ。`battle_only` 条件付き効果は通常ライブでは常に不発（P3a condition 拡張タグの仕様）。
7. **Pスキル発動（前半）** — §4 の選択規則。
8. **SP/A/ビートの発動・スコア精算** — §5。成功→そのレーン combo+1、MISS→combo=0（コンボ継続効果が有効なレーンはリセット免除・増加もしない。research/01 §2.2「コンボ継続」行）。
9. **全スキル・フォトの CT −1** — `skillCt` 全体をデクリメント（下限0）。このビートで発動したスキルも減る。【T5実測確定】**発動時の CT は満タンでセットする**（旧「CT−1 初期化」は前半発動で gap CT−2 を生み research/08 §2.3 の実測則に違反）。前半発動は同ビート内のステップ9で減算されるため実効 CT−1（CTが0になったビートのステップ11で再使用可・gap CT−1）、後半発動は減算されないため実効 CT（gap CT）。実測 gap 系列（かんしょ 49/50/50、逆襲 50/50/35、さらけ出す 59/46、photo-L1-2 49/50/50、photo-L2-2 50/50/50）を完全再現。逆襲の gap35 と さらけ出すの gap46 は b106 ドリームウエディングの隣接 CT−15（research/08 §2.5）で説明。
10. **全効果のビート数 −1**（スタミナ継続回復/消費はここで処理） — この時点でアクティブな全効果をデクリメント。`durationBeats` 付き `stamina_recovery` はここで1回分の回復/ダメージ。ビート10を跨いでから付与される効果（=ステップ11付与）は減算されない。→ 前半発動バフの実効=表記−1、後半発動=表記どおり、が自動的に成立する【Confirmed: research/01 §4 補足】。
11. **Pスキル発動（後半）** — §4 の選択規則（条件付き）。

## 4. Pスキル・フォトの選択規則（ステップ7/11共通）

- 処理順: メンタル降順（`deck.mental` の大きいレーンから）。同値は `IDOL_PRIORITY_ORDER = [3,2,4,1,5]`
  （L3→L2→L4→L1→L5・発動優先位置順）【ユーザー確定 2026-08-29・research/01 §2.1 の 42135 説は訂正】。
  【T5実測確定】本実測編成のメンタル実数（research/14 §4）は
  **L1(8996) > L3(8074) > L4(5890) > L2(5880) = L5(5880)**。
  L2/L5 は同値で、b3 後半の実測発動順 L2→L5 はタイブレーク規則で再現される。
- 各レーンは各位相で **Pスキル1つ + フォト1つ** まで発動できる（「各アイドル1つ→次いでPフォト1つ」research/01 §4-7【Estimate: フォトも1つ/アイドル/位相と解釈】）。
- 候補選択: 各レーンの `skills` / `photos` 配列の**先頭から**最初の発動可能なもの【Estimate: 上から順】。
- **前半（ステップ7）**: 全効果行の condition が "none" または "battle_only" のスキル/フォトが対象。
  （battle_only 行は通常ライブで「除外して評価」のため無条件扱い・実測 order3 の
  結婚への願望が前半発動することで確認。P3a condition 拡張タグの仕様）
  - 初回発動はここで起こる（初期CT=0のため前半で使用可）。
- **後半（ステップ11）**: 以下を前半と同一規則で処理。
  - 条件付きスキル/フォト（condition ≠ none を1つでも含む。条件評価はこの時点）。
    【T5実測確定】`combo>=N` は **グローバル成功ノート数**（ビートノート +1・A/SP 成功 +1・
    FAIL は数えない。b49 SP FAIL を除外した全曲共通カウンタ）と照合
    （実測: L4-3(combo>=50)@b51・L4-4/L1-3(combo>=80)@b81・L5-4(combo>=100)@b101 —
    レーン別コンボ説は L4-4 が b80 でなく b81 に発火したことで否定）。
    `someone_*` は「**自レーンを含む**全レーンのいずれかに該当バフが有効」
    （実測: photo-L3-2/photo-L4-1(someone_critical_coeff_up) の b47 発火は birt-02-1 が
    L3 自身へ ccu+8 を付与した直後であり、他レーンに ccu が存在しない → 自レーン包含）。
    `self_vocal_lane`/`self_visual_lane` は発動レーンの属性比較。
  - ステップ9でCTが0になり使用可能になった無条件スキル（2回目以降は自然に後半になる。research/01 §4 補足【Confirmed】）。
  - 【T5実測確定】「前半で使用可能だった無条件を後半で除外する」**永続集合は存在しない**。
    同ビート内の二重発火は予算（P/フォト各1回・前後半合算）で担保され、b1 でフォト予算を
    取られた無条件フォト（photo-L1-2）は b51 に後半発火する（gap CT−1）— 実測と完全一致。
- 発動可否チェック順（各候補）: limitPerLive 残数 → CT（`skillCt>0` なら不発。`ct:null` はCT管理なし）→ スタミナ（消費=§3-4の式）→ 確率/成功率（`probabilityPermil<1000` または成功率<1000 のとき `rng.nextCritical()` を発動可否の抽選に流用【Estimate: 抽選源の割当はUnknown。ゴールデン実測データは全て1000でこの経路は通らない】）。不成立は FAIL トレース（`in_ct`/`stamina_short`/`probability`/`limit`）。
- 発動したら: スタミナ消費 → CT設定（`ct` が数値なら `skillCt = ct`）→ 効果適用（§6）→ トレース記録。**発動処理はスコア精算（ステップ8）より前に完了させる**（research/01 §2.5「スキル・スコアは発動時点で既に乗っているバフで計算」【Confirmed】）。後半発動は次ビート以降のスコアに影響する。

## 5. スコア精算（ステップ8）

共通: 係数は**発動者（スコアを得るレーン）自身の**スナップショットで計算。丸めは `computeEventScore`（src/formula/scoreEvent.ts）に一任。`roundingPolicy` は `SimulateInput` から透過。

### 5.1 ビートノート（noteType=1）
- 対象: **全5レーン**が独立イベント。
- 基本スコア = `(vocal成分 + dance成分 + visual成分) × λ`（切捨て）【T5実測確定・Strong estimate】:
  - `vocal成分 = mulPermil(mulPermil(lane.deck.vocal, liveStatusMultiplierPermil(snapshot, "vocal")), beatWeightsPermil.vocal)`
    （**発動レーン自身の** vocal バフを乘る。L4 が 反抗 の vocal_up でスコアが跳ねる実測 b60 と整合）
  - `dance成分 = mulPermil(lane.deck.dance, beatWeightsPermil.dance)`
  - `visual成分 = mulPermil(lane.deck.visual, beatWeightsPermil.visual)`
  - 全レーンが**3統計の混成**基本スコアを持つ（属性単一説は L4/L1 pop比 1.13 で否定。research/12 §T5-2b）。
  - `λ = 8/140 ≈ 0.057143`【Strong estimate】: 離散乱数スキャンで L1/L2/L4/L5 の 88% が
    |r−round(r)|<1.5 かつ [945,1055] に収束（0.05712〜0.057145 がプラトー）。140 の由来は未解明
    （候補: 156全ノート−A16 = 140、ビート138+SP2 = 140）。
- `b1Permil = b1Permil(snapshot, "beat", scoreBonusPct)` = `1000 + 25×score_up + bonus.beat`
  【Confirmed: su 25‰/段は L2 の系列で確定（su=0/50‰ は不整合）。asu/テンション不入も実測で確認】
- `comboFactorPermil = comboFactorPermil(そのレーンのコンボ（増加前）, snapshot.combo_score_up)`
  （コンボ155でビート156を検算した実績から「増加前コンボ」採用【Confirmed: research/02 §3.3】。
  lane/global 両基準は本実測で無差別（b49 FAILでも combo_continue 保護でコンボ維持）→ lane 維持）
- `fanFactorPermil = fanFactorPermil(input.fanFactorPermil, snapshot.focus)`
- `stageFactorPermil = input.stage.stageFactorPermil`
- `randPermil = rng.nextScoreRoll()`（イベント=レーンごとに1抽選【Estimate: ビート共有説と対立あり、T5で判定】）
- `critFactorPermil = criticalProvider(beat, lane) ? criticalFactorPermil(lane.critExtrasPermil, snapshot.critical_coeff_up) : 1000`
- コンボ更新: 全レーン +1（ビートノートは常に成功【Estimate】）。
- 【T5判明・未解決】L3（スコアラー）のビートのみ実測と ×0.62〜0.70 の乖離が残る。
  b1 から su を除外 + csu を −4段 とすると 26/39 が離散乱数整合だが、Aイベント（b2）は
  csu=6 段で r=995 検算済みのため式レベルの差分ではなく**バフ進化（延長対象/期限）の差**が疑われる。
  research/12 §T5-2b 参照。T5ソルバー段階で残差ビートを特定して精査する。

### 5.2 A/SPノート（noteType=2/3）
- ノートは `position`（1始まりの優先ランク）で指定されたレーンに属し、**そのレーンのみが挑戦する**。
  写像: pos1→L3, pos2→L2, pos3→L4, pos4→L1, pos5→L5（POSITION_TO_LANE のインデックス position−1）。
  **実測 A/SP 発動 18/18 がこの写像と一致**【Confirmed】。他レーンは挑戦しないため FAIL も
  コンボ変動も発生しない（b49 の SP: L4 のみ FAIL スキル未習得、他レーンは無関係）。
  ※ 旧版の「全レーンが [1,2,3,4,5] 順で挑戦」説は実測で否定（research/12 Phase 3b 記録）。
- 挑戦レーンの処理:
  - kind が一致するスキルを持たない → FAIL `no_skill`、コンボリセット（コンボ継続で免除）
  - スタミナ/CT/確率チェック合格で発動（§3-4, §3-5）。成功 → コンボ+1、失敗 → リセット
- 発動レーンのスコアイベント:
  - 基本スコア = `mulPermil(liveStatus[attribute], skillWeightsPermil.active|special)`（切捨て）
  - `skillPowerPermil`: 効果行 `score_get` の `powerPermil`。`scaling` ありで `perStagePermil != null` のとき `mulPermil(power, 1000 + perStage × scaling.ref の実効段数)`（`ref: "vocal_up_stages"` は `snapshot.vocal_up` のみ。**超化（vocal_up_extreme）は非参照**【2026-09-01 確定・SCALING_REF_KEYS】。星見プロ 19 段=×2.2・成宮すず SP も +6%/段）。`perStagePermil: null` ならスケーリングなし（P3cフィッティング待ち）。
  - A/SP スコアの基本値は**自身のステータスバフ適用前（PRE）**: 効果行は技能文の文順（スコア獲得→ステータスアップ）に処理する（ソート禁止・マスタ順のまま）。自身 vb 等はスコア行の**後**（b123 では基本値 296,208=a vb4 適用前【2026-09-02 確定・旧 POST 仮説撤回】）。
  - A スキルには**写真の Aスコア固定値の平坦加算**（`LaneInput.aScoreAdditionalFlat` = photos の `a_score` type=fixed 合計。b123: +92,262+121,429【2026-09-02 確定】）。割合行・P/フォト行には適用しない。
  - B1 kind: A→"active"、SP→"special"。
  - ratio 型（`score_get_by_score_ratio`）: 基本スコア = `floorDiv(割合行実行時点のレーン自身の累積獲得スコア × powerPermil, 1000)`、`skillPowerPermil=1000`、**コンボ・ファン不適用**（`comboFactorPermil=1000`/`fanFactorPermil=1000`。research/02 §1.4【Confirmed】）。**基準は割合行時点の `self.scoreCum`（同一 SP の score_get 行（前の行）を含む）。全体累積は誤り・クリティカル係数は適用される**【2026-09-02 確定: たろう note nd9513654416f・S1 b143 / T5 b103 両立】。
  - 1スキルに複数のスコア効果行がある場合（例: SP 1570% + 割合12%）は**行ごとに独立のスコアイベント**として計算し合算する（表示ポップは1つでも内部は行単位【Estimate】）。トレースは行ごとに記録し `skillId` を共有。
- コンボ更新: 発動成功レーン +1。未発動/FAIL レーンはコンボリセット（コンボ継続有効なら維持）。

### 5.3 Pスキル・フォトのスコア（score_get / 固定スコア）
- Pスキル・フォトの `score_get`（通常型）も §5.2 と同式（基本スコア=レーン色ライブ中ステータス、B1 kind="passive"。research/02 §1.3 P_Score【Strong estimate】）。
- フォト固定スコア（`fixedScore`）は現データに数値が無いため未対応（将来拡張）。

## 6. 効果適用（発動時・ステップ7/8/11）

効果行ごとに処理（上から順。research/01 §2.5「上から順に処理され、スコア獲得行→バフ付与行の順」【Confirmed】。**A/SP も同順でソートしない**【2026-09-02 確定・旧「ステータス系→スコア行」ソートは撤回】）:

| type | 処理 |
|---|---|
| 段階型バフ（mapEffectToBuffKey が非null） | 対象レーン各々に `ActiveEffect` を付与（stages=行の stages、remainingBeats=durationBeats、limitRelease 引継ぎ）。付与時に対象レーンの同種実効段数が上限超になる分は無視（aggregateBuffs がクランプ）【Confirmed: research/01 §2.2】。`durationBeats` null の段階型は現データになし（あれば永続扱い【Estimate】） |
| `score_get` / `score_get_by_score_ratio` | §5 のスコアイベント（A/SPはステップ8内、P/フォトは発動位相内で即時） |
| `stamina_recovery` | `value` を発動対象レーンのスタミナに加算（負値=ダメージ）。**[0, maxStamina] にクランプ**（maxStamina=デッキスタミナ。実測 order9: L3 18730−866+2560 → 18730 で上限確認【Confirmed】）。`durationBeats` があればステップ10で毎ビート `value`【Estimate: 継続型の単位は1回/ビートと解釈】 |
| `ct_reduction` | 対象レーンの全スキル `skillCt = max(0, skillCt − value)`（b106 ドリームウエディングの隣接CT−15実測【Confirmed: research/08 §2.5】。Aスキルも短縮対象に含める【Estimate: [T1]に「Aスキル対象外」の明記がある短縮スキルがあるとのみ記載】） |
| `ct_increase` | 対象レーンの全スキル `skillCt += value`【Estimate: 実測での発火箇所が少なく T4 で検証】 |
| `effect_amplify` | 対象レーンのアクティブなバフ効果のうち、各BuffKeyで残りビート最大の1インスタンスに `value` 段追加【Confirmed: research/01 §2.2「残りビート数が最長のものだけが増強・延長の対象」】 |
| `effect_extension` | 対象レーンの全アクティブバフ効果の remainingBeats に `value` 加算【Confirmed: 同上「延長は全強化効果が対象」】 |

## 7. 対象解決（resolveEffectTargetLanes）

`target` → 対象レーン配列。発動者レーンを `A` とする。

| target | 解決 | 確度 |
|---|---|---|
| `self` / `single` | `[A]` | single は P3a 注記「実測では常にスコアラー白石千紗に解決」と整合（発動者=千紗のスキルのみ対象）【Estimate】 |
| `score_type_1` / `score_type_2` | `[A]`（バフ付与先として発動者扱い） | 【Unknown: スコアタイプの厳密意味。T4 のバフmultiset照合で検証】 |
| `center` | `[3]` | 【Estimate】 |
| `all` | `[1,2,3,4,5]` | 【Confirmed: テキスト「味方全員」】 |
| `neighbors` | `[A−1, A+1]`（範囲内のみ。A=1なら[2]、A=5なら[4]） | 【Estimate: 隣接=左右1レーンずつ】 |
| `vocal_high_1`、`*_higher_N` | レーン属性が <attr> のレーンをデッキ属性ステータス降順で N 個（「ボーカル高い1人」等） | 【Estimate】 |
| `vocal_type_1/2/3`、`dance_type_*`、`visual_type_*` | **メンバーのタイプ**（cardType=装着カードの属性【Estimate: ratiosPermil 最大。research/07 確度 Medium】）が一致するレーンをレーン優先度順（L3>L2>L4>L1>L5）で先頭 N 個。レーン属性（stage laneAttributes）とは独立 | 【Confirmed 2026-09-01: サンプル1 殻をやぶる（ボーカルタイプ2人）→ L3,L2。デッキ vocal 降順説は棄却】 |
| `same_lane_other` | `[]`（非バトルでは対象なし・不発） | 【Estimate: ライブバトル用と解釈】 |

条件の someone_* 系（`someone_focus` 等）は「他レーンに該当BuffKeyのアクティブ効果があるか」を真偽判定に使う（付与先解決には使わない）。

【サンプル1確定 2026-09-01】`target-position_attribute_<attr>-N`（「ボーカル**レーン**N人」）は
`*_lane_N`: レーン属性一致レーンを**レーン番号順**に N 個（麻奈も立った大舞台 vocal_lane_3 → L1,L3,L4。
4番目のボーカルレーン L5 は対象外）。タイプ（cardType）とは明確に区別する。
**レーン優先度 L3>L2>L4>L1>L5** は P前半発動順のタイブレーク以外に、*_type_N の対象選択順としても使われる（ユーザー確認 2026-09-01）。

## 8. トレース要件（T4/T5 の突合に必須）

- `ActivationTrace`: 全発動試行（成功/FAILとも）。`phase` は位相（first/main/last）、`staminaCost`/`gainedScore` は成功時のみ。
- `BeatTrace.buffSnapshots`: スコア精算直前（ステップ8開始時）のレーン別スナップショット（aggregateBuffs の出力そのもの）。
- `BeatTrace.comboAfter`/`staminaAfter`: ステップ10完了時点（ビート末尾）。
- `gainedScore` 合計 = `totalScore`（ビートノート・A・SP・P/フォト全てを含む累積）。

## 9. 推測・要検証リスト（T4/T5 で判定すること）

※ T4（ビート1〜3の発動15件・スタミナ全点）で以下は解決済み【Confirmed】:
- A/SPノートは該当レーンのみ挑戦（旧「全レーン挑戦」説は否定）
- battle_only 行を含むスキルは無条件扱いで前半発動する
- スタミナ回復は maxStamina でクランプ
- P前半の各レーン処理 = 無条件Pスキル1つ + 無条件フォト1つ、条件付きは後半
- L2 フォトの前半/後半発動スケジュール（配列順・CT・条件評価の実装と全点一致）

残る検証項目:
1. ビートノートの全レーン成功前提（MISSなし）→ T5（no_pop ラーン=MISS の可能性含む）
2. スコア乱数の抽選単位（レーンイベントごと）
3. type36 scaling の段数参照（vocal_up+vocal_up_extreme）
4. ratio 型の基本スコア基準（累積総スコア）
5. score_type_1/2 の付与先解決
6. 割合SP b103 の厳密一致（基本スコア定義含む）
7. ct_reduction の Aスキル包含
8. コンボのレーン別/全体モデル（combo>=N 条件が絡む b50 以降で判定）
9. P前半/後半のメンタル降順規則。
   【2026-08-31 確定】メンタルは**算出値**で担保される: 100×(1+交流Men%)＋スタッフ固定＋エール固定＋
   フォト/アクセ固定（research/01 §1.4・baseStatus.ts SUB_STATS 分岐）。
   T5 実測 5 レーンの算出値 8996/5880/8074/5890/5880 は research/14 §4 の実数と 1 の位まで完全一致
   （L3: 100×1.50 + 5165 + 600 + 2159 = 8074）。
   相対順 **L1 > L3 > L4 > L2 = L5**（b51 後半 L1→L3→L4 / b47 後半 L3→L4→L2 / b3 後半 L2→L5 の
   発動順と完全一致。L2=L5 同値は配置優先度 IDOL_PRIORITY_ORDER=[3,2,4,1,5] で解決）。

既存テスト（234 passed）を壊さないこと。`npx vitest run` と `npx tsc --noEmit` を全グリーンで完了すること。

---

## §9 T5 ゴールデン確定仕様（2026-08-30・総スコア 1 の位まで完全一致）

総スコア 17,529,132,014 に完全一致し、統合リージョンを除く全 119 ビートの累積スコアが
実測 cumulative と一致（tests/golden/t5-scores.golden.test.ts）。

| 項目 | 確定値 |
|---|---|
| スコア乱数 | **連続値（float, [0.95,1.05]）**。整数パーミル仮定は棄却 |
| 丸めポリシー | **at-end（全ファクター積算→最終 1 回 floor）**。sequential は棄却 |
| ビート CB | X=baseComboBonus(表示コンボ=beat-1)、X_eff=floor(X×(1000+57.5×csu)/1000)、CB=floor((1000+X_eff)×(1000+11.5×csu)/1000) |
| ビート B1 | 1000+25×su+360 |
| フォト行のクリティカル | **非適用**（b47/b132/b125 のポップが全て非 crit で成立） |
| ミスノート | b1 全レーン（LIVE START 取りこぼし）。SimulateInput.missedNotes |
| type36 スケーリング | A fest-03-2: 2.5‰/段（vb+vue 基準）／SP fest-03-1: 11‰/段 |
| photo-L3-2 score_get | **160‰**（テキスト表記 20% と食い違い・ポップ実測で確定） |
| wedding A type20 | **combo_score_up+5 [60b]** target=score_type_1（旧 ccu+5 解釈は棄却） |
| 比率行基準 | レーン累積+15700 行加算後の累積 ×120‰（trace.ratioBaseCumScore） |
| ポップ表示精度 | 10 万単位 truncation（100K 幅）。精密判定には不十分 |

### 検証の枠組み
- 逆算ソルバー（tests/golden/t5-solver.test.ts）がビート毎に実測 gained をターゲットに
  連続乱数 r を逆算（単一イベント: BigInt 厳密逆算／複数イベント: 一様 f 二分探索+最終イベント
  残余吸収／比率行: 先行乱数 1000 固定の構成的不動点）。
- 失敗ビートは前方統合（最大 4 行）で総和一致を解く（フレーム帰属・表示遅延の例外 20 区間 36 ビート）。
- ゴールデンテストは乱数列をリプレイし、total + 全ビート累積 + リージョン総和を検証する。

### 既知の残課題
- b1-3 の gained 帰属（表示遅延）と b47-51 等のフレーム帰属は「リージョン総和一致」でのみ検証。
  ビート単位の一致は計測データの制約により検証対象外。
- ポップの OCR 誤読（b97=330万は 350万の誤読等）が少数残る。gained/cumulative は信頼できる。

---

## §10 ライブボーナス（ステージ側Pスキル）【Phase 9・Peing確定 2026-08-31】

research/16_peing_verified_specs.md §1 の実装仕様。データ源は `data/live_bonuses.json`
（Quest.liveBonusGroupId → LiveBonusGroup → LiveBonus → LiveAbility → Skill.json の連携で抽出）。

### 10.1 ビート内処理順への組み込み（§3 の拡張）
| ステップ | 内容 |
|---|---|
| 6.5（新設） | **ライブボーナス前半発動** — 全アイドルPスキルより先頭。無条件（+編成人数条件 `count_<unit>>=N` 成立）ライボが対象。付与バフは同ビートのスコア精算に乗る（実効ビート数=表記-1） |
| 7〜10 | 従来どおり（アイドルP前半→スコア精算→CT-1→効果ビート数-1）。ライボ CT も step9 で減算 |
| 11（先頭） | **ライブボーナス後半発動** — 後半Pスキル群の中で最も最初。動的条件（`someone_*`/`combo>=N`/`someone_recovered`）を評価し未成立時は保留。CT が step9 で 0 になった無条件ライボの再発動もここ（アイドルPと同一規則） |

- 予算: ライボはアイドルの P/フォト予算（各1回/ビート）と**独立**。ライボ毎に前後半合算1回。
- 対象解決のアンカーはセンター（L3）【Estimate: neighbor 基準は現データのライボに未出現】。
- トレース: 成功時のみ `kind="live_bonus"`・`lane=0`。

### 10.2 発動条件（triggerId → EffectCondition）
| triggerId | condition | 発動位相 |
|---|---|---|
| （無し） | none | 前半 |
| tg-someone_status-<X> | someone_<EffectType>（20 種） | 後半 |
| tg-combo-N | combo>=N（グローバル成功ノート数） | 後半 |
| tg-someone_recovered | someone_recovered（ビート中の回復受けレーン） | 後半 |
| tg-more_than_character_count-<unit>-N | count_<unit>>=N（UNIT_MEMBERS 定数・静的成立） | 前半（成立時） |

- `someone_*` は自レーンを含む全レーンが評価対象（T5実測確定の準用）。
- 条件評価は `target="trigger"` の解決にも使う（条件成立レーンに効果を付与）。

### 10.3 CT と同期仕様
- 発動時に CT 満タン→step9 減算（アイドルPと同一モデル）。前半発動の実効間隔 CT-1・後半発動は CT。
- **「CT短縮ライボで短縮されたPスキルはライボの発動タイミングに収束（同期）する」（research/16 §1）**:
  追加ルールは不要。Pスキルの CT が step9 で 0 になったビートの後半=ライボ再発動と同位相で
  発火するという CT モデルの帰結として自然に成立する。
- `live_bonus_ct_reduction`（マスタ live_ability_cool_time_reduction）はライボ側 CT を短縮する
  アイドルスキル効果（Phase 9 で対応）。

### 10.4 Phase 9 のその他の拡張（§2・§5・§6 への影響）
- BuffKey 拡張（24キー）: `vocal_down/dance_down/visual_down`（低下・-50‰/段）／`p_skill_score_up`
  （P スコア上昇・b1 passive に +100‰/段）／`stealth`（副効果で他4レーンの fanFactor に加算:
  STEALTH_FAN_BONUS_PERMIL・5段=18‰/6段=21‰/10段=37‰・1-4段 Unknown=0 近似）／`stamina_cost_up`
  （消費増加・+50‰/段・最大2倍）。
- 超化（add_effect_value_*）: **表記段階数はダミーで一律「元バフ+5段階分（固定）」**。
  【2026-09-02 修正】capExtend=true の効果行は独立インスタンスを作らず**増強型**として処理
  （同種バフの残り最大インスタンスへ +5 段・基底なしで不発。§11 の表参照）。
  加算を受けたインスタンスの生存中は同種バフの上限を加算量ぶん拡張（20→25・テンション 10→15）。
  vocal_up_extreme の1段値は 50‰（STATUS_UP_EXTREME_PER_STAGE_PERMIL。golden fest-03-2 は
  stages 10→5 に修正・合計 +250‰ 不変・type36 perStage は 2.5→3.0 に再較正）。
- 集目副効果テーブル確定値: FOCUS_FAN_BONUS_PERMIL = [7,14,21,28,35,38,41,44,47,50]。

---

## §11 サンプル2 確定仕様（2026-09-02）

出典: `research/20_sample2_gap_analysis/README.md`・`サンプル2/issues.md`。実測 STAGE680（168 ビート）。

| 項目 | 仕様 | 確度 |
|---|---|---|
| 誰かが低下効果状態の時 | `tg-someone_status_group-weekness` → `someone_down_group`（vocal/dance/visual_down のいずれかが編成の誰かに有効）。低下効果なし編成では**全編不発**（憧れていた青春。発動間隔 b1→b55→b110→b165 = CT55 前半発動モデルと一致） | 【Confirmed: S2 発動ログ】 |
| 効果行単位トリガー | `skillDetails[].triggerId` を効果行ごとに写像（score_get 行は無条件・バフ行のみ <属性>レーン条件の混合スキルが存在） | 【Confirmed: マスタ構造】 |
| 入力 audience | 入力 JSON の `audience` 明示時は会場キャパ cap/5 で上書きしない。fan.png 実測値（個人来場ファン数）× `fanBonusPermilFromCount` テーブルが実測スコアボーナス%（53.9-57.4%）と 1 の位まで一致 | 【Confirmed: fan.png 全 5 レーン検算】 |
| tg-position_attribute_* の意味 | **レーン属性説で確定（2026-09-02 ユーザー確定）**: S2 怜 A2 の「発動」は誤認。効果行ごとの独立条件評価（下記行独立行参照）により 怜 A2 は無条件スコア行のみ発動。両サンプルが同一規則で整合（T5 82/82・S2 L3 ×0.976） | 【Confirmed: ユーザー確定】 |
| 効果行の行独立条件評価 | 効果行は**行ごと**に条件評価し不成立行のみスキップ（1 行でも成立すればスキルは発動）。P の後半ゲートも `rowsHoldAny`（1 行成立で発動可・全行 AND から変更）。根拠: T5 紗季 A2・S2 怜 A2 = 無条件スコア行のみ発動（スキルウィンドウに 2 行目以降が表示されない）／祭り千紗 P2 = 2 行目が 1 行目のレーン条件に非依存 | 【Confirmed: ユーザー確定】 |
| 前発動/後発動の判定 | **無条件行（none/battle_only）を 1 つでも持つ P/フォト = 前発動**（CT0 で前半自動発動。祭り千紗 P3 型・`some` 判定に変更）。全行条件式 = 後発動（後半評価） | 【Confirmed: ユーザー確定】 |
| 超化の方式 | **増強型で確定（2026-09-02）**: 同種バフの残りビート最大インスタンスへ +5 段（実効加算値 5 段・ユーザー確定）。**基底インスタンスが無いと不発**（独立インスタンスを作らない）。上限拡張量はインスタンスの `capExtend`（加算量）に記録し aggregateBuffs が上限へ加算。S2 実測: b41 ccu=13（P2 8段+超化5）→ critF 2504・b100 ccu=0（基底消滅で超化不発）→ 1854・b142 ccu=8 → 2254 がユーザー式と完全一致 | 【Confirmed: S2 3 ビート完全一致】 |
| ビート crit と ccu | A/SP と同一式（critF = 1500 + 50×ccu + extras）。第一段階で「傾きなし」に見えたのは旧 ccu 系列の誤り（行独立未実装で ccu が過大）が原因。修正後の ccu 系列で L3 全体 ×0.976（±5% 内） | 【Confirmed: 全体整合】 |
| フォトスキルのスタミナ | **消費される（訂正）**: S2 の「減っていない」観測はスクショが P 消費後・フォト消費前の中間フレームだった誤認 + measured_data の 7→2 OCR 誤読（計 236 行・修正表を measured_data_v2_ocr7to2_fix.json に追記）。L3 b1 = 8046（P 610 消費後）→ b2 = 7494（フォト 552 消費後）で確定 | 【Confirmed: 元画像目視】 |
| 自身が低下効果状態の時 | `tg-status_group-weekness` → `self_down_group`（自身に vocal/dance/visual_down のいずれかが有効。誰か版 `someone_down_group` の主語違い）。「一生懸命、金魚すくい」2 行目 | 【Confirmed: マスタ構造・実測は次サンプル】 |
