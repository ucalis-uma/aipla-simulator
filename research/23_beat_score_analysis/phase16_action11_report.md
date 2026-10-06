# Phase 16 Action11 — S2 系統的な −3.65% の原因分解（報告）

対象: `prompts/phase16-action11-s2-note-gap.md`
担当: DSH（deepseek-v4.1）／実施日: 2026-10-02
前提ハーネス: `tools/audit_hidden_cells_sim.ts`（CASES は変更していない）

---

## 0. 出発点（変更なしの再確認）

`node tools/audit_hidden_cells.mjs S1,S2,S3`（= `npm run audit:hidden`）と
`npx tsx tools/audit_hidden_cells_sim.ts --samples S1,S2,S3`（実行ログ: `phase16_action11_models_S1S2S3.txt`）:

| サンプル | 実測合計 | sim 合計 | 乖離 |
|---|---:|---:|---:|
| S1 | 116,537,513 | 116,829,040 | **+0.25%** |
| S2 | 77,732,383 | 74,895,810 | **−3.65%** |
| S3 | 79,411,389 | 78,485,270 | **−1.17%** |

隠れセル監査: **FAIL 0 件 / WARN 0 件 / PASS（exit 0）**。閾値・分母は一切緩めていない。

測定器（すべて本 Action で追加。`../aipura_nox/` は読み取りのみ）:

| ファイル | 役割 |
|---|---|
| `phase16_action11_decouple.ts` → `phase16_action11_decouple_out.json` | ハーネスと同一 CASES/build でセル単位トレース（`basicScore`/`b1Permil`/`fanFactorPermil`/`randPermil`/`critFactorPermil`/`gainedScore`）を吐く |
| `phase16_action11_weightfit.ts` → `phase16_action11_weightfit_legacy.json` | レーンごとに `E_i[attr]=Σ deck[attr]·liveStatusMultiplierPermil(snap,attr)/1000`（バフ込み）と `Y_i=Σ basic·(pop/gained)·(140/8)`（実測が要求する素点）を集計 |
| `phase16_action11_beatfit.ts` → `phase16_action11_beatfit_legacy.json` | **レーン横断でビートごとに 1 本**の線形式 `Σpop_b = (8/140)·Σ_attr w'_attr·G_b[attr]` を立てる（ポップのレーン割当に依存しない） |
| `phase16_action11_crit_split.ts` | レーンごとにクリ／非クリへ層別した `sim/pop` 比 |
| `phase16_action11_window_probe.mjs` / `phase16_action11_livebonus_probe.ts` | ライボ窓走査／ライボ on-off 比較 |

---

## 1. タスク1の裁定: **ライブボーナスは発動していない**

**根拠（ファイル＋位置）**

1. `C:\Users\umaro\Documents\aipura_nox\サンプル2\live_bonus.png` を Windows OCR（`research/23_beat_score_analysis/winocr.ps1`）で読むと
   「ライブ詳細／クリア報酬／STAGE680／**ライブボーナス①**／誰かが消費スタミナ低下状態の時／ボーカルが高い2人に10段階スコア上昇効果[45ビート]／Lv5／CT:50」。
   これは `data/live_bonuses.json` の `.byQuest["qt-tower-680"][0]`（`sk-live-lba-passive_skill-033`, `condition:"someone_stamina_cost_down"`, `effects:[{type:"score_up",target:"vocal_high_2",durationBeats:45,stages:10}]`, `liveBonusLevel:5`）の
   **事前定義画面そのもの**であり、発動の記録ではない。
