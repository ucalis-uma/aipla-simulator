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

#### 生マスタ Quest.json 確認（vendor/Quest.json）
qt-daily-003-19 の原値を直接確認: position1-5AttributeType=[2,2,1,2,2]、
beatVocal/Dance/VisualWeightPermil = **600/250/150**（標準値そのもの・データ抽出誤りではない）。
全5916ステージの重み組み合わせ分布: 600/250/150 系が3位までで約43%、残りに 200/600/200 等の変則値。
→ L4 実効重み ≈ 1.33×vocal（=800 相当）は**マスタ値から導出できない** = モデル側の未解明機構
   （延長/増強の対象選択、重み適用方法、またはポップ帰属の問題）。機械フィッターで確定させる。

### T5 調査フェーズ2b: 仮説グリッドフィッター（決定的進展）

#### 施設
- engine.ts に一時デバッグトグル追加: `SimulateInput.debugOptions` = { extensionMode: "all"|"longest", comboBasis: "lane"|"global" }（既定=現行動作。T5確定後に削除予定）
  - effect_extension の longest モード（最長残り1インスタンスのみ延長）と、コンボ係数の global 基準（処理済みビートノート数）を実装
- tests/golden/t5-debug.test.ts にグリッド比較/統合仮説/λスキャン/L3実効比の4テストを追加（トレース後掛け検証）

#### 確定したこと
1. **effect_extension = 全インスタンス延長（all）で確定**。longest モードは L3 ビート系列の破綻（buckets 66→234）と type36 の r=6157/14223 で完全否定。
2. **コンボ基準は lane で不変**。b49 SP FAIL でも L4 のコンボは継続（combo_continue 保護済み）のため lane/global で差が出ない。lane 維持。
3. **ビート basic は総和式**（最重要）:
   `basic = vocal×600×liveMult_vocal(レーン) + dance×250 + visual×150`
   - L1/L2/L4/L5 の A（=pop/(basic×b1×cb×fan×crit)）が **0.0567〜0.0575 に統一**（従来 L4 だけ ×7.7 の例外）
   - L4/L1 pop比 1.13 の謎が解決。L4 の b60 跳ね(+19%) は 反抗の vocal_up 6（neighbors→L4）が vocal 成分に乗るため
   - L1 の +9% ドリフトの大半も統合（残りドリフトは僅少）
4. **ビート B1 = 1000 + 25×score_up + bonus.beat**（su 25‰確定）。
   - asu(50‰)入りは L2/L5 で median が 0.057→0.047 に下がり否定。テンション入りは L1/L4 で tension=0 のため影響なし（不入で維持）。
5. **λ = 0.05712〜0.05715**（離散乱数スキャンのプラトー）。8/140 = 0.0571428 と整合。
   - implied rand が **88%** で |r−round(r)|<1.5 かつ [945,1055] を満たす（L1 115/127, L2 70/85, L4 108/120, L5 111/126）
   - su 50‰ 説は 80.6% に低下 → 25‰ 確定
6. **譜面内訳確定**: 156ノート = ビート138 + A16 + SP2。コンボ表示は **全ノート行 +1（FAIL行も含む）**、b156 のみ +0。
7. ビート行の pop 列には P/フォトの score_get ポップが混入する（L5 b68: ×11 等）。分析時は gainedScore 付き発動ビートを除外必須。

#### 未解決（次ターン最優先）
- **λ の厳密確定**: 高精度 pop（≥1e6）2サンプルの整数候補交集は空（丸め誤差>候補間隔）。許容を緩める/サンプルを増やして 8/140 か否かを確定。
- **L3 のみ実効比 0.62〜0.70**（b1×cb が過大）:
  - 仮説A: ビート B1 から su を除外（b6 で ratio 0.83 を説明）+ csu が sim より 3〜4 段過大（b2 A の +6 が実質 +2? ターゲティング疑い）
  - 仮説B: d3/v3 デッキ値が過大（Aイベントはvocalのみで検証済みのため dance/visual は未検証）
  - b39-46 の +40% クラスタは su バフ期限切れタイミング（sim が b45 まで保持、実ゲームは早い）と整合
  - Aノートビート（b60 r=977 等）では r 一致しているため、スナップショットは A 時点で正しい → ビート間の期限/集計差に絞られている
