# S4 再撮影手順メモ（Step C 用・2026-09-05 Step C-pre で作成）

対象: `qt-ex-tower-004-054`（EXタワー Liznoir-054）の全面再撮影。
本メモは Step C のセッションを跨いでも同一手順で動くことを目的とする（AGENTS.md の「プロンプトが手順書を兼ねる」運用）。
進捗の一次情報は `research/22_sample4_rollback/progress.md`。背景は `prompts/rollback-recapture-sample4.md`。

---

## 0. 最重要規律（読み飛さないこと）

1. **暴走防止ルール（`aipura_nox/create_sample.md` 最上位）**: アプリ クラッシュ/フリーズ、
   `recognize_beat()` 3 回連続失敗で即停止・ユーザー報告。勝手な再挑戦・リタイア禁止（ライブチケット保護）。
   撮影完了/停止時は画面を触らず静止して報告
2. **誤タップ回避（S4 無効化の直接原因の一つ・ユーザー指示）**:
   - **A/SP/P/フォトスキルのアイコンをタップすると、そのレーン（やビート）にカメラが遷移する**。
     タップ禁止ゾーンは:
     - スキルアイコン帯 **y=1450〜1575**（各カード上の A/SP/P スキルアイコン・CT バッジ・赤 X）
     - 「現在の効果」ボックス内のアイコン（x≈20〜660, y≈230〜760・内容量で伸縮）— **スクロールはスワイプのみ**
     - タイムライン上のノーツ・SP リング（レーン中心 X = 108/324/540/756/972 の帯）
   - **タップしてよいのはアイドルカード帯 (lane_x, 1630) のみ**（フォーカス切替）
   - タイムラインのスクロールは**レーン境界 X (216/432/648/864)** でのスワイプのみ
   - 誤って遷移してしまった場合: 焦らず目的ビートへ戻り（BEAT カウンタ確認）、
     目的レーンのアイコンを再タップ → 名前帯で確認してから続行
3. **NoxPlayer の競合**: 本再撮影の開始時点で Nox が他サンプル収集中の場合は**開始しない**。
   ADB 接続 (127.0.0.1:62001, 1080×1920) が空いてから実施する
4. 旧 S4 の実測データ・解析（隔離フォルダ `サンプル4_invalid_capture_20260905/`）は**読み書きしない**
   （ツール開発の検証で参照した実績は progress.md に記録済み）

## 1. 撮影対象と編成（旧 deck.json の編成コピー・2026-09-05 保全）

ステージ: `qt-ex-tower-004-054`（EXタワー Liznoir-054）／譜面: `chart-tri-004-001`
（全 167 ビート: beat 0〜166。ライブボーナス: マスタ上なし — `data/stages_index.json` 由来。
`live_bonus.png` を撮れるなら撮って `stage.live_bonus_check` を更新）

観客 8,000 / critRate 0.5 / missedNotes なし / `communication_levels.json` は `aipura_nox/サンプル4/` に残置済み。

| レーン | card_id | キャラ | ロール | Lv | レア | 交流 | スキルLv (A1/A2/A3) |
|---|---|---|---|---|---|---|---|
| 1 | card-chs-05-fest-00 | 白石千紗 | Supporter | 182 | ★5 | 14 | 4 / 4 / 2 |
| 2 | card-rei-05-fest-00 | 一ノ瀬怜 | Buffer | 182 | ★6 | 18 | 5 / 4 / 3 |
| 3 | card-ngs-05-fest-02 | 伊吹渚 | Scorer | 182 | ★10 | 15 | 6 / 5 / 4 |
| 4 | card-szk-05-sail-00 | 兵藤雫 | Supporter | 182 | ★5 | 11 | 3 / 5 / 2 |
| 5 | card-suz-05-fest-02 | 成宮すず | Buffer | 182 | ★6 | 16 | 4 / 4 / 3 |

フォト（Quality カッコ内）:

