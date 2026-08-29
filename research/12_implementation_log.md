# 12. 実装ログ（Implementation Log）

- 目的: フェーズごとの実装記録・決定事項・発見事項を時系列で記録する（PLAN.md §14 に対応）

---

## Phase 0〜1（2026-08-29 完了）

### 完了内容
- `git init` 済み（コミットはユーザー指示時に実施）
- スキャフォールド: package.json / tsconfig.json / vitest.config.ts / .gitignore（重い実測画像・vendor/ は除外）
- **計算コア**（`src/`、依存ゼロ・純粋関数・TypeScript）:
  - `rounding.ts`: 千分率整数演算（mulPermil / floorDiv / pctToPermil）。浮動小数点直接演算の禁止規律を定義
  - `kouryu.ts`: 交流Lv累積テーブル（Lv1〜60、Confirmed）
  - `types.ts`: Card/StatBonus/YellBonus/StaffBonus 等のドメイン型、rarityBonusPermil（☆1=1.00〜☆10=1.45）
  - `formula/baseStatus.ts`: カード外ステータス式（PLAN.md §3.1 確定式）。**DeckStatusInput.rarity は開花後の現在レアリティを入力**（☆5初期カードの限界突破に対応）
- **データパイプライン**（`tools/importers/build_data.mjs`、`npm run build:data`）:
  - vendor/（gitignore）にマスタ生JSONをキャッシュし、`data/` へ9ファイル生成（meta/cards 491枚/card_parameters 780行/staff/stages/qt-daily-003-19/audience_advantage 1000行/combo_advantage/chart-hsm-004-001/yell）
  - region検証（日本語カード名・music-clb-*・Lv260・qt-daily-003-19）自動実装
  - 検証: audience 16,000→1,620‰(+62.0%) OK、staff vocal Lv65=29,195 OK
- **テスト**:
  - T0 データ健全性（`tests/data-integrity/`）: I-01〜I-16＋v2追加不変条件。**41テスト全グリーン**（1 skipped: 判定内訳の「ノート単位」解釈は実測クリティカル148個と矛盾するため理由明示の上skip）
  - T3 ゴールデン（`tests/golden/deck-status.golden.test.ts`）: beat 0 の5レーン×4ステータス×{basic, deck}=**40項目が1の位まで完全一致**
  - 合計: **50 passed / 1 skipped、typecheck ゼロエラー**

### 実装中の発見・決定事項
1. **【重要】`MusicChartPattern.number` はゲーム内ビート番号ではない**（1..268のグリッド番号）。ビートは「type≠0 のノートの通し番号」として採番するのが正しく、実測A発動16/16・SP=49/103と完全一致で検証済み。`data/charts/chart-hsm-004-001.json` には採番済みの beat を保存（PM検証済み）
2. T3 のレアリティ: カードの `initialRarity` ではなく編成時の現在レアリティ（開花後）を使う。実測編成は ☆6/☆5/☆10/☆10/☆6
3. `StaffLevel.advantage` は既に累積値（差分ではない）
4. I-12 のポップパースに ±1 の切り捨てアーティファクト10セル（b119/L3 等）→ 既知例外リストで回帰固定
5. b61/L5 のみスタミナ変化に発動ログが紐づかない（b60 の2連発動のフレーム分割表示）→ 例外定数で管理
6. 交流Lvテーブルは `src/kouryu.ts` に単一実装（data/aijou.json との二重管理は避ける判断）

### 環境メモ
- Node 24.18 / npm 11.16 / TypeScript 5.x / Vitest 2.1.9 / @types/node 導入済み
- PowerShell 5.1 で日本語を扱う .ps1 は UTF-8 BOM 必須（research/06 §7 のとおり再確認）。Node の .mjs 推奨

---

## Phase 2（2026-08-29 完了）— スコア式

### 完了内容
- `src/formula/combo.ts`: コンボファクター（B2）。テーブル7行（data/stages/combo_advantage.json 同期）+ `(1000+基本ボーナス)×(1000+100×段)/1000`【Confirmed】。表記対立（×6.0 vs ×3.0）の判定記録を JSDoc に保存（×3.0説は r≈0.49 で範囲外のため却下）
- `src/formula/fan.ts`: 来場ファンボーナス（B3）。audience_advantage 1000行の二分探索。16,000→1620‰
- `src/formula/critical.ts`: クリティカル係数。`1500 + 50×段 + extras‰`（実測 extras=255）
- `src/formula/scoreEvent.ts`: イベントスコア共通計算。`computeEventScore()` は丸めポリシー2種（"sequential"=各乗算ごと切捨て【Estimate】/ "at-end"=最後 once）を切り替え。巨大積は BigInt フォールバック。T4/T5 でポリシー判定
- `src/rng/`: ScoreRng 契約 / ReplayRng / MinRng / MaxRng / FixedRng（mulberry32・モンテカルロ用）
- 単体テスト115件追加 → **合計 165 passed / 1 skipped、typecheck ゼロエラー**

