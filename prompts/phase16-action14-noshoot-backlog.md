# Phase 16 アクション14（次セッション用の手順書・**再撮影なしで進められる残タスク**の束）

作成: 2026-10-07（A13 完了コミット `b0ad71c`・記録コミット `05d9d8e` の直後）。対象: どのエージェントでも可。
ただし **`src/` を触る可能性があるので同時実行は 1 エージェントのみ**（`engine.ts`/`buffs.ts` を触るなら特に）。

前提: **新規撮影は一切しない**（`../aipura_nox/` は読み取り専用。撮影が要る作業は §8 に隔離）。
A13 の手順書 `prompts/phase16-action13-buff-reconciliation.md` の **§5（5.1〜5.5）がそのまま残っている**ので、
本ファイルはそれを「タスク A」として再掲し、**A13 で新たに出た残り（タスク B）**を追加したもの。
A13 で決着した項目は §1 に「前提として疑わないこと」として固定してある（蒸し返さない）。

---

## 0. 最初に読むもの・現状の基準値

読む順: `AGENTS.md` → `prompts/readme.txt` → 本ファイル → `research/23_beat_score_analysis/phase16_action13_report.md`（A13 の裁定）。

**基準値（2026-10-07・commit b0ad71c。作業開始時にこの 3 つを 1 回だけ再検証する）**:

```powershell
npx vitest run                                                  # 42 files / 526 passed・1 skipped
npm run typecheck                                               # 0
npx tsx src/cli/simulate.ts --input examples/t5-sample.json --n 0 --crit-rate 0   # 2,581,114,209
npm run audit:hidden -- --low-gate=warn                          # 上側 FAIL 0 / WARN 0 = PASS
```

- 総スコア口径（legacy）: **S1 +0.250% / S2 −3.354% / S3 −1.166%**（lanefans: −2.04% / −3.66% / −2.50%）
- `npm run audit:hidden`（下側込み）: FAIL 2 件 = **S2 L3 0.19×・S3 L3 0.04×**／WARN 2 件 = S2 L4 0.31×・S3 L2 0.45×
  → 下側 FAIL は exit 1 を返す。上側のみの受け入れ判定は `npm run audit:hidden -- --low-gate=warn`

## 1. 前提として疑わないこと（A13 で確定・蒸し返さない）

1. **超化（`capExtend`） = 基本キーへの +5段（+250‰）修飾子**。マスタ `efficacyId` が
   `ef-add_effect_value_<基本キー>-10`（値 10 は 25‰ 単位のダミー）で、`ef-limit_break_*`（上限開放）とは別 ID。
   寿命は自分の `[Nビート]` を持つ**独立インスタンス**（`effect_extension` の対象）で、
   **基本キーの段数が 0 の間は加算しない**（gate）。実装は `src/timeline/buffs.ts` の `extendStages`＋ループ後の合算。
   検定は H1(18段)=7.8σ・H2(8段)=9.7σ で棄却、H3(13段) 採用（`phase16_action13_report.md` §1・§2）。
2. **表示規約の罠**（すべて実測で確認済み）: 実機パネルは**発動ビートから**行を出す／sim の `buffSnapshots` は
   **そのビートのスコア計算に使った値**（A/SP は精算がスコア計算の後）＝ A/SP 付与の行は実機が 1 ビート先行。
   超化行の表示段数 `10` は**ダミー**。`/クリティカル係数/` の正規表現は超化行にも当たるので**完全一致**で引く。
3. **S2 の超化行が b15–87 に出ないのは抽出漏れではない**（A13 で決着）。pop 逆算も b51–87 = 7.9段（+5 なし）、
   b15–43 = 12.9段（+5 あり）で一致し、行データと矛盾しない。**罠 1 は解決済み**。
4. **口径**: legacy（`analyze_beat_score_models.ts` 系）と lanefans（`audit_hidden_cells_sim.ts` 系）は混ぜない。
   正しい口径は「A4 表引き + focus/stealth 動的項」で**どちらのハーネスも未実装**（A12 の裁定）。受け入れは legacy。
5. `sp_skill_score_up`（`sk-skr-05-fest-00-3`・`someone_before_special`・`[Nビート]` 表記なし）の
   実機 b90–167 vs sim b90–93 は**スコア影響 0**（行の寿命のみの【Unknown】→ タスク B1）。
