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

## Phase 2〜3（スコア式・タイムラインエンジン）

（未着手。次フェーズで記録）
