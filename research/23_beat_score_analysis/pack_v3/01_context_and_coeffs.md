# 01. 計算アーキテクチャと現行エンジン確定係数

> 本ファイルの数値はすべてリポジトリ内の実装コード・データから機械的に抽出した確定値である
> （出典を各節に明記。目視転記・推測値は含まない）。
> 検証リポジトリ: https://github.com/ucalis-uma/aipla-simulator （ブランチ main・
> 本 pack 作成時点のコミット `d94cefe`。GitHub raw URL は 04b を参照）

## 1. スコアイベントの計算構造（全種類のノートに共通）

1 回のビート（ノーツ 1 個 × レーン 5 本の各組合せ = 1 イベント）の獲得スコアは、
ゲーム内部で千分率（permil、1000 = 1.0 倍）を用いた**乗算ファクター列 + 逐次切り捨て**で
計算されることが実測で確定している:

```
v1 = floor( basicScore × skillPowerPermil / 1000 )   ※通常ビートは skillPowerPermil = 1000（不使用）
v2 = floor( v1 × b1Permil / 1000 )                   ※B1: スコアボーナス
v3 = floor( v2 × comboFactorPermil / 1000 )          ※B2: コンボ倍率
v4 = floor( v3 × fanFactorPermil / 1000 )            ※B3: ファンボーナス
v5 = floor( v4 × stageFactorPermil / 1000 )          ※B4: ステージ固有倍率
v6 = floor( v5 × randPermil / 1000 )                 ※B5: スコア乱数
v7 = floor( v6 × critFactorPermil / 1000 )           ※B6: クリティカル係数
Score = v7 + fixedScore                              ※フォトの固定スコア等（乗算後に加算）
```

- 出典: `src/formula/scoreEvent.ts` の `computeEventScore`（ファクター列は L84-93・
  逐次 floor は L155-184。実機の丸め方式は **at-end（最終 floor のみ）** が T5 実測で確定 —
  L189-193 のコメント。シミュレータは `roundingPolicy: "at-end"` を実サンプルで使用
  （`src/sim/build.ts` L749）。本検証スクリプトは単一イベントの逆算のため逐次/at-end の差は出ない）
- **スコア乱数 randPermil**: 連続一様値 **[950, 1050]‰**（±5%・離散 0.1% 刻み説は棄却済み）。
  出典: `src/rng/types.ts` L19-21・`src/formula/scoreEvent.ts` L37-42【Confirmed】。
  実測上の観測振れ幅は概ね ±4.5%（[955, 1045]）に収まる例が多いが、確定仕様は [950, 1050]
- **クリティカル係数 critFactorPermil**: 非発生時 = 1000‰（変動なし）。発生時は
  `1500 + 50 × クリ係数上昇段数 + エール/フォトのクリスコ%` で 1.5〜2.5 倍以上に変動するため、
  **本解析ではクリティカル発生ビートを完全に除外して検証する**。
  出典: `src/formula/critical.ts`（`CRITICAL_BASE_PERMIL = 1500`・`+50/段`）
- **キャラ優位**: ステージ固有の「優位キャラ」のレーンには後段で advantagePermil が乗る
  （S3 では L5 のみ 2250‰。`src/timeline/engine.ts` L2051-2054・本 pack の S3 表に反映済み）

## 2. 通常ビート（白ノーツ）の基本スコア basic【本 pack の解析対象】

```
basicSum = floor( S_vocal(レーン) × liveMult_vocal / 1000 × W_vocal / 1000 )
         + floor( S_dance(レーン) × liveMult_dance / 1000 × W_dance / 1000 )
         + floor( S_visual(レーン) × liveMult_visual / 1000 × W_visual / 1000 )

basic = floor( basicSum × 8 / 140 )        ※ λ = 8/140 ≈ 5.7143%
```

- **S_attr(レーン)**: そのレーンのアイドルの属性別ステータス（deck 実値。ライブバフ適用後の
  表示値ではなく deck.json の `total_after_non_skill_modifiers`。§4 参照）
- **liveMult**: ライブ中のステータス上昇/低下バフ（上昇 +50‰/段・超化 +50‰/段・ブースト +75‰/段・
  低下 −50‰/段・上限 3750‰）。出典: `src/timeline/engine.ts` の `liveStatusMultiplierPermil` 系
