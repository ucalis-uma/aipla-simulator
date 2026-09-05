/**
 * pack_v3 ドキュメント組立スクリプト。
 *
 * gen_output.txt（gen_pack_v3_tables.mjs の機械出力）から表セクションを切り出し、
 * 02_s2_pure_white_beats.md / 04a_inquiry_prompt_v3_inline.md / 04b_inquiry_prompt_v3_github.md
 * を組み立てる。数値の手打ち転記を防ぐのが目的（表は全てスクリプト出力のバイト列をそのまま埋め込む）。
 *
 * 実行: node research/23_beat_score_analysis/pack_v3/verification/assemble_docs.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";

const PACK = "C:/Users/umaro/Documents/アイプラ/research/23_beat_score_analysis/pack_v3";
const gen = readFileSync(`${PACK}/verification/gen_output.txt`, "utf-8").split("\n");

/** マーカー行（前方一致）の行番号を探す */
function find(marker, from = 0) {
  for (let i = from; i < gen.length; i++) {
    if (gen[i].startsWith(marker)) return i;
  }
  throw new Error(`marker not found: ${marker}`);
}

/** マーカー a の行目からマーカー b の直前まで（前後の空行を除去） */
function betweenIncl(a, b) {
  const lines = gen.slice(a, b);
  while (lines.length && lines[0].trim() === "") lines.shift();
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
  return lines.join("\n");
}
/** マーカー a の直後からマーカー b の直前まで（前後の空行を除去） */
function between(a, b) {
  const lines = gen.slice(a + 1, b);
  while (lines.length && lines[0].trim() === "") lines.shift();
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
  return lines.join("\n");
}

// --- セクション切り出し ---
const S2_HEAD = find("===== S2 (");
const S3_HEAD = find("===== S3 (");
const FLAT_HEAD = find("===== flat (");
const KAPPA_HEAD = find("===== kappa scan");

const s2Stats = betweenIncl(find("pure white beats:", S2_HEAD), find("### S2 beat table", S2_HEAD));
const s2BeatTable = between(find("### S2 beat table", S2_HEAD), find("### S2 per-lane implied rand matrix", S2_HEAD));
const s2Matrix = between(find("### S2 per-lane implied rand matrix", S2_HEAD), find("per-lane aggregates:", S2_HEAD));
const s2Agg = between(find("per-lane aggregates:", S2_HEAD), find("### S2 per-lane factor means", S2_HEAD));
const s2Factors = between(find("### S2 per-lane factor means", S2_HEAD), find("photo beat_score pct per lane", S2_HEAD));
const s2Photo = between(find("photo beat_score pct per lane", S2_HEAD), find("### S2 own/off decomposition matrix", S2_HEAD));
const s2OwnOff = between(find("### S2 own/off decomposition matrix", S2_HEAD), S3_HEAD);

const s3Stats = betweenIncl(find("pure white beats:", S3_HEAD), find("### S3 beat table", S3_HEAD));
const s3BeatTable = between(find("### S3 beat table", S3_HEAD), find("### S3 per-lane implied rand matrix", S3_HEAD));
const s3Agg = between(find("per-lane aggregates:", S3_HEAD), find("### S3 per-lane factor means", S3_HEAD));
const s3Factors = between(find("### S3 per-lane factor means", S3_HEAD), find("photo beat_score pct per lane", S3_HEAD));
const s3Photo = between(find("photo beat_score pct per lane", S3_HEAD), FLAT_HEAD);

const flatBlock = between(FLAT_HEAD, KAPPA_HEAD);
const kappaBlock = between(KAPPA_HEAD, gen.length);

