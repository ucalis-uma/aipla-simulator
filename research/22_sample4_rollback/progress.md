# S4 全面ロールバック・再撮影 — 進捗ファイル（一次情報）

- **プロンプト**: `prompts/rollback-recapture-sample4.md`（ステップ実行式。ユーザーが範囲を指示して起動）
- **現ステップ**: **Step B 完了（ロールバック実行）→ 次は Step C-pre（撮影準備）**
- **次にユーザーが指示すべきこと**: 「Step C-pre を実行」
  （なお、リポジトリ側の変更は**未コミット**。コミットはプロンプト §3 の「要ユーザー確認」のため
  ユーザー指示待ち — 「コミットして」と指示すれば 2 コミットに分離して作成する）

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

**コミット状態**: 変更はすべて**ワーキングツリーにあり未コミット**（プロンプト §3「revert コミットは可・
要ユーザー確認」のため）。前セッション（backfill）の未コミット分（research/12 §5・prompts/readme.txt・
`prompts/continue-t5-backfill.md`・`prompts/rollback-recapture-sample4.md`・`tools/backfill/`）と混在 —
コミット時は「backfill 記録コミット」と「ロールバックコミット」の 2 件に分離することを推奨。

---

## Step B の前準備（完了済み）

- [x] 旧 S4 `issues.md` の banner 判定（テンプレートマッチング）知見のメモ化
      → `research/22_sample4_rollback/capture_knowledge_notes.md`

## 次ステップ

- **Step C-pre**（次）: 撮影手順メモ作成（deck.json 編成コピー含む）・capture スクリプトの
  リテイク対応案（フォーカス判定→同ビート内再撮）・検収ツール（フォーカス判定クロップ一式・
  `tools/backfill/make_pop_sheets.py` の 1080×1920 座標流用）
- **Step C**: 再撮影（人間補助前提・複数セッション可・暴走防止ルール遵守）
- **Step D/E**: 未着手

