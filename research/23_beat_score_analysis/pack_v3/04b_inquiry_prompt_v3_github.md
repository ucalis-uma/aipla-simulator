# IDOLY PRIDE（アイプラ）通常ビート（白ノーツ）スコアのレーン別系統的オフセットの原因特定依頼

スマートフォン向けゲーム『IDOLY PRIDE（アイプラ）』の完全決定論的ライブスコアシミュレータを
開発しています。実機から取得した精密な実測データ（全ビート × 全 5 レーンのスコアポップ・
判定・バフ状態）を用いたリバースエンジニアリングを進めています。

スキルノーツ（SP/A）のスコア・バフ計算・コンボ倍率・ファンボーナス・クリティカル係数は、
全検証ステージで実測と乱数幅（±5%）以内に 100% 合致させています。
**未解明なのは通常ビート（白ノーツ）の基本スコア（basic）まわりのみ**です。

前段の解析で「ある 1 ステージ（以下 S2）の純白ビート 32 件が全て乱数中心より正側に
ずれる（平均 +5.04%・レベルシフト）」という現象を発見し、単純な説明（係数の差し替え等）
は全て棄却済みです。今回レーン別のスコアポップ実測を完備したことで、
**シフトがレーンごとに異なる構造を持つこと**が初めて判明しました。

本依頼は 1 回のやり取りで完結します（追加の質問・往復はできません）。
回答は長文テキストで返してください（Web アプリ形式の場合も、本文中に根拠数値を含めてください）。
あなたの計算は近似を含み得るため、厳密な検証責任はこちら側にあります。数値の桁は信頼できますが、
レーン別ポップには K/M 単位表示の切り捨て分解能（±0.1K 桁 = 約 ±0.15% 以下）が含まれる点だけ
考慮してください。

> 本プロンプトは GitHub リポジトリ直接読取版です。以下の raw URL をフェッチできる環境で
> 使用してください。フェッチできない場合も、下記「主要数値の併記」だけで回答に進められます
> （完全なデータ表は URL 先の 01-03 を参照）。
>
> 参照基準: ブランチ main / 本 pack 作成時点の直近コミット `d94cefe`
> （pack_v3 収録コミットの push 後に有効。再現性が重要な場合は URL 中の `main` を
> pack_v3 を含むコミットの SHA に置き換えて使用すること = SHA 固定推奨）。

## 読取するファイル（raw URL）

- `research/23_beat_score_analysis/pack_v3/01_context_and_coeffs.md`: https://raw.githubusercontent.com/ucalis-uma/aipla-simulator/main/research/23_beat_score_analysis/pack_v3/01_context_and_coeffs.md
- `research/23_beat_score_analysis/pack_v3/02_s2_pure_white_beats.md`: https://raw.githubusercontent.com/ucalis-uma/aipla-simulator/main/research/23_beat_score_analysis/pack_v3/02_s2_pure_white_beats.md
- `research/23_beat_score_analysis/pack_v3/03_known_explanations.md`: https://raw.githubusercontent.com/ucalis-uma/aipla-simulator/main/research/23_beat_score_analysis/pack_v3/03_known_explanations.md
- `src/timeline/engine.ts`: https://raw.githubusercontent.com/ucalis-uma/aipla-simulator/main/src/timeline/engine.ts
- `src/formula/scoreEvent.ts`: https://raw.githubusercontent.com/ucalis-uma/aipla-simulator/main/src/formula/scoreEvent.ts
- `src/formula/combo.ts`: https://raw.githubusercontent.com/ucalis-uma/aipla-simulator/main/src/formula/combo.ts
- `src/formula/fan.ts`: https://raw.githubusercontent.com/ucalis-uma/aipla-simulator/main/src/formula/fan.ts
- `src/formula/critical.ts`: https://raw.githubusercontent.com/ucalis-uma/aipla-simulator/main/src/formula/critical.ts
- `src/timeline/buffs.ts`: https://raw.githubusercontent.com/ucalis-uma/aipla-simulator/main/src/timeline/buffs.ts
- `src/rng/types.ts`: https://raw.githubusercontent.com/ucalis-uma/aipla-simulator/main/src/rng/types.ts

