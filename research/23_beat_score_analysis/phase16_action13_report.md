# Phase 16 Action13 裁定: 超化（capExtend）の意味と engine の修正

作成: 2026-10-07（A13）。対象: `src/timeline/engine.ts` / `src/timeline/buffs.ts` を変更した唯一のアクション。
本ファイルは `phase16_action13_buff_rows.ts` が生成する `phase16_action13_buff_rows.md` の末尾に
そのまま取り込まれる（ハーネスを再実行しても裁定が残るようにするため）。

---

## 1. 裁定（結論）

**超化（`capExtend: true`）は「基本キーへの修飾子」である。**

| 項目 | 確定内容 | 根拠 |
|---|---|---|
| 効果量 | **一律 +5 段（= +250‰）**。マスタの値 `10` はダミー（25‰ 単位の量記法） | §2.1 efficacyId・§2.2 pop 逆算・§2.4 行突合 |
| 対象 | **基本キー**（例: `critical_coeff_up`）へ加算。engine が `*_up_extreme` の独立キーを持つ属性上昇でも、実機の意味は「基本キーへの修飾子」 | §2.1（`ef-add_effect_value_visual_up-10` = `visual_up` の修飾子） |
| 寿命 | **自分の表記 `[N ビート]` の独立インスタンス**（基本インスタンスの寿命に従わない）。`effect_extension` の延長対象 | §3（実機の行の窓が基本行と独立・+10 延長で伸びる） |
| 加算の門（gate） | **基本キーの段数が 0 の間は加算しない**（超化だけ生きているビートでは効果なし） | §2.3（S3 stat 26 セルが厳密一致）・§2.2（S2 b100 の A セル = 0 ± 0.35 段） |
| 上限拡張 | engine 側は従来どおり「上限 +`LIMIT_RELEASE_STAGE_CAP`(30) 段」と「同名インスタンスの上限は最大値を採用」。**3 サンプルでは上限に到達しないため実測での検証は不能**【Unknown】 | §5 |

検定した 3 仮説の結果（S2 L3 の pop 逆算・保守的 sd 2.5 段で評価）:

| # | 仮説 | 予測 | 判定 |
|---|---|---|---|
| H1 | 独立キーとして表示値 10 を加算 | 8+10 = 18 段 | **棄却**（b101–127 推定 13.55 ± 0.57 → 7.8σ 外れ） |
| H2 | 上限拡張のみ（係数は基本 8 のまま） | 8 段 | **棄却**（同 9.7σ 外れ） |
| H3 | 基本に対する +5 段で寿命だけ独立 | 13 段 | **採用**（同 0.96σ・b15–43（0.2σ）/ b151–167（1.2σ）でも整合） |

→ 機構の誤りが確定したため `src/` を修正した（§6）。

## 2. 実測根拠

### 2.1 マスタの efficacyId（機構の一次情報・決定打）

`vendor/Skill.json` の `skillDetails[].efficacyId` は 3 系統を**別 ID** で表す:

| 系統 | efficacyId の例 | 意味 |
|---|---|---|
| 通常行 | `ef-visual_up-4-target-...` | `visual_up` を **4 段** |
| 超化 | `ef-add_effect_value_critical_bonus_permil_up-10-target-character_type-1-1-31` / `ef-add_effect_value_visual_up-10-target-self-26` | **基本キー `critical_bonus_permil_up` / `visual_up` への修飾子**・値 `10`（25‰ 単位 = 250‰ = **5 段**）・末尾は `[N ビート]` |
| 上限開放 | `ef-limit_break_visual_up-10-...` | **上限開放**（`10` = 上限 +10 段）。超化とは別 ID |

`add_effect_value_<KEY>` という命名自体が「`<KEY>` の値に加える」＝修飾子であることを示す。
`[N ビート]` が独立に付くので**寿命も独立**。S2 の A スキル `sk-chs-05-fest-00-1` は
`ef-add_effect_value_critical_bonus_permil_up-10-...-31`（= 超化 +5 段・31 ビート）、
`sk-ktn-05-fest-02-1` は `ef-limit_break_visual_up-10` + `ef-visual_up-4`（= 上限開放 + 基本 4 段）。