- **L1 白石千紗**: フォト1 (150) dance+10986/visual+46.3%/stamina+36.2%/mental+1574/sp_score+203433 /
  フォト2 (140) vocal+44.4%/dance+37.4%/visual+45.8%/beat_score+19.3%/critical_score+23.4% /
  フォト3 (150) vocal+25.4%/visual+35.5%/mental+929/beat_score+713 /
  フォト4 (85) vocal+33.2%/dance+33.2%/visual+36.4%/mental+442/beat_score+230
  アクセサリ: ビジュアルリボン (visual+24500/visual+30.0%)、メンタルペンダント (mental+2420)
- **L2 一ノ瀬怜**: フォト1 (150) vocal+7442/dance+33.5%/mental+1205/sp_score+8.5% /
  フォト2 (150) dance+30.4%/critical+1067/mental+1033/a_score+7.3% /
  フォト3 (135) dance+33.1%/critical+800/mental+933/critical_score+14.0% /
  フォト4 (150) vocal+41.9%/dance+46.3%/stamina+29.4%/sp_score+224478/beat_score+1150
  アクセサリ: ダンスシューズ (dance+19300/dance+25.0%)、メンタルペンダント (mental+2420)
- **L3 伊吹渚**: フォト1 (155) vocal+13623/dance+39.9%/stamina+31.2%/critical+1542/critical_score+21.6% /
  フォト2 (145) vocal+44.0%/dance+39.7%/stamina+35.2%/mental+1586/a_score+13.4% /
  フォト3 (140) dance+40.2%/visual+9881/stamina+34.0%/a_score+62833/beat_score+639 /
  フォト4 (130) dance+33.1%/visual+34.4%/stamina+34.5%/mental+910/critical_score+18.9%
  アクセサリ: 伊吹渚専用ダンスシューズ (dance+29400/dance+35.0%)、メンタルペンダント (mental+2800)
- **L4 兵藤雫**: フォト1 (140) dance+44.4%/visual+43.0%/critical+1248/mental+1289/a_score+66641 /
  フォト2 (140) dance+37.4%/visual+40.2%/mental+1456/a_score+13.2%/beat_score+20.7% /
  フォト3 **小美山愛メモリアル (150)** vocal+43.0%/dance+43.0%/visual+43.0%/a_score+10.7%
  （**フォトスキル持ち**: critical_coeff_up 4段/48ビート/score_type_1/someone_skill_success_up/
  スタミナ消費706/ライブ1回 — `photo_skill_lane4_3.PNG` 残置済み・uph-lane4-3） /
  フォト4 (140) vocal+9282/dance+43.0%/mental+1081/a_score+47601/critical_score+23.4%
  アクセサリ: ダンスシューズ (dance+24500/dance+30.0%)、メンタルペンダント (mental+2610)
- **L5 成宮すず**: フォト1 (125) vocal+40.0%/dance+38.7%/visual+7562/critical+828/a_score+44437 /
  フォト2 (150) dance+31.4%/critical+895/mental+929/critical_score+19.1% /
  フォト3 (145) dance+30.7%/visual+28.7%/mental+1110/sp_score+6.2% /
  フォト4 (120) vocal+6838/dance+32.7%/mental+836/a_score+36919/beat_score+15.9%
  アクセサリ: ダンスシューズ (dance+19300/dance+25.0%)、メンタルペンダント (mental+2420)

完全版（stats の base / total_after_non_skill_modifiers・staff_bonus・yale_bonus・mentalOverride 含む）は
`C:\Users\umaro\Documents\aipura_nox\サンプル4\deck.json`（**機能ファイルとして残置済み・これをそのまま使う**）。
上表はファイル喪失時の復元用ミラー。編成を変更**しない**こと（旧 S4 との比較対象を維持するため）。

## 2. 撮影の構え（何を・なぜ）

- S4 無効化の根本原因: **「あるビートの全 5 フレームでカメラが目的レーンを向いていない」事象**（全レーンで発生。
  旧実測では自レーン フォーカス率がパス毎に 13〜17% しかなかった — `acceptance_selftest/focus_check_report_summary.json`）