2. 条件 `someone_stamina_cost_down` を成立させ得る経路が S2 の編成に**存在しない**:
   - S2 の 5 枚（`サンプル2/deck.json` の `characters[].card_id` = `card-hrk-05-sail-00`, `card-skr-05-fest-00`, `card-rei-05-fest-01`, `card-chs-05-fest-00`, `card-ktn-05-fest-02`）の技能 15 件（`data/skills_master.json` の `.byCard[...]`）に `stamina_cost_down` は **0 件**。
   - `data/skills_golden.json` の photo 種別 20 件（`photo-L1-1` … `photo-L5-4`）に `stamina_cost_down` は **0 件**。T5 実測フォト名（`スコア分析サンプル/verification_data_v2.json` の `characters[].photos[].name`）で注入される golden フォトにも無い。
   - golden 全体で `stamina_cost_down` を持つのは `sk-ktn-05-wedd-00-1`（`card-ktn-05-wedd-00` の A スキル）**1 件のみ**で、S2 のデッキに該当カードは無い。
   - `サンプル2/deck.json` の `disabledSkillIds` は `null`（＝無効化で消えているわけではない）。`myPhotos` は `uph-lane3-3` 1 件で、その効果は `someone_critical_coeff_up` 条件の `score_up`（`stamina_cost_down` ではない）。
3. `npx tsx research/23_beat_score_analysis/phase16_action11_livebonus_probe.ts`（ライボを強制 on/off して総合比較）→ **発動 0 件・総合は同値**。
4. 45 ビート窓（ボーカル上位 2 人 = L5 119,535 / L3 118,235）を全ビート走査しても、pop に 10 段階ぶんの段差は現れない（`phase16_action11_window_probe.mjs`）。

→ **裁定: 未発動。** S2 の −3.65% はライボ由来ではない。以降の分解はライボ抜きで行う。
（`stage.live_bonus_check` は既存サンプルの記録に従い、本 Action では変更していない。）

---

## 2. タスク2: レーン依存の素点因子 — **線形な重みでは説明できない（単一因子に絞れない）**

### 2.1 実測比（`sim/pop`、beat 素点セルのみ・skill 発動セル除外・pop≥3000）

`sim/pop` は「sim が実測の何倍か」。**1.000 未満 = sim 不足**。

| | L1 | L2 | L3 | L4 | L5 |
|---|---:|---:|---:|---:|---:|
| **S2**（属性 vocal/vocal/vocal/dance/vocal, w=[600,250,150]） | 0.9968 | 0.9493 | 0.9407 | **0.8282** | 0.9131 |
| **S2 非クリ分**（n=129/137/41/134/130） | 1.0007 | 0.9499 | 0.9790 | 0.8273 | 0.9085 |
| **S2 クリ分** | 0.9813 | 0.9460 | 0.9347 | 0.8356 | 0.9409 |
| **S1**（vocal/dance/vocal/vocal/vocal, w=[600,250,150]） | 1.0715 | 1.1309 | 0.9997 | 1.0868 | 1.1448 |
| **S1 非クリ分**（n=69/55/16/63/84） | 1.0409 | 1.1180 | 1.0017 | 1.0674 | 1.1417 |
| **S3**（visual/vocal/visual/visual/visual, w=[500,300,1200]） | 1.0520 | 0.9356 | 1.0376 | 0.9192 | 1.0589 |
| **S3 非クリ分**（n=132/116/103/139/140） | 1.0464 | 0.9217 | 1.0315 | 0.9197 | 1.0603 |

**事前解析メモ（`phase16_action11_preanalysis.md`）の「S1 のレーンは ≈1.00」は否定された** —
S1 の beat 素点は L3 以外の 4 レーンで sim が +4〜+14% 高い（S1 の総合が +0.25% なのは、
L3 の巨大な A/SP セルとビート以外の要素が打ち消しているため）。

### 2.2 レーン割当に依存しない検定（最重要）

5 レーン合計で見ると（`phase16_action11_beatfit.ts`、ポップのレーン割当を一切使わない）:

| | 5レーン合計 sim/pop | 10ビート帯ごとの比 |
|---|---:|---|
| S1 | **1.0555** | 1.043〜1.077（時間構造なし） |
| S2 | **0.9300** | 0.940 → 0.903（b100〜120）→ 0.903〜0.946 |
| S3 | **0.9955** | 0.976〜1.005（時間構造なし） |