// --- レーン別オフセット比較表（aggregates の mean から機械算出） ---
function offsetsOf(aggText) {
  const map = {};
  for (const m of aggText.matchAll(/- L(\d): n=\d+ mean=([-\d.]+)/g)) {
    map[Number(m[1])] = (parseFloat(m[2]) - 1000).toFixed(1);
  }
  return map;
}
const off2 = offsetsOf(s2Agg);
const off3 = offsetsOf(s3Agg);
let offsetTable = "| lane | S2 offset | S3 offset | S2 レーン属性 | S3 レーン属性 |\n|---|---|---|---|---|\n";
const ATTRS2 = { 1: "vocal", 2: "vocal", 3: "vocal", 4: "dance", 5: "vocal" };
const ATTRS3 = { 1: "visual", 2: "vocal", 3: "visual", 4: "visual", 5: "visual" };
for (let L = 1; L <= 5; L++) {
  offsetTable += `| L${L} | ${off2[L] > 0 ? "+" : ""}${off2[L]}‰ | ${off3[L] > 0 ? "+" : ""}${off3[L]}‰ | ${ATTRS2[L]} | ${ATTRS3[L]} |\n`;
}

// --- 共通の導入部（04a/04b で共用） ---
const INTRO = `# IDOLY PRIDE（アイプラ）通常ビート（白ノーツ）スコアのレーン別系統的オフセットの原因特定依頼

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
考慮してください。`;

// --- 04a 本文 ---
const QSECTION = `## 依頼する分析

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
3. 次回実機計測時のチェックリスト（(B) の要約）`;

// --- 02 本文 ---
const doc02 = `# 02. S2 32 純白ビート実測（レーン別ポップ付き）と S3 70 ビート対照

> 数値出典: 本ファイルの全表は \`verification/gen_pack_v3_tables.mjs\` の機械出力
> （\`verification/gen_output.txt\`）から組立スクリプト \`verification/assemble_docs.mjs\`
> がバイト列のまま埋め込んだものである（手計算・目視転記なし）。
> 入力データ: \`research/20_sample2_gap_analysis\`・\`research/21_sample3_gap_analysis\` の
> sim_trace_full.json / sim_skills.json（エンジン出力）+ aipura_nox 側の measured_data と
> lane_pops_backfill.json（実測・2026-09-05/06 遡及完了分）。
> 無効化済みサンプルのデータは一切参照していない。

## 1. ヘッドライン

${s2Stats}

- 32/32 ビートが乱数中心（1000）より正側・最小値 1017 = **系統的な +5.04% レベルシフト**
  （偶然で全 32 ビートが正側になる確率は 2^-32。sd 15.9‰ は乱数本来の広がりと同程度 →
  「乱数は正常・中心だけがずれる」型の現象）
- **pack_v3 の新知見（レーン別ポップによる分解）**: シフトはレーン構造を持つ。

${offsetTable}

- L1 はほぼ乱数中心（31/32 が [950,1050] 内）、L5 は 32/32 が 1050 超え。
  一方 S3（ビート合計は 70/70 で乱数中心一致）のレーン別は **混号のオフセット**で、
  ビート合計では相殺されている。L2・L4 は両サンプルで正側に偏る
- レーン別 implied rand の sd（29-34‰）は一様乱数 [950,1050] の理論 sd 28.9‰ と、
  ビート合計の sd（S2 15.9 / S3 13.7）は 5 独立乱数の平均の理論 sd 12.9‰ とそれぞれ整合。
  つまり実態は「**各レーンの乱数抽選は正常 + レーンごとの定数オフセット**」という構造
- 既知の S2 全体ギャップ（crit 再現ラン 75,656,769 vs 実測 77,732,383 = sim 側 ×0.973）と
  同方向。スキルノーツは全件乱数内合致のため、オフセットは通常ビート系に局所される

## 2. S2 ステージスペック

| 項目 | 値 |
|---|---|
| ステージ | qt-tower-680（VENUSタワー STAGE680・サマー♡ホリデイ Lv241） |
| 属性重み (Vo/Da/Vi) | 600 / 250 / 150‰（和 1000‰） |
| レーン属性 L1-L5 | vocal / vocal / vocal / dance / vocal |
| 会場キャパ / 来場者数 | 70,000 / 13,206 人（B3 基準 1564‰） |
| ノーツ内訳 (計/通常/A/SP) | 167 / 149 / 16 / 2 |
| エール beat% | 6.0% |
| キャラ優位 | なし（全レーン 1000‰） |

詳細は \`01_context_and_coeffs.md\` §4。

## 3. S2 ビート表（32 純白ビート・レーン別ポップ付き）

\`implied rand\` = 実測ビート合計 / 現行モデル再計算値（乱数 1000 固定）× 1000。
ポップは実機表示値（K 単位・切り捨て表示）。純白ビート = クリティカル 0 + スキル発動なし +
獲得スコア > 0 のビート。

${s2BeatTable}

## 4. S2 レーン別 implied rand マトリクス

レーン別 implied rand = 実測ポップ（表示下限値）/ レーン別イベント再計算値 × 1000。
ポップの表示分解能（K 桁で [表示値, 表示値+100)）のノイズを含む近似値。

${s2Matrix}

${s2Agg}

## 5. S2 レーン別ファクター平均とフォト構成

純白 32 ビートにおける各レーンの乗算ファクター・own/off の平均（buffSnapshots 由来）。

${s2Factors}

${s2Photo}

- b1 の内訳 = 1000 + エール 60‰ + フォト beat% max（L4 のみ 2 枚中最大 206）。sum 適用なら
  L4 のみ b1 が +175 増える
- own/off は「自レーン属性の重み込みステータス / それ以外 2 属性の重み込み合計」。
  κ=1000（off 引き下げなし）の現行実装では basic = floor((own+off) × 8/140)

## 6. S2 own/off 分解マトリクス

セル = own/off（バフスナップショット由来・純白 32 ビート）。

${s2OwnOff}

## 7. S3 対照（70 純白ビート）

${s3Stats}

S3 はビートスコア 2 倍ステージ（重み和 2000‰）・L5 にキャラ優位 2250‰（反映済み）。
レーン属性は visual / vocal / visual / visual / visual。B3 基準 1375‰（8,000 人・全レーン集目 0 時。
実データは L3 の集目で非集目 4 レーン ≈1361‰・L3 1527.9‰）。

${s3BeatTable}

### S3 レーン別 implied rand 集計

${s3Agg}

### S3 レーン別ファクター平均

${s3Factors}

${s3Photo}

## 8. 参考: 棄却済みモデルの再現値（03 へのリンク）

- κ スキャン・フォト flat 加算の検証値は \`03_known_explanations.md\` に引用
  （出典は同じく \`verification/gen_output.txt\`）
- S3 のレーン別 implied rand マトリクス（70 行）は \`verification/gen_output.txt\` 参照
  （本ファイルでは集計のみ掲載）
`;

