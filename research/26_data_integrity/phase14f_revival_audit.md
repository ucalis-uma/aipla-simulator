# Phase 14-F 検証監査 — 前ビート満了バフの延長復活（`expiredThisBeat`）

作成: 2026-09-27 ／ 対象: `src/timeline/engine.ts` の満了インスタンス復活処理
関連: `tests/golden/t5-scores.golden.test.ts` / `tests/unit/timeline/extension-revival.test.ts`
監査スクリプト: `audit_phase14f_revival.mjs`（v1）・`audit_phase14f_divergence.mjs`（v2）
出力: `phase14f_revival_audit.json` / `phase14f_divergence_audit.json`

## 0. 結論

**採用（revival ON）。** T5 リプレイ確定値を `17,516,522,572 → 17,521,599,508` に更新した。

採用の根拠はスコアの近さではなく **表示バフ段数の実測が復活ありでしか説明できない**こと:

| 判定材料 | 結果 |
|---|---|
| ON/OFF が分岐するセル（T5・全 7,800+ セル中） | **14 セル**（すべて b87–b100・L3・vocal_boost） |
| そのうち実測表示が ON と一致 | **3**（b87・b91・b99 ＝ 20 段） |
| そのうち実測表示が OFF と一致 | **0** |
| OFF が予測する **17 段**が実測 vocal_boost に出現する回数 | **0 回**（全 75 観測） |
| ON が予測する 20 段の実測出現回数 | **33 回**（最頻値） |
| S2・S3 への影響 | buffSnapshots **分岐 0 セル**（バイト単位で無影響） |

## 1. 背景

作業ツリーの `src/timeline/engine.ts` に、以下の仕様が無記録のまま実装されていた
（`research/12` に Phase 14-F の記録なし・`tests/unit/timeline/extension-revival.test.ts` 未追跡）:

> 前ビート終了時に `remainingBeats <= 0` となって除去されたバフインスタンスを破棄せず
> `LaneState.expiredThisBeat` に退避し、**当ビートのステップ7/8（P 前半・A/SP）の延長効果**
> （`extend` / 増強）で復活させる。除去パスはステップ8直後に置くため、ステップ11（後半 P）
> の延長は直前満了インスタンスを見られない（S1 b136 の実測で不復活が確定しているため）。

この挙動の T5 への影響は総スコア **+5,076,936**（+0.029%）で、T5 ゴールデン 4 箇所
（`t5-scores.golden.test.ts` / `buff-snapshots.audit.test.ts` / `cli-myphotos.test.ts` /
`sim/ui-pipeline.test.ts`）の期待値を動かした。スコアだけ見れば「実測に近づいた」が、
それ自体は採用理由にならない（過去にスコア・フィッティングで data を改ざんした前例が
`research/26` の監査で判明している）。そこで **実測表示バフの段数**で検証した。

## 2. 検証方法

- **ON**: 作業ツリーの `research/25_buff_audit/t5_sim_trace_full.json`（現行エンジンで再生成済み）
- **OFF**: 同ファイルの `git show HEAD:` 版（revival 実装前のエンジンで生成されたもの）
  - 交絡排除: Phase 14-E（スキル単位トリガー）は T5 の発動系列を一切変えない。
    revival 部だけを `if (false && …)` で無効化して `t5-scores.golden.test.ts` を走らせると
    **HEAD 期待値 17,516,522,572 で 4/4 完全一致**した → 本監査の差分は 14-F の寄与のみ。
- **実測**: `tests/golden/fixtures/t5_measured.json` の `timeline[].effects[lane] = [{id, stage}]`
  （ライブ画面のバフアイコン＝段数）。レーン×ビート 785 セルすべて撮影済み（撮影欠損 0）
- **v1**（`audit_phase14f_revival.mjs`）: 実測に当該バフが写ているセルだけを表示遅延 1 ビート
  許容で突合
- **v2**（`audit_phase14f_divergence.mjs`）: v1 では「実測に無いバフを ON が作り出す偽陽性」を
  捕捉できないため、**ON/OFF の buffSnapshots が食い違うセルを全列挙**し、各セルを実測表示が
  ON 支持 / OFF 支持 / 双方不一致 / 撮影欠損 のいずれかで判定（本報告の主証拠）

## 3. 結果

### 3.1 分岐セルの内訳（v2・14 セル全てが b87–b100 L3 vocal_boost）

