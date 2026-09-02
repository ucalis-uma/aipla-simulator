# 引継ぎプロンプト: アイプラ ライブスコア計算機 — 修正作業の継続（新セッション用）

以下を新しいセッションの冒頭に貼り付けて使用する。

---

## あなたの役割

IDOLY PRIDE（アイプラ）ライブスコア計算機の**開発を引き継ぐエンジニア**として行動する。
このリポジトリは既に動作する完成段階のアプリであり、これからは**機能追加・仕様追従・不具合修正**を行う。
計画段階には戻らず、既存の設計・不変条件を尊重して作業すること。

## 最初にやること（この順で読む）

0. **`AGENTS.md`（リポジトリルート）** — 大元の規約。**ゲームデータの参照規則（スキル等は
   Info Pride API / vendor マスタから確定・スクショ不要の範囲・BWIKI 数値利用禁止）を最初に確認する**
1. `PLAN.md` — 全体計画。**§14 フェーズ別実装計画**に完了履歴がある
2. `research/12_implementation_log.md` — **実装ログの本体**。Phase 0〜9・8-A〜8-B10 の全変更履歴、
   裏取り結果、設計メモはすべてここにある（ファイル末尾 = 最新）
3. 作業に必要になった時点で `research/01〜16`（式確定・実測検証・Peing確定仕様）を参照
4. `git status` と `git log --oneline -5` で現状確認

## プロジェクト原則（絶対に守る規律）

0. **出力規律**: タスク開始時に完了条件を書き出し、それが満たされるまでチャットへテキストを
   出力しない（テキスト出力＝ターン終了＝停止とみなされる）。進捗レポート・中間報告は禁止。
   途中結果は `research/` のメモ・ログ・todo に記録する。報告は完了後の最終まとめ 1 通のみ。
   例外: ユーザーの判断・承認が必要な分岐 / データ不足で続行不能（不足物を明記）/
   暴走防止（連続 60 ツール呼び出し・約 2 時間経過）
1. **未解明仕様は自己解決する**: `python tools/peing_search.py <キーワード>` で公式質問箱を検索。
   解決できない推測実装にはコメントに **【Estimate】**（根拠のある推定・出典明記）または
   **【Unknown】**（未解明）をタグ付けする
1b. **スキル等のゲームデータはマスタから確定する**（`AGENTS.md` 参照）: スキルの名称・
   枠種別・Lv別効果・CT・消費は Info Pride vendor API（`idoly-backend.outv.im/api/Skill?ids=...`）
   または `vendor/Skill.json` で確定できる。「スクショが必要」と結論する前に必ずマスタ参照を
   試すこと（未発動スキルも card_id から機械的に導出できる。BWIKI 由来データの数値利用は禁止）
2. **千分率整数演算**: パーミル計算は必ず `src/rounding.ts` 経由（`mulPermil` / `floorDiv` /
   `pctToPermil`）。**`Math.floor` 等の直書き禁止**。丸め位置は at-end
3. **不変条件（T5 ゴールデン・2026-09-02 更新）**:
   - T5 ゴールデンスコア（ReplayRng 実測較正）: **17,521,461,739**（5/5・1 の位まで実測一致。
     生実測 17,529,132,014 は計上規則補正前の値なので不変条件にしない）
   - UI/CLI 確定値（乱数中立・crit なし）: **2,580,038,995**
   - エンジン・ビルダーを触ったら必ずこの 2 値が不変であることを確認する。
     確認コマンド: `npx tsx src/cli/simulate.ts --input examples/t5-sample.json --n 0 --crit-rate 0`
4. **テスト維持**: 現状 **458 passed / 1 skipped**（2026-09-02 サンプル2 第二段階・仕様確定 8 本追加後）。全テスト・typecheck を壊さない
5. **データの変更は importer 経由**: `data/` の生成物（`unlocks.json` / `skills_levels.json` /
   `photos_master.json` 等）を直接編集しない。`npm run build:data:ext` で再生成する
6. UI へのデータ埋め込みは `tools/build_ui.mjs`（`SimSourceData` に乗るものは `data` 内に、
   UI 専用はトップレベルに置く。**Phase 8-B4 の skillLevels 未伝播バグ**の教訓）

## 現状サマリ（2026-09-02 時点・サンプル2 取り込み後）

- **サンプル2（S2）**: `examples/sample2.json`（STAGE680・実測 77,732,383）。
  **2026-09-02 第二段階でユーザー確定 4 仕様を実装 → L3 ×0.755 を解消・全レーン ±5% 内**
  （L1 ×0.992 / L2 ×0.969 / L3 ×0.976 / L4 ×0.962 / L5 ×0.952。crit フラグ再現ラン）。
  確定済み 4 仕様: ①tg-position = レーン属性説確定 ②効果行の行独立条件評価
  （1 行でも成立で発動・不成立行のみスキップ）③無条件行を 1 つでも持つ P/フォトは前発動
  （some 判定）④超化 = 増強型（同種最長インスタンスへ +5 段・基底なしで不発・上限も +5 拡張）。
  L3 A crit がユーザー式と完全一致（b41 critF=2504/b100=1854/b142=2254）。
  S2 の measured_data_v2.json は current_stamina に 7→2 OCR 誤読 236 行あり
  （修正表: aipura_nox/サンプル2/measured_data_v2_ocr7to2_fix.json・スコア不影響）。
  フォトはスタミナ消費する（無消費説は撤回・b1 スクショは中間フレームだった）。
  詳細: `research/20_sample2_gap_analysis/CONCLUSION_2026-09-02.md` 第二段階節。

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
  - 8-B10: 編成JSON インポートのネスト形式対応（`{ deck: {...} }`＝CLI スキーマ。
    Phase 4 から UI 自身のエクスポート往復も壊れていた）・photoEquip 装着分の
    myPhotos ステータスを CLI へ統合（同名重複は二重計算防止でスキップ）・
    **golden フォトスキルの名前一致モデル化**（下記落とし穴 4 参照）・
    実サンプル `examples/nested-sample.json` 同梱（S1。確定値は 2026-09-02 の最終解決後
    UI = 114,082,925 / 実測 116,537,513 = ×0.98、CLI 直読は 58,385,639 = audience クランプ由来）
