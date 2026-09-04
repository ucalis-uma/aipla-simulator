## 2026-09-03 結論: サンプル3（STAGE045・Blow Up・ⅢX）取り込み — 6 確定仕様の実装

### 実測（aipura_nox/サンプル3・実測 79,411,389 vs sim）

- examples/sample3.json（deck.json 複製・audience のみ合計 40000→個人 8000 に修正）。
- CLI 確定値（crit なし・乱数中立）: before 184,864,596 → **after 72,427,317**（実測 ×0.912）。
  （2026-09-04 追補: ct_cuts 適用後は 63,123,447。crit 再現ランが正規の比較軸）
- crit フラグ再現ラン（research/21_sample3_gap_analysis/trace_dump.ts）:
  **79,957,391 vs 実測 79,411,389 = ×1.0069**（消費自属性化・フォト残スタミナ参照の適用後）。
  レーン別 L1 ×1.055 / L2 ×0.980 / L3 ×1.009 / L4 ×0.995 / L5 ×1.045（全レーン ±5.6% 内）。
  終端スタミナ [303, 233, 867, 1064, 125]（実測 [17, 233, 541, 1064, 125]。L4 一致）。
- スケジュール一致: 開幕バースト・b2/b3/b4/b13/b14/**b42**/b24/b34/b41/b50/b51/b53/b60/b61/b70/b79/b81
  の発動が一致（LB 後半機構による b3/b13 再発動・CT25 による b42 を含む）。
- A イベント 10 件中 7 件が ±5% 内（b4/b14/b24/b34/b79/b169 + b51 0.96）。

### 確定した 6 つの規則（サンプル3 実測）

1. **ステージのスタミナ消費倍率**（Quest.skillStaminaWeightPermil。STAGE045=3000=3.0倍）。
   8 件以上の発動で 1 の位一致。`StageInput.skillStaminaWeightPermil` を新設し消費計算に乗算
   （バフ→ステージの順）。stages_index configs に `st` を追加。
2. **battle_only 行は無条件扱いしない**（S3 L2「誰も知らない雲の向こうへ」
   [combo>=50, battle_only] が b1 前半誤発動→limit=1 消費で b50 を潰していた）。
   T5「結婚への願望」[none, battle_only] は none 行で前半発動のまま不変。
3. **`*_high_N` はライブ中ステータス降順**（b61 ライボ対象が deck 順 {L4,L3} ではなく
   ライブ中 visual {L4:679074, L1:222021} の {L4,L1}。deck 順ではさらけ出す b61 誤発動）。
4. **継続回復 tick = 15 × 段階 × ライブ特徴**（research/02 §1.8 と一致。
   のんびり/泥酔とも +45/beat = 15×3×1.0。100+ デルタ・効果窓 42b/24b で確定）。
   `staminaRecoveryWeightPermil`（0=特徴なし=1000扱い）を新設。configs に `rw` を追加。
5. **limit_break 行は上限解放のみ・段数不加算**（L1A「手を伸ばす」b53/b61/b81 の上昇 11/15/15。
   マスタ技能文も上限解放効果と上昇効果を分離記載。*_limit 変数型・T5 b2 と同一規則）。
   buffs.test.ts の旧期待値 2 件を実測根拠付きで更新。
6. **audience は個人来場数**（S3 deck の 40000 は fan.png 合計。8000=均等割に修正。
   合計のままではファン係数 1900/1375 = 1.38 倍の系統過大。lane_fans 真値 6684-8535
   に対し base 差 ±2% 以内。非均一来場の厳密対応は残課題）。
7. **フォト付与の静的 CT 短縮**（2026-09-04・ユーザー提供。`DeckCharacter.ct_cuts`。
   S3 L4 早坂芽衣 6/6 の CTカット2nd → A（-2）の CT30→25。b14→b42 の gap 28 と整合。
   発動イベントなしのため静的適用。マスタ schema 未確定のため【Estimate】）。