- **W**: ステージの属性重み `beatWeightsPermil`（`vendor/Quest.json` マスタ由来）
- **λ = 8/140**: `src/timeline/engine.ts` L1967-1968（`BEAT_LAMBDA_NUM = 8` / `BEAT_LAMBDA_DEN = 140`）。
  T5 実測（全 3000 イベントの乱数逆算が [950,1050] に 100% 収束・ゴールデンスコア 1 の位まで一致）
  と S3 実測（70/70）で確定した実装値。**140 の由来は未解明**（やる気士 docs の 1/20 説は S3 で棄却）
- **A/SP ノートの基本スコアは属性単一**（`S_レーン属性 × W_レーン属性` 等）で全サンプル 100% 整合。
  **乖離は通常ビートの basic にのみ局所化されている**

## 3. B1〜B4 の確定係数（実装値）

| 項目 | 実装値 | 出典 |
|---|---|---|
| B1 共通骨格 | `1000 + 25‰ × score_up 段 + 各種上昇%の加算合算` | `src/timeline/buffs.ts` `b1Permil`（L519-556） |
| B1 ビート項 | `+ 100‰ × beat_score_up 段 + scoreBonusPct.beat` | 同上（`BEAT_SCORE_UP_PER_STAGE_PERMIL = 100`・`src/timeline/constants.ts` L85） |
| scoreBonusPct.beat の中身 | エール beat% + **フォト beat% の最大値（max）** + スコア固定付与 | `src/sim/build.ts` L676-679（`maxScorePct(equipmentForScore, "beat_score")`）。sum 説は S3-L4 の実測天秤で棄却（research/23 pack_v2/05 §2.4） |
| B2 コンボ | `1000 + テーブル増分‰ × (1000 + 100 × csu) / 1000`。テーブル: combo 0-9:+0 / 10-19:+50 / 20-29:+100 / 30-39:+150 / 40-49:+200 / 50-69:+250 / 70-99:+300 / 100+:+500（‰増分） | `src/formula/combo.ts` `comboFactorPermil`（docs 一次資料 + 実測 IMG_1512 で確定）。旧「1000+2.5×combo」線形式は実測不一致で廃止 |
| B3 ファン（引力式） | `1000 + fanBonus表(自レーン来場数) + 集目固定加算`。自レーン来場数 = `baseCount × 5 × 自引力度 / Σ引力度`、引力度 = `1000 + 50×集目段 − 50×ステルス段` | `src/timeline/buffs.ts` `fanFactorPermilByAttraction`（L633-653）・`fanBonusPermilFromCount`（docs 累積セグメント: 1K まで 10 人/0.1% → 5K まで 20 → 9.8K まで 40 → 10K まで 2.5 → 20K まで 50 → 以降 100 人/0.1%） |
| B3 の入力 baseCount | 個人来場ファン数（deck.json の `audience`。実測表示の来場者総数 ÷ 5。S2 = 13,206 人 / S3 = 8,000 人。未指定時は会場キャパ ÷ 5 フォールバック） | `src/sim/build.ts`（`fanBaseCount: options.audience`）・research/12 Phase 10 の audience 上書き修正 |
| B4 ステージ | 通常 1000‰（現行の全検証ステージで 1 倍。ビートスコア 2 倍ステージは W の重み和 2000‰ で表現され B4 は不変） | `src/timeline/engine.ts` L2035（`stageFactorPermil`） |

- fan テーブル検算例: 16,000 人 → +62.0%（1620‰）が S1 実測で 1 の位まで一致
  （`src/formula/fan.ts` L7-9・research/02 §1.8【Confirmed】）
- 集目固定加算テーブル: 1-5 段 +0.7%/段・6-10 段 +0.3%/段（最大 +5.0%）= `[7,14,21,28,35,38,41,44,47,50]‰`。
  出典: `src/timeline/buffs.ts` `focusFanBonusPermil`（Peing 確定 2026-08-31）

## 4. 検証対象 2 ステージの確定スペック（マスタ + deck.json 実値）

共通出典: `data/stages_index.json`（`vendor/Quest.json` 生成物）・`data/charts_all.json`・
各サンプル deck.json（`total_after_non_skill_modifiers` = UI 表示の「スキル以外での補正後の
ステータス」実値。スタッフボーナス/エール/フォト/アクセの静的補正込み・ライブ中バフは含まない）。

