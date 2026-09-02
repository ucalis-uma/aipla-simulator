AGENTS.md（リポジトリルート）
は全エージェント共通の大元規約。prompts/ 配下の各プロンプトは冒頭でこれを読ませる前提

deck-json-from-images.md
は編成JSONを画像分析させるためのやつ

prompts/continue-session.md
は0901 0:14の引継ぎ用プロンプト

prompts/measure-new-sample.md
は新しいサンプルの画像解析→measured_data 生成（画像分析エージェント用）

prompts/improve-from-sample.md
は実測サンプルの計算機取り込み・確定仕様実装・乖離分析（計算機改良エージェント用）
2つのプロンプトはセットで使う: 先に measure-new-sample、その成果物を受けて improve-from-sample

prompts/measure-sample1-antigravity.md
はサンプル1測定時の記録（完了済み・新規は measure-new-sample.md を使う）