- 目標: **全ビート（0〜166）× 全レーン（1〜5）の 835 セルすべてに「そのレーン フォーカス済みフレーム」が存在**する状態。
  これが揃えばレーン別スコアポップが初回解析で全記録でき、遡及（backfill）は不要になる（= 再撮影の主目的）
- 各レーン 1 パス（lane1〜lane5 フォルダ）で全ビートを撮る旧フローを維持しつつ、
  **保存直前にフォーカス判定 → NG なら同じビート内でリテイク**する（§3）

## 3. 使用ツール（Step C-pre で作成・検証済み）

### aipura_nox 側（撮影）

- **`capture_lane_focus_retake.py`**（新規。旧 `capture_lane_generic.py` を継承しフォーカス検証を追加。
  旧スクリプトは残置・変更しない）:
  - `focus-setup`: 名前帯参照（`サンプル4/focus_refs/lane{1-5}.png`）を**実画面から校正**。
    クロス判定マトリクス（最小マージン 0.30 が必要）+ 同梱テンプレート突合で停止保証。
    **セッション冒頭で必ず 1 回実行**
  - `lane <L> [wait_sec] [start_beat]`: レーン L を全ビート撮影。
    保存前に名前帯テンプレートマッチングで判定（閾値 0.80）→ 非フォーカスなら
    **同じビート内で再タップ→再撮**（待ち 0.5→2.0s に段階延長、4 ラウンド目直前に ±1 ビート揺らし）。
    それでも NG なら `beat_NNN_NG.PNG` 保存 + `focus_retake_log.json` 記録（タイムラインは進む）
    → 後で `repair`。既存ファイルはスキップ（セッション跨ぎ再開可能）
  - `repair <L> <beats>`: 欠損ビート（カンマ区切り）のみ再撮（reset_to_zero 後個別アプローチ）
  - `stepd [wait_sec]`: 青ドット 7 個以上のビートの効果欄スクロール追加撮影（beat_NNN_2.PNG・フォーカス検証込み。
    スクロールスワイプがタップ誤認されても検出→再タップ→再撮）
  - 判定器の実績: 旧 S4 ラベル付き 909 フレームで精度 100%（自 1.000 vs 他最大 0.546）
- `capture_skill_order_proper.py`（既存・Step B スキル発動順の撮影。変更なし）
- `templates/name_band/lane{1-5}.png` + `README.md`（同梱テンプレート。フォールバックと突合先）

### 本リポジトリ側（検収）

- **`tools/recapture/focus_check.py`**: 全ビート×全レーンのフォーカス検収（自動判定）。
  セル判定 OK / MISSING（ファイル無し）/ NOFOCUS（全フレーム非フォーカス）/ NGFILE（NG 保存分のみ）/
  LOWMARGIN（要目視）。NOFOCUS・MISSING は `repair` の対象リストとして出力。
  **フォルダ名とフォーカスは無関係**（どのフォルダのフレームで目的レーンにフォーカスされていても OK）
- **`tools/recapture/make_focus_sheets.py`**: 目視検収用クロップシート（名前帯+BEAT カウンタ、9 枚/シート）。
  自動判定の抜き取り目視・LOWMARGIN 確認に使う
- 検証実績（旧 S4 無効データへの読み取り専用セルフテスト・`research/22_sample4_rollback/acceptance_selftest/`）:
  NOFOCUS 400 セル = 旧 backfill の「該当フレームなし 400 セル」と完全一致、
  OK 435 = 読取可能 385 + popなし 50 と完全一致。シート 1 枚目視確認済み

## 4. セッション手順（Step C・人間補助前提）

> 複数セッション可。**毎回 §4.0 から入る**。終了時は §4.6 をやって progress.md を更新してから報告。

### 4.0 前回までの検収（セッション冒頭・毎回）

1. `research/22_sample4_rollback/progress.md` を読む（撮影済みレーン/ビート・欠損・リテイク記録）
2. 前回分があるなら検収:
   `python tools/recapture/focus_check.py "C:\Users\umaro\Documents\aipura_nox\サンプル4"`（本リポジトリで実行）
