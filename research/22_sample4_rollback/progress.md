# S4 全面ロールバック・再撮影 — 進捗ファイル（一次情報）

- **プロンプト**: `prompts/rollback-recapture-sample4.md`（ステップ実行式。ユーザーが範囲を指示して起動）
- **現ステップ**: **Step C-pre 完了（撮影準備）→ 次は Step C（再撮影・人間補助前提）**
- **次にユーザーが指示すべきこと**: 「Step C を実行」（NoxPlayer が他サンプル収集中なら空いてから。
  Step C は `research/22_sample4_rollback/recapture_procedure.md` §4 の手順・複数セッション可）

---

## 実績ログ

### Step A（2026-09-05）: 影響調査・リスト提示 ✅（ユーザー承認済み）

方法: シードリスト（プロンプト §2）をもとに `git log --oneline`・
`grep -ril "004-054|qt-ex-tower-004|sample4|サンプル4|STAGE054|lumiere"`（vendor/node_modules/.git 除外）で
全Repo再走査。コミット差分（`git show`）で S4 由来/他サンプル由来の切り分けを実施。

### Step B（2026-09-05・本セッション）: ロールバック実行 ✅

ユーザー判断の反映: aipura_nox の `サンプル4/` は**ファイル単位で機能/無効を区分**して隔離
（プロンプトの「フォルダごと隔離」をユーザー指示により修正）。

**実行内容**:

1. **撮影知見の保全（隔離前に実施）**: 旧 `issues.md` #5/#6（banner テンプレートマッチング座標・
   クロップ座標・ハイブリッド抽出法）+ 旧 deck.json 編成（L1 chs-05-fest-00 / L2 rei-05-fest-00 /
   L3 ngs-05-fest-02 / L4 szk-05-sail-00 / L5 suz-05-fest-02・全員 Lv182）を
   `capture_knowledge_notes.md` に原文・要約で保全
2. **aipura_nox 隔離**: `サンプル4/` → `サンプル4_invalid_capture_20260905/` へ**無効部分のみ**移動し、
   `INVALID_20260905_README.md` を作成。機能分は新 `サンプル4/` に残置（再撮影でそのまま使える）
   - 無効（隔離）: `lane1/`〜`lane5/`（1008 枚）・`analysis/`・`issues.md`・`measured_data.json`・
     `measured_data_v2.json`・`measured_data_summary.md`・`lane_pops_backfill.json`
   - 機能（残置）: `deck.json`・`communication_levels.json`・`skill_order/`・ディレクトリ直下の
     全画像（fan.png・yale.png・staff.PNG・stage_ex_liznoir_tower_54.png・result_*.PNG・
     lane*_charactor.PNG・lane*_photos_and_accessories*.PNG・photo_skill_lane4_3.PNG・
     スキル以外での補正後のステータス一覧.PNG）
3. **src ロールバック**: `src/timeline/engine.ts`・`buffs.ts`・`types.ts` を `git checkout 9141ffb -- ...`
   で 809838f 直前へ復元（9141ffb は research/22 pack 追加のみで src に触れておらず、
   809838f 以降 src/tests 変更 0 件のため完全復元）。
   承認どおり `attrLaneLanes` の優先度ソートも除去（S4 由来コードは全除去・新データで再検証時に再導入）
4. **テスト**: `tests/unit/timeline/sample4-specs.test.ts` → `tests/invalidated/sample4-specs.test.ts.disabled`
   （拡張子変更で vitest（`tests/**/*.test.ts`）・tsconfig（`tests/**/*.ts`）の両対象外）
5. **tools**: `tools/verify_sample4_beats.ts` → `tools/invalidated/verify_sample4_beats.ts.disabled`
   ＋ `tools/backfill/recon_s4frames.py`・`recon_s4pop.py` → `tools/invalidated/` へ。
   `tools/invalidated/README.md` 作成。`tools/backfill/` 共通パイプライン（make_pop_sheets.py 等）は維持
6. **examples**: `examples/sample4.json` → `examples/invalidated/sample4.invalid.json` + README
   （src/tests からの参照なし・grep 済み）
7. **research/22**: `INVALID_20260905_README.md` をディレクトリ先頭に作成（中身は証跡保持）
8. **research/23**（S4 由来の節のみマーカー・S2/S3/T5 節は有効）:
   `pack/01_problem_context.md` §2.3 / `pack/03_cross_sample_data.md` §2 /
   `pack_v2/01_fable51_rebuttal.md` の S4 反証行 / `pack_v2/02_clean_data_by_sample.md` §2 /
   `pack_v2/03_the_8_over_7_mystery.md` §2 / `pack_v2/04_inquiry_for_fable_v2.md` サンプルA 節 /
   `pack_v2/05_fable_v2_verification.md` §2.2 / `pack_v2/verification/verify_output.txt` 冒頭
