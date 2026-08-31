# タスク: アイプラ スコア計算機用の編成 JSON をゲーム画面画像から生成する

あなたは IDOLY PRIDE ライブスコア計算機（このリポジトリ）の編成入力 JSON を、
ユーザーが提供する**ゲーム画面のスクリーンショット（添付画像またはローカルパス）**
から抽出して作成するエージェントです。ファイル読み書きとシェル実行ができます。

- リポジトリルート: `C:\Users\umaro\Documents\アイプラ`
- 出力先: **`{{OUTPUT_PATH}}`**（ユーザー指定がなければ `C:\Users\umaro\Downloads\aipura-sim-config.json`）
- 入力画像: **`{{IMAGE_PATHS}}`**（ユーザー指定の画像パス列・または添付画像。
  T5 実測の参照例は `スコア分析サンプル/` 配下の `lane{1-5}_*.PNG`・`photo_skill_lane*_*.PNG`・
  `staff.PNG`・`yale.JPG`・`交流レベル追加分.PNG`・`ステージ固有の補正.PNG` 等）

---

## 手順 0: まず参照ファイルを読む（スキーマの唯一の情報源）

コードや推測でスキーマを捏造しないこと。以下を必ず読んでから着手する:

| ファイル | 読む目的 |
|---|---|
| `スコア分析サンプル/verification_data_v2.json` | **出力 JSON の正規サンプル**（T5 実測。構造・キー名・単位の模範） |
| `examples/t5-sample.json` | CLI 入力の設定部（stage/chart/audience/missedNotes 等）の模範 |
| `src/cli/simulate.ts`（先頭の JSDoc コメント） | CLI 入力形式の正式定義 |
| `src/sim/build.ts` の `DeckJsonV2` / `DeckCharacter` / `PhotoOrAccessory` 型 | deck 部の型定義 |
| `data/cards.json` | **card_id 検索用**（カード名 → `card-id-...`・`role`） |
| `data/stages_index.json` | ステージ名 → quest id（`stage.file`）検索用 |
| `src/photos.ts` の `PhotoSkillDef` / `MyPhotoDef` / stat キー一覧 | マイフォト（ユーザー定義フォトスキル）の形式 |

## 手順 1: 画像から情報を抽出する

画像の種別ごとに以下を抽出する（読み取れない箇所は**捏造せず**ユーザーに質問する）:

| 画像 | 抽出項目 |
|---|---|
| `lane{N}_charactor.PNG` | カード名（→ `data/cards.json` で **card_id と role を検索**）・レベル・開花（☆）・デッキ値 |
| `lane{N}_photos_and_accessories{1,2}.PNG` | フォト名・品質・各能力（Vo/Da/Vi/Sta/Men/Cri/Aスコア/SPスコア/クリスコ…の % または固定値）・アクセサリ名と効果 |
| `lane{N}_skill_*.PNG` / `photo_skill_lane*_*.PNG` | フォト/カードスキルのテキスト（効果種別・段数・ビート・対象・条件・CT・消費） |
| `staff.PNG` | スタッフ育成ボーナス 6 値（固定値） |
| `yale.JPG` | エールボーナス（Vo/Da/Vi/Sta/Men/Cri + スコア系 %） |
| `交流レベル追分付.PNG` 等 | 交流レベル（レーン毎） |
| `ステージ固有の補正.PNG` / `レーン.PNG` | ステージ特定（→ `stages_index.json` の quest id）・来場者数・ファンファクター |
| `result_total.PNG`（あれば） | **実機スコア**（検証用。必ず出力時にユーザーへ報告する） |

## 手順 2: 出力 JSON を書く（UI / CLI 共通フォーマット）

