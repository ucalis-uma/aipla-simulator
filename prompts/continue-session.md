# 引継ぎプロンプト: アイプラ ライブスコア計算機 — 修正作業の継続（新セッション用）

以下を新しいセッションの冒頭に貼り付けて使用する。

---

## あなたの役割

IDOLY PRIDE（アイプラ）ライブスコア計算機の**開発を引き継ぐエンジニア**として行動する。
このリポジトリは既に動作する完成段階のアプリであり、これからは**機能追加・仕様追従・不具合修正**を行う。
計画段階には戻らず、既存の設計・不変条件を尊重して作業すること。

## 最初にやること（この順で読む）

1. `PLAN.md` — 全体計画。**§14 フェーズ別実装計画**に完了履歴がある
2. `research/12_implementation_log.md` — **実装ログの本体**。Phase 0〜9・8-A〜8-B9 の全変更履歴、
   裏取り結果、設計メモはすべてここにある（ファイル末尾 = 最新）
3. 作業に必要になった時点で `research/01〜16`（式確定・実測検証・Peing確定仕様）を参照
4. `git status` と `git log --oneline -5` で現状確認

## プロジェクト原則（絶対に守る規律）

1. **未解明仕様は自己解決する**: `python tools/peing_search.py <キーワード>` で公式質問箱を検索。
   解決できない推測実装にはコメントに **【Estimate】**（根拠のある推定・出典明記）または
   **【Unknown】**（未解明）をタグ付けする
2. **千分率整数演算**: パーミル計算は必ず `src/rounding.ts` 経由（`mulPermil` / `floorDiv` /
   `pctToPermil`）。**`Math.floor` 等の直書き禁止**。丸め位置は at-end
3. **不変条件（T5 ゴールデン）**:
   - T5 ゴールデンスコア（ReplayRng 実測較正）: **17,529,132,014**
   - UI/CLI 確定値（乱数中立・crit なし）: **2,436,373,427**
   - エンジン・ビルダーを触ったら必ずこの 2 値が不変であることを確認する。
     確認コマンド: `npx tsx src/cli/simulate.ts --input examples/t5-sample.json --n 0 --crit-rate 0`
4. **テスト維持**: 現状 **428 passed / 1 skipped**。全テスト・typecheck を壊さない
5. **データの変更は importer 経由**: `data/` の生成物（`unlocks.json` / `skills_levels.json` /
   `photos_master.json` 等）を直接編集しない。`npm run build:data:ext` で再生成する
6. UI へのデータ埋め込みは `tools/build_ui.mjs`（`SimSourceData` に乗るものは `data` 内に、
   UI 専用はトップレベルに置く。**Phase 8-B4 の skillLevels 未伝播バグ**の教訓）

## 現状サマリ（2026-09-01 時点）

- **アーキテクチャ**: TypeScript 純粋関数計算コア（`src/`）+ 単一HTML UI（`ui/` → esbuild で
  `dist/aipura_simulator.html`）+ CLI（`src/cli/simulate.ts`）+ Tauri（`src-tauri/`）
- **完了済み主要機能**:
  - 計算コア: ステータス式/スコア式/タイムラインエンジン（11段階ビートループ）/MC・CRN
  - Phase 6: 全491カード・全5916ステージ・624アクセサリ・マスタ解析スキル
  - Phase 8-A〜8-C: アクセサリスロット役割分離・フォト5スロット/マイフォト帳・統合オプティマイザ
  - 8-B2: フォトマスタ統合（262枚）・条件 72+ 種・リッチチップ表示
  - 8-B3: スキルLv1-6選択・カードレベル制約（解放テーブルは `data/unlocks.json`）
  - 8-B4: 与/被レタッチ（延長・増強の scope/buffKey）・`combo>=70`・`beat_chance=N`
  - 8-B5: 対象型延長/増強（scope 指定なし）・`trigger` 対象・`vocal_type_3`・同フォト1編成1枚
  - 8-B6: フォトのステータス/スキル表示統合・装備解除↔スキル連動
  - 8-B7: アクセサリソート・一括装備解除・テンプレレタッチ訂正・スキル持ち取り消し
  - 8-B8: UI 黄色テーマ・Vo=ピンク/Da=青/Vi=黄・ロール色（Sup=赤/Buf=青/Sco=黄）
  - 8-B9: 画像→編成JSON 生成プロンプト（`prompts/deck-json-from-images.md`）・
    CLI の myPhotos/photoEquip 解決（UI と同一スコアになる）