- エンジンへの実装（総和 basic + λ）は L3 確定後に一括実施。

#### 数値メモ
- ノート数: 156（ビート138/A16/SP2）。λ候補: 8/140=0.0571428（140=156-16 の意味は未解明）
- L3 の csu 段数: sim b6=8 (b2 A +6, b3 フォト +2) / b53+=14。実効は 4-5 / 10 程度か
- 259→264 テスト（t5-debug 拡張分）。typecheck 0 エラー。

### T5 調査フェーズ2c: エンジンへのビート新式実装

#### エンジン変更（src/timeline/engine.ts settleBeatNote）
- **ビート基本スコアを総和式+λへ変更**:
  `basic = floor((vocal×liveMult_vocal×600 + dance×250 + visual×150) × 8 / 140)`
  - BEAT_LAMBDA_NUM=8 / BEAT_LAMBDA_DEN=140。全レーン3統計混成（A/SPは従来どおり属性単一）。
- 根拠: L1/L2/L4/L5 の implied 乱数が 88% 離散整合（λ=0.05712-0.057145 プラトー、8/140=0.0571428 が inside）。
- 単体テスト6本の期待値を新式で更新（4357/5042/6071/7058/7276/4368）。**267 passed + typecheck 0**。

#### スキルマスタ調査（vendor/Skill.json）
- b1 の P発動の正体: かんしゃ(L1)=スコアラーにcsu5-6段+上限解放10段[25-44b] / 気持ちを和歌に乗せて(L2)=スコアラーにテンション+ブースト2-3段[32-43b] / さらけだし(L5)=センターに集目7-9段[24-45b]+効果延長6-12 / 結婚への願望(L4)=隣接スタミナ回復
- fest-03-2(L3のA, b2/b69/b156): ①type36スコア行 ②**vocal_up_extreme 10段[36b] self**（goldenは正しくextreme。add_effect_value_vocal_up-10 = 上昇超化のこと）
- su の出所: photo-L1-1 (su+3[37b]→score_type_1, b1/b50/b100/b150) + photo-L1-2 (su+8, b2/b51/...)
- L3 スナップショット(su=3→11→3→6→14...)の推移は golden 定義の積分結果として正しそう

#### L3ビート乖離の現状理解（未解決・次ターン最優先）
- L3 のみ ×0.62-0.70。L3係数グリッド: su=0/asu=0/csu−4 が 26/41 で圧勝（次点15/41）
- しかし Aイベント b2 は csu=6段で r=995 検算済み → 式の差ではなく**バフ進化の差**（延長の対象/期限）の疑い:
  - 仮説: さらけだし等の「センターの強化効果を延長」は sim では全効果に効くが、ゲームでは一部
    （例: photo-L1-1 の su[37b] が b38 で期限切れのはずが sim では延長され b45 まで生存 → b39-46 の +40% クラスタと整合）
  - csu の −4 は birt(csu6段[25b]) の延長有無で説明可能かも（ゲームでは b26 で切れて photo-L5-3 の +2 のみ → 真値は sim−4 に近い）
- 実測 stat 列の逆算: b1=×1.875(up7+boost7) / b3=×2.375(+ext10) / b38=×2.75 / b51=+up7(fest-03-3再発火) / b60=×3.675 / b68=表示上限3.75
  → stat 列は vocal_up/boost/extreme の期限の真値源。これを使って延長セマンティクスを確定させる。

#### 譜面/コンボ確定
- 156ノート = ビート138 + A16 + SP2。コンボ表示は全ノート行+1（FAIL含む）、b156のみ+0
- λ=8/140 の「140」の由来: 156−16(A数) = 140 または ビート138+SP2 = 140（どちらかは未確定・式上は定数で差支えない）