| 項目 | S2 | S3 |
|---|---|---|
| ステージ ID | `qt-tower-680`（VENUSタワー STAGE680） | `qt-ex-tower-005-045`（EXタワー ⅢX-045） |
| 曲 | サマー♡ホリデイ（Lv241） | Blow Up |
| センター属性 | Vocal | Visual |
| 属性重み W (Vo/Da/Vi) | 600 / 250 / 150‰（和 1000‰） | 500 / 300 / 1200‰（**和 2000‰ = ビートスコア 2 倍ステージ**） |
| レーン属性 (L1-L5) | vocal, vocal, vocal, dance, vocal | visual, vocal, visual, visual, visual |
| 会場キャパ / 個人来場ファン数 | 70,000 / 13,206 人 | 40,000 / 8,000 人 |
| B3 fan 基準値（全レーン集目 0） | 13,206 人 → +56.4% = **1564‰** | 8,000 人 → +37.5% = **1375‰** |
| スタミナ消費重み | 1000‰ | 3000‰ |
| ノーツ内訳 (計/通常/A/SP) | 167 / **149** / 16 / 2 | 169 / **148** / 19 / 2 |
| 総獲得スコア（実測） | 77,732,383 | 79,411,389 |
| エール beat_score_pct | 6.0% | 6.0% |
| フォト beat_score% (L1-L5) | 207 / 177 / 193 / 175+206 / 156‰ | 0 / 0 / 249 / 175+193 / 0‰ |

- S2 の B3 検算: 13,206 人（全レーン集目 0・引力度均等）→ fanBonus 564‰ → 1564‰。
  トレース内の純白ビートの fan 平均 1554.6‰ は L3 の集目バフ（focus 平均 3.8 段）が
  レーン配分を動かす分を含む。S3 は 8,000 人 → 全員集目 0 なら 1,600 人/レーン → 1375‰
  （fan 表引き・旧 pack 記載の「40,000 人一律 1375‰」と同値）だが、L3 の集目
  （focus 平均 7.3 段）がファンを再配分するため非集目 4 レーンは約 1,459 人 → 1361‰。
  トレース純白ビート fan 平均は L1/L2/L4/L5 = 1360.8‰・L3 = 1527.9‰ で実装と一致
- S3 の L5 にはキャラ優位 2250‰ が乗る（STAGE045 ⅢX メンバー・実測確定。02 の S3 sim 値に反映済み）
- deck 実値（`total_after_non_skill_modifiers` の Vo/Da/Vi。L1→L5）:
  - S2: L1 95,327/117,828/154,199 ・ L2 60,351/93,070/187,383 ・ L3 118,235/134,408/281,705 ・
    L4 97,666/214,094/100,838 ・ L5 119,535/91,551/191,884
  - S3: 純白ビートの own/off 分解表（02 §3）で実効値を確認できる（バフ込み。素値は deck.json）

## 5. データの信頼性（この pack の実測値の出典）

- **実測データ**: 実機（NoxPlayer/ADB）スクリーンショット 904 枚から全 168 ビート × 5 レーンの
  ポップ・判定・バフを解析した `measured_data_v2.json`（S2）・167 フレーム系（S3）。
  ビート獲得スコア合計・クリティカルフラグ・スキル発動ログを含む
- **レーン別ポップ**: 2026-09-05/06 の遡及プロジェクトで**全ビート × 全レーン 840/840 セル
  （S2）・850/850 セル（S3）**を決着済み。S2 は readable 745 + pop なし 95・S3 は
  readable 57 + pop なし 113 + 既存記録転記 680。ポップ数字は K/M 単位の**切り捨て表示**
  （例: `+38.6K` = [38600, 38700) のどこか）であるため、レーン別 implied rand の比較には
  表示分解能のスラック（K 桁 ±50 / M 桁 ±50k）が含まれる
- **クリティカル/スキル発動の除外**: 実測 critical_flags で 1 レーンでもクリティカル発生の
  ビート、実測スキル発動ログに一致する発動ビートを除外した「純白ビート」のみを検証対象とする
  （クリティカル係数がバフ依存で変動するため。§1 参照）
- **検証スクリプト**: 本 pack の全数値は
  `research/23_beat_score_analysis/pack_v3/verification/gen_pack_v3_tables.mjs`
  （出力: 同ディレクトリ `gen_output.txt`）の機械出力である。手計算・目視転記はしていない