writeFileSync(`${PACK}/02_s2_pure_white_beats.md`, doc02);

// --- 04a ---
const doc04a = `${INTRO}

## 1. 計算アーキテクチャ（確定分）

1 イベント（ノーツ 1 個 × レーン 1 本）の獲得スコアは千分率（1000 = 1.0 倍）の
乗算ファクター列で、各ステップで 1000 で割って切り捨てる（実機は最終 floor のみの
at-end 方式が確定。単一イベントの解析では差が出ない）:

\`\`\`
Score = floor( basic × 8/140 )            ← basic: 通常ビートの基本スコア（解析対象）
        × B1 / 1000                       ← スコアボーナス
        × B2 / 1000                       ← コンボ
        × B3 / 1000                       ← ファン
        × B4 / 1000                       ← ステージ（本検証では 1000 固定）
        × rand / 1000                     ← 連続一様 [950,1050]
        × crit / 1000                     ← クリティカル（本検証では全て非発生 = 1000）
        (+ 固定スコア: なし)
\`\`\`

- **basic**: そのレーンの属性別ステータス（deck 実値）にライブ中バフ倍率（上昇 +50‰/段等・
  上限 3750‰）を乗じ、ステージの属性重み W（千分率）で重み付けして合算した basicSum に
  λ = 8/140 を掛けた値
  - S2: W = (Vo 600, Da 250, Vi 150)。S3: W = (Vo 500, Da 300, Vi 1200)（重み和 2000‰）
  - **A/SP ノートの基本スコアは属性単一式で全サンプル 100% 整合。乖離は通常ビートのみ**
- **B1** = 1000 + 25‰ × score_up段 + 100‰ × beat_score_up段 + エールbeat% + フォトbeat%（max）+ 固定付与
  （本データの純白ビートでは beat_score_up は常に 0 段。score_up は乗ることがあるが、
  下表の b1 はトレース実値なので影響済み）
- **B2**（コンボ・テーブル式）: combo 0-9:+0‰ / 10-19:+50‰ / 20-29:+100‰ / 30-39:+150‰ /
  40-49:+200‰ / 50-69:+250‰ / 70-99:+300‰ / 100+:+500‰（増分。csu 段で (1000+100×csu)/1000 倍）
- **B3**（引力式）: 自レーン来場数 = baseCount × 5 × 自引力度 / Σ引力度（引力 = 1000 + 50×集目 − 50×ステルス）→
  fan テーブル引き（1K 人まで 10 人/0.1% → 5K まで 20 → 9.8K まで 40 → 10K まで 2.5 → 20K まで 50 →
  以降 100 人/0.1%）+ 集目固定加算（1-5 段 +0.7%/段・6-10 段 +0.3%/段・最大 +5.0%）
- **crit**: 非発生時 1000。発生時は 1500 + 50/段 + クリスコ% で 1.5〜2.5 倍超に変動するため、
  本検証はクリティカル発生ビートを完全除外している（乱数推定の汚染防止）

## 2. 検証ステージのスペック

| 項目 | S2 | S3 |
|---|---|---|
| ステージ | VENUSタワー STAGE680 / サマー♡ホリデイ Lv241 | EXタワー ⅢX-045 / Blow Up |
| センター属性 / 重み (Vo/Da/Vi) | Vocal / 600-250-150‰ | Visual / 500-300-1200‰（2 倍ステージ） |
| レーン属性 L1-L5 | vocal, vocal, vocal, dance, vocal | visual, vocal, visual, visual, visual |
| 会場キャパ / 来場者数 | 70,000 / 13,206 人 | 40,000 / 8,000 人 |
| B3 基準値（全レーン集目 0） | 13,206 人 → 1564‰ | 8,000 人 → 1375‰（L3 集目の再配分で非集目 4 レーン ≈1361‰） |
| ノーツ内訳 (計/通常/A/SP) | 167 / 149 / 16 / 2 | 169 / 148 / 19 / 2 |
| エール beat% | 60‰ | 60‰ |
| キャラ優位 | なし | L5 のみ 2250‰（反映済み） |
| フォト beat% (L1-L5) | 207 / 177 / 193 / 175+206 / 156‰ | 0 / 0 / 249 / 175+193 / 0‰ |

deck 実値（total_after_non_skill_modifiers・Vo/Da/Vi・L1→L5）:
- S2: 95327/117828/154199, 60351/93070/187383, 118235/134408/281705, 97666/214094/100838, 119535/91551/191884
- S3: レーン別ファクター平均（§4.6 の own mean / off mean）から実効値を確認できる

## 3. 検証方法

- 実機データ: S2 は 904 枚・S3 は 167 フレーム系のスクショから全ビート × 全 5 レーンの
  ポップ・判定・バフを解析した実測ファイル。**レーン別ポップは全ビート × 全レーンで
  完備**（S2 840/840 セル・S3 850/850 セル決着。色 × 判定フラグ突合・K 単位合計照合済み）
- 純白ビート = クリティカル 0・スキル発動なし・獲得スコア > 0 のビートを抽出
  （S2: 149 通常ノーツ中 32 ビート、S3: 148 中 70 ビート）
- 再計算: トレースのバフスナップショットから own/off を分解し、乱数 1000 固定で
  イベント値を再計算。implied rand = 実測 / 再計算値 × 1000

## 4. 実測データ

### 4.1 ヘッドライン統計

S2（32 純白ビート）:

${s2Stats}

S3（70 純白ビート）:

${s3Stats}

### 4.2 レーン別オフセット比較（本依頼の主対象）

implied rand のレーン別平均 − 1000:

${offsetTable}
- S2 は L1 を除く 4 レーンが正側（L5 は 32/32 が 1050 超）。S3 は混号でビート合計では相殺。
  L2・L4 は両サンプルで正側
- レーン別 sd は 29-34‰（= 一様乱数 [950,1050] の理論 sd 28.9‰ + ポップ表示ノイズ）、
  ビート合計 sd は S2 15.9 / S3 13.7（= 5 独立乱数平均の理論 sd 12.9）。
  → 各レーンの乱数抽選自体は正常で、**レーンごとの定数オフセット**が乗っている構造

### 4.3 S2 ビート表（32 純白ビート・実測合計 + レーン別ポップ）

${s2BeatTable}

### 4.4 S2 レーン別 implied rand マトリクス

ポップ表示の切り捨て分解能（±0.1K ≒ ±0.15% 以下）を含む近似値。

${s2Matrix}

${s2Agg}

### 4.5 S2 own/off 分解（バフスナップショット由来）+ レーン別ファクター平均

own = 自レーン属性の重み込みステータス、off = 他 2 属性の重み込み合計
（basic = floor((own+off) × 8/140)。セル = own/off）:

${s2OwnOff}

レーン別ファクター平均（純白 32 ビート）:

${s2Factors}

${s2Photo}

### 4.6 S3 対照表（70 純白ビート・レーン別ポップ付き）

${s3BeatTable}

S3 レーン別 implied rand 集計:

${s3Agg}

S3 レーン別ファクター平均:

${s3Factors}

${s3Photo}

## 5. 検討済み・棄却済みの説（再提案不要）

1. **κ モデル**（off 属性に係数 κ<1000 を掛ける）: S2 は κ≈1080（引き上げ）が必要、S3 は κ=1000 で
   70/70 → 単一 κ では不可
2. **フォト固定値（flat）のビート常時加算**: S2 は 32/32・平均 1016 に収まるが S3 は 69/70・平均 983
   に悪化 → 数値の偶然一致
3. **λ = 1/20**（コミュニティ資料の定義）: S3 が −14.3% で全滅
4. **λ = 8/ノーツ数**: S2（149）と S3（148）はほぼ同数なのに適合 λ が異なる
5. **フォト beat% の sum 適用**: S3-L4 b8 の実測ポップ 86.3K に対し max 規則 0.982 / sum 規則 1.114
   （全乱数域でオーバー）。全レーン一括の sum/max 切替では S2 のレーン構造も説明できない
6. **乱数分布自体の偏り**: S3 の 70 ビートは [963,1032] に対称 → ゲーム全体の乱数中心は 1000 のまま

## 6. 観察の補足

- S2 には全体でも実測 > シミュの既知ギャップがある（crit 再現ランで sim 側 ×0.973）。
  純白ビートの +5.04% と同方向
- S2 の L3 のみ集目バフ（focus 平均 3.8 段）で B3 が他レーンより高い（1624.6 vs 1554.6）。
  S3 の L3 も同様（focus 7.3 段・1527.9 vs 1360.8）
- S2 の L4 のみフォトが 2 枚（beat% 175/206）。S3 の L4 も 2 枚（175/193）。
  sum/max の差が効くのはこの 2 レーンだけ
- ポップ表示は K 単位の切り捨て（例: +38.6K = [38600, 38700)）。レーン別 implied rand の
  オフセット（最大 +96‰）はこの分解能より 1 桁以上大きい

${QSECTION}

（以上。本プロンプトは自己完結しています。外部リソースの参照は不要です）`;