- **主要データ**: `data/`（cards / skills_golden＝T5実測較正 / skills_master＝マスタ解析 /
  skills_levels＝全スキルLv1-6 codec / unlocks / photos_master / stages_index / charts_all）。
  ベンダーマスタは `vendor/`（MalitsPlus/ipr-master-diff キャッシュ）

## 検証コマンド一覧（変更後は状況に応じて実行）

```bash
npx vitest run                 # 全テスト（458 passed / 1 skipped が基準）
npm run typecheck              # コアの型チェック
npm run typecheck:ui           # UI の型チェック
npm run build:data:ext         # data/ 再生成（マスタ変更時）
npm run build:ui               # 単一HTML 再生成（ui/ 変更後は必須）
npx tsx src/cli/simulate.ts --input examples/t5-sample.json --n 0 --crit-rate 0
                               # → confirmed.totalScore が 2,580,038,995 であること（2026-09-02 更新）
npx tsx src/cli/simulate.ts --input examples/sample2.json --n 0 --crit-rate 0
                               # → 8-B10 の実サンプル（S2・STAGE680）。確定値 48,956,341（crit なし・
                               #   audience 13,206=実測 fan.png 由来）。
npx tsx src/cli/simulate.ts --input examples/nested-sample.json --n 0 --crit-rate 0
                               # → 8-B10 の実サンプル（S1）。UI（audience テーブル引き）は 114,082,925。
                               #   CLI 直読では audience 71,000 が 2000‰ にクランプされ値が異なる
                               #   （S1 audience トラップ・推奨は UI 側の値）
```

## 既知の落とし穴（過去に実際に起きた不具合）

1. **UI は dist 経由でテストする**: `tests/ui/smoke.test.ts` は `dist/aipura_simulator.html` を
   読むため、`ui/` を変更したら **`npm run build:ui` してから** smoke を実行する
2. **smoke テストには実行順序依存がある**: 「オプティマイザ」テストはラインナップ反映後
   **リセットしない**（レーンの photosJson が空になる）→ 直後の「レタッチ1枚制限」テストは
   それを前提に設計済み。テストを追加・並び替えする際は前テストの残置状態に注意
3. **UI への新データは `data` 内へ**: `buildSimulateInput` に渡すデータ（SimSourceData）と
   UI 表示専用データの埋め込み場所を混同すると、UI でだけ無視されるバグになる（8-B4 教訓）
4. **golden フォトスキルは名前一致モデル（8-B10 追補3で位置モデルから変更）**:
   `photo-L{レーン}-*` は「装着位置のフォト名が T5 実測サンプル
   （verification_data_v2.json）のレーン内フォト名と一致する場合のみ」表示・注入される。
   汎用編成では T5 由来スキルが UI に出ず、CLI/オプティマイザの計算にも乗らない
   （`build.ts` の `goldenPhotoNames`・UI は `GOLDEN_PHOTO_NAMES`、CLI はサンプルから読込）。
   T5 実測編成を再現する場合はサンプルと同一のフォト名を使うこと。
   旧来の `disabledSkillIds` による photo-L\* 無効化は互換のため有効（不要だが害もない）
5. **CLI/UI のスキーマは共通**: 編成 JSON（deck + stage/chart + 設定 + myPhotos/photoEquip）は
   `src/cli/simulate.ts --input` と UI インポートの両方で同じ挙動にすること（8-B9 で統一済み）。
   インポート（`applyConfig`）は **JSON を as-is で反映**する（チェックの強制 ON/OFF をしない）。
   スキル持ち myPhotos のステータスは「CLI では `characters[].photos` 側、UI では
   photoEquip 側」で表現される差を `mergePhotoEquipStatuses`（同名重複スキップ）と
   applyConfig の重複除去で吸収している（8-B10）。photos 側と myPhotos の
   両方に同じフォトのステータスがある JSON でも二重計算にならない
6. **T5 ゴールデン検証の前提が 2 つ**: examples/t5-sample-deck.json のフォト名は
   verification_data_v2.json と**全レーン完全一致**している（名前一致モデルで golden が
   乗る前提）。フォト名を変えると 2,580,038,995（ゴールデン系）が崩れるので注意

## 未解決・将来課題（ログに記録済みのもの）

- 与系レタッチの「自分への自己付与を与えた扱いに含める」は実機未確認の【Estimate】（8-B4）
- 実測/JSON フォトと golden スキルの対応は**フォト名一致モデル**（8-B10 追補3・Estimate）。
  フォト名が T5 サンプルと同一でも実は別フォトという場合は誤適用の余地がある
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