#### 次ターン
1. 延長セマンティクス確定（stat列の期限逆算 + waso/L2-4/L3-2 の延長対象）→ L3 ビートの統合
2. type36 フィッティング（b69/b103/b156）
3. ソルバー → t5_replay_rands.json → T5 本テスト（ReplayRng で cumulative 157点完全一致）
4. research/13 §5.1 更新済み（今回実施）。デバッグトグル(debugOptions)は T5 完了後に削除。

### T5 調査フェーズ3: 発動スケジュール完全一致（2026-08-29）

#### ブレークスルー: CT モデルの完全解読
実測発動ログ82件の gap 系列を全部説明する CT 則を逆算確定（engine 実装済み）:
1. **発動時 CT := 満タン**（旧「CT−1 初期化」は誤り。旧モデルは前半発動で gap CT−2 を生み
   research/08 §2.3 の実測則 gap ≥ CT−1 にすら違反していた）
2. ステップ9で毎ビート減算 → **前半発動は同ビート内に減算され step11 で再使用可（gap CT−1）、
   後半発動は減算されず gap CT**
3. CTが step9 で 0 になったビートの **step11 で発動**（「2回目以降は後半発動」の機構的説明）
4. ct_reduction は即時 clamp（既存実装どおり）

検証データ（全て本モデルで完全再現）:
- かんしょ/和歌 (CT50): gap 49/50/50（b1→50→100→150）
- 結婚への願望 (CT40): 39/40/40
- 逆襲のドッキリ企画 (CT50・条件付き→常に後半): **50/50/35**（b1→51→101→136）
- さらけ出す (CT60): **59/46**（b1→60→106）
- photo-L1-2: 49/50/50、photo-L2-2: 50/50/50、L2-4(CT45): 45/45/45、L5-1/L5-2(CT70): 69→(CT短縮)
- **逆襲 gap35 と さらけ出す gap46 は b106 ドリームウエディング(wedd-00-2)の隵接 CT−15**
  （neighbors=L3/L5, research/08 §2.5 実測）で同時に説明 — wedd-00-2 の発火 b106 は実測ログで確認済み

#### 条件評価の確定
1. **combo>=N はグローバル成功ノート数**（ビートノート +1・A/SP 成功 +1・FAIL は数えない）。
   実測: L4-3(>=50)@b51・L4-4/L1-3(>=80)@b81・L5-4(>=100)@b101 — レーン別コンボ説は
   L4-4 が b80 でなく b81 に発火したことで否定
2. **someone_* は自レーンを含む**。実測: photo-L3-2/photo-L4-1(someone_critical_coeff_up) の
   b47 発火は birt-02-1 が L3 自身(score_type_2)へ ccu+8 を付与した直後であり、
   他レーンに ccu が存在しない → 自レーン包含でしか説明できない
3. **「前半使用可だった無条件を後半除外する永続集合」は存在しない**（旧実装の誤り。
   b1 でフォト予算を取られた photo-L1-2 が b51 に後半発火=実測と完全一致）。
   同ビート内の二重発火は予算（P/フォト各1回・前後半合算）で担保

#### レーン処理順（メンタル降順）の較正更新
本実測編成の真の優先順は **L1 > L3 > L4 > L2 > L5**:
- b51 後半: L1(photo-L1-2) → L3(fest) → L4(photo-L4-3)
- b47 後半: L3(photo-L3-2) → L4(photo-L4-1) → L2(photo-L2-3)
- b3 後半: L2(photo-L2-3) → L5(photo-L5-3)
（旧較正値は L3 最下位で b47/b51 と矛盾。t4/t5 両ハーネスの CALIBRATED_MENTAL を更新）

#### 実測ログの表示名規則（突合用）
フォトのログ名は「**最後の効果行の種別**」から導出されるカテゴリ名
（L3-2=[score_get,extension]→強化効果延長スキル / L5-4=[score_get,amplify]→増強 /
L4-4=[score_get,ccu]→クリティカル）。スキル名の ～/〜 は全角チルダの表記ゆれ。

#### 成果: 発動スケジュール突合テスト（新設）
tests/golden/t5-debug.test.ts に「発動スケジュール突合（sim 82 vs 実測 82）」を追加 →
**82件全て (beat, lane, skill, kind) が順序込みで完全一致**。269 passed / 1 skipped、typecheck 0。