S1 と S2 は **同一の `beatWeightsPermil=[600,250,150]`** なのに、ビート素点の合計が
逆向き（S1 は sim 過大・S2 は sim 不足）にずれる。→ **ズレは「レーン依存」だけではなく、
デッキ構成に依存する項を必ず含む**（S1 は vocal 偏重、S2 は visual 偏重）。

### 2.3 反証した仮説（すべて数値付き）

| 仮説 | 検定 | 結果 |
|---|---|---|
| レーン別ファン係数 | `--mode=lanefans` で `laneFanFactorPermil=[1539,1570,1574,1565,1569]`（S2、全体 1563） | **棄却**（レーン間 ≤1.5%。L4 の −17% を説明不能） |
| per-lane の一律倍率（属性補正・ファン・b1 全体） | S2 の A/SP セル比 b148 L3 1.000 / b10 L3 1.000 / b14 L4 0.987 / b88 L4 1.039 / b5 L2 1.015 | **棄却**（スキルノートは一致＝レーン一律の係数ではない。beat ノート固有） |
| 固定の重みベクトル `Σ deck·w'` | 3 サンプル別 LSQ rms = S1 3.19% / S2 4.70% / S3 6.60%、プール S1+S2 7.69% / 3 本 51.4%。解は不安定・負値（S1 583.5/**−426.4**/887.9 等） | **棄却**（セル単位のノイズ床は約 0.5%。2.3〜7.7% は実モデル誤差） |
| ポップのレーンラベルが position 由来（順列） | 全 120 順列を探索、共通 π で最小 rms。ベスト S1 6.61% / S3 6.08% | **棄却**（恒等を有意に下回る π が無い。5 レーン合計のズレは順列不変なので元から説明不能） |
| 「自分の属性 vs 残り 2 属性」の重み（未知 3） | S1+S2 で rms **6.28%**、S3 単独 16.9% | **棄却** |
| 無重み和・最大/中央値属性・属性ローテーション・「own=600 で他は据え置き」 | 各々計算 | **棄却** |
| per-lane の b1 定数オフセット | S1 の L1/L2/L4/L5 はすべて `pct.beat=60`（エール 6% のみ、beat_score フォト無し）で **b1 が 1060 で完全に同一**なのに、必要倍率は 1.0409 / 1.1180 / 1.0674 / 1.1417 | **棄却** |
| ビートあたり定額加算（§2.5 の `beat_score: fixed` フォト） | S2 L4 の同定額 1,150 は素点 127,249 の 0.9%。実測の不足は +20.9% | **棄却** |
| 重みの誤り（デッキ 3 属性の線形結合）一般 | 上記 LSQ 群 + `phase16_action11_beatfit.ts` のビート単位フィット（rms S1 2.26% / S2 2.68% / S3 2.06%、正規化重み S1 511/−389/878、S2 482/370/148、S3 228/142/630 で**サンプル間で矛盾**） | **棄却** |

### 2.4 生き残る唯一の記述と、その限界

- 生き残る記述は 1 つだけ: **「ビートノートにだけ掛かる、レーンごとに一定の倍率」**。
  根拠: `Δ_c = b1_sim_c × (pop_c/gained_c − 1)` の平均がレーンごとに一定で、
  標準偏差（S1 −60.8±45.5 / −120.5±29.2 / −79.2±31.9 / −134.0±30.0、S2 +1.6/+67.4/+69.6/+280.6/+119.6）
  は乱数ノイズ（rand ±5% × b1 ≒ ±40〜50‰）と同程度 ＝ 時間変化しないレーン定数。
  A/SP/フォトのセルが ≈1.00 なので、作用点は **beat ノートの経路**に限定される。