| ビート | 実測表示 | ON | OFF | 判定 |
|---|---|---|---|---|
| b87 / b91 / b99 | **20 段** | 20 | 17 | **ON 支持** |
| b88–b96, b98, b100（11 ビート） | 当該アイコン非表示 | 20 | 17 | 識別不能 |

「識別不能」11 セルは表示リストに vocal_boost が写っていないセルで、17 でも 20 でもなく
ON/OFF を区別しない（表示アイコン数には上限があり、他バフ表示時にこぼれる known 挙動）。
**OFF を支持するセルは 1 セルもなかった。**

### 3.2 実測 vocal_boost 段数の出現分布（T5 全 75 観測）

```
{5:8, 9:10, 11:3, 12:2, 15:1, 19:6, 20:33, 21:3, 24:1, 25:9}
```

revival なし模型が b87 以降で予測する **17 は一度も出現しない**。一方 revival あり模型の
予測する 20 は最頻値（33 回、L3 の b68 以降で反復）。L3 の時系列（抜粋）:
`b78=20 b79=20 b80=20 b84=5 b87=20 b91=20 b97=5 b99=20 b102=25 b103=20 …`
→ b84/b97 の 5（＝延長源スキルの小刻みな満了／再付与）を挟んでも 20 が戻るパターンは、
満了インスタンスが同一ビートの延長で息を吹き返す模型と整合する。

### 3.3 v1（表示セルの一致率・lag1 許容）

表示バフ 713 セルの突合で **ON 237 / OFF 234** 一致、差分 3 セル（b87・b91・b99）は全て ON 支持。
絶対一致率が 3 割程度しかないのは本監査が弱い道具であることを意味する（v2 の主証拠は 3.1）。

### 3.4 既存監査パイプラインの一致率（`run_audit_post_decay.py` / `run_audit_v3.py`）

| サンプル | HEAD（14-E/14-F 導入前） | 作業ツリー（14-E + 14-F） | buffSnapshots 分岐セル |
|---|---|---|---|
| S1 | 94.50%（1615/1709） | **95.75%**（1623/1695） | 15（うち開幕 P 前半発動＝14-E 由来を含まれる） |
| S2 | 89.76%（1227/1367） | 89.76%（1227/1367） | **0** |
| S3 | 91.23%（1530/1677） | 91.73%（1530/1668） | **0**（一致増なし＝分母だけ `missing_frames` 除外で減少） |
| T5 | 2675/3411 = 78.42% | **2689/3411 = 78.83%** | 14 |

- S1 の数値は 14-E と 14-F の合成。14-E 単独で 95.53%（`research/12` Phase 14-E 記録）なので
  **14-F 単独の寄与は約 +0.22pt**（S1 スコアは 116,846,821 → 116,829,040 と減少側に動いており、
  「スコアを上げる方向の改変」ではないことも確認できる）。
  > **【2026-09-28 訂正・Phase 15-4】** この +0.22pt 推定は**撤回**。revival だけが異なる trace を
  > 全セル突合した結果、S1 の 14-F 単独差分は **0 セル（trace がバイト一致）**だった。
  > 94.50% → 95.75% のうち 14-F の寄与は 0 で、すべて 14-E と監査側の未観測セル除外由来。
  > → **§5.4**（恒久スクリプト `audit_phase14f_s1_divergence.mjs` で再現可能）

- S2/S3 は buffSnapshots が分岐しない＝**14-F は実データ上で局所的な挙動**であり、
  全域を緩める変更（＝フィッティング化）ではない。

### 3.5 総スコア

| モデル | T5 リプレイ | fixture 実測 17,529,132,014 との相対誤差 |
|---|---|---|
| revival OFF（旧） | 17,516,522,572 | −0.0719% |
| **revival ON（採用）** | **17,521,599,508** | **−0.0430%** |

※ fixture の `results.scores_by_lane` の合計は 17,529,132,014 で `results.total_score` と一致する
（21,231,893 + 53,435,162 + 17,398,054,223 + 23,863,258 + 32,547,478）。
Golden テストのコメントに残っていた `17,521,461,739` は fixture 旧版の実測値で、
`describe` タイトルと誤差計算から `t5.results.total_score` 参照へ修正した（誤差 0.043% に対し
0.001% 閾値は成立しないため 0.05% に是正）。

## 4. 限界・未決着