#### L3 ビート乖離の現状
修正後も L3 実効比 0.62〜0.84（sim の B1 が過大）。su=11（L1-1+L1-2、延長で延命）が
実測と合わない可能性が最高疑い。次ターン: L3 stat 列（b1=1.875/b3=2.375/b38=2.75/
b50=2.975/b51=3.325/b60=3.675/b68+=上限3.75）+ b45 の su 低下タイミングを使って
延長セマンティクス（対象インスタンス範囲）を機械フィッティングで確定する。
※ stat 列の b50/b51 増分は CT 修正後の発動スケジュール（和歌 b50・fest-03-3 b51）と完全整合済み。

#### 次ターン
1. L3 延長セマンティクス確定（インスタンス追跡 fitter + stat 列/su 期限の逆算）→ L3 ビート統合
2. type36 フィッティング（b69/b103/b156）
3. ソルバー → t5_replay_rands.json → T5 本テスト（ReplayRng で cumulative 157点完全一致）

### T5 調査フェーズ4（2026-08-30）— over-cap 確定・L3 実態解明・ソルバー基盤

#### バフ上限超過（over-cap）仕様の確定・実装（タスク1完了）
【ユーザー確定 2026-08-30】「バフは上限段数を超えて付与されても内部的には切り捨てず
超過分を保持する。計算式・見た目で使う値は上限でクランプされるが、後から一部インスタンスの
期限が切れても内部段数が上限以上であれば上限段数を維持する（19段に+4段→内部23/表示20。
次ビートで2段切れても内部21/表示20）」。
- 実装調査の結果、エンジン本体は既にこの挙動（applyEffect は stages を無整形で push、
  期限切れはインスタンス単位除去、aggregateBuffs が合算後に clamp）であることを確認。
  修正は JSDoc の旧仕様記述（research/01 §2.2「付与時に無視」）の訂正と回帰テスト追加。
- buffs.ts: ファイルヘッダ+aggregateBuffs+ActiveEffect の JSDoc を新仕様に更新。
- buffs.test.ts: 「19+4→表示20」「期限切れ後も20維持（旧仕様なら19）」「limit解放時に
  内部24が露出（12+12+1limit→25）」の3テスト追加。
- engine.test.ts: P×2+フォトで 19段[5b]+2段[2b]+2段[3b] を付与し b1-b6 のスナップショット
  [20,20,20,20,20,0] を検証するエンドツーエンドテスト追加。
- **273 passed / 1 skipped、typecheck 0 エラー。**

#### L3 ビート残差の実態（fit 窓列挙による）
tests/golden/t5-l3fit.test.ts（一時ハーネス）で L3 各ビートの実現可能 (su_t, csu_t) 整数ペアを列挙:
- **photo-L1-2（su+8[31b]）の対象は vocal_type_2 = L2 と L3 の両方**（golden 確認）。
  L2 のビート fit は su 係数 25‰ を強く要求（su=25 で 70/81、su=0 で 28/81）
  → su 25‰/段・L1-2 の L2/L3 付与は確定。
- **L3 ビートは sim の su=11 を受け入れない**（b6-b19 は (su≈0-3, c≈3-4) 窓、b45-46 は
  (su3, c4) 窓）。一方 **b47/b97 の photo-L3-2 passive イベントは (su3, csu8) / (su14, csu14)
  で整合**（score_get 系は B1_passive に su 入り・CB 10%/段で sim と一致）。
- **b132 passive は c≈22 を要求**（sim csu=20）→ b118 の photo-L5-3 増強(+2)が実ゲームでは
  csu に乗った証拠。sim の「全体最長1インスタンス」増強選択は要修正候補
  （vocal_type_1 の最長＝csu インスタンス、またはキー単位選択）。
- **ビートと passive で csu の効き方が矛盾**（b45-46 ビートは c≈3-4、b47 passive は c=8-9）。
  ビート CB の csu 係数 5%/段説（debugOptions.beatCsuPermil=50）だと b6-b19・b45-46 が_fit_
  するが b21 以降が崩れる。ビート B1 の su 係数 0 説（beatSuPermil=0）でも同様に部分整合。
