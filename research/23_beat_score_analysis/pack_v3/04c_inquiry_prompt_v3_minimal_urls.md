# IDOLY PRIDE ライブスコアのレーン別系統的オフセットの原因特定（URL 読取依頼）

スマホゲーム『IDOLY PRIDE（アイプラ）』の完全決定論的ライブスコアシミュレータを開発しています。
実機実測データとの照合で、通常ビート（白ノーツ）のスコアに**レーンごとの系統的オフセット**が
見つかりました。原因を仕様レベルで特定したいです。やり取りは 1 回のみ（追加質問不可）。
回答は長文テキストで。

**まず以下の URL を全て取得してから回答してください**（生テキスト・GitHub リポジトリ
`ucalis-uma/aipla-simulator` の main ブランチ）:

- https://raw.githubusercontent.com/ucalis-uma/aipla-simulator/main/research/23_beat_score_analysis/pack_v3/01_context_and_coeffs.md
  （計算アーキテクチャと確定係数一式）
- https://raw.githubusercontent.com/ucalis-uma/aipla-simulator/main/research/23_beat_score_analysis/pack_v3/02_s2_pure_white_beats.md
  （主データ: S2 32 純白ビートの実測 + 全レーンポップ + own/off 分解 + S3 70 ビート対照）
- https://raw.githubusercontent.com/ucalis-uma/aipla-simulator/main/research/23_beat_score_analysis/pack_v3/03_known_explanations.md
  （検討済み・棄却済みの説一覧）
- https://raw.githubusercontent.com/ucalis-uma/aipla-simulator/main/src/timeline/engine.ts
- https://raw.githubusercontent.com/ucalis-uma/aipla-simulator/main/src/formula/scoreEvent.ts
- https://raw.githubusercontent.com/ucalis-uma/aipla-simulator/main/src/formula/combo.ts
- https://raw.githubusercontent.com/ucalis-uma/aipla-simulator/main/src/formula/fan.ts
- https://raw.githubusercontent.com/ucalis-uma/aipla-simulator/main/src/formula/critical.ts
- https://raw.githubusercontent.com/ucalis-uma/aipla-simulator/main/src/timeline/buffs.ts
- https://raw.githubusercontent.com/ucalis-uma/aipla-simulator/main/src/rng/types.ts
  （上 7 件は現行シミュレータの実装。01 に引用済みなので補助資料）

**核心（依頼対象の現象）**: implied rand（実測 / 再計算 × 1000・乱数中心 1000 基準）の
レーン別平均の偏差 —
S2: L1 +1.5 / L2 +61.9 / L3 +20.2 / L4 +67.4 / L5 +95.9‰（L1 のみ乱数中心・L5 は 32/32 が
+5% 超。レーン別 sd は一様乱数の理論値 28.9 と一致 → 乱数は正常・レーン定数のオフセット）。
S3: L1 −49.4 / L2 +84.5 / L3 −46.2 / L4 +73.9 / L5 −54.6‰（混号でビート合計では相殺・
ビート合計は 70/70 で乱数内）。L2・L4 は両サンプルで正側。

## 回答形式

1. このパターンを説明できる仕様レベルの仮説を蓋然性の高い順に列挙
   （各仮説に: (i) 機序 — なぜレーン間で差が出るか・なぜ S2 と S3 でパターンが変わるか
   (ii) 定量的整合 — どのファクターがどれだけズレれば観測と一致するか
   (iii) 03 の棄却済み説・01 の確定事実との矛盾の有無）
2. 最有力仮説 1 つとその理由
3. 各仮説の判定に使える追加データ / 次回実機計測の決定実験の提案

**注意**: λ・κ・フォト規則の再推定や統一モデルの全面再構築は不要（03 で棄却済み）。
レーン別オフセットの機序に集中してください。URL が取得できなかったファイルがあれば
捏造せずその旨を明示し、取得できた範囲で回答してください。
