# 12. 実装ログ（Implementation Log）

- 目的: フェーズごとの実装記録・決定事項・発見事項を時系列で記録する（PLAN.md §14 に対応）

---

## Phase 0〜1（2026-08-29 完了）

### 完了内容
- `git init` 済み（コミットはユーザー指示時に実施）
- スキャフォールド: package.json / tsconfig.json / vitest.config.ts / .gitignore（重い実測画像・vendor/ は除外）
- **計算コア**（`src/`、依存ゼロ・純粋関数・TypeScript）:
  - `rounding.ts`: 千分率整数演算（mulPermil / floorDiv / pctToPermil）。浮動小数点直接演算の禁止規律を定義
  - `kouryu.ts`: 交流Lv累積テーブル（Lv1〜60、Confirmed）
  - `types.ts`: Card/StatBonus/YellBonus/StaffBonus 等のドメイン型、rarityBonusPermil（☆1=1.00〜☆10=1.45）
  - `formula/baseStatus.ts`: カード外ステータス式（PLAN.md §3.1 確定式）。**DeckStatusInput.rarity は開花後の現在レアリティを入力**（☆5初期カードの限界突破に対応）
- **データパイプライン**（`tools/importers/build_data.mjs`、`npm run build:data`）:
  - vendor/（gitignore）にマスタ生JSONをキャッシュし、`data/` へ9ファイル生成（meta/cards 491枚/card_parameters 780行/staff/stages/qt-daily-003-19/audience_advantage 1000行/combo_advantage/chart-hsm-004-001/yell）
  - region検証（日本語カード名・music-clb-*・Lv260・qt-daily-003-19）自動実装
  - 検証: audience 16,000→1,620‰(+62.0%) OK、staff vocal Lv65=29,195 OK
- **テスト**:
  - T0 データ健全性（`tests/data-integrity/`）: I-01〜I-16＋v2追加不変条件。**41テスト全グリーン**（1 skipped: 判定内訳の「ノート単位」解釈は実測クリティカル148個と矛盾するため理由明示の上skip）
  - T3 ゴールデン（`tests/golden/deck-status.golden.test.ts`）: beat 0 の5レーン×4ステータス×{basic, deck}=**40項目が1の位まで完全一致**
  - 合計: **50 passed / 1 skipped、typecheck ゼロエラー**

### 実装中の発見・決定事項
1. **【重要】`MusicChartPattern.number` はゲーム内ビート番号ではない**（1..268のグリッド番号）。ビートは「type≠0 のノートの通し番号」として採番するのが正しく、実測A発動16/16・SP=49/103と完全一致で検証済み。`data/charts/chart-hsm-004-001.json` には採番済みの beat を保存（PM検証済み）
2. T3 のレアリティ: カードの `initialRarity` ではなく編成時の現在レアリティ（開花後）を使う。実測編成は ☆6/☆5/☆10/☆10/☆6
3. `StaffLevel.advantage` は既に累積値（差分ではない）
4. I-12 のポップパースに ±1 の切り捨てアーティファクト10セル（b119/L3 等）→ 既知例外リストで回帰固定
5. b61/L5 のみスタミナ変化に発動ログが紐づかない（b60 の2連発動のフレーム分割表示）→ 例外定数で管理
6. 交流Lvテーブルは `src/kouryu.ts` に単一実装（data/aijou.json との二重管理は避ける判断）

### 環境メモ
- Node 24.18 / npm 11.16 / TypeScript 5.x / Vitest 2.1.9 / @types/node 導入済み
- PowerShell 5.1 で日本語を扱う .ps1 は UTF-8 BOM 必須（research/06 §7 のとおり再確認）。Node の .mjs 推奨

---

## Phase 2（2026-08-29 完了）— スコア式