- 実測 pop 列にはフレーム混入汚染がある（b40 L3=863300、b120 L3=3800000、b45 L2/L4 異常等）
  → pop ベースの fit は汚染ビートの除外が必須。gained/cumulative 列は自己整合
  （cum差分==gained 157/157・最終=total_score 17,529,132,014）。
- **gained 列はスキル/フォトのスコアを最大1行後ろに記録する**（b2 の A が b3 行、
  photo-L3-2 が b47→b48 行。ビートスコアは同時行）。フレーム異常はローカルに総和保存。

#### T5 ソルバー（tests/golden/t5-solver.test.ts・一時）を実装
- 乱数消費順にトレースイベントを復元し、行単位の gained をターゲットに
  r∈[950,1050] 整数の厳密一致（Σ computeEventScore(rand)==gained）を解く。
  行で解けない場合はフレーム異常を考慮し隣接行と統合したリージョン（最大3行）で総和一致。
- クリティカルフラグ（yellow_lanes）を反映（b4/b5 の L3 は crit: critF≈3151、
  b156 は crit かつ ccu=30 で critF≈4651）。b103 の割合型行は累積依存のため反復収束。
- 結果: 55 リージョン中 5 が厳密解。**残りは (a) L3 ビートの系統的過大（×0.60-0.85・
  全ビートリージョンの s≈0.70-0.79 の主因）、(b) type36 の perStagePermil 未フィッティング
  （b69 s=1.93・b156 s=1.20・b103 s=1.84）、(c) A/SP 単発イベントの 1-9% の係数誤差
  （b30 s=1.02・b80 s=0.94・b106 s=1.09 等）に分類される。**
- L3 ビートの s が buff 推移と連動して変動することから、根本原因は「L3 のビート B1/CB
  構造またはバフ進化（延長/増強の対象）」である可能性が高い。passive イベントは整合
  しているため、**ビート固有の係数構造（su/csu/bonus の組み合わせ）の機械探索**が次一手。

#### 次ターン（T5 継続）
1. L3 ビート構造の確定: (beatSu, beatCsu, bonus.beat 有無, 延長/増強対象) の仮説空間を
   ソルバーの厳密一致率で評価する（debugOptions を拡張済み: beatSuPermil/beatCsuPermil/
   extensionMode none 追加）。
2. 増強（amplify）の対象選択: b118 +2 が csu に乗る実測 → 「vocal_type_1 の最長」または
   「キー内最長」説をエンジンに実装して検証。
3. type36: L3 ビート確定後に b69/b156/b103 の 3 方程式で perStagePermil を確定し
   skills_golden.json へ反映（engine の scaling 実装は済み）。
4. ソルバー再実行 → t5_replay_rands.json 生成 → T5 本テスト
   （ReplayRng で total_score 17,529,132,014 完全一致+リージョン照合）を実装。

---

## P3d: T5 ゴールデン完全一致達成（2026-08-30・連続乱数確定）

### 結果
- **総スコア 17,529,132,014 に 1 の位まで完全一致**（tests/golden/t5-scores.golden.test.ts 4/4 PASS）。
- **統合リージョンを除く全 119 ビートで累積スコアが実測 cumulative と 1 の位まで一致**（CUMCHECK errors=0）。
- 統合リージョン 20 区間 36 ビート（b1-3 表示遅延 / b47-51, b68-72, b80-87, b97-98, b101-103, b106-109, b123-124, b130-132, b146-151 のフレーム帰属・ポップ混入ゾーン）もローカル総和で完全一致。
- ソルバー: tests/golden/t5-solver.test.ts（ビート毎厳密逆算、2 反復で収束、fixtures/t5_replay_rands.json 生成）。