9. **research/12**: Phase 13 節・Fable 5.1 節・Fable v2 節・§4・§5 に【2026-09-05 無効化】/
   【注記】マーカー追記（エントリ削除なし）+ 末尾に「S4 全面無効化」エントリ追記
10. **research/19_next_sample_plan.md**: サンプル4 節に保持注記（計画文書は再撮影で再利用）
11. **PLAN.md**: Phase 13 行に無効化注記

**data/ は保持**（`stages_index.json`・`character_advantage.json`・`live_bonuses.json` の 004-054 参照は
`vendor/Quest.json` 等マスタ由来の生成物と確認済み）。

**検証結果（ロールバック後）**:

| 項目 | 結果 |
|---|---|
| `npx vitest run` | **37 ファイル 474 passed / 1 skipped**（809838f 直前の 474 基準に復帰・S4 テスト 5 件分減） |
| `npm run typecheck` | **エラー 0 件**（旧 `tools/verify_sample4_beats.ts` 起因の 11 エラーも消滅） |
| T5 CLI 確定値 | **2,580,038,995** 不変 ✅ |
| S3 CLI 確定値 | **66,227,491** 不変 ✅ |
| S1 CLI 確定値 | **129,201,077** — 809838f 時点（ロールバック前 HEAD）と同一値 ✅ |
| S2 CLI 確定値 | **43,236,162** — 809838f 時点（ロールバック前 HEAD）と同一値 ✅ |

※ S1/S2 について: `prompts/continue-session.md` 記載の S1=130,698,595・S2=43,599,085 は
ロールバック前 HEAD でも既に一致しない（Phase 13 エントリ内の確定値表 129,201,077 / 43,236,162 と一致）。
**本ロールバック起因の回帰ではない**（Phase 12 時点以降の更新漏れ = 先行課題）。
Step E で continue-session.md の検証コマンド節を最新化するときに直すことを推奨。

**コミット状態**: 2026-09-05 ユーザー承認により 2 コミットに分離して作成済み:
- `f9d044c` docs: add lane-pop backfill pipeline (tools/backfill) and T5 backfill handoff prompt
  （前セッション分。research/12 §5 はロールバック注記を除いた中間版で記録）
- `4fdf191` docs: S4（qt-ex-tower-004-054）全面無効化とロールバック実行（隔離+マーカー方式・Step B）
  （ロールバック一式。research/12 は無効化注記+末尾エントリ込みの完全版）
- コミット後に最終再検証: vitest 474 passed / 1 skipped・typecheck 0 エラー・T5 2,580,038,995 不変 ✅

---

### Step C-pre（2026-09-05・本セッション）: 撮影準備 ✅

**制約**: Nox が他サンプル収集中のため **ADB 接続・撮影は一切行わず**、手元の旧サンプル画像分析のみで完結。
（検収ツールの検証には旧 S4 隔離フォルダを**読み取り専用**で使用。隔離フォルダは未変更 — 改名以外触っていない）

1. **誤タップ回避の仕様確定（ユーザー指示への対応）**: 「A/SP/P/フォトスキルアイコンをタップすると
   そのレーン/ビートに遷移する」問題に対し、旧フローの全タップ箇所を棚卸しし
   **タップはアイドルカード帯 (lane_x, 1630) のみに限定**（スキルアイコン帯 y=1450〜1575・
   効果ボックス内アイコン・ノーツ座標は禁止）。効果ボックスのスクロールスワイプがタップ誤認された
   場合もフォーカス検証が検出して再撮する設計。座標根拠は旧 S4 フレームの実測クロップで確認済み
2. **フォーカス判定器の開発と検証**: アイドル名帯 (70,393)-(235,437) テンプレートマッチング（閾値 0.80）。
   旧 S4 の `lane_pops_backfill.json`（読取済み 909 フレーム = ラベル。ポップが読めたフレームは
   そのレーン フォーカス済みという既存事実）で精度検証 → **精度 100%（909/909）・
   自レーン 1.000 vs 他レーン最大 0.546（最小マージン 0.454）**