3. 検収結果の missing/nofocus があれば `repair` サブコマンドで拾う（Nox が空いている場合）

### 4.1 準備（人間操作を伴う）

1. NoxPlayer が他サンプル収集中でないことを確認 → ADB 接続確認（127.0.0.1:62001）
2. `aipura_nox/create_sample.md` §1〜§4 に従い、ライブ実施〜リザルト〜分析画面まで進める
   （編成は §1 のとおり・`サンプル4/deck.json` どおり。**ライブチケット保護ルールを最優先**）
3. 分析画面に入ったらディレクトリ確認（`サンプル4/lane1〜5`, `skill_order`）

### 4.2 スキル発動順（create_sample.md Step B）

`python capture_skill_order_proper.py サンプル4`
（既存スクリプト。**スキルアイコンの吸着を利用するスクリプトなので、ここだけは§0 のタップ禁止に含まない**。
ただし手動操作時は §0 を遵守）

### 4.3 フォーカス校正

`python capture_lane_focus_retake.py サンプル4 focus-setup`
→ クロスマトリクス（マージン ≥ 0.30）と同梱テンプレート突合が全 OK であることを確認。
LOW MARGIN / 不一致で **ABORT が出たら撮影を始めない**（ユーザーに報告）

### 4.4 各レーン全ビート撮影（create_sample.md Step C 相当）

```
python capture_lane_focus_retake.py サンプル4 lane 1 5.0
python capture_lane_focus_retake.py サンプル4 lane 2 5.0
...（lane 5 まで）
```

- 途中で異常停止した場合: BEAT 認識 3 連続失敗なら**再試行せず報告**（暴走防止ルール）
- 再開は `lane <L> 5.0 <start_beat>`（既存ビートは自動スキップされるので、まず focus-setup からやり直して
  `lane <L> 5.0` でも可）
- NG 保存分（beat_NNN_NG.PNG）が出たレーンは、パス完了後に focus_check → `repair <L> <beats>` で拾う

### 4.5 効果欄スクロール撮影（create_sample.md Step D 相当）

`python capture_lane_focus_retake.py サンプル4 stepd 2.5`

### 4.6 検収と終了報告

1. `python tools/recapture/focus_check.py "C:\Users\umaro\Documents\aipura_nox\サンプル4"`
   → 全セル OK（MISSING/NOFOCUS/NGFILE = 0）が目標
2. 抜き取り目視: `python tools/recapture/make_focus_sheets.py ... --beats <怪しいビート>` で確認
3. 検収で残った欠損は **諦めて missing_frames として列挙**（無理に粘らない。理由を progress.md に記録。
   カメラがビートに強くロックされる区間（スキル発動・サビ等）では上書きできない可能性がある。
   旧 S4 の nofocus 集中帯（例: beat 17〜36 は伊吹渚固定）を参考に事前に心構えを持つ）
4. progress.md に記録: 撮影済み範囲・検収結果・NG/リテイク件数・欠損リスト・次回指示事項

### 4.7 完了条件（Step C 全体）

- [ ] 全ビート（0〜166）× 全レーン（1〜5）のフォーカス検収が OK（欠損 0・達成不能なら理由付きリスト）
- [ ] `focus_retake_log.json` の保存
- [ ] skill_order・Step D（_2 系列）も含めファイル一式が `aipura_nox/サンプル4/` に揃っている

## 5. 次ステップ（Step D 以降・本メモでは実行しない）

- Step D: `prompts/measure-new-sample.md` に従い measured_data.json 生成 +
  **全ビート×全レーンの `gained_score_pop{color,text}` を初回解析時に記録**（AGENTS.md 2026-09-05 規約）。
  フォーカス検収済みなので遡及 backfill は不要なはず（これが再撮影の主目的）
- Step E: `prompts/improve-from-sample.md`。src への確定仕様実装は新データ検証を通ってから
