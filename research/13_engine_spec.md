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
9. **全スキル・フォトの CT −1** — `skillCt` 全体をデクリメント（下限0）。このビートで発動したスキルも減る。ただし**発動時の内部CT初期値は CT−1** とする（research/08 §2.3 実測: 表示は満値だが再使用可能最小間隔は CT−1（CT50で gap49 を実測）。発動ビート中に初期化(C−1)+ステップ9減算で実質2進むため、scoring 時に内部CTが0になる最小ビート = 発動+CT−1 となり実測則と一致する）。
10. **全効果のビート数 −1**（スタミナ継続回復/消費はここで処理） — この時点でアクティブな全効果をデクリメント。`durationBeats` 付き `stamina_recovery` はここで1回分の回復/ダメージ。ビート10を跨いでから付与される効果（=ステップ11付与）は減算されない。→ 前半発動バフの実効=表記−1、後半発動=表記どおり、が自動的に成立する【Confirmed: research/01 §4 補足】。
11. **Pスキル発動（後半）** — §4 の選択規則（条件付き）。

## 4. Pスキル・フォトの選択規則（ステップ7/11共通）

- 処理順: メンタル降順（`deck.mental` の大きいレーンから）。同値は `IDOL_PRIORITY_ORDER = [4,2,1,3,5]`【Confirmed: research/01 §2.1】。
- 各レーンは各位相で **Pスキル1つ + フォト1つ** まで発動できる（「各アイドル1つ→次いでPフォト1つ」research/01 §4-7【Estimate: フォトも1つ/アイドル/位相と解釈】）。
- 候補選択: 各レーンの `skills` / `photos` 配列の**先頭から**最初の発動可能なもの【Estimate: 上から順】。
- **前半（ステップ7）**: 全効果行の condition が "none" または "battle_only" のスキル/フォトが対象。
  （battle_only 行は通常ライブで「除外して評価」のため無条件扱い・実測 order3 の
  結婚への願望が前半発動することで確認。P3a condition 拡張タグの仕様）
  - 初回発動はここで起こる（初期CT=0のため前半で使用可）。
- **後半（ステップ11）**: 以下を前半と同一規則で処理。
  - 条件付きスキル/フォト（condition ≠ none を1つでも含む。条件評価はこの時点。`combo>=N` はステップ8更新後のコンボ値、`someone_*` は「他レーンに該当バフが有効」、`self_vocal_lane`/`self_visual_lane` は発動レーンの属性比較）。
  - ステップ9でCTが0になり使用可能になった無条件スキル（2回目以降は自然に後半になる。research/01 §4 補足【Confirmed】）。
- 発動可否チェック順（各候補）: limitPerLive 残数 → CT（`skillCt>0` なら不発。`ct:null` はCT管理なし）→ スタミナ（消費=§3-4の式）→ 確率/成功率（`probabilityPermil<1000` または成功率<1000 のとき `rng.nextCritical()` を発動可否の抽選に流用【Estimate: 抽選源の割当はUnknown。ゴールデン実測データは全て1000でこの経路は通らない】）。不成立は FAIL トレース（`in_ct`/`stamina_short`/`probability`/`limit`）。
- 発動したら: スタミナ消費 → CT設定（`ct` が数値なら `skillCt = ct`）→ 効果適用（§6）→ トレース記録。**発動処理はスコア精算（ステップ8）より前に完了させる**（research/01 §2.5「スキル・スコアは発動時点で既に乗っているバフで計算」【Confirmed】）。後半発動は次ビート以降のスコアに影響する。

## 5. スコア精算（ステップ8）

共通: 係数は**発動者（スコアを得るレーン）自身の**スナップショットで計算。丸めは `computeEventScore`（src/formula/scoreEvent.ts）に一任。`roundingPolicy` は `SimulateInput` から透過。

### 5.1 ビートノート（noteType=1）
- 対象: **全5レーン**が独立イベント。
- 基本スコア = `mulPermil(liveStatus, beatWeightsPermil[lane.attribute])`（切捨て）。
  - `liveStatus = mulPermul省略 → mulPermil(lane.deck[attribute], liveStatusMultiplierPermil(snapshot, attribute))`（切捨て。research/01 §2.4「(1+上昇+ブースト−低下)×V_deck 小数切捨て」【Confirmed】）。