6. `critical` 系は `_extreme` キーを持たず `capExtend` 経路（属性上昇は `*_up_extreme` の独立キー）だが、
   **どちらの経路も「基本 0 では加算しない」で一致**している（属性側は A13 以前からの規則 → タスク B3 で回帰テスト化）。

## 2. タスク A（A13 手順書 §5 の残り・優先順）

### A1. S3 L3 の「隠れ 3 セル」＝ 下側ゲート 0.04× の正体【最優先・これが下側 FAIL を消せる唯一の筋】

A12 の下側ゲートは S3 L3 を **0.04×（sim 116,039 / 隠れ枠 2,635,445・未説明 1,731,274）**とした。
可読セル比は 1.050＝**可読セルは過剰なのにレーン合計を 9.4% 説明できていない**＝不足は 3 つの未読セル側。

- やること: 該当 3 セル（ビート × レーン）を特定し、sim の因子（素点・crit・fan・combo・スキル）を全部ダンプ。
  **同じビートの他レーン**と比べる（S3 は 5 レーン分の実測があり、同時刻の A/SP セルが対照になる）。
  読めなかった理由（遮蔽・非表示）も `measured_data_v3.json` の `missing_frames` / `supplement` から引く。
- 判定: (a) sim の不足（機構の誤り）／(b) 実測の読み（K 表記・遮蔽）／(c) レーン割当のずれ（罠 2）。
  **(b) ならゲートの除外条件を精緻化する（上側の閾値・分母は絶対に動かさない）**。
- 成果物: `research/23_beat_score_analysis/phase16_action13_s3_l3_cells.md`（セル表＋因子＋裁定）。

### A2. S2 の SP 1 セル（不足 707,502）と A セル（b10 L3 Δ −151,321）

実測 29,500,000 に対し sim 28,792,498（**pop 可読＝ノイズ源が少ない最良の的**）。
SP は `score_get_by_score_ratio` 系の連鎖を持つので、同セルの A セル（28,851,076 / 29,073,700）と併せて
**累積スコア比の適用順序**を疑う（`state.scoreCumAtSkillStart` = A/SP/フォト/ライブボーナス開始時点の累積、
`score_get_by_score_ratio` の参照点が「自身の効果適用前」か「他スキル適用後」か）。
S2 の不足内訳（A12）: beat 可読 1,604,279 / beat 隠れ 528,268 / A 222,624 / SP 707,502（lanefans 口径）。

### A3. レーン別オフセット＝デッキ入力の検証（A11 の未解決項）

A11 は「beat ノート専用のレーン定数倍率」まで絞った（重みの数値では説明不能）。再撮影なしで試せる残り:

- 各レーンの**デッキ素ステータス**を `deck.json` の `stats` / `data/card_parameters.json` /
  `communication_levels.json` / フォト・アクセから**再計算**し、sim が使っている値と比較する
  （1 レーンでも入力がずれていれば「レーン定数倍率」の正体になる）。
- λ（8/140）と属性重み [600,250,150] を 15 レーンで**分離して**解く（A11 は重みだけをフィットした）。
- 期待: 原因が判明すれば A11/A12 の最大の未解決項が消える。判明しなければ**数値で棄却して記録**。

### A4. 可読セル比を正式なゲートに昇格

A12 で `sim(可読)/Σpop` を診断列として出した（S2 L3 = 0.966・S3 L3 = 1.050 など）。
15 レーンの分布から閾値を決め、`tools/audit_hidden_cells.mjs` の**検査 3** として追加する。
**上側（≥2.0 FAIL / ≥1.5 WARN）と下側（≤0.25 FAIL / ≤0.5 WARN）の分母・閾値は動かさない**。

### A5. 正しい fan 口径の予測計算（`src/` 無変更）

A12 の裁定は「正しい口径 = A4 表引き + focus/stealth 動的項」で、現存 2 ハーネスはどちらも未実装。
**engine を変えずに**、lanefans の per-cell スコアに `+ focusFanBonusPermil(snap.focus) + stealth` を
オフラインで適用して S1/S2/S3 の総スコアを予測する（`phase16_action12_focusprobe.ts` の資産を再利用）。
→ 修正したときの受け入れ値が先に分かる（A12 の概算では S2 が −3.94% → −3.79% 程度で目標未達）。