### 2.2 S2 L3 の pop 逆算（γ 補正つき・`_a13_gammafit.mjs`）

同一ビートの非対象 4 レーンの pop/sim から共通の乱数係数 γ を出し、
`crit = crit_sim × q_target / γ` → `段数 = (crit − 1500 − critExtras) / 50` で要求段数を推定:

| 窓 | n | 推定段数 | sim（修正後） | 判定 |
|---|---:|---:|---:|---|
| b15–43（超化 1） | 22 | **12.9** | 13 | H3 と 0.2σ 一致 |
| b51–87（超化なし） | 19 | **7.9** | 8 | 一致 |
| b89–94（超化・基本末） | 4 | **11.8** | 13 | 一致（境界） |
| b101–127（超化 2） | 19 | **13.55** | 13 | H3 と 0.96σ・H2 を 9.7σ・H1 を 7.8σ で棄却 |
| b130–146（超化なし） | 12 | **7.75** | 8 | 一致 |
| b151–167（超化 3） | 14 | **13.79** | 13 | H3 と 1.2σ・H2 を 8.7σ で棄却 |
| b95 / b97（孤立窓） | 1 / 1 | 14.4 / 4.2 | 0 | **判断不能**（§5-1） |
| b100（A セル・高精度） | 1 | **0 ± 0.35** | 0 | gate を支持（+5 なし） |

### 2.3 S3 の stat 系列（同じ `add_effect_value` ファミリの独立検証）

S3 L3/L4 の `visual_up_extreme`（engine 側の超化キー）は b40–50 / b98–110 で
**素のデッキ値 305,202 と厳密一致（26 セル）** = 基本の `visual_up` が 0 のビートでは
超化分（5 段 = +250‰）が乗っていない。**gate の直接的証拠**。

### 2.4 行の突合（`phase16_action13_buff_rows.md` §一致率表）

超化行を「基本キーへ +5 合算・基本行が無ければ加算なし」として畳んだ**実効値**比較:

| サンプル | キー | セル | 両方あり | 平均差 | Σ\|差\| | 最大\|差\| |
|---|---|---:|---:|---:|---:|---:|
| S2 | `critical_coeff_up` | 149 | **148** | **−0.07** | **10** | 5 |
| S3 | `visual_up`（engine は `visual_up`+`visual_up_extreme`） | 158 | **157** | **−0.18** | **29** | 7 |
| S1 | （超化行なし＝生表と同一。キー別 Σ\|差\| は `vocal_boost` 31 / `critical_rate_up` 26 / `combo_score_up` 25 など） | — | — | ≤0.12 | 95 | 6 |

S2 の Σ\|差\| = 10・最大 5 の内訳は**表示規約の 3 セルだけ**（下記。実測 JSON から機械的に列挙できる）:

| セル | 実機の実効値 | sim | 理由 |
|---|---:|---:|---|
| b14 L3 | 13（基本 8 + 超化行 +5） | 8 | 実機パネルは A 発動ビートから超化行を出す（sim の +5 は翌ビート b15 から） |
| b88 L3 | 13（同上） | 8 | 同上（A 発動 b88） |
| b1 L3 | 0（実機の行は b2 から） | 8 | 実機の行の開始が 1 ビート遅い（表示規約・sim のみの 1 セル） |
生表（超化を別行として扱う）では S2 が平均 +2.67 段・Σ\|差\| 395 になるが、これは
「実機が超化を別行で表示する」という**表示上の都合**であって機構の差ではない。

## 3. 寿命（engine の旧実装が誤っていた点）

- 実機の超化行の窓: **b14–43 / b88–127 / b148–167**（値は常に 10 = ダミー）。
  基本行の窓: b2–44 / b51–94 / b101–144 / b151–167。
  → 超化は A スキル発動ビート（b14 / b88 / b148）から始まる**自分の寿命**を持ち、
  基本行が消えている b95–100・b148–150 でも生き残る。