### 完了内容
- `src/formula/combo.ts`: コンボファクター（B2）。テーブル7行（data/stages/combo_advantage.json 同期）+ `(1000+基本ボーナス)×(1000+100×段)/1000`【Confirmed】。表記対立（×6.0 vs ×3.0）の判定記録を JSDoc に保存（×3.0説は r≈0.49 で範囲外のため却下）
- `src/formula/fan.ts`: 来場ファンボーナス（B3）。audience_advantage 1000行の二分探索。16,000→1620‰
- `src/formula/critical.ts`: クリティカル係数。`1500 + 50×段 + extras‰`（実測 extras=255）
- `src/formula/scoreEvent.ts`: イベントスコア共通計算。`computeEventScore()` は丸めポリシー2種（"sequential"=各乗算ごと切捨て【Estimate】/ "at-end"=最後 once）を切り替え。巨大積は BigInt フォールバック。T4/T5 でポリシー判定
- `src/rng/`: ScoreRng 契約 / ReplayRng / MinRng / MaxRng / FixedRng（mulberry32・モンテカルロ用）
- 単体テスト115件追加 → **合計 165 passed / 1 skipped、typecheck ゼロエラー**

## Phase 3a（2026-08-29 完了）— スキルゴールデンデータ

- `data/skills_golden.json`: カード15+フォト20=35スキル・効果57件。マスタ Skill.json（SkillEfficacy の type/grade）と検証テキスト・発動ログの突合で作成。推測値ゼロ（Unknown は null + confidence タグ）
- 写像: type36→score_get(+scaling), type70→score_get_by_score_ratio, type80/86/81→a_skill_score_up/combo_score_limit/critical_coeff_limit（limitRelease 形式）等。type36 係数・type70 上限は perStagePermil:null でエンジン側フィッティング待ち
- Lane3 フォト1/3/4 は画像判読不可（本実測未発火）のため null 記載
- 検証スクリプト `tools/validate_skills_golden.mjs`

## Phase 3b（2026-08-29 完了）— タイムラインエンジン

### 完了内容
- `research/13_engine_spec.md`: 実装仕様書（11段階処理順・P前半/後半選択・効果適用・対象解決・トレース要件・推測リスト11項）を先に文書化し、実装はこれに従う方式を採用
- `src/timeline/types.ts` / `constants.ts`: 契約型と定数（POSITION_TO_LANE=[3,2,4,1,5] 実測21/21一致、IDOL_PRIORITY_ORDER=[4,2,1,3,5]、focus ファンボーナス表等）
- `src/timeline/buffs.ts`（P3b-1 サブエージェント）: 段数集計（加算+上限クランプ・limit解放→30）・ライブ中ステータス倍率・消費倍率・B1・成功率・focus ファンボーナス。69テスト
- `src/timeline/engine.ts`（PM直接実装）: `simulateTimeline()`。11段階ビート処理・P前半/後半・効果適用（増強/延長は残りビート最大インスタンス対象【Confirmed】）・対象解決9種・トレース出力
- テスト15件追加 → **合計 249 passed / 1 skipped、typecheck ゼロエラー**

### 実装中の発見・決定事項
1. **【重要】CT 内部初期値は CT−1**: research/08 §2.3 の実測系列（act=b1・CT50 → b50 再発動 = gap 49 = CT−1）から、発動時に内部CTを CT−1 に設定しないと最小再使用間隔が CT になってしまう。発動ビート中に（初期化+ステップ9減算で）実質2進むモデルを採用
2. **前半/後半発動の実効ビート数差は処理順から自動的に成立**: 前半発動→ステップ10で減算→表記−1、後半発動→減算をスキップ→表記どおり（research/01 §4 補足の機構的説明）。残り0の効果はスコア時に無効（翌ビート開始で除去）
3. **サブエージェント失敗の記録**: P3（全体）×2・P3b-2（engine単体）×1 の計3回が空応答で失敗（成果物ゼロ）。P3b-1（buffs）は成功。→ 仕様書を先にファイル化（research/13）しても engine 単体タスクは失敗したため、PM が直接実装するフォールバックを採用（ユーザー承認済みの方針）。タスク分割の目安: 「1ファイル+テスト」でも出力が大きいと失敗し得る
4. snapshot 計算はステップ7後（P前半バフをスコアに反映）である必要があった。バグはミニフィクスチャのテストで検出・修正（テスト設計の有効性確認）
5. 割合型（type70）の基本スコア = 累積総スコア×SkillPower（コンボ/ファン不適用）で実装。累積の厳密な基準（全体 vs レーン別等）は【Unknown】→ T5 の b103 検算で判定