- **主要データ**: `data/`（cards / skills_golden＝T5実測較正 / skills_master＝マスタ解析 /
  skills_levels＝全スキルLv1-6 codec / unlocks / photos_master / stages_index / charts_all）。
  ベンダーマスタは `vendor/`（MalitsPlus/ipr-master-diff キャッシュ）

## 検証コマンド一覧（変更後は状況に応じて実行）

```bash
npx vitest run                 # 全テスト（428 passed / 1 skipped が基準）
npm run typecheck              # コアの型チェック
npm run typecheck:ui           # UI の型チェック
npm run build:data:ext         # data/ 再生成（マスタ変更時）
npm run build:ui               # 単一HTML 再生成（ui/ 変更後は必須）
npx tsx src/cli/simulate.ts --input examples/t5-sample.json --n 0 --crit-rate 0
                               # → confirmed.totalScore が 2,436,373,427 であること
```

## 既知の落とし穴（過去に実際に起きた不具合）

1. **UI は dist 経由でテストする**: `tests/ui/smoke.test.ts` は `dist/aipura_simulator.html` を
   読むため、`ui/` を変更したら **`npm run build:ui` してから** smoke を実行する
2. **smoke テストには実行順序依存がある**: 「オプティマイザ」テストはラインナップ反映後
   **リセットしない**（レーンの photosJson が空になる）→ 直後の「レタッチ1枚制限」テストは
   それを前提に設計済み。テストを追加・並び替えする際は前テストの残置状態に注意
3. **UI への新データは `data` 内へ**: `buildSimulateInput` に渡すデータ（SimSourceData）と
   UI 表示専用データの埋め込み場所を混同すると、UI でだけ無視されるバグになる（8-B4 教訓）
4. **golden フォトスキルはレーンスコープ**: `photo-L{レーン}-*` は装着位置（photoIndex）に
   応じてどの編成にも注入される。T5 以外のフォト構成では `disabledSkillIds` での無効化が必要
   （`prompts/deck-json-from-images.md` にエージェント向けの手順あり）
5. **CLI/UI のスキーマは共通**: 編成 JSON（deck + stage/chart + 設定 + myPhotos/photoEquip）は
   `src/cli/simulate.ts --input` と UI インポートの両方で同じ挙動にすること（8-B9 で統一済み）

## 未解決・将来課題（ログに記録済みのもの）

- 与系レタッチの「自分への自己付与を与えた扱いに含める」は実機未確認の【Estimate】（8-B4）
- 実測/JSON フォトはスキル ID を持たないため golden スキルとの対応は装着位置モデル（8-B6・Estimate）
- 専用フォト（やる気士docs のキャラ別フィルム ☆3/☆9 システム）はベンダーマスタに存在せず、
  条件種は実装済みなのでユーザー手動作成のみ対応（8-B4）
- フォト品質変更時の photoAbilityLevels テーブル引きは未実装（8-B2・将来拡張）
- フォト画像は INFO PRIDE CDN に存在せず（400）、名前＋チップ表示のまま（8-B2）
- 楽曲限定（music_limited）等 5 条件は常時発動近似（8-B2・engine は文脈未保持）

## 作業の進め方

1. 変更前に該当フェーズのログ項目（research/12 の該当箇所）を読み、既存設計意図を確認する
2. 実装 → `npx vitest run` + 両 typecheck → 対応する smoke/build → T5 不変確認
3. 完了したら **research/12_implementation_log.md に新しい Phase セクションを追記**
   （完了内容・テスト・検証結果・設計メモ/【Estimate】）し、**PLAN.md §14 に行を追加**
4. テストを追加する場合は既存の構成に倣う（unit は `tests/unit/`、UI は `tests/ui/smoke.test.ts`）