8. **キャラ優位**（2026-09-04・ユーザー提供。`QuestCharacterAdvantage` → 
   `data/character_advantage.json` → `LaneInput.characterAdvantagePermil`。
   STAGE045 の ⅢX メンバー（L5 miho）に ×2.25 を全スコアイベントへ後段乗算。
   ファクター列への追加は T5 golden を float 丸めで壊すため禁止・後段方式）。
9. **延長は継続回復の予約にも効く**（2026-09-04・ユーザーの指摘から確定。
   さらけ出す b13/b73 の +7 で のんびり回復窓が 36→43b。メンタル順により
   b1・暗闇 b1/b50 の延長は無効。既存規則のまま成立）。

### 決定打・棄却仮説（記録）

- issues #1「開幕 P は CT 不消費」説は**棄却**: b1 ライボ CT-47（後半発動）の効果であり、
  現行エンジンが b3/b13 を再現する。新規実装なし（S3-5 テストが回帰ロック）。
- 「T5 由来 golden フォト混入」: trace_dump の goldenPhotoNames 未指定が原因の分析ミス。
  CLI と同一の名前一致モデルに修正（実装変更なし）。
- 「写真の候補優先度」: クリ b51 は limit=1（uph-lane5-2/4 各1回）+ combo>=50 +
  スロット順で説明可能。新規則なし（b42 由来の combo ずれが顕在化させていた）。
- 「L4A b14/b42 の CT 短縮イベント」: S3 全スキルに ct_reduction なし（LB 除く）。
  未収録発動の可能性はなし。

### 残差と要因（定量・2026-09-04 未明更新）

- R1: **解消**（ct_cuts により L4A b42 が発動）。
- R2: R1 由来の sim 余剰発動は**解消**。
- R4: b123 L3A 1.096（crit 再現つきで +9.6%。no-crit 換算では不一致のため旗は正の見込み）。
- R5: **解消**（延長の回復予約への適用。L3 ×1.017・b169 発動）。
- R6: L3 b2 スタミナ境界ノイズ等（【Unknown】継続）。
- R7: L5 ビートの優位 ×2.25 に対し実測 ≈×2.02-2.11（L5 ×1.051）。per-lane fan
  （6684 vs 8000）の半分を説明。残りは未解明（優位の適用範囲・値はユーザー確定どおり実装）。
- R3: b81 L4A は 0.969 に改善（combo 軌道の一致による）。残りは beats drift 等。
- R4: b123 L3A 1.57 倍は critical_flags の lane-beat 単位への conflation
  （no-crit 換算で 0.97）。再現ランの手法限界として記録。
- R5: のんびり回復の持続 42b（deck Lv3 の 36b と不一致・270 スタミナ分の軽微差）。
- R6: L3 b2 スタミナ -1449・b3 -402 境界ノイズ・b25/b80 の +90 tick ゆらぎ（【Unknown】）。

### エンジン変更点（git diff 概要）

- `tools/importers/build_data_phase6.mjs` + `data/stages_index.json` 再生成（configs に st/rw 追加。
  5916 quests の内容不変・config 3456→3642 件。T5/S2 ステージは st/rw=1000 で中立）。
- `src/timeline/types.ts`（StageInput 2 フィールド）・`src/sim/build.ts`
  （StageWeights 2 フィールド＋透過）・`src/cli/simulate.ts`＋`ui/app.ts`（st/rw 解決）。
- `src/timeline/engine.ts`: staminaCostOf（消費×3.0）/ isUnconditional（battle_only 除外）/
  attrStatDescLanes（ライブ中順位）/ recoveryTickOf（15×段階×特徴）/
  activateLiveBonuses・tryActivate の行評価は不変。
- `src/timeline/buffs.ts`: aggregateBuffs の limit_break 行は段数不加算（上限拡張のみ維持）。
- テスト: `tests/unit/timeline/sample3-specs.test.ts` 新設 9 本・buffs.test.ts 期待値 2 件更新。
- 全テスト **474 passed / 1 skipped**・typecheck 2 件・T5 2 値・S1/S2 確定値すべて不変・build:ui OK。