## 3. タスク B（A13 で新たに出た残り）

### B1. S2 L3 `sp_skill_score_up` の寿命（実機 b90–167 vs sim b90–93）

`sk-skr-05-fest-00-3`（`someone_before_special`・`[Nビート]` 表記なし）が実機では b90–167 に出続ける。
**スコア影響は 0**（A12 で確認済み）だが行の寿命が【Unknown】のままなので、再撮影なしで決着させる:

- マスタ（`vendor/Skill.json` の `levels[].description` と `skillDetails[].efficacyId`）を読み、
  持続ビートの指定が本当に無いのか確認する（`ef-...-<N>` の末尾にビート数が入る系列かどうか）。
- 同種の SP 行を S1/S3 でも探す（`sp_skill_score_up` の窓が実機と sim で何ビート違うか）。
- 決着しない場合は「実機は b90–167・sim は b90–93・スコア差 0」を【Unknown】として明記（**当てずっぽうの式は書かない**）。

### B2. 孤立窓 b95–100 の再検証（A13 の【Unknown】1）

A13 では b95 = 14.4段 / b97 = 4.2段（各 n=1）・b100 の A セル = 0 ± 0.35段 で、**per-cell の散らばり ±2〜3段**のため
単セルでは 0/5/13 を分離できなかった（gate は S3 stat 26 セルと b100 で採用）。

- 改善案: (a) `_a13_gammafit.mjs` の γ を**ビートごとに複数レーンから**取る（現在は 4 レーン平均）／
  (b) 実機の **`critical_rate_up` 行**（b95–100 で 7 = 基本 2 + 5 の形）を独立な証拠として突合する／
  (c) 同じビートの A/SP セル（flat 加算あり・§7 の罠 5）を式から除いて推定する。
- 期待: b95/b97 のどちらかが 0 または 5 に落ちれば gate の追加証拠になる。落ちなければ【Unknown】のまま据え置き。

### B3. `*_up_extreme` と `capExtend` の gate 同一性を回帰テスト化

S3 の `visual_up_extreme`（属性上昇の超化キー）は b40–50 / b98–110 で素のデッキ値 305,202 と厳密一致（26 セル）
＝ 基本 0 では加算しない。A13 で **capExtend 経路にも同じ gate** を入れたので、
**両経路が同じ規則であること**をユニットテストで固定する（`tests/unit/timeline/` に 1〜2 件）。
S3 の 26 セルは実測データを読む統合テストにはしにくいので、合成入力（visual_up 0 + 超化）で表現する。

### B4. `NAME_TO_BUFF_KEY` 追加の影響確認（A13 で 2 箇所の表を直した）【A13 で実行済み・残りは S2/S3】

- `tools/analyze_beat_score_models.ts` L1327 は `simEffects[k]` を引くだけ（**スコア経路は非依存**）。
  `@capExtend:*` / `@limitRelease:*` は `simEffects` に無いので「不一致」として計上される（従来も不一致）。
- `tools/audit_s1_b136_step11.ts` L180 は「表に無い行」を未知名として出すので、超化・上限開放の行が
  **未知名リストから消える**（意図どおり）。
- **2026-10-07 に実行済み**: `npx tsx tools/audit_s1_b136_step11.ts` → exit 0・出力
  `research/26_data_integrity/s1_b136_step11_audit.json` は**コミット済みの版とバイト一致**（S1 の b130–145 窓には
  超化・上限開放の行が無いため差分ゼロ）。→ **残りは S2/S3 の行を含む窓で同じ確認をするだけ**
  （`analyze_beat_score_models.ts` 側は行突合の集計のみでスコアに影響しないことを確認して記録する）。

## 4. ゲート（`src/` を触った場合のみ・A12/A13 の規律を継承）

- `npx vitest run` 全件 pass（現状 42 files / 526 passed・1 skipped）
- `npm run typecheck` 0 エラー
- **T5 ゴールデン `2,581,114,209` 不変**
- S1 |≤1%|・S3 |≤3%| を維持（現状 +0.250% / −1.166%）
- S2 の |乖離| が縮むこと（**現状 −3.354%**。目標 2.0% 以内）
- `npm run audit:hidden -- --low-gate=warn` の**上側 FAIL 0 を維持**（閾値・分母は絶対に緩めない）
- **下側ゲートの FAIL を消す場合も閾値・分母は動かさない**。消せない場合は「なぜ消せないか」を数値で書く
- 変更した機構には単体テストを追加（A13 の `choka-cap-extend.test.ts` が前例）