- しかし **その「倍率」を生む量は特定できなかった**。エンジン側で「レーン定数かつ beat ノート専用」なのは
  `src/timeline/buffs.ts` L514-551 の `b1Permil` のうち `scoreBonusPct.beat` のみ（`active`/`special`/`passive` は
  スキルノート専用で、そちらは一致している）。ところが `pct.beat` は
  `src/sim/build.ts` L702-717 で `yell.beat_score_pct + maxScorePct(equipment,"beat_score") + scoreGrants.beat_score` と組まれ、
  - sim 側の `pct.beat` はデッキ実データと完全一致（S1 60/60/253/60/60、S2 267/237/253/266/216、S3 60/60/309/253/60）、
  - 実測が要求する値（S2 ≈268.6/304.4/322.6/546.6/335.6、S1 ≈−0.8/−60.5/254.7/−19.2/−74.0、S3 ≈10.0/140.2/262.0/366.2/0.7）は
    どのフォト集計（最大／合算／先頭）でも再現できない。
  加えて 2.3 のとおり S1 の同一 b1 4 レーンが反例になる。

→ **結論: 「レーン依存の素点因子」は実在し、かつ『beat ノート専用のレーン定数倍率』という形までは
絞り込めたが、1 つの機構名（重み／pct.beat／λ のいずれか）には特定できなかった。**
デッキ 3 属性の任意の線形結合が棄却された以上、原因は (a) 素点式の**関数形**が 3 属性の線形結合でない、
または (b) デッキ 3 属性以外の入力（レーン識別子そのもの）が効いている、のいずれかである。

### 2.5 次に必要な観測（これが取れれば決着する）

現在の 15 観測（3 サンプル × 5 レーン）は「デッキ 3 属性」と「レーン識別子」が完全に交絡していて、
3〜4 未知に対して自由度が足りない。決着には次のいずれかが必要:

1. **同一デッキを別レーンに置いた実測**（例: S2 の編成を L2↔L4 入れ替えて撮影）。
   素点の式がレーン識別子に依存しないなら倍率は不変、依存するなら移動する。
2. **1 属性だけを変えた実測**（同一カード・同一フォトで、属性一致レーンと不一致レーンに置く）。
   本 Action では S2 L4（dance 属性レーン）が唯一の非 vocal レーンで、かつ最大のズレ（0.827）を持つ。
   ここが「属性一致＝own の扱い」の切り分け点になる。
3. 実測側の裏取り: `beat_gained_score`（5 レーン合計・独立測定）と Σpop の比は
   S1 1.018 / S2 1.022 / S3 1.028 で閉じており、ポップ記録は健全（AGENTS.md の n=5 層別化規律に適合）。
   ただしこれは「合計が合う」ことしか示さないので、上記 1・2 の撮影が本質。

---

## 3. タスク3: L3 の b≈100 の −10% 段差 — **原因はクリティカル係数（素点ではない）**

`phase16_action11_crit_split.ts` と `tmp_step_probe.mjs`（一時）による L3 の生値:

| beat | pop | sim | sim/pop | basic | b1 | fan | crit |
|---:|---:|---:|---:|---:|---:|---:|---:|
| b89 | 56,400 | 57,375 | 1.017 | 9,354 | 1253 | 1564 | 2504 |
| b93 | 59,000 | 57,375 | 0.972 | 9,354 | 1253 | 1564 | 2504 |
| b101 | 23,800 | 24,334 | 1.022 | 9,354 | 1253 | **1661** | 1000 |
| b102 | 66,700 | 56,973 | **0.854** | 9,716 | 1253 | 1661 | **2254** |
| b103 | 26,800 | 26,287 | 0.981 | 9,716 | 1253 | 1661 | 1000 |
| b117 | 25,700 | 26,287 | 1.023 | 9,716 | 1253 | 1661 | 1000 |

- b100 に L3 の A（`sk-rei-05-fest-01-2`）と P（`sk-rei-05-fest-01-3`）が同時発動し、
  sim では basic 8,871→9,716・fan 1564→1661 へ上がる一方、**critFactorPermil は 2504→2254 へ下がる**
  （`critical_coeff_up` 段数 15→10 段。`CRITICAL_COEFF_UP_PER_STAGE_PERMIL=50` / `CRITICAL_BASE_PERMIL=1500`、
  `src/formula/critical.ts` L19-42）。