### 残課題（Phase 3c へ）
- T4: ビート1〜10の発動ログ突合（発動順・対象・効果 multiset・stamina）→ **T4完了（下記）**
- T5: 全156ビートのスコア検定（Mode R: 乱数中立1000+実測クリティカルフラグ注入、ratio_b ∈ [950,1050] 検定、3点検算 b2/b103/b156）
- type36 係数フィッティング（skills_golden.json の perStagePermil）

## Phase 3c（2026-08-29 進行中）— ゴールデン接続

### T4 完了（発動ログ・スタミナ突合）
`tests/golden/t4-activations.golden.test.ts`（+ fixtures/t4_measured.json）: **255 passed / 1 skipped**。
beat 1〜3 の成功発動15件が (beat, lane, skillId, phase) 順序込みで完全一致、beat 4〜10 は発動ゼロ、
スタミナは L1/L2/L4/L5 全点1の位一致・L3 は ±300 許容（cutscene とレーン画面の取得タイミング差、
research/08 §1.4-2）で一致。

#### T4 で確定した仕様（すべて実測由来・engine と research/13 に反映済み）
1. **A/SPノートは該当レーンのみ挑戦**: chart の position は 1始まりの優先ランク
   （pos1→L3, pos2→L2, pos3→L4, pos4→L1, pos5→L5）。A/SP 発動 18/18 が一致。
   旧「全レーン挑戦」説は否定。他レーンは FAIL もコンボ変動もしない
2. **score_type_1/score_type_2/single はスコアラーレーンに解決**:
   発動ログの target_idol が全て白石千紗（Scorer）。LaneInput.role を追加。
   score_type を発動者扱いした旧実装は L2 にテンションが乗りゲート失敗する形で矛盾が顕在化
3. **vocal_type_N は「ボーカル属性レーンのデッキvocal降順」**: vocal_type_3 → [L3,L2,L5]
   （626,223 > 401,055 > 339,715。L1 334,153 は4位、ダンスレーン L4 は対象外）【Confirmed】
4. **battle_only 行を含むスキルは無条件扱いで前半発動**（order3 結婚への願望）
5. **P/フォトの発動予算は「1ビートにつき各1回」（前後半合算）**:
   b2 で L5 が前半にフォト発動済み→条件付きフォト L5-3 は b3 発火（order 11/15）。
   位相ごと予算説は否定
6. **スタミナ回復は maxStamina でクランプ**（order9: 18730−866+2560 → 18730）
7. **成功率の基礎値が100%（メンタル盛り）ならテンション副効果(-1.5%/段)は相殺され100%維持**
   （実測 stage の skill_success_rate 100%×5 × 全82発動成立）
8. **CT 内部初期値 = CT−1**（再確認・research/08 §2.3 の gap ≥ CT−1 則と整合）

#### T4 で判明した未解決（T5 へ持ち越し）
- **ライブ開始時プリバフ（ライブボーナス由来か）の存在**: timeline の効果表示に L3 で
  vocal_up 17段/stamina_cost_down 12段等が b1 時点から出現。ただし効果表示はスコア詳細
  画面のキャプチャ混入で値が変動し（focus 9→3→15→23）、信頼できる系列ではない。
  スコア検証（T5）に直結するため、正しいプリバフ系列の復元が必要
- L3 b2 のスタミナ Δ432 vs 消費404 の +28 差は取得タイミング差の範囲内として許容
- 判読不能フォト（L1-4, L3-1/3/4）はシミュレーションから除外（実測でも発動記録なし）

### T5 調査（2026-08-29 進行中）— 全156ビートスコア検定