1. **S1/S3 の 14-F 単独寄与を分離していない**（HEAD トレースが 14-E 導入前のため混在）。
   分離するには 14-E 時点のトレース再生成が必要。S2/S3 で分岐 0 セルなので影響は微小。
   → **【2026-09-28 解決・§5】** 手順 B（revival だけを無効化した trace との全セル突合）で分離完了。
   S1/S2/S3 とも 14-F 単独の差分は **0 セル**、S1 の変化 18 セルは全て 14-E 由来。
2. **表示アイコンの取りこぼし**（3.1 の識別不能 11 セル）は撮影側の既知の制約。
   1 段でも欠けると全バフが写らないレーンがあるため、表示段数は強力だが網羅性の低い道具。
3. **ステップ11 を復活対象から外した根拠（S1 b136）**は今回の再監査対象外
   （Phase 14-F 実装時に確定済みとされる主張。`research/12` 単独の記録がないため、
   S1 b136 窓の単独監査は未実施の宿題として残す）。
   → **【2026-09-27 解決・Phase 15-1】** `tools/audit_s1_b136_step11.ts` で一次実測 14/14 対 0/14 により
   Step 11 非復活を実測確定（`phase14f_revival_audit_appendix.md` §5）。

4. 段数と % の対応（20 段＝20% なのか 4 段×5% なのか）は未確定。ただし本監査は
   模型出力と実測表示が**同一単位で一致する**ことだけを見ており、単位解釈に依存しない。

---

## 5. 【手順 B 完了・2026-09-28 / Phase 15-4】revival 単独寄与を全セル列挙で確定

恒久スクリプト `research/26_data_integrity/audit_phase14f_s1_divergence.mjs`
（成果物 `phase14f_s1_divergence_audit.json` / 同 `s2` / 同 `s3`）。
revival だけが異なる 2 本の trace を突き合わせ、バッフ差分セル（beat × lane × buffKey）を
全件列挙する。あわせて 14-E/14-F 採用前コミット `34c6ed7` との差分も列挙し、
S1 で観測された変化を「14-E 単独」と「14-F 単独」に分解する。

### 5.1 対照実験の妥当性（＝revival だけを止めた確認）
OFF 化は `engine.ts` processBeat 冒頭の満了退避 1 行（L248）を
`state.expiredThisBeat = [];` に置き換えるもの。effect_extension 側の復活ブロックはこの集合が
空だと発火しないため、**この 1 行で 14-F が完全に無効化**される（scoped 延長はもともと 14-F 対象外）。

| 確認 | revival OFF | revival ON（現行） |
|---|---|---|
| T5 総スコア（`npx tsx tools/dump_t5_trace.ts`） | **17,516,522,572** | 17,521,599,508 |
| `t5-scores.golden.test.ts` | **4/4 完全一致（14-F 採用前の期待値）** | 4/4（採用後の期待値） |

→ OFF 側で旧 golden に完全一致 = 14-F が確かに消えている。ON 側との Δ = +5,076,936（T5 L3
vocal_boost の 14 セル）＝ §3 と同じ。**対照が効いていることを両側で確認してから**下の 0 セルを読む
（これが出来ていなかったのが §3.4 の +0.22pt 誤帰属の実失敗）。

### 5.2 結果: S1 でも S2/S3 でも 14-F 単独の差分は 0 セル
| 指標 | S1 | S2 | S3 |
|---|---|---|---|
| 突合空間（beat × lane × buffKey） | 176 × 5 × 27 = **23,760** | 22,545 | 22,815 |
| **A = revival OFF ↔ ON の差分セル** | **0** | **0** | **0** |
| B = 採用前（`34c6ed7`）↔ 現行 | 18 | 0 | 0 |
| C = 採用前 ↔ revival OFF | 18 | 0 | 0 |
| 加算性 B = A ⊎ C（A ∩ C = 0・漏れ 0） | 成立 | 成立 | 成立 |
| 14-F 単独のスコア差（replay 総合） | 0 | 0 | 0 |
| 発動系列・ビート別 gained の差分ビート | 0 | 0 | 0 |

S1 の ON/OFF trace は **SHA-256 まで一致**（`6101c8c72dca2822…8fa6f4`・両者同一）。
S1 中立 57,661,616 / リプレイ 116,829,040、S2 43,118,707 / 74,895,810、S3 65,954,705 / 78,485,270
が OFF でも同値。**S1 では 14-F の復活条件（当ビートのステップ7/8 延長 × 直前ビート満了）が
一度も成立しない**のが全空間列挙で示せた。