## 5. 成果物

- タスク A1: `research/23_beat_score_analysis/phase16_action13_s3_l3_cells.md`（A13 手順書の名前を踏襲）
- タスク A2〜A5: それぞれ `research/23_beat_score_analysis/phase16_action14_*.{ts,json,md}`
- タスク B: 同上（B3 は `tests/unit/timeline/`、B4 は `research/26_data_integrity/` の監査 JSON 再生成）
- `research/12_implementation_log.md` への追記 + `prompts/readme.txt` の完了行（コミットハッシュ付き）+ コミット

## 6. 再現コマンド

```powershell
# バフ行の一致率表（実機 ⇔ sim。A13 の成果物を再生成）
npx tsx research/23_beat_score_analysis/phase16_action13_buff_rows.ts S1,S2,S3 --mode=legacy
# 総スコア口径の乖離（legacy / lanefans）
npx tsx research/23_beat_score_analysis/phase16_action12_cellcmp.ts S1,S2,S3
# pop 逆算（γ 補正つき。入力は A13 の cells ダンプ）
node research/23_beat_score_analysis/_a13_gammafit.mjs research/23_beat_score_analysis/_a13_cells_s2_legacy.json S2 3
# 実機のバフ行（完全一致で引くこと）
node -e "const j=require('../aipura_nox/サンプル2/measured_data_v3.json');const L=j.timeline.find(e=>e.beat===90).lanes['3'];console.log(L.effects)"
# 受け入れゲート
npm run audit:hidden -- --low-gate=warn ; npm run audit:hidden
```

## 7. 既知の罠（A13 で更新）

1. ~~S2 の `effects` は抽出漏れがある疑い~~ → **解決済み**（§1-3。超化行が b15–87 に出ないのは実機どおり）。
   S2 v3 に `lanes` キー `2` が無い件は A13 でも未検証（S2 L2 は staged バフを持たない構成なので実害なし）。
2. `deck.json` の `lane` フィールドと実レーンの対応は**鵜呑みにしない**（`results.scores_by_lane` と突き合わせる）。
3. `/クリティカル係数/` の正規表現は `クリティカル係数上昇超化` にも一致する。**完全一致**で引く。
4. `src/` の超化は 2 系統ある（属性上昇の `*_up_extreme` 独立キー／`capExtend` による基本キー加算）。
   **どちらも「基本 0 では加算しない」**（A13 で統一。§1-6・タスク B3）。
5. A12/A13 の pop 逆算は beat ノートの flat 加算が 0 であることを前提にしている
   （`engine.ts` は A/SP にだけ `aScoreFlat` を足す）。**A/SP セルには同じ式を使わない**。

## 8. 撮影が必要なので**やらない**こと（保留リスト）

- S4/S5 のポップ遡及取得（S4 は 2026-09-05 に全面無効化済み・S5 は `deck.json` が無い）
- 同一デッキの別レーン実測／満員会場で focus 段数を振った実測／**超化の再発動を含む実測**
  （同時生存時の加算則 sum/max・段数が上限に到達する場面の観測）
  → いずれも `prompts/measure-new-sample.md` §10・§11 に依頼済みの形式で書くだけ。**自分で撮らない**

## 9. 制約（A12/A13 から継承）

- `../aipura_nox/` は**読み取り専用**・**新規撮影禁止**（既存ファイルの削除・改名・上書きもしない）
- **閾値・分母を緩めない**（`tools/audit_hidden_cells.mjs` の上側 ≥2.0 FAIL / ≥1.5 WARN、
  下側 ≤0.25 FAIL / ≤0.5 WARN は固定）
- 推測実装には【Estimate】/【Unknown】。読めない値は null + 注記（捏造禁止）
- 失効値を使わない（A7 の +37.10%・b90 2.15×・63,317,124／9b の S2 +37.40%／事前解析の「S1 のレーンは ≈1.00」）
- 進捗をチャットに書かない（途中結果は `research/` のメモ・JSON・ログへ）
- 暴走防止: 連続 60 ツール呼び出し / 約 2 時間