- `b1Permil = b1Permil(snapshot, "beat", scoreBonusPct)`
- `comboFactorPermil = comboFactorPermil(そのレーンのコンボ（増加前）, snapshot.combo_score_up)`（コンボ155でビート156を検算した実績から「増加前コンボ」採用【Confirmed: research/02 §3.3】）
- `fanFactorPermil = fanFactorPermil(input.fanFactorPermil, snapshot.focus)`
- `stageFactorPermil = input.stage.stageFactorPermil`
- `randPermil = rng.nextScoreRoll()`（イベント=レーンごとに1抽選【Estimate: ビート共有説と対立あり、T5で判定】）
- `critFactorPermil = criticalProvider(beat, lane) ? criticalFactorPermil(lane.critExtrasPermil, snapshot.critical_coeff_up) : 1000`
- コンボ更新: 全レーン +1（ビートノートは常に成功【Estimate】）。

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
  - `skillPowerPermil`: 効果行 `score_get` の `powerPermil`。`scaling` ありで `perStagePermil != null` のとき `mulPermil(power, 1000 + perStage × scaling.ref の実効段数)`（`ref: "vocal_up_stages"` は `snapshot.vocal_up + snapshot.vocal_up_extreme`【Estimate】）。`perStagePermil: null` ならスケーリングなし（P3cフィッティング待ち）。
  - B1 kind: A→"active"、SP→"special"。
  - ratio 型（`score_get_by_score_ratio`）: 基本スコア = `floorDiv(その時点の累積総スコア × powerPermil, 1000)`、`skillPowerPermil=1000`、**コンボ・ファン不適用**（`comboFactorPermil=1000`/`fanFactorPermil=1000`。research/02 §1.4【Confirmed】）。累積総スコアの厳密な定義（全体かレーン別か等）は【Unknown】→ T5 の b103 検算で判定。
  - 1スキルに複数のスコア効果行がある場合（例: SP 1570% + 割合12%）は**行ごとに独立のスコアイベント**として計算し合算する（表示ポップは1つでも内部は行単位【Estimate】）。トレースは行ごとに記録し `skillId` を共有。
- コンボ更新: 発動成功レーン +1。未発動/FAIL レーンはコンボリセット（コンボ継続有効なら維持）。

### 5.3 Pスキル・フォトのスコア（score_get / 固定スコア）
- Pスキル・フォトの `score_get`（通常型）も §5.2 と同式（基本スコア=レーン色ライブ中ステータス、B1 kind="passive"。research/02 §1.3 P_Score【Strong estimate】）。
- フォト固定スコア（`fixedScore`）は現データに数値が無いため未対応（将来拡張）。

## 6. 効果適用（発動時・ステップ7/8/11）

効果行ごとに処理（上から順。research/01 §2.5「上から順に処理され、スコア獲得行→バフ付与行の順」【Confirmed】）:

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
| `vocal_high_1` | デッキ vocal が最大のレーン（同値は IDOL_PRIORITY_ORDER 順） | 【Estimate】 |
| `vocal_type_1/2/3` | 属性 vocal のレーンを IDOL_PRIORITY_ORDER 順に N 個 | 【Estimate: 「ボーカルタイプn人」解釈】 |
| `same_lane_other` | `[]`（非バトルでは対象なし・不発） | 【Estimate: ライブバトル用と解釈】 |

条件の someone_* 系（`someone_focus` 等）は「他レーンに該当BuffKeyのアクティブ効果があるか」を真偽判定に使う（付与先解決には使わない）。

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
9. P前半のメンタル降順規則（実測データにメンタル値が無く、発動順 L1→L4→L2→L5→L3 との
   整合は較正値で担保。絶対値での検証は不可）

既存テスト（234 passed）を壊さないこと。`npx vitest run` と `npx tsc --noEmit` を全グリーンで完了すること。