#### インフラ
- tools/tmp_t5_extract.mjs で tests/golden/fixtures/t5_measured.json を抽出（timeline 157行: gained/cumulative/stamina/stat/effects/表示ポップ, critical_flags.beats 157, activations 82, results）
- tests/golden/t5-debug.test.ts: デバッグハーネス（ビート別比診断・レーン別係数フィット・時系列ダンプ）
- LaneScoreEventTrace に comboFactorPermil/fanFactorPermil/isRatioScore を追加（ソルバー用）

#### エンジン修正（実測確定・コミット済み 6c34fb4）
1. **上限解放変数型（tension_limit/combo_score_limit/critical_coeff_limit）は段数を加算しない**。
   解放=上限拡張のみ。根拠: b2 Aスコア検算 — かんしょ combo_score_up 6段+limit10 を16段として
   計算すると 41.8M（実測 25,578,742 の1.63倍=乱数域外）、6段なら 25.7M（乱数≈995 で整合）。
2. **effect_amplify は全体で最長残り1インスタンスのみ+N段**（キー毎選択は否定）。
   根拠: b3 の photo-L5-3 +2 で全キー+2 になる旧実装は L3 の実測 stat（b4 で不変）と矛盾。
   b3 時点の最長は かんしょ combo_score_up（44b+延長）→ csu+2 のみ。
   ※ 同一残りビートのタイは付与順が先のものを選ぶ（配列順・実装上の仮定）

#### プリバフ問題の解決（T4 残課題）
- **ライブ開始プリバフは存在しない**。b1 L3 stat=1,174,168 = 626,223×1.875 = vocal_up 7段(350‰)
  + vocal_boost 7段(和歌3+Voブースト4=525‰) で完全一致。timeline の効果表示
  （vocal_up 17, tension_limit 3, critical_coeff_up 7 等の L3 b1 表示）は
  スコア詳細画面の別時点キャプチャ混入でゴミ → effects 照合は L1/2/4/5 のみに限定。

#### stat_value 列の意味（重要な新発見）
- timeline の lanes[N].stat_value は**レーンの実ライブ中ステータス**（L1/L2/L4/L5 = デッキ値で不変、
  L3 のみ vocal バフ込みで変動: M 値 1875→2375(b3)→3750(b68 以降平台上限)）。
- ただし **b2 のみ例外**: b2 capture = M 2125 でモデル（A発動後 2375）と合わない
  （スクロール表示のフレーム位相）→ stat_value は絶対アンカーに使わず変化点のみ参考。

#### コンボ表示の確定
- 表示コンボは **+1/beat 厳密**（b156 の +0 は最終表示の既知例外、最終 155）。
  **A/SP 成功は表示コンボを増やさない**（16 A+1 SP 成功でも全く跳ねない）。
  → コンボボーナスの基準値は「ビートノート処理回数」で全レーン共通の可能性が高い
  （L4 b110 のポップがグローバルコンボ基準と整合。エンジンのレーン別 combo
  （A/SP 成功 +1・FAIL リセット）は CB ファクター用としては誤り候補 → 次ターン修正検討）。

#### ビートスコアの構造謎（T5 の最重要未解決・次ターン継続）
レーン別係数フィット（pop = live×A×B1×cb×fan×crit×r、A = w×(λ/N)）の結果:
- **L1/L2/L5（ボーカル・無バフ）: 現行モデルで乱数レベル一致（sd≈5%）** → 600‰・B1 1360・fan 1620 は正しい
- **L4（ダンスレーン）: A ≈ 1.33×L1**（b6/b10/b20 で 1.34-1.38 と頑健）→ dance 重み 250‰ では説明不能。
  候補: (a) このステージの実際の重みが {vocal:600, dance:800}（マスタ JSON の 250 は誤り/別行の可能性・
  research/03「daily STAGE は変則値」参照）, (b) L4 のイベントが visual(392,347)×600 ベース。
  b60 以降に反抗 vocal_up 6段（neighbors→L4）で係数が跳ねる（×1.4-1.5 vs 予測1.3）→
  vocal が絡む構造の証拠だが b104/b105 は伸びておらず確定できず
