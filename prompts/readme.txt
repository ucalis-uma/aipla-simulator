AGENTS.md（リポジトリルート）
は全エージェント共通の大元規約。prompts/ 配下の各プロンプトは冒頭でこれを読ませる前提

deck-json-from-images.md
は編成JSONを画像分析させるためのやつ

prompts/continue-session.md
は開発継続用の引継ぎプロンプト（0901 0:14 作成・09-02/09-03 のサンプル2対応で内容更新済み。
現状サマリ・テスト数・不変条件の数値はここが一次）

prompts/measure-new-sample.md
は新しいサンプルの画像解析→measured_data 生成（画像分析エージェント用）

prompts/improve-from-sample.md
は実測サンプルの計算機取り込み・確定仕様実装・乖離分析（計算機改良エージェント用）
2つのプロンプトはセットで使う: 先に measure-new-sample、その成果物を受けて improve-from-sample

prompts/measure-sample1-antigravity.md
はサンプル1測定時の記録（完了済み・新規は measure-new-sample.md を使う）

prompts/analyze-sample1-gap.md
はサンプル1乖離分析の診断専用プロンプト（完了済み 2026-09-02・S1 は ±5% 内で決着。
再利用の際は確定値を research/17_sample1_gap_analysis/CONCLUSION で更新してから使う）

prompts/continue-beat-score-session.md
は通常ビートスコア計算式の再推定・Fable回答検証用の引継ぎプロンプト（2026-09-05作成。
Fableに投げたプロンプトの回答URLとともに新セッションへ投入して検証・実装を進める用）

prompts/backfill-lane-pops.md
は既存サンプル（T5〜S4）のレーン別スコアポップ数字の遡及取得プロンプト（2026-09-05作成）。
LLM画像分析（OCR不使用）で元スクショから +38.6K 等のポップ数字を読み、
lane_pops_backfill.json に追記する。λ・off-attr・フォト重複規則のレーン単位検証に必須。
優先順位: S4 → S2 → S3 → S1/T5。新規サンプルでは measure-new-sample.md の規約どおり
初回解析時に gained_score_pop.text を必ず記録する（遡及は不要にする）


prompts/rollback-recapture-sample4.md
は S4 全面ロールバック+再撮影プロンプト（2026-09-05 作成・最優先）。カメラ自動遷移により
「全5フレームで目的レーンが非フォーカス」のビートが全レーンで発生したことが確定したため、
S4 のデータ・src 確定仕様・research/22/23 の S4 部分を無効化（隔離+マーカー方式）し、
フォーカス確認付きリテイクで再撮影→再解析する。
**ステップ実行式**: ユーザーが「Step A〜B まで」のように範囲を指示して起動する（撮影は人間補助が
要るため一括実行禁止）。進捗は research/22_sample4_rollback/progress.md が一次情報。
範囲未指定なら Step A のみ実行して停止。

prompts/continue-t5-backfill.md
は T5 欠損 111 セルの遡及引継ぎプロンプト（2026-09-05 作成・同日現状更新）。T5 は 1668×2420・IMG_NNNN 命名で
lane3 が「効果ウィンドウ状態数に応じ 1 ビート 1〜3 枚バースト」になるため、IMG↔beat 対応表の構築
（青ドット数ベース+既知シード照合）とクロップ座標再計測が前提。
画像分析のみで Nox 不要のため、**S4 再撮影（Step C）を待たずに並行実行してよい**
（2026-09-05 ユーザー承認。S4 は全面無効化済みのため本タスクでは触れない）。

prompts/create-pack-v3-fable-inquiry.md
は research/23 pack_v3（S4 完全除外・係数修正版 Fable 投入プロンプト）の作成タスク
（2026-09-05 作成）。主問題は「S2 白ビート系統的 +4.5% シフトの犯人特定」。
S4 は無効化のため混入禁止・pack_v2 は書き換えない。係数は現行エンジン実装（B2 テーブル・
fan 引力式 1356‰・deck 実値 basicSum）に修正する。Fable への投入はユーザーが LMarena で行い、
回答 URL は prompts/continue-beat-score-session.md とともに新セッションへ投入して検証する。
T5 遡及の成果を反映できるよう、実行順は T5 遡及の後を想定。