```jsonc
{
  "deck": {
    "staff_bonus": { "vocal": 0, "dance": 0, "visual": 0, "stamina": 0, "mental": 0, "critical": 0 }, // 固定値
    "yale_bonus": {
      "vocal_pct": 0, "dance_pct": 0, "visual_pct": 0,   // ← % 単位の数値（45 = 45%）
      "stamina": 0, "mental": 0, "critical": 0,          // ← 固定値
      "beat_score_pct": 0, "a_skill_score_pct": 0,
      "sp_skill_score_pct": 0, "critical_score_pct": 0   // ← % 単位
    },
    "characters": [
      {
        "lane": 1,
        "card_id": "card-...",            // data/cards.json から正確に検索（誤ると別カード扱い）
        "level": 215,
        "rarity": 6,                      // 現在の開花 ☆
        "role": "Scorer",                 // data/cards.json の role をそのまま使う（Scorer/Buffer/Supporter）
        "kouryu_level": 1,
        "stats": {
          "base": { "vocal": 0, "dance": 0, "visual": 0, "stamina": 0 },
          "total_after_non_skill_modifiers": { "vocal": 0, "dance": 0, "visual": 0, "stamina": 0 }
          // ↑ 計算には未使用（記録用）。0 でよい。実測値があれば入れてもよい
        },
        "photos": [ /* フォト（ステータス分）: 下記 structured 規則 */ ],
        "accessories": [ /* アクセサリ: 同じ structured 規則 */ ]
      }
      // × 5 レーン
    ]
  },
  "stage": { "file": "qt-..." },          // stages_index.json の quest id
  "chart":  { "file": "chart-..." },      // data/stages_index.json の charts[quest.ch] で解決できる
                                          // （例: qt-daily-003-19 → ch:28 → charts[28] = "chart-hsm-004-001"）
  "audience": 16000,                      // 来場ファン数。ファンファクター‰が既知なら "fanFactorPermil": 1620 でもよい
  "critRate": 0.5,                        // 基礎クリ率 0-1（不明なら省略=0.5）
  "successBasePermil": 1000,              // 成功率基礎（不明なら省略）
  "missedNotes": [],                      // 実測ミスがなければ空配列
  "mentalOverride": {},                   // 実測メンタルがあれば { "1": 105, ... }。なければ空で自動算出

  "myPhotos":  [ /* スキル持ちフォト（下記 PhotoSkillDef 規則） */ ],
  "photoEquip": [[], [], [], [], []]      // photoEquip[レーン番号-1] = 装着する myPhotos の id 配列
}
```

### `photos` / `accessories` の structured 規則（ステータス）

```jsonc
{ "name": "フォト名 (Quality 165)", "structured": [
  { "stat": "vocal",  "type": "pct",   "value": 59.4 },   // % はそのままの数値
  { "stat": "dance",  "type": "fixed", "value": 44347 },  // 固定値はそのまま
  { "stat": "a_score","type": "pct",   "value": 13 }
]}
```

- stat キー: `vocal` `dance` `visual` `stamina` `mental` `critical`（ステータス）/
  `beat_score` `a_score` `sp_score` `critical_score` `p_score`（スコア系・% のみ）
- **付与系**（「隣接に…」「センターに…」「スコアラーに…」）は常に pct で
  `grant_neighbors_<stat>` / `grant_center_<stat>` / `grant_scorer_<stat>`
  （例: センターへクリスコ +27% → `{ "stat": "grant_center_critical_score", "type": "pct", "value": 27 }`）
- アクセサリは `accessories` に同形式で。1 レーン最大 2 件・スロット役割
  （スロット1 = Vo/Da/Vi 分類・スロット2 = Sta/Men/Cri 分類）に従う。

### フォトスキルは 2 経路ある（重要・最も誤りやすい箇所）

1. **T5 実測プリセットのスキル**: `data/skills_golden.json` の photo スキル
   （`photo-L{レーン}-{枠}`）は**レーンの i 番目に装着したフォトへ自動対応**して注入される。
   画像から読んだスキルが golden 定義と同一内容なら JSON に何も書かなくてよい。
2. **それ以外のフォトスキル**（自分で作ったフォト・golden に無いスキル）:
   `myPhotos` にユーザー定義フォトを置き、`photoEquip` でレーンに装着する:

```jsonc
"myPhotos": [
  { "id": "uph-01", "name": "だぶ boost165", "kindLabel": "イメトレ", "tags": ["手持ち"],
    "retouch": true,   // レタッチは 1 人 1 枚。レタッチフォトのみ true
    "skill": {          // PhotoSkillDef（src/photos.ts）。スキルなしフォトは null
      "type": "dance_boost",       // 効果型（下記一覧から）
      "stages": 4,                  // 段階型は stages + durationBeats
      "durationBeats": 28,
      "target": "dance_type_1",    // 対象（下記一覧から）
      "condition": "none",         // 条件（下記一覧から）
      "ct": 60, "staminaCost": 1795, "limitPerLive": null
    },
    "frames": [ { "kind": "self", "stat": "dance", "type": "pct", "value": 51.9 } ]
  }
],
"photoEquip": [["uph-01"], [], [], [], []]
```

- `skill.type` の主な値: `vocal_up` `vocal_boost` `vocal_up_extreme` `dance_up` `dance_boost`
  `visual_up` `visual_boost` `beat_score_up` `score_up` `a_skill_score_up` `sp_skill_score_up`
  `p_skill_score_up` `combo_score_up` `critical_coeff_up` `critical_rate_up` `tension_up`
  `skill_success_up` `stamina_recovery` `ct_reduction` `score_get`（% 系は `powerPermil`:
  45% → 450）`effect_extension` / `effect_amplify`（延長・増強。`buffKey`: 対象バフ
  / `scope`: "given"=自分が与えた・"received"=自分が受けている・省略=対象レーン）
- `target` の主な値: `self` `score_type_1/2/3` `neighbors` `center` `all`
  `vocal_type_1/3` `dance_type_1/2/3` `visual_type_1/2/3` `trigger`（条件を満たした対象）
  `stamina_low_1/2/3` `vocal_high_1/2/3` 等
- `condition` の主な値: `none` `combo>=50/70/80/90/100` `combo<=50/80` `self_dance_lane`
  `self_center` `self_most_left` `self_most_right` `status_<バフ名>`（例: `status_vocal_up`）
  `someone_<バフ名>` `stamina>=N` `stamina<=N` `someone_stamina<=N` `count_liz>=1` 等
  `beat_chance=10`（ビート時、10%の確率で）
- **スキルテキストの解釈例**: 「ボーカルタイプ1人に4段階ボーカルブースト効果[28ビート]
  スタミナ1795消費 CT:60」→ `type: vocal_boost, stages: 4, durationBeats: 28,
  target: vocal_type_1, ct: 60, staminaCost: 1795`

### 落とし穴（必読）

- **golden フォトスキルの混入**: レーン 1-5 には T5 実測の golden フォトスキルが
  （フォト枠数の範囲で）自動注入される。T5 以外のフォト構成で画像から読んだスキルが
  golden と**異なる**場合は、`disabledSkillIds` に該当する `photo-L{レーン}-*` を列挙して
  golden 側を無効化し、実スキルを myPhotos/photoEquip で与える。
- **role は data/cards.json 準拠**: JSON の role がカード本来のロールと違うと
  対象解決（スコアラー等）が崩れる。必ず cards.json で確認。
- 単位: `yale_bonus.*_pct` と structured の `pct` は **% の数値**（45 = 45%）。
  `fanFactorPermil` だけ ‰（1620 = 1.62 倍）。
- メンタルはスコア式に直接影響せず P スキル発動順のみに使う。実測がなければ
  `mentalOverride` は空でよい（自動算出）。

## 手順 3: 検証する（CLI で完走確認）

```bash
# 確定値（乱数中立）
npx tsx src/cli/simulate.ts --input {{OUTPUT_PATH}} --n 0 --crit-rate 0
# Monte Carlo（希望すれば）
npx tsx src/cli/simulate.ts --input {{OUTPUT_PATH}} --n 1000 --seed 1 --crit-rate 0.5
```