- **L3（センター・スコアラー）: A ≈ 0.45×L1 で散らばる**（0.40-0.48・sd 大）。
  候補: (a) ビートの B1 に score_up が乗らない + ビートの CB に combo_score_up が乗らない
  （A_3 = 0.0876 となり L1 と完全一致・最有力）, (b) w3 = 250-300。
  b2 の A スコアでは B1 に a_score_up/score_up/tension が乗うことを確認済み
  （25.7M↔実測 25.58M・乱数 995）→「A には乗るがビートには乗らない」説と整合するか要検証
- A/SP/P/フォトイベントは **b2 A で完全検証済み**（CB=(1+0.5)×(1+0.1×6)=1600 で乱数 995）。
  フォトのスコア獲得は **powerPermil が 10 分の 1**（40%→400、85%→850。マスタ ef-score_get-400 の
  値がそのまま permil・P3a が×100 した誤り。pop 214.9K/457.2K と 220K/468K が乱数 976/978 で整合）
  → skills_golden.json の photo score_get powerPermil ÷10 が必要（次ターン実施）
- b103 SP の +15,145,715,433: 12%×累積(421M)=50M では説明不能。1570%行+type36 スケーリング
  （vocal_up_stages ≈ 40 段想定・p≈20-30‰/段）+12% 行の合算で説明する仮説 → ソルバーで数値確定

#### クリティカルフラグの性質
- yellow_lanes/white_lanes/no_pop_lanes = そのビートで**スコアイベントがあったレーン**とその色。
  ビートノートのビートは全5レーンがポップ、A/SP ビートはオーナーレーン(+フォト発火レーン)のみ。
  no_pop は遮蔽（イベント自体はスコアに計上されている）→ crit 不確定として扱う。
  b1/b2 はフレーム混合（b2 に b1 の L4 ポップが混る）で既知異常区域。

#### 次ターンの作業計画
1. skills_golden.json の photo powerPermil ÷10（4000→400, 8500→850, 4500→450, 2500→250, 2000→200）
2. A/SP/フォト 27 イベントの離散乱数検定（k=1 の (beat,lane) で r=D/E×1000 が 950-1050 の整数）→
   バフ進化の検証。type36 フィッティング（b3/b69/b103/b156 の 4 方程式）
3. ビートスコア構造の確定: L3 の「B1/CB にバフ乗らない」説を b40/b100 で検証、
   L4 の重み 1.33 を {vocal:600, dance:800} で固定し全ビート再フィット（残差 rand レベル化を目標）
4. コンボ: グローバルコンボ基準への変更可否を FAIL/コンボ継続と合わせて確定
5. ソルバー（ビート合計=実測 gained の rand 組み合わせ探索・meet-in-middle）→ 解列を
   fixtures/t5_replay_rands.json に出力 → T5 テスト（ReplayRng で cumulative 157点完全一致 + 状態照合）
6. research/13 の §5.1（ビート基本式）・§7（amplify/limit）を新確定事項で更新

### T5 調査2（2026-08-29）— A/SP モデル検証完了・ビート構造は機械フィッターへ

#### フォト powerPermil 修正（コミット済み 0c9feb1）
photo-L5-1/2: 4000→400, photo-L5-3: 8500→850, photo-L5-4: 4500→450, photo-L4-4: 2500→250, photo-L3-2: 2000→200。
マスタ ef-score_get-N の N がそのまま permil（40%=400）。P3a がテキスト%×100 した誤り。
検証: b2/b3 の L5 フォトポップ 214.9K/457.2K ↔ モデル 220K/468K（乱数 976/978）。

