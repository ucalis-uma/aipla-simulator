# Phase 16 Action14 / タスク B4: `NAME_TO_BUFF_KEY` 追加の影響確認（S2/S3 完了・スコア差分 0）

作成: 2026-10-07。手順書 `prompts/phase16-action14-noshoot-backlog.md` §3 B4。
A13（コミット `b0ad71c`）で `tools/analyze_beat_score_models.ts` の `NAME_TO_BUFF_KEY` に 5 行
（クリティカル係数上昇超化・`*上昇上限開放`×3・テンション上限開放）を追加した。S1 窓は A13 で
`audit_s1_b136_step11.ts` の出力がコミット済み版とバイト一致することを確認済み。**残っていた S2/S3 を確認**した。

## 方法（A13 版と A13 直前版を同一の `src/` で走らせて差分を取る）

```powershell
git show b0ad71c^:tools/analyze_beat_score_models.ts > tools/_tmp_b4_pre_a13_analyze.ts   # A13 直前版
npx tsx tools/_tmp_b4_pre_a13_analyze.ts --samples S2,S3 --quiet --json <pre.json>       # 旧表
npx tsx tools/analyze_beat_score_models.ts --samples S2,S3 --quiet --json <post.json>    # 新表（HEAD と同一）
node research/23_beat_score_analysis/_b4_json_diff.mjs <pre.json> <post.json>            # 深い比較
```

- `tools/analyze_beat_score_models.ts` は **HEAD と作業ツリーで差分なし**（`git diff --stat HEAD -- <tool>` が空）
  ＝ A13 の表追加はすでにコミット済み。
- 旧版は `src/` を共有するため、**差分は表の追加だけに起因**する（engine 側の A13 変更は A13 のゲートで検証済み）。

## 結果: **数値差分 0 件**（差分は timestamp と診断ラベル 3 件のみ）

```
差分パス総数: 4
  $.meta.generatedAt                              ← 実行時刻のみ
  $.samples.0.laneDiag.2.effectDiffTop.1: "クリティカル係数上昇超化(実測10/sim?)×15" → "…(実測10/sim0)×15"
  $.samples.1.laneDiag.0.effectDiffTop.0: "ビジュアル上昇上限開放(実測10/sim?)×26"       → "…(実測10/sim0)×26"
  $.samples.1.laneDiag.3.effectDiffTop.1: "ビジュアル上昇上限開放(実測10/sim?)×27"       → "…(実測10/sim0)×27"
数値差分: 0 件
```

- **スコア・モデル・比・一致率の数値はすべて完全一致**（`数値差分: 0 件`）。S2/S3 の窓に
  超化行・上限開放行が含まれていても、**行突合の診断以外に影響しない**ことを数値で確定。
- 唯一の内容変化はラベル `sim?` → `sim0`: `@capExtend:*` / `@limitRelease:*` の擬似キーが
  `simEffects` に存在しないため `Number(undefined)` が `0` に変わり、**「未知」から「0 段」として
  引けるようになった**（不一致として計上される件数 ×15/×26/×27 は不変 ＝ 一致率も不変）。
  これは A13 の予測（「`@capExtend:*` / `@limitRelease:*` は `simEffects` に無いので不一致として
  計上される（従来も不一致）」）と完全に一致する。
- `tools/audit_s1_b136_step11.ts` の未知名リスト（L180）は S1 の b130–145 窓専用ツールであり、
  S2/S3 に対応する窓は上記の `effectDiffTop` 集計が相当する（超化・上限開放の行が
  「未知」ではなく「0 段」として扱われるようになった）。

## 成果物

- `research/26_data_integrity/phase16_action14_b4_s23_pre_a13.json`（A13 直前版の出力）
- `research/26_data_integrity/phase16_action14_b4_s23_post_a13.json`（現行版の出力）
- `research/23_beat_score_analysis/_b4_json_diff.mjs`（深い比較スクリプト）
- S1 側は A13 の `research/26_data_integrity/s1_b136_step11_audit.json`（コミット済み版とバイト一致）