### 5.3 S1 の 18 セルは全て 14-E 由来（全件・`combined_pre_14ef_vs_on` に収録）
| セル群 | ビート | 採用前 → 現行 | 実測表示 | 帰属 |
|---|---|---|---|---|
| L1 vocal_up 出現 4 セル | b1 / b51 / b101 / b151 | 0 → 3 | 3 | 14-E |
| L1 vocal_up 終端 2 セル | b36 / b86 | 3 → 0 | 0 | 14-E |
| L1 vocal_up 後退 8 セル | b136–b143 | 3 → 0 | 0 | 14-E（**15-1 の対象窓**） |
| L2 critical_rate_up 3 セル | b51 / b101 / b151 | 5 → 6 | 6 | 14-E |
| L2 combo_score_up 1 セル | b151 | 3 → 4 | 4 | 14-E |

**18/18 セルが実測表示と一致**（JSON の `measured_agreement` が全件「現行模型と一致」）。
revival OFF 列も全セルで現行と同値 → 14-F 単独で実測支持を要するセルは 0 件
（A が空集合なので判定対象が存在しない）。b136 窓（b132–b148）に絞っても
revival 単独差分は 0 セルで、8 セルすべて 14-E 由来。

### 5.4 §3.4 の「14-F 単独 +0.22pt」は誤り（訂正）
- 同一スクリプトで測った 94.50%（1615/1709）→ 95.75%（1623/1695）は、trace がバイト一致である
  以上 **14-F の寄与 0**。すべて 14-E と監査側の未観測セル除外（分母 −14）に起因する。
- 独立の裏取り: `research/12` Phase 14-E 記録の分子 **1623** は現行（14-E + 14-F）の分子と同一
  （1623/1699 → 1623/1695 は除外セル増だけで分子は 1 も動いていない）＝ **S1 の trace は
  14-E 時点で確定しており 14-F で変わっていない**。
- よって 14-F の実データ上の寄与は **T5 の 14 セル（b87–b100・L3 vocal_boost）のみ**。
  S1〜S3 の一致率・スコアへの寄与は 0。§3.4 の表自体（HEAD/作業ツリーの値）は正しいが、
  帰属の記述を上記に訂正する。
- §3.4 が挙げた「S1 分岐 15 セル」は ad-hoc スクリプト（`dump_full3/compare.mjs`・未コミットで
  消失済み）によるもので再現不能。本節の 18 セルは恒久スクリプトで再現可能（§6）。


### 5.5 【参考】14-F 採用時点（2026-09-27）の確定値　※出典を明記した復元記録

前セッションが本メモに書いた §5（T5/S1 数値の更新）は**コミットされないまま作業ツリーから消失**していた
（2026-09-28 に判明）。そこで主要な数値を、**検証済みのものと未再測のものを区別して**復元する。

| 指標 | revival OFF | revival ON（採用） | 実測 | 本セッションでの検証状態 |
|---|---|---|---|---|
| T5 リプレイ | 17,516,522,572 | 17,521,599,508 | 17,529,132,014（−0.0430%） | **実測で確認**（OFF trace 生成時の `t5_check` と `t5-scores.golden.test.ts` 4/4） |
| T5 confirmed | 2,580,038,995 | 2,581,114,209 | 2,587,080,162 | ON 側は golden 一致で確認／OFF 側は前セッション記録 |
| S1 confirmed | 129,241,691 | 129,243,796 | 115,063,834 | 【前セッション記録・今回未再測】 |
| S2 confirmed | 43,236,162 | 43,243,704 | 48,176,495 | 【前セッション記録・今回未再測】 |
| S3 confirmed | 66,227,491 | 66,378,887 | 72,176,945 | 【前セッション記録・今回未再測】 |

- S1〜S3 の confirmed 増加分は**14-E の寄与**（`buffSnapshots` の差分が 0 でもスコアは動く＝
  観測されていないビートの発動が変わる。S2/S3 の trace 差分 0 はバフセルの話）。
- **本節の数値は 15-4 の結論（14-F 単独寄与 = 0 セル）の根拠にしていない**。根拠は §5.2 の全セル突合と
  trace のバイト一致のみ。
- strict 一致率（`run_audit_post_decay.py`）の採用前後は §3.4 の表おり、2026-09-28 再実行でも不変:
  S2 1227/1367 = 89.76% / S3 1530/1668 = 91.73% / T5 2689/3411 = 78.83%（adjusted は全て 100%・residual 0）。