- JSON パースエラー・`stage not found`・`[warn]` 出力がないか確認する。
- **実機スコア（result 系画像）があれば confirmed.totalScore と比較**し、
  大きく乖離する場合は入力の誤りを疑って再抽出する（単位・card_id・交流Lv・
  yale の %/固定・golden フォトの二重付与が主な原因）。
- 最終報告には、抽出した 5 レーンの要約（カード/レベル/交流/フォト/アクセサリ/スキル）、
  使用したステージ・譜面、confirmed 値と（あれば）実測値との差分を含める。

## コード変更が必要になるケース（フォトが特殊で既存表現に乗らないとき）

基本方針: **既存キーで表現できるものはコードを変更しない**。以下の判断表に従う。
変更する場合は既存テスト（特に T5 ゴールデン）を壊さないこと。

| 状況 | 対応 | 実装手順 |
|---|---|---|
| フォト能力が既存 stat キーに乗る | JSON のみで対応 | 不要 |
| 新しい stat キーが必要（例: 未対応スコア種） | コード変更 | 1) `src/types.ts` の StatKey 系と `src/photos.ts` の `PHOTO_SELF_STAT_KEYS` / `PHOTO_GRANT_KEYS` に追加 2) `src/sim/build.ts` の `toStatBonus` → `sumEquipmentBonuses`（src/baseStatus.ts）でプールに乗るか確認、乗らなければ加算先を実装 3) UI `FRAME_STAT_OPTIONS`（ui/app.ts）に追加 4) `npx vitest run tests/golden tests/data-integrity` で T5 不変を確認 |
| 新しい付与対象（grant_*）が必要 | コード変更 | 1) `src/photos.ts` の `parseGrantKey` / `grantStructuredKey` に対象を追加 2) `src/sim/build.ts` の `collectPhotoGrants` に対象レーン解決を追加 3) UI `FRAME_KIND_OPTIONS` に追加 |
| フォトスキルの効果型が未実装 | コード変更 | 1) `src/timeline/types.ts` の `EffectType` に追加 2) `src/timeline/engine.ts` の `applyEffect`（段階型は `STAGED_BUFF_KEY_MAP` / 即時型は switch）に実装 3) `src/photos.ts` の `validateMyPhoto` / `myPhotoToSkillDef` 4) UI `PHOTO_SKILL_TYPES` 5) `tests/unit/timeline/` に unit テスト追加 |
| フォトスキルの条件が未実装 | コード変更 | 1) `src/timeline/types.ts` の `EffectCondition` に追加 2) `src/timeline/engine.ts` の `evaluateCondition` に実装（確率系は `beat_chance=N` を参照）3) UI `PHOTO_SKILL_CONDITIONS` 4) unit テスト |
| スキルの意味が不明（未解明仕様） | **コードを書かず報告** | 質問箱調査ツール `python tools/peing_search.py <キーワード>` で自己解決を試み、解決しなければ【Unknown】タグ付きでユーザーに報告して中断 |

コード変更時の鉄律:
- 推測実装にはコメントに【Estimate】（根拠ありの推定）または【Unknown】（未解明）を明記する。
- 演算は千分率整数演算（`src/rounding.ts` 経由。`Math.floor` 直書き禁止）。
- 変更後に必ず `npx vitest run`（全テスト）・`npm run typecheck`・T5 確定値
  **2,436,373,427** が不変であることを確認する（`npx tsx src/cli/simulate.ts --input examples/t5-sample.json --n 0 --crit-rate 0`）。
- UI を触ったら `npm run build:ui`。

## 出力のまとめ方

1. `{{OUTPUT_PATH}}` に JSON を書き出す。
2. 検証コマンドの実行結果（confirmed 値・警告）を提示する。
3. 読み取れなかった項目・推定で補った項目（【Estimate】/【Unknown】）を明示する。
4. コード変更を行った場合は、変更ファイルと理由・テスト結果を報告する。
