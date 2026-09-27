# バフ監査の一致率の定義（Phase 15-2 / 15-3 で確定・2026-09-27）

## 1. なぜ定義を書き換えたか

従来の「一致率」は**段数の完全一致**だけで、次のようなセルを丸ごと不一致に計上していた。

- T5: `combo_continue`（コンボ継続）653 セル — 実測は段数なしフラグ（`stage: null`）、sim は 0/1 保持。
  単位系が違うだけで、実測・sim とも「表示あり」で全セル一致していた
- S1/S3: 発動ビートの撮影位相（実測=発動後表示 / sim=発動前値）72 + 53 セル
- S2/S3: 超化の別建て表示（実測 10段 / 実効 +5段）・SP永続バフの常時表示 110 + 85 セル

その結果、T5 の 78.8% は「エンジンが 21% 間違っている」ように読めてしまい、
**残った真の不一致の絶対数が指標から読めない**という問題があった（`Explanation Required` が
722 件残り、S1 の 301→200 も「何を直したのか」が追えない状態だった）。

## 2. 3 層定義（以後の主指標）

定義元は `research/25_buff_audit/display_spec_rules.json`（v1）。監査スクリプトはこの JSON を
読みに行く（コード側にハードコードしない・黙示 skip 禁止）。

| 層 | 意味 | 使い道 |
|---|---|---|
| **strict** | 段数の完全一致のみ（旧来定義） | 過去レポートとの比較専用。`summary.match_rate_pct` / `tiers.strict_match_rate_pct` |
| **adjusted** | strict の不一致から「段数の単位系」「表示仕様」「撮影/sim の表示位相」で**説明がつく**セルを一致に寄せる | **主指標**。`tiers.adjusted_match_rate_pct` |
| **residual** | adjusted でも説明がつかないセル | **Phase 16 の削減対象**。`tiers.residual_mismatch_count`（件数で管理する） |

### ポリシー

1. **不一致は必ずいずれかの規則に分類する**。どの規則にも入らなければ `UNCLASSIFIED` として
   residual に残す（`Explanation Required` を捨てない／暗黙に 0 扱いしない）。
2. **規則の追加・除外は `display_spec_rules.json` に evidence 付きで書く**。コード側の
   `if` で黙って除外することは禁止（PLAN.md §16 の「既知例外は known_anomalies 的な明示リストで扱う」）。
3. **strict を主指標にしない**。strict 表示だけを見して残りを無視する運用に戻らないこと。
4. **residual は件数で追う**。率に薄めない（例: residual 0 件が目標、1 件でも出現したら原因調査）。

## 3. Phase 15-2 の決定：撮影位相（PHASE_LAG）の扱い → **①監査側の許容**

**決定**: エンジン側の出力は **PRE（発動前の段数）を維持**し、監査側で「表示位相」として明示計上する。
（提案された②「監査側で翌ビート値と照合して一致に寄せる」は、adjusted 層で実装する形で採用。
③「sim 侧の位相をエンジン側で修正」は不採用）

### 不採用にした理由

- スクショはスキル発動**後**に撮影されるため実測は POST を映す。sim 出力を POST へ寄せると、
  「発動ビートからスコアに加算される」というスコア計算側の事実（`applyBeat` の発動→加算順）と
  **表示値の意味が二重にずれる**。スコアは実測と一致しているのに表示段数だけ実測に寄せる形になり、
  監査と計算が互いを検証できなくなる。
- 位相ズレは 1 ビート分の**表示**の問題で、段数そのものの計算誤り（14-F で直した種別）とは
  根本的に性質が違う。同一指標に混ぜると、本当に危険な段数誤りが位相ズレに埋もれる。

### 許容の条件（位相ズレと認めてよいケース）

規則 `PHASE_LAG_ACTIVATION`（tags 同一）は次を確認したセルのみを対象にする:

- 当該ビートに sim 側の発動記録がある、**または**翌ビートの sim 段数 == 実測段数
- 14-F で対称形も追加済み（実測が sim より 1 ビート**遅れて**追いつくケース:
  `m < s` かつ翌ビート実測 == sim 現値。S3 開幕 b1 L3 focus 7vs10 ほか）
- 満了側は `DECAY_TIMING_LAG`（前ビートに sim 段数が立っていたことを確認）

`display_spec_rules.json` の `PHASE_LAG_ACTIVATION.accepted_policy` に同じ趣旨を記録した。

## 4. Phase 15-3 の決定：表示仕様・単位系の明示除外一覧