#### A/SP 離散乱数検定（16 ビート中 13 A + 1 SP）
r = pop / E(rand=1000) × 1000 が [950,1050] に入るか:
- **10/13 の A が完全一致**: b23 L4 r=1022, b30 L5 r=1008, b38 L2 r=1006, b47 L1 r=953,
  b60 L5 r=977, b86 L2 r=966, b115 L2 r=968, b128 L5 r=963, b136 L1 r=981, b144 L2 r=968
  → **バフ進化・B1(エール+装備+バフ)・CB((1+base)×(1+0.1×csu))・fan(1620+focus)・crit(1500+extras+50×段)
  の全モデルが確定**（3-4有効桁の K ポップのみ全て範囲内）
- 範囲外 3 件は全て 2 有効桁の M ポップ（±2-4% の OCR 丸め/誤読圏）: b80 L4 r=922, b94 L1 r=943, b106 L4 r=1074
- type36 の 3 件（b69 r=1927, b103 r=1387(両行合計), b156 r=1199）はスケーリング係数のフィッティング対象。
  b69 の必要倍率 s∈[1.84,2.03]（r±5%込み）だが b156 は s∈[1.08,1.30] と兩立しない
  → 段数の参照法（vocal_up のみ / extreme のみ / 合算・上限値）と b156 ポップの読み値（+1.7G は 2 桁）
  を含め機械フィッティングで確定する。b103 は行2(12%×累積)が E の約 8.07B を占め、
  累積基準は実測 cumulative（421M）を使うべき（sim 中立累積は beatscore 過大で 5.3B になるため）。

#### エンジンの既知残差（次ターン修正）
1. **ビートスコアに λ/Nbeat 正規化がない**: L1 のフィット A = w×(λ/156) = 0.0874 → w×λ = 13,634
   （w=600 なら λ=22.7 / w=800 なら λ=17.0 / S1 の λ≈8 なら w≈1700）。S2 の「Vo 3.0%」
   （=w×λ/156=0.03）と測定 A の 0.0874 は ×2.91 ずれる — B1/fan/cb は denom で除算済みで
   sd 4.8% に収まっているため、この積 w×λ×B1×fan が確定量。どこに ×2.91 を配分するかは
   機械フィッターで w/λ/B1 の仮説空間を走らせて確定させる。
2. **L3 のスナップショット進化が過大**（推定）: b69 の sim basic = live M3450（up+boost ≈ 49 段相当）は
   実測 stat 軌道（b3 M2375 → b68 以降表示上限 3750）と整合せず。effect_extension を
   「全インスタンス +N」から「最長 1 インスタンス +N」に変える仮説を最初に試す
   （research/01 §2.2「増強・延長の対象は最長のものだけ」）。b2 の stat 表示 2125 はフレーム例外、
   b68 以降は表示上限のため、stat の信頼できるアンカーは b1(1875)・b3(2375)・b38(2750) のみ。
3. **コンボ CB の基準**: L4 b110 のポップがグローバルコンボ基準と整合（レーン別 combo は
   A/SP 成功 +1 と FAIL リセットを持つためズレる）。CB・combo>=N 条件とも
   グローバル（= ビートノート処理回数・表示値）に統一する方向で確定させる。

#### 次ターンの作業計画（機械フィッター）
1. tests/golden/t5-debug.test.ts を拡張し、仮説グリッド
   {ext: all|longest} × {cb: レーン別|グローバル} × {beatB1: su/tension あり|なし} ×
   {w: (600,250,150)|(600,800,150)|(450,600,150)|(600,250,150)+λ別...} × {λ} について
   全ビート×全レーンのポップ残差の中央値/sd を一括スコア化し、最小の仮説を確定させる。
   目標: L1-L5 全レーンの A が乱数レベル（sd≈5%）で一定化。
2. 確定後: type36 フィッティング（b69/b103/b156）、b103 の行分解（12%行は実測累積ベース）。
3. エンジン修正（λ/N 正規化・ext/combol 方式）→ 単体テスト更新。
4. ソルバー（ビート合計 = 実測 gained の離散 rand 組合せ探索）→ t5_replay_rands.json 生成。
5. T5 本テスト: ReplayRng で cumulative 157 点完全一致 + スタミナ/コンボ/レーン別合計照合。