- L3 を crit 値で層別すると:

| L3 の critFactorPermil | n | Σpop | sim/pop |
|---|---:|---:|---:|
| 1000（非クリ・全期間） | 41 | 1,015,800 | **0.9790** |
| 2504（b89〜b101） | 27 | 1,545,200 | **0.9778** |
| 2254（b102〜） | 73 | 4,648,000 | **0.9258** |
| 1854 | 6 | 306,000 | 0.8519 |

**非クリセルは段差の前後で 0.9790 のまま**（b94-b99 も b103/b105/b117 も同じ層）。
段差は **crit=2254 のセルにだけ**現れ、crit=2504 では現れない。
実測が要求する crit 係数は 2254 × 0.9790/0.9258 ≈ **2383**（sim 比 +5.7%）。

→ **タスク3の段差は「クリティカル係数の段数依存」の問題であり、タスク2の素点問題とは別機構**。
段差の位置（b≈101/102）は `critical_coeff_up` の段数が動いたビートと 1 ビート以内で一致する。
（なお S2 L3 のクリ係数は `pct.beat` とは無関係で、非クリセルには影響しない。）

---

## 4. タスク4: 修正は行わない（機構誤りが証明できなかった）

- タスク2: 素点式が「デッキ 3 属性の線形結合」である限り、どの重みでも実測を再現できない
  （最小 rms 2.26%、ノイズ床 0.5%）。**誤りであることは確かだが、正しい式が特定できていない**ので
  コードを書き換える根拠がない。当てずっぽうの係数変更は S1/S3 を同時に悪化させる
  （ビート単位フィットの重みがサンプル間で矛盾: S1 511/−389/878 vs S2 482/370/148）。
- タスク3: クリ係数の +5.7% は候補だが、(a) `critical_coeff_up` の段数 15→10 という遷移は
  スキル定義（`critical_coeff_limit` / `critical_coeff_up` の段数合算）から自然に出ており、
  (b) 同じ層の別サンプル（S1 の crit=2081 は 0.9997 で一致、S3 の crit=1620 は層別 n が小さく判定不能）で
  再現しないため、**「段数集約則の誤り」と断定できない**。段数集約（max か sum か、`_limit` の扱い）を
  確定するには、クリ係数だけを狙った実測（同一レーンで段数が段階的に変わるライブ）が必要。
- したがって **本 Action では `src/` を一切変更していない**。

---

## 5. ゲート（コード無変更のため基準値の再確認）

| ゲート | 結果 |
|---|---|
| 1. S2 \|dev\| | 3.65%（未改善。修正なしのため現状維持） |
| 2. S1 \|dev\| ≤1% | **+0.25%** ✓ |
| 3. S3 \|dev\| ≤3% | **−1.17%** ✓ |
| 4. T5 ゴールデン | 不変（`src/` 無変更） |
| 5. `npx vitest run` | **41 files / 519 passed, 1 skipped** ✓ |
| 6. `npm run typecheck` | **エラー 0** ✓ |
| 7. `npm run audit:hidden` | **PASS / FAIL 0 / WARN 0（exit 0）** ✓ |

---

## 6. 成果物

- `research/23_beat_score_analysis/phase16_action11_report.md`（本ファイル）
- `phase16_action11_decouple.ts` + `_out.json`（`_lanefans.json`）
- `phase16_action11_weightfit.ts` + `_legacy.json`
- `phase16_action11_beatfit.ts` + `_legacy.json`
- `phase16_action11_crit_split.ts`
- `phase16_action11_window_probe.mjs` / `phase16_action11_livebonus_probe.ts`
- `phase16_action11_models_S1S2S3.txt`（受け入れハーネス実行ログ）
- `research/12_implementation_log.md` 追記 / `prompts/readme.txt` 完了行
