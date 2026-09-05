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