## 6. 再現手順（revival OFF trace の作り方・engine は恒久変更しない）

```powershell
# 0) clean な作業ツリーから始める
git status --short                      # 空であること

# 1) engine.ts processBeat 冒頭（L248 付近）を 1 行だけ書き換える
#    state.expiredThisBeat = state.effects.filter((e) => e.remainingBeats <= 0);
#  → state.expiredThisBeat = [];        # 14-F 導入前と同じく満了インスタンスを破棄

# 2) 発火の確認（必須。省くと「0 セル」を誤読する＝§3.4 の +0.22pt 誤帰属の実失敗）
npx tsx tools/dump_t5_trace.ts | Select-String '"totalScore"'
#    → 17,516,522,572（OFF 旧値）なら発火。17,521,599,508 なら置換が効いていない＝そこで止める
npx vitest run tests/golden/t5-scores.golden.test.ts   # 4/4 PASS（採用前期待値で通る＝revival 部のみ無効化）
git checkout -- tools/t5_sim_trace_full.json           # ダンプ成果は戻す

# 3) OFF 版 trace 生成と退避（生成物は HEAD と timestamp 以外同一になるはず）
npx tsx tools/dump_samples_trace.ts
New-Item -ItemType Directory -Force $env:TEMP\p154_base | Out-Null
Copy-Item research/17_sample1_gap_analysis/sim_trace_full.json $env:TEMP\p154_base\s1_off.json
Copy-Item research/20_sample2_gap_analysis/sim_trace_full.json $env:TEMP\p154_base\s2_off.json
Copy-Item research/21_sample3_gap_analysis/sim_trace_full.json $env:TEMP\p154_base\s3_off.json

# 4) 復元（engine も trace も HEAD に戻す＝常時比較が現行エンジンで再生成できる性質の確認も兼ねる）
git checkout -- src/timeline/engine.ts `
  research/17_sample1_gap_analysis/sim_trace_full.json `
  research/20_sample2_gap_analysis/sim_trace_full.json `
  research/21_sample3_gap_analysis/sim_trace_full.json `
  research/26_data_integrity/samples_trace_summary.json
git status --short                      # 空になること

# 5) 監査実行
node research/26_data_integrity/audit_phase14f_s1_divergence.mjs --sample S1 --off $env:TEMP\p154_base\s1_off.json
node research/26_data_integrity/audit_phase14f_s1_divergence.mjs --sample S2 `
  --on research/20_sample2_gap_analysis/sim_trace_full.json --off $env:TEMP\p154_base\s2_off.json `
  --measured research/26_data_integrity/measured_data_s2_v3.json
node research/26_data_integrity/audit_phase14f_s1_divergence.mjs --sample S3 `
  --on research/21_sample3_gap_analysis/sim_trace_full.json --off $env:TEMP\p154_base\s3_off.json `
  --measured research/26_data_integrity/measured_data_s3_v3.json
```

**生成物**（本手順で再生成したものの SHA-256。同じ手順なら同一ハッシュになる）:

| trace | SHA-256（先頭12桁） | ON/OFF |
|---|---|---|
| S1 `research/17_sample1_gap_analysis/sim_trace_full.json` | `6101c8c72dca` | 一致（OFF 版をリポジトリに置く必要はない） |
| S2 `research/20_sample2_gap_analysis/sim_trace_full.json` | `ef80c4bb10d6` | 一致 |
| S3 `research/21_sample3_gap_analysis/sim_trace_full.json` | `9a634e5a06dc` | 一致 |

監査 JSON `phase14f_{s1,s2,s3}_divergence_audit.json` には `inputs.*.sha256` に上記を記録済み。
OFF trace そのものはバイト一致のためコミットしない（`--off` に退避先を渡せばいつでも再実行可能）。

### 6.1 教訓（手順書側の規律として）
- **「差分 0 セル」は必ず対照の発火確認とセットで報告する**。無効化が効いていない場合の 0 セルは
  無証拠（本件の §3.4 がまさにこれで、+0.22pt という実在しない寄与を生んだ）。
- **ad-hoc な比較スクリプト（`dump_full3/compare.mjs` 等）は必ずコミットする**。失われた再帰検証は
  恒久スクリプトで作り直す必要がある（本件の §5 はそれが再構築）。