## Phase 3a（2026-08-29 完了）— スキルゴールデンデータ

- `data/skills_golden.json`: カード15+フォト20=35スキル・効果57件。マスタ Skill.json（SkillEfficacy の type/grade）と検証テキスト・発動ログの突合で作成。推測値ゼロ（Unknown は null + confidence タグ）
- 写像: type36→score_get(+scaling), type70→score_get_by_score_ratio, type80/86/81→a_skill_score_up/combo_score_limit/critical_coeff_limit（limitRelease 形式）等。type36 係数・type70 上限は perStagePermil:null でエンジン側フィッティング待ち
- Lane3 フォト1/3/4 は画像判読不可（本実測未発火）のため null 記載
- 検証スクリプト `tools/validate_skills_golden.mjs`

## Phase 3b（2026-08-29 完了）— タイムラインエンジン

### 完了内容
- `research/13_engine_spec.md`: 実装仕様書（11段階処理順・P前半/後半選択・効果適用・対象解決・トレース要件・推測リスト11項）を先に文書化し、実装はこれに従う方式を採用
- `src/timeline/types.ts` / `constants.ts`: 契約型と定数（POSITION_TO_LANE=[3,2,4,1,5] 実測21/21一致、IDOL_PRIORITY_ORDER=[4,2,1,3,5]、focus ファンボーナス表等）
- `src/timeline/buffs.ts`（P3b-1 サブエージェント）: 段数集計（加算+上限クランプ・limit解放→30）・ライブ中ステータス倍率・消費倍率・B1・成功率・focus ファンボーナス。69テスト
- `src/timeline/engine.ts`（PM直接実装）: `simulateTimeline()`。11段階ビート処理・P前半/後半・効果適用（増強/延長は残りビート最大インスタンス対象【Confirmed】）・対象解決9種・トレース出力
- テスト15件追加 → **合計 249 passed / 1 skipped、typecheck ゼロエラー**

### 実装中の発見・決定事項
1. **【重要】CT 内部初期値は CT−1**: research/08 §2.3 の実測系列（act=b1・CT50 → b50 再発動 = gap 49 = CT−1）から、発動時に内部CTを CT−1 に設定しないと最小再使用間隔が CT になってしまう。発動ビート中に（初期化+ステップ9減算で）実質2進むモデルを採用
2. **前半/後半発動の実効ビート数差は処理順から自動的に成立**: 前半発動→ステップ10で減算→表記−1、後半発動→減算をスキップ→表記どおり（research/01 §4 補足の機構的説明）。残り0の効果はスコア時に無効（翌ビート開始で除去）
3. **サブエージェント失敗の記録**: P3（全体）×2・P3b-2（engine単体）×1 の計3回が空応答で失敗（成果物ゼロ）。P3b-1（buffs）は成功。→ 仕様書を先にファイル化（research/13）しても engine 単体タスクは失敗したため、PM が直接実装するフォールバックを採用（ユーザー承認済みの方針）。タスク分割の目安: 「1ファイル+テスト」でも出力が大きいと失敗し得る
4. snapshot 計算はステップ7後（P前半バフをスコアに反映）である必要があった。バグはミニフィクスチャのテストで検出・修正（テスト設計の有効性確認）
5. 割合型（type70）の基本スコア = 累積総スコア×SkillPower（コンボ/ファン不適用）で実装。累積の厳密な基準（全体 vs レーン別等）は【Unknown】→ T5 の b103 検算で判定

### 残課題（Phase 3c へ）
- T4: ビート1〜10の発動ログ突合（発動順・対象・効果 multiset・stamina）
- T5: 全156ビートのスコア検定（Mode R: 乱数中立1000+実測クリティカルフラグ注入、ratio_b ∈ [950,1050] 検定、3点検算 b2/b103/b156）
- type36 係数フィッティング（skills_golden.json の perStagePermil）