`display_spec_rules.json` v1 の規則と、2026-09-27 再実行時のヒット数:

| rule_id | tier | 内容（evidence 要約） | T5 | S1 | S2 | S3 |
|---|---|---|---:|---:|---:|---:|
| `FLAG_PRESENCE` | explained_unit | 段数なしフラグは**表示の有無**で照合。実測 `stage: null` と sim の 0/1 は単位系が異なる。<br>**有無が食い違った場合は `FLAG_PRESENCE_MISMATCH` として residual に落とす**（＝有無の検証自体は厳密に行う） | 653 | 0 | 0 | 0 |
| `EXTREME_DISPLAY_VS_EFFECTIVE` | explained_display_spec | 超化は UI で単独 10 段表示、スコアへの寄与は +5 段。sim は実効段数を返す | 0 | 0 | 36 | 85 |
| `CRITICAL_COEFF_MERGE` | explained_display_spec | クリティカル係数上昇に超化 +5 を合算する sim と別建て表示の実測 | 0 | 0 | 0 | 0 |
| `PERSISTENT_SP_BUFF` | explained_display_spec | 集目 SP 等は実測で全ビート表示、sim は条件成立ビートのみ | 0 | 0 | 74 | 0 |
| `PHASE_LAG_ACTIVATION` | explained_display_phase | §3 の位相（発動側） | 69 | 72 | 30 | 53 |
| `PHASE_LAG_DECAY` | explained_display_phase | 同（満了側・tag は `DECAY_TIMING_LAG`） | 0 | 0 | 0 | 0 |
| `BUFF_STAGE_MISMATCH` / `AMPLIFY_OR_OVERLAP_ON_BEAT` | **residual** | 未説明の段数差（＝Phase 16 の対象） | 0 | 0 | 0 | 0 |

`RESIDUAL_AMPLIFY_STACKING`（14-D まで S1/S2 に 140 件あった増幅・重ね掛け系の未説明差）は
**Phase 14-F の満了バフ復活修正で消滅**した。規則 JSON には「以後この tag が再出現したら
14-F の退行として扱う」という注記を残してある。

## 5. 再実行結果（2026-09-27 / 14-E・14-F 適用後の trace）

`python research/26_data_integrity/run_audit_post_decay.py`（S1/S2/S3）と
`python research/25_buff_audit/run_audit_v3.py`（T5）の出力。

| サンプル | 比較セル | strict | adjusted | **residual** | 内訳 |
|---|---:|---|---|---:|---|
| S1 | 1,695 | 95.75% (1,623) | **100.0%** | **0** | 位相 72 |
| S2 | 1,367 | 89.76% (1,227) | **100.0%** | **0** | 表示仕様 110（超化36/SP永続74）・位相 30 |
| S3 | 1,668 | 91.73% (1,530) | **100.0%** | **0** | 表示仕様 85（超化）・位相 53 |
| T5 | 3,411 | 78.83% (2,689) | **100.0%** | **0** | 単位系 653（コンボ継続）・位相 69 |

**読み方**: 4 サンプルとも、表示仕様・単位系・撮影位相で説明できるセルを除いた**真の不一致は 0 件**。
以後「一致率が低い」と書くときは strict を引用しないこと。残課題は §2 の residual 件数で管理する。

### 再現手順

```
node tools/simulate.ts --deck examples/t5_deck.json --out research/25_buff_audit/t5_sim_trace_full.json --buff-snapshot true   # T5 trace
python research/25_buff_audit/run_audit_v3.py                 # T5 監査（strict/adjusted/residual を出力）
python research/26_data_integrity/run_audit_post_decay.py     # S1/S2/S3 監査（同上）
```

監査の生データ（`diff_*.json`）の各セルには `rule_id` / `tier` が付与されている。
`summary.tiers` に 3 層の集計と `rule_hit_counts` が入る。

## 6. 残る既知の限界（residual には数えない）

- **`combo_continue` の実測は有無のみ**（段数が観測不能）。有無の一致までは検証したが、
  「何段乗っているか」は比較できない。実測側で撮影規律として段数を記録しない限り残る限界。
- **撮影フレーム欠落・キー単位の観測不能セル**は比較から除外（`unobserved_cells_missing_frames`）。
  S1 で 5 セル、S3 で 4 セル。0 扱いではなく未観測として扱う（research/12 §7-6 の規律）。
- **`vocal_up` / `vocal_boost` の名称曖昧性**はマスタ側で解ける（スキル ID → 効果テキスト）が、
  実測表示名側の解決はサンプル撮影に依存する。