writeFileSync(`${PACK}/04a_inquiry_prompt_v3_inline.md`, doc04a);

// --- 04b（GitHub 読取版） ---
const REPO_URL = "https://github.com/ucalis-uma/aipla-simulator";
const RAW = "https://raw.githubusercontent.com/ucalis-uma/aipla-simulator/main";
const FILES = [
  "research/23_beat_score_analysis/pack_v3/01_context_and_coeffs.md",
  "research/23_beat_score_analysis/pack_v3/02_s2_pure_white_beats.md",
  "research/23_beat_score_analysis/pack_v3/03_known_explanations.md",
  "src/timeline/engine.ts",
  "src/formula/scoreEvent.ts",
  "src/formula/combo.ts",
  "src/formula/fan.ts",
  "src/formula/critical.ts",
  "src/timeline/buffs.ts",
  "src/rng/types.ts",
];
const urlList = FILES.map((f) => `- \`${f}\`: ${RAW}/${encodeURI(f)}`).join("\n");

const doc04b = `${INTRO}

> 本プロンプトは GitHub リポジトリ直接読取版です。以下の raw URL をフェッチできる環境で
> 使用してください。フェッチできない場合も、下記「主要数値の併記」だけで回答に進められます
> （完全なデータ表は URL 先の 01-03 を参照）。
>
> 参照基準: ブランチ main / 本 pack 作成時点の直近コミット \`d94cefe\`
> （pack_v3 収録コミットの push 後に有効。再現性が重要な場合は URL 中の \`main\` を
> pack_v3 を含むコミットの SHA に置き換えて使用すること = SHA 固定推奨）。

## 読取するファイル（raw URL）

${urlList}

- 01: 計算アーキテクチャ・確定係数一式（B1/B2/B3/クリティカル/乱数幅・ステージスペック）
- 02: 本依頼の主データ（S2 32 純白ビートの実測合計 + 全レーンポップ + own/off 分解 + S3 対照表）
- 03: 検討済み・棄却済みの説と棄却理由（κ スキャン・flat 加算の検証値込み）
- src/*: 現行シミュレータの実装（\`engine.ts\` のビート精算・\`scoreEvent.ts\` のファクター列・
  \`combo.ts\`/\`fan.ts\`/\`critical.ts\` の各係数・\`buffs.ts\` の B1/ファン・\`rng/types.ts\` の乱数仕様）

## 主要数値の併記（URL が読めない場合の要約）

**ヘッドライン統計**

S2（32 純白ビート）:

${s2Stats}

S3（70 純白ビート）:

${s3Stats}

**レーン別オフセット比較（implied rand 平均 − 1000・本依頼の主対象）**

${offsetTable}
- レーン別 sd は 29-34‰（一様乱数 [950,1050] の理論 sd 28.9 と一致）、ビート合計 sd は
  S2 15.9 / S3 13.7（5 独立乱数平均の理論 sd 12.9 と一致）→ 乱数抽選は正常で
  レーンごとの定数オフセットが乗る構造

**S2 レーン別ファクター平均（純白 32 ビート・buffSnapshots 由来）**

${s2Factors}

${s2Photo}

**S3 レーン別ファクター平均（純白 70 ビート）**

${s3Factors}

${s3Photo}

**S2 own/off の代表値（L1-L5・b3 時点）**

- L1 57196/58369・L2 36210/51374・L3 70941/90647・L4 53523/73724・L5 71721/57426
  （L3 の off はビートにより 84308〜118113 まで変動。全 32 ビートの分解は 02 の表を参照）

**棄却済みモデルの検証値**

${flatBlock}

${kappaBlock}

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

${QSECTION}

（以上。URL が読めた場合も読めなかった場合も、同じ形式で回答してください）`;

writeFileSync(`${PACK}/04b_inquiry_prompt_v3_github.md`, doc04b);

console.log("written: 02_s2_pure_white_beats.md / 04a_inquiry_prompt_v3_inline.md / 04b_inquiry_prompt_v3_github.md");
console.log("offset table:");
console.log(offsetTable);