- 旧 engine は「同名インスタンスのうち**最長のものへ合算**（`amplifyLongestOfKey`）＋上限だけ拡張」だった
  → 基本が消えたビートで超化も消える（実機と矛盾）・A 発動ビートの段数も合わない。
- 窓の長さ: 超化 3 つ目の窓 b88–127 は **40 ビート** = `[31 ビート]` − 1 + **`effect_extension` +10**
  （`sk-ktn-05-fest-02-2` が b100 に発動）→ **超化も延長の対象**である（engine は元から延長対象）。
- 表示規約: 実機パネルは**発動ビート**から行を出し、sim の `buffSnapshots` は
  **そのビートのスコア計算に使った値**（A/SP は精算がスコア計算の後）なので、
  A/SP 付与の行は実機表示が 1 ビート先行する。P・フォト行も実機表示が 1 ビート先行する
  （`phase16_action13_buff_rows.md` §窓比較の ±1 ビートはこれで説明でき、機構差ではない）。

## 4. 不一致の分類（プロンプト §2-1）

| 分類 | 実例 | 判定 |
|---|---|---|
| (a) sim に無い行 | S2 `@capExtend:critical_coeff_up` 90 セル / S3 `@capExtend:visual_up` 88・`@limitRelease:visual_up` 78 / S3 `@nonstaged:stamina_recovery` 132 | 超化は **基本キーへ合算される設計**（§2.4 で一致）。上限開放は engine では上限値のみ（別キー無し・意図どおり）。`stamina_recovery` は段階型でないため対象外 |
| (b) 段数違い | S2 `critical_coeff_up` 生表 +5（90 セル）→ **実効値で解消**。残りは S1 `vocal_boost` Σ31（最大 4）・`critical_rate_up` Σ26 などの 1〜4 段の少数セル | 超化は裁定どおり。残りは端数・同時発動の丸め由来で、総スコア影響は小（S1 は +0.250% 維持） |
| (c) 寿命違い | S2 L3 `sp_skill_score_up`: 実機 b90–167 vs sim b90–93（`sk-skr-05-fest-00-3` = `someone_before_special`・`[N ビート]` 表記なし・**スコア影響 0**）【Unknown】。他は上記 ±1 ビートの表示規約 | 超化の寿命は §3 で確定。SP 行は未解決として残す（A12 から継続の【Unknown】） |

## 5. 【Unknown】/【Estimate】

1. **孤立窓 b95–100 の矛盾**: b95 = 14.4 段（n=1）・b97 = 4.2 段（n=1）・b100（A セル）= 0 ± 0.35 段。
   per-cell の散らばりは ±2〜3 段あるため**単セルでは 0/5/13 を分離できない**（【Unknown】）。
   高精度の 2 証拠（S3 stat 26 セル・b100 の A セル）が gate を支持するため gate を採用した。
2. **複数の超化インスタンスが同時に生きるときの加算規則**（sum か max か）は 3 サンプルに同時生存が無く
   【Unknown】。修飾子＝キー単位の加算という機構から **sum** を採用（上限拡張は max のまま）。
3. **上限拡張の実測**: 3 サンプルとも段数が上限（20 段・上限開放時 +30）に到達しないため
   cap 拡張そのものは観測できない【Unknown】（実装は従来どおり）。
4. b51–87 の推定 7.9 段・b130–146 の 7.75 段は sim 8 段に対し −0.1〜−0.25 段低い（【Estimate】=
   推定器の系統誤差の範囲。S2 全体の −3.35% 乖離の主因はこのレベルではなく、A12 で特定済みの
   フォト/ファン口径・SP 連鎖などの複合要因）。

## 6. 変更内容とゲート結果（プロンプト §4）

変更:

- `src/timeline/engine.ts`: capExtend 専用分岐（`amplifyLongestOfKey` = 最長インスタンスへの合算）を削除し、
  通常の効果 push に `capExtend`（+ 段数）を持たせるだけにした。付与ビート・寿命・延長の扱いは通常効果と同一。
- `src/timeline/buffs.ts`: `extendStages`（キー→合計段数）を集め、**基本キーの段数 > 0 のときだけ**
  上限クランプ前に加算する（= gate）。
- テスト: `tests/unit/timeline/choka-cap-extend.test.ts`（新規 3 件: 独立寿命・+5 の算術・別インスタンス基本への再適用）、
  `tests/unit/timeline/buffs.test.ts`（超化の段数算術 4 件を追加・旧「最大インスタンス採用」テストを実測に合わせて修正）。
- `tools/analyze_beat_score_models.ts` / `tools/audit_s1_b136_step11.ts`: `NAME_TO_BUFF_KEY` に
  `クリティカル係数上昇超化` → `@capExtend:critical_coeff_up`・`*上昇上限開放` → `@limitRelease:*` を追加（2 箇所の重複表）。

ゲート:

| ゲート | 結果 | 判定 |
|---|---|---|
| `npx vitest run` | **42 files / 526 passed・1 skipped**（A12: 41 / 519+1） | PASS |
| `npm run typecheck` | 0 エラー | PASS |
| T5 ゴールデン | **2,581,114,209（不変）** | PASS |
| S1 | legacy 116,829,040 = **+0.250%**（A12 と同一・\|≤1%\|） | PASS |
| S3 | legacy 78,485,270 = **−1.166%**（A12 と同一・\|≤3%\|） | PASS |
| S2 | legacy 75,125,099 = **−3.354%**（A12 −3.65% から **0.30pt 縮小**。目標 2.0% は未達） | 縮小は達成 |
| `npm run audit:hidden -- --low-gate=warn` | 上側 **FAIL 0 / WARN 0**（PASS）。下側 FAIL 2（S2 L3 0.19×・S3 L3 0.04×）・WARN 2（S2 L4 0.31×・S3 L2 0.45×）で**A12 と同数・同値**（想定内） | PASS |
| 単体テスト追加 | 超化の寿命・段数算術を固定（上記 7 件） | PASS |

参考（lanefans 口径）: S1 114,162,150（−2.04%）・S2 74,886,541（−3.66%、A12 −3.94%）・S3 77,425,702（−2.50%）。

**S2 の縮小幅が小さい理由（機構優先の判断）**: ゲート無しなら S2 = −2.886% まで改善するが、それは
基本が 0 のビート（b100 の A セル・寄与 **+363,607**）に超化を足した分である。S3 stat 26 セルと
b100 の高精度測定が「加算しない」を示すため、**機構を優先して −3.354% を受け入れた**。

## 7. 再現コマンド

```powershell
# 1) 一致率表・分類・本裁定の再生成（ts → json / md）
npx tsx research/23_beat_score_analysis/phase16_action13_buff_rows.ts S1,S2,S3 --mode=legacy
# 2) 総スコア口径の乖離（legacy / lanefans）
npx tsx research/23_beat_score_analysis/phase16_action12_cellcmp.ts S1,S2,S3
# 3) pop 逆算（γ 補正つき・要 _a13_cells_s2_legacy.json）
node research/23_beat_score_analysis/_a13_gammafit.mjs research/23_beat_score_analysis/_a13_cells_s2_legacy.json S2 3
# 4) 受け入れゲート
npx vitest run ; npm run typecheck ; npm run audit:hidden -- --low-gate=warn
npx tsx src/cli/simulate.ts --input examples/t5-sample.json --n 0 --crit-rate 0
```

一時ファイル（`research/23_beat_score_analysis/_a13_*`）は A13 の調査用の生ログ・小道具で、
`_a13_gammafit.mjs` / `_a13_cells_s2_legacy.json` 以外は再実行で再生成できる（コミットには含めるが、
恒久ツールではない。`phase16_action13_*` が正規の成果物）。