3. **テンプレート画像の生成**: `aipura_nox/templates/name_band/lane{1-5}.png`（165×44px・
   名前文字のみ。S4 計測データは不含有効）+ `README.md`。同時に本リポジトリ
   `tools/recapture/templates/` へも同梱（検収ツール既定 refs）。アイドル名はマスタ
   `vendor/Character.json` で確定（L1 白石千紗 / L2 一ノ瀬怜 / L3 伊吹渚 / L4 兵藤雫 / L5 成宮すず）
4. **リテイク対応 capture スクリプト**: `aipura_nox/capture_lane_focus_retake.py`（新規・旧
   capture_lane_generic.py を継承・旧スクリプトは無変更）。サブコマンド:
   `focus-setup`（実画面からの refs 校正 + クロス判定 + 同梱テンプレ突合で ABORT 保証）/
   `lane`（全ビート撮影・**保存直前にフォーカス判定→非フォーカスなら同ビート内リテイク**（待ち段階延長
   4 ラウンド・最終は ±1 ビート揺らし）→ 4 ラウンド NG なら beat_NNN_NG.PNG 保存 + 
   focus_retake_log.json 記録）/ `repair`（欠損ビート再撮）/ `stepd`（効果欄スクロール・検証込み）。
   BEAT 認識 3 連続失敗で即停止（暴走防止ルール）・既存ファイルスキップでセッション跨ぎ再開可
5. **検収ツール（本リポジトリ `tools/recapture/`）**:
   - `focus_check.py`: 全ビート×全レーンの自動検収（OK/MISSING/NOFOCUS/NGFILE/LOWMARGIN・
     repair 対象リスト出力・pass_quality 参考値）。**フォルダ名とフォーカスは無関係**として判定
     （旧 backfill で実証済みの仕様）
   - `make_focus_sheets.py`: 目視確認シート生成（名前帯+BEAT カウンタ・9 枚/シート。
     `tools/backfill/make_pop_sheets.py` 流用の 1080×1920 座標。**measured_data.json 非依存**で
     撮影直後から使える）
   - **セルフテスト（旧 S4 無効データへの読み取り専用実行・エビデンスは
     `acceptance_selftest/`）**: 判定 909 フレーム精度 100% + 全 835 セル検収で
     **NOFOCUS 400 = 旧 backfill の「該当フレームなし 400 セル」と完全一致、
     OK 435 = 読取可能 385 + popなし 50 と完全一致**。旧 S4 の自レーン フォーカス率は
     パス毎に 13〜17% と定量化（再撮影の必要性の裏取り）。シート 1 枚目視確認済み
6. **撮影手順メモ**: `recapture_procedure.md`（旧 deck.json 編成の完全ミラー（表+フォト明細。
   実ファイルは `サンプル4/deck.json` に残置）・タップ禁止ゾーン地図・ツール一式の使い方・
   セッション手順（冒頭=前回検収から）・完了条件（835 セル全 OK・達成不能なら理由付き missing_frames）

**成果物パス一覧**:
- `aipura_nox/capture_lane_focus_retake.py`（撮影本体・aipura_nox 側は git 管理外）
- `aipura_nox/templates/name_band/`（テンプレート 5 枚 + README）
- `tools/recapture/focus_check.py` / `tools/recapture/make_focus_sheets.py` / `tools/recapture/templates/`（本リポジトリ・未コミット）
- `research/22_sample4_rollback/recapture_procedure.md`（手順メモ）
- `research/22_sample4_rollback/acceptance_selftest/`（検収ツール検証のエビデンス 4 点）

**留意事項（Step C 冒頭で必読）**:
- 実撮影ではまず `focus-setup`（実画面校正）を 1 回行う。同梱テンプレートはフォールバック・突合用
- 待ち時間・リテイク回数（`MAX_RETAKES=4`）は現状推定値。実機で自レーン維持率が悪ければ
  progress.md に記録して調整
- 本リポジトリ側の成果物（tools/recapture・research/22 追加分）は**コミット済み**
  （commit `693f564`・2026-09-05 ユーザー承認）

---

## Step B の前準備（完了済み）

- [x] 旧 S4 `issues.md` の banner 判定（テンプレートマッチング）知見のメモ化
      → `research/22_sample4_rollback/capture_knowledge_notes.md`

## 次ステップ

- **Step C**: 再撮影（人間補助前提・複数セッション可・暴走防止ルール遵守）。
  手順は `recapture_procedure.md` §4。セッション冒頭は必ず「前回までの検収（focus_check）」から入る
- **Step D/E**: 未着手