### 本セッションで確定した仕様（【T5確定】）
1. **スコア乱数は連続値（float, [0.95,1.05]）**。整数パーミル仮定では単一 A スキル 9 イベントの ±0.03% ワobble が説明不能だったが、連続値なら全イベントが成立帯に収まる。computeEventScore の randPermil 検証を非整数許容に変更。
2. **丸めは at-end（最終 floor のみ）**。sequential（ステップ毎 floor）では crit 係数との二重 floor により約 21.5% の目標値が到達不能になり（b156 で発生）、実測と矛盾。
3. **フォト行はクリティカル判定の対象外**。b47/b132/b125 のポップが全て非 crit で成立（crit 適用では r≈200-930 で範囲外）。
4. **b1 は全レーンミス**（LIVE START 直後の取りこぼし）。b1 のポップが全レーン null、かつ b1-3 リージョンの達成帯がミスなしでは不成立（s=0.9491）。missedNotes を SimulateInput に追加。
5. **b97/b132 の L3 ビートはクリティカル**。フォトポップの遮蔽で critFlags 抽出から欠落していた（b97 を crit 扱いすると領域 97-100 の s=1.158→1.001、b132 で 1.186→1.002）。t5_measured.json に補正。
6. **wedding A（sk-ktn-05-wedd-00-2）の type20 効果は combo_score_up+5 [60b]**（旧解釈 critical_coeff_up+self_visual_lane 不発は誤り）。b107 以降 csu=min(26+5,30)=30（かんしょ combo_score_limit+10 の上限でクランプ）となり b106-155 の全領域 s∈[0.987,1.023] に成立。旧解釈では critF=4,901 が必要になり b116+ の実測と矛盾。
7. **type36 スケーリング**: A fest-03-2 は perStage=2.5‰/段（b2/b69/b156 の 3 点フィット、成立帯 [2.37,2.78]）、SP fest-03-1 は perStage=11‰/段（比率行との結合 A×2.68689+667M=15,147M → A≈5,390M、成立帯 p∈[10.9,11.1]）。初版の SP=90 は比率行の結合係数 1.68689 を忘れた誤りだった。
8. **photo-L3-2 の score_get は 160‰**（テキスト表記 20% と食い違い）。b47/b97/b132 のポップ（万 truncation）から確定。b97 のポップ 330万は誤 OCR（350万なら r=986 で成立）。
9. **比率行の基準累積はレーン累積+A行加算後**（trace に ratioBaseCumScore を追加。b103 検算 basic=533,472,897=4,445,607,475×0.12）。
10. **比率行を含むリージョンの逆算は構成的不動点**: 先行乱数を 1000 に固定すると base' が反復に依存しなくなり 1 反復で収束。uniform f 方式は利得 −1.687 の発散振動を生んだ（実測 diff 列が等比 ±1.687 で発散することを確認）。
11. ポップ表示は **10 万単位 truncation**（390万 = [3.90M, 4.00M) の 100K 幅）。ポップによる r の精密判定は不可で、gained/cumulative が信頼できる。
12. 残サ: b106-113 は (csu=30) 解釈で領域 106-109 s=1.012 / 110-113 s=0.987 に解決。b97-100 s=1.001 / 130-133 s=1.002。

### 変更ファイル
- src/formula/scoreEvent.ts: randPermil 検証の非整数許容、multiplySequential/multiplyAtEnd の float 乱数対応
- src/timeline/engine.ts: missedNotes 対応、フォト行 crit 除外、ratioBaseCumScore トレース追加、type36 スケーリングの素の乗算化
- src/timeline/types.ts: SimulateInput.missedNotes、LaneScoreEventTrace.ratioBaseCumScore
- data/skills_golden.json: photo-L3-2 pow 200→160、fest-03-2 perStage=2.5、fest-03-1 perStage=11、wedd-00-2 type20→combo_score_up+5
- tests/golden/fixtures/t5_measured.json: b97/b132 の critFlags 補正
- tests/golden/t5-solver.test.ts: 連続乱数ビート毎厳密逆算ソルバー（全面書き換え）
- tests/golden/fixtures/t5_replay_rands.json: 生成乱数列（連続値 717 イベント分）
- tests/golden/t5-scores.golden.test.ts: ゴールデンテスト（新規・4 tests）
