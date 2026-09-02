# サンプル1 乖離分析（prompts/analyze-sample1-gap.md の診断実行成果）

本ディレクトリは診断スクリプトと中間 JSON。分析結果の本文は
`research/17_sample1_gap_analysis.md`（報告書）を参照。

## スクリプトと実行方法

| スクリプト | 内容 | 実行 |
|---|---|---|
| `trace_dump.ts` | サンプル1 デッキ（deck.json + myPhotos/photoEquip・crit なし・乱数中立）で `simulateTimeline` を直接呼び、**完全な LaneScoreEventTrace**（basicScore / skillPowerPermil / b1Permil / comboFactorPermil / fanFactorPermil / critFactorPermil / isRatioScore / buffSnapshots / activations）を JSON 化 | `npx tsx research/17_sample1_gap_analysis/trace_dump.ts` |
| `t5_trace.ts` | T5 ゴールデンリプレイ（fixtures/t5_replay_rands.json を ArrayRng で再生）のイベント因子をダンプ。検証済み式（A/SP の因子構成）との対照に使用 | `npx tsx research/17_sample1_gap_analysis/t5_trace.ts` |
| `b143_check.ts` | 旧診断（b143 の SP 内訳）。結果メモはファイル冒頭コメント | `npx tsx research/17_sample1_gap_analysis/b143_check.ts` |

中間データ:

| ファイル | 内容 |
|---|---|
| `sim_trace_full.json` | 全 176 ビート × イベントの完全トレース（crit なし・fan=2000 のままの「現行実装出力」） |
| `sim_skills.json` | 解決済みレーン別スキル定義（master/skills_levels 復元値・対象・段数・パワー） |
| `confirmed.json` | CLI（`--n 0 --crit-rate 0`）の確定値タイムライン（195,077,552） |
| `gap_map.csv` | ビート毎: 実測 gain / シミュ gain / 差分 / 累積差 / ポップ数 |
| `gap_rows.json` | 同上の JSON（イベント構成付き） |
| `aevent_table.json` | A/SP 15 イベントの逆算表（実測状態・fan 1584・100‰CB 形式） |

## 観測成果（2026-09-01）

1. **fanFactor クランプ誤り**: `fanBonusPermil(71,000)` → 2000‰ はテーブル最大行クランプ。
   正は 個人 14,200 人 = **1584‰**（b2 検算で r=0.9669 に収束・fan 2000 は r=0.766 で破綻）。
2. **過去の私へ（ct=0・limitPerLive=1）が b136 以降毎ビート再発動**（トレースで確認）。
   csu が毎ビート +3 で 20 に到達、バフ延長も毎ビート適用。
3. **A/SP 逆算（fan 1584・実測状態）で raw パワーとの乖離率 0.38〜0.85**。
   千紗ビームはフラット（0.72〜0.85）、新たな衣装/夏/殻/麻奈はコンボ増で単調減 — type36
   （コンボ数が少ない程効果上昇）の欠落+未解明残差の組合せと解釈（詳細は報告書 §③-3）。
4. T5 ゴールデンは不変（`npx vitest run tests/golden/t5-scores.golden.test.ts` 5 件パス・
   変更ファイルはすべて research/17_sample1_gap_analysis/ 配下のみ）。