- 01: 計算アーキテクチャ・確定係数一式（B1/B2/B3/クリティカル/乱数幅・ステージスペック）
- 02: 本依頼の主データ（S2 32 純白ビートの実測合計 + 全レーンポップ + own/off 分解 + S3 対照表）
- 03: 検討済み・棄却済みの説と棄却理由（κ スキャン・flat 加算の検証値込み）
- src/*: 現行シミュレータの実装（`engine.ts` のビート精算・`scoreEvent.ts` のファクター列・
  `combo.ts`/`fan.ts`/`critical.ts` の各係数・`buffs.ts` の B1/ファン・`rng/types.ts` の乱数仕様）

## 主要数値の併記（URL が読めない場合の要約）

**ヘッドライン統計**

S2（32 純白ビート）:

pure white beats: n=32 mean=1050.4 sd=15.9 in=15/32 [1017, 1078]  (ratio = actual/sim ×1000, rand=1000 基準)

S3（70 純白ビート）:

pure white beats: n=70 mean=1003.0 sd=13.7 in=70/70 [963, 1032]  (ratio = actual/sim ×1000, rand=1000 基準)

**レーン別オフセット比較（implied rand 平均 − 1000・本依頼の主対象）**

| lane | S2 offset | S3 offset | S2 レーン属性 | S3 レーン属性 |
|---|---|---|---|---|
| L1 | +1.5‰ | -49.4‰ | vocal | visual |
| L2 | +61.9‰ | +84.5‰ | vocal | vocal |
| L3 | +20.2‰ | -46.2‰ | vocal | visual |
| L4 | +67.4‰ | +73.9‰ | dance | visual |
| L5 | +95.9‰ | -54.6‰ | vocal | visual |

- レーン別 sd は 29-34‰（一様乱数 [950,1050] の理論 sd 28.9 と一致）、ビート合計 sd は
  S2 15.9 / S3 13.7（5 独立乱数平均の理論 sd 12.9 と一致）→ 乱数抽選は正常で
  レーンごとの定数オフセットが乗る構造

**S2 レーン別ファクター平均（純白 32 ビート・buffSnapshots 由来）**

| lane | attr | own mean | off mean | off% | liveMult(own) mean | b1 mean | fan mean | focus mean | beat_score_up mean |
|---|---|---|---|---|---|---|---|---|---|
| L1 | vocal | 57196 | 57285 | 50.0% | 1000 | 1267.0 | 1554.6 | 0.0 | 0.00 |
| L2 | vocal | 36210 | 51374 | 58.7% | 1000 | 1237.0 | 1554.6 | 0.0 | 0.00 |
| L3 | vocal | 70941 | 100881 | 58.7% | 1000 | 1257.7 | 1624.6 | 3.8 | 0.00 |
| L4 | dance | 53523 | 73724 | 57.9% | 1000 | 1506.6 | 1554.6 | 0.0 | 0.00 |
| L5 | vocal | 71721 | 55267 | 43.5% | 1000 | 1216.0 | 1554.6 | 0.0 | 0.00 |

- L1: photos=[207] max=207 sum=207 (sim_skills scoreBonusPct.beat 参照は上表 b1)
- L2: photos=[177] max=177 sum=177 (sim_skills scoreBonusPct.beat 参照は上表 b1)
- L3: photos=[193] max=193 sum=193 (sim_skills scoreBonusPct.beat 参照は上表 b1)
- L4: photos=[175, 206] max=206 sum=381 (sim_skills scoreBonusPct.beat 参照は上表 b1)
- L5: photos=[156] max=156 sum=156 (sim_skills scoreBonusPct.beat 参照は上表 b1)

**S3 レーン別ファクター平均（純白 70 ビート）**

| lane | attr | own mean | off mean | off% | liveMult(own) mean | b1 mean | fan mean | focus mean | beat_score_up mean |
|---|---|---|---|---|---|---|---|---|---|
| L1 | visual | 212596 | 115807 | 35.3% | 1117 | 1060.0 | 1360.8 | 0.0 | 0.00 |
| L2 | vocal | 146578 | 153981 | 51.2% | 1199 | 1060.0 | 1360.8 | 0.0 | 0.00 |
| L3 | visual | 207519 | 119860 | 36.6% | 1000 | 1381.5 | 1527.9 | 7.3 | 0.00 |
| L4 | visual | 548840 | 116303 | 17.5% | 1499 | 1268.7 | 1360.8 | 0.0 | 0.00 |
| L5 | visual | 180088 | 138136 | 43.4% | 1000 | 1060.0 | 1360.8 | 0.0 | 0.00 |

- L1: photos=[] max=0 sum=0 (sim_skills scoreBonusPct.beat 参照は上表 b1)
- L2: photos=[] max=0 sum=0 (sim_skills scoreBonusPct.beat 参照は上表 b1)
- L3: photos=[249] max=249 sum=249 (sim_skills scoreBonusPct.beat 参照は上表 b1)
- L4: photos=[175, 193] max=193 sum=368 (sim_skills scoreBonusPct.beat 参照は上表 b1)
- L5: photos=[] max=0 sum=0 (sim_skills scoreBonusPct.beat 参照は上表 b1)

**S2 own/off の代表値（L1-L5・b3 時点）**

- L1 57196/58369・L2 36210/51374・L3 70941/90647・L4 53523/73724・L5 71721/57426
  （L3 の off はビートにより 84308〜118113 まで変動。全 32 ビートの分解は 02 の表を参照）

**棄却済みモデルの検証値**

S2 flat per lane (deck.json beat_score/fixed sum): {"2":474,"4":1150,"5":1378}
- no-flat: n=32 mean=1050.4 sd=15.9 in=15/32 [1017, 1078]
- flat-per-lane-event: n=32 mean=1016.1 sd=14.9 in=32/32 [989, 1042]
S3 flat per lane (deck.json beat_score/fixed sum): {"2":3598,"3":920}
- no-flat: n=70 mean=1003.0 sd=13.7 in=70/70 [963, 1032]
- flat-per-lane-event: n=70 mean=982.9 sd=13.8 in=69/70 [946, 1013]

S2 (qt-tower-680):
  kappa=1000: n=32 mean=1050.4 sd=15.9 in=15/32 [1017, 1078]
  kappa=900: n=32 mean=1110.5 sd=17.4 in=0/32 [1075, 1140]
  kappa=850: n=32 mean=1143.2 sd=18.3 in=0/32 [1107, 1174]
  kappa=800: n=32 mean=1178.0 sd=19.2 in=0/32 [1141, 1210]
  kappa=700: n=32 mean=1254.1 sd=21.4 in=0/32 [1215, 1289]
  lam=1/20 k=1000: n=32 mean=1200.4 sd=18.2 in=0/32 [1162, 1232]
S3 (qt-ex-tower-005-045):
  kappa=1000: n=70 mean=1003.0 sd=13.7 in=70/70 [963, 1032]
  kappa=900: n=70 mean=1038.9 sd=13.5 in=58/70 [1003, 1063]
  kappa=850: n=70 mean=1057.7 sd=13.7 in=20/70 [1025, 1082]
  kappa=800: n=70 mean=1077.4 sd=14.1 in=4/70 [1044, 1103]
  kappa=700: n=70 mean=1118.8 sd=15.5 in=0/70 [1079, 1149]
  lam=1/20 k=1000: n=70 mean=1146.4 sd=15.6 in=0/70 [1101, 1179]

**ステージスペック**

| 項目 | S2 | S3 |
|---|---|---|
| 重み (Vo/Da/Vi) | 600/250/150‰ | 500/300/1200‰（2 倍） |
| レーン属性 L1-L5 | vocal, vocal, vocal, dance, vocal | visual, vocal, visual, visual, visual |
| 会場キャパ / 来場者数 | 70,000 / 13,206 人 | 40,000 / 8,000 人 |
| B3 基準値（全レーン集目 0） | 1564‰ | 1375‰（L3 集目の再配分で非集目 4 レーン ≈1361‰） |
| ノーツ内訳 (計/通常/A/SP) | 167/149/16/2 | 169/148/19/2 |
| エール beat% | 60‰ | 60‰ |
| キャラ優位 | なし | L5 のみ 2250‰ |
| フォト beat% (L1-L5) | 207/177/193/175+206/156‰ | 0/0/249/175+193/0‰ |

**deck 実値（Vo/Da/Vi・L1→L5）**

- S2: 95327/117828/154199, 60351/93070/187383, 118235/134408/281705, 97666/214094/100838, 119535/91551/191884
- S3: レーン別ファクター平均（上表 own mean / off mean）から実効値を確認できる

## 依頼する分析

以下 (A)(B) に答えてください。

**(A) レーン別系統的オフセットの原因（仕様レベルの仮説）の列挙**

S2 と S3 のレーン別オフセット（上表）を説明できる仮説を、発想の制約なく列挙してください。
- 「計算式・処理フローのどこにどんな仕様/バグがあるとこのパターンになるか」の機序レベルで。
  単なる「○% の係数が違う」ではなく、なぜレーン間で差が出るのか・なぜ S2 と S3 でパターンが
  変わるのかまで説明できるものを評価します
- 各仮説には (i) 機序 (ii) 定量的整合性（どのファクターがどれだけズレれば観測と一致するか）
  (iii) 既知の確定事実（下記「前提」）との矛盾の有無、を付けてください

**(B) 各仮説の判定に使える追加データ / 実験の提案**

- このプロンプト内のデータだけで判定できる検算（どの表のどの数字を使って何を比べればよいか）
- 次回の実機計測で判定できる決定実験（どの画面要素・どの数値を記録すれば一意に判定できるか）

**前提（これらの確定事項と矛盾する仮説は、どの実測と衝突するかを明示の上で提示してください）**

1. λ = 8/140 は T5（全 3000 イベント乱数逆算が [950,1050] に 100% 収束・ゴールデン一致）と
   S3（70/70）で確定。1/20 説・ノーツ数分割説は棄却済み
2. スコア乱数は連続一様 [950,1050]（離散 0.1% 刻み説は棄却済み）
3. B2 コンボは閾値テーブル（0-9:+0% … 50-69:+2.5% … 100+:+5%）+ csu 連成。線形式は実測不一致
4. B3 ファンは引力式（自レーン来場数 = base×5×自引力/Σ引力 → テーブル引き + 集目固定加算）
5. フォトのビートスコア上昇%は max 適用（S3-L4 b8 の実測ポップ 86.3K が max 規則で比率 0.982、
   sum 規則では 1.114 で全乱数域オーバー。本 pack の S3 表でも b8 L4 = 1018.3 として再現される）
6. フォトのビートスコア（固定値）はビート常時加算ではない（S3 で 70/70 → 69/70 に悪化）
7. スキルノーツ（SP/A）は全ステージ全件乱数内合致 → デッキ実値・バフ・コンボ・ファンの
   共通処理にズレはなく、差は通常ビートの basic またはレーン別の乗算ファクターに局所される
8. S3 のビート合計は κ（off 引き下げ）なしで 70/70。S2 だけを κ≈1080 で合わせることは
   S3 と矛盾するため単一 κ では不可（棄却済み）

**期待する回答形式**

1. 仮説リスト（蓋然性の高い順・各仮説に (i)(ii)(iii) を付す）
2. 最も蓋然性が高いと考える仮説 1 つとその理由
3. 次回実機計測時のチェックリスト（(B) の要約）

（以上。URL が読めた場合も読めなかった場合も、同じ形式で回答してください）