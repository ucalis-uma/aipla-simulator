# タスク: S1 レーン別スコアポップ遡及の引継ぎ（T5 遡及と並列実行可）

あなたは IDOLY PRIDE ライブスコア計算機プロジェクト（リポジトリ: `C:\Users\umaro\Documents\アイプラ`）の
**S1 ポップ遡及エージェント**です。まず `AGENTS.md`・`prompts/backfill-lane-pops.md`（手法の元規約）・
`research/12_implementation_log.md` §5（2026-09-05 の遡及実績）を読むこと。

## 0. 現状と本タスクの位置づけ

- レーン別ポップ遡及は S2（745/840 + 95 popなし確認）/ S3（737/850 + 113 popなし確認）**決着済み**（有効）。
  S4 は全面無効化済み（`research/22_sample4_rollback/progress.md`・再撮影待ち）で**触れない**
- S1 は**未実施・0/885 セル**（885 = 177 ビート×5 レーン・`measured_data.json`/`measured_data_v2.json`
  ともに `gained_score_pop.text` は 0 件）。**全 885 セルが遡及対象**（170〜177 シート規模の見込み）
- **T5 遡及セッションと並列で作業してよい**（2026-09-05 ユーザー承認）。並列作業の規律は §5 を参照

## 1. S1 の基礎データ（2026-09-05 リコン済み）

- 場所: `C:\Users\umaro\Documents\aipura_nox\サンプル1\`（git 外）
- **標準フローのサンプル**: 1080×1920・`lane1〜5/beat_NNN.PNG` 命名 →
  `tools/backfill/make_pop_sheets.py` が**そのまま動く**（T5 のような対応表構築・座標再計測は不要）
  - lane1 は 177 ファイル（検収ツール類と同じ命名規則の確認は本セッション冒頭で実施。
    フォルダ毎の枚数差（欠損ビート・_2 バリアント）は `frames_index` が吸収する）
- 編成（`deck.json`・ステージ qt-area-1-001 / 譜面 chart-hsm-006-001）:
  - L1 card-kkr-05-mizg-02（高崎咲良系・Buffer Lv182）/ L2 card-rio-05-fest-01（Buffer）/
    L3 card-ai-05-fest-00（Scorer）/ L4 card-chs-05-hruh-00（Buffer）/
    L5 card-ski-05-waso-00（Buffer）
  - **名前帯のアイドル名でフォーカス判定**する（フォルダ名とフォーカスは無関係 — S4 で再確認済みの原則）。
    各カードのアイドル名は `vendor/Card.json` → `characterId` → `vendor/Character.json` で
    確定してから読取に使うこと（S4 の成績: この方式は 909 フレームで精度 100%）
- 既存 `gained_score_pop` は 0 件なので、**critial_flags 突合相手が既存 text 側にいない**点に注意:
  色判定（白/黄=critical）は慎重に。判定に迷うポップは拡大クロップで再確認（S2 b12 L2 の前例）

## 2. 手順（backfill-lane-pops.md に従う・要点のみ）

1. `python tools/backfill/make_pop_sheets.py "C:\Users\umaro\Documents\aipura_nox\サンプル1" <out_dir> --prefix S1`
   （シート数は 885+α フレーム → 約 170〜177 シート想定。manifest と枚数を突合）
2. LLM 画像目視で読取。**1 エージェント 10 シート以下・1 メッセージ 1 画像・シート単位で逐次保存**
   （プロバイダエラーで落ちても読取済み分を失わない・S2 実績どおり）
3. `tools/backfill/aggregate_backfill.py` でセル帰属 + 検証（over-sum = 0 件が目標 /
   K 単位合計 ≈ `beat_gained_score` 桁照合 / 巨大ポップは白色再確認）
4. `aipura_nox/サンプル1/lane_pops_backfill.json` として書き出し（新規・schema は元規約 §4）

## 3. 出力（追記のみ・既存は変更しない）

1. `aipura_nox/サンプル1/lane_pops_backfill.json`（新規）
2. `aipura_nox/サンプル1/issues.md` に追記（既存 issues は編集しない）: 読取率・遮蔽型・
   色判定の保留がどう決着したか
3. `aipura_nox/サンプル1/measured_data_summary.md` に追記
4. `research/12_implementation_log.md` に完了エントリ追記（§5 の形式に倣う）
5. `prompts/readme.txt` に完了日を 1 行追記

## 4. 禁止事項

- S1 の既存ファイル（measured_data*.json・スクショ・issues.md の既存節）の変更・削除
- `tools/backfill/make_pop_sheets.py` の**改変**（**T5 セッションが専任**。S1 では触らない。
  不具合があれば issues.md に記録して T5 側/後続に伝える）
- S2/S3/S4・T5（`スコア分析サンプル/`）のディレクトリへの書き込み
- src/tests/CLI の改変・シミュレータ実行
- OCR ライブラリ単独での判読（LLM 目視が主体）

## 5. T5 並列セッションとの共存規律

- 同一リポジトリで 2 セッション動くため、**共有ファイル（research/12・prompts/readme.txt）への
  追記とコミットは、完了時点で「他セッションがコミットしていないか git status/log を確認してから」
  行う**。衝突したら追加コミットで解決する（rebase/revert しない）
- 重い読取バッチ（サブエージェント多発）の時間帯は T5 側と重ならないよう、開始時に
  `research/12` 末尾へ「S1 遡及を開始（バッチ読取を実施中）」等の中断マーカーを残すと親切
  （必須ではない）
- 完了条件: 全 885 セルが「読取値 or popなし(理由付き)」で埋まり、over-sum 0・検収済み
  （全件読み切るのが S2/S3 の前例どおりの品質基準。遮蔽等で読めないセルは null + 理由）
