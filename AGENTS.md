# AGENTS.md — エージェント共通の基本指示（IDOLY PRIDE ライブスコア計算機）

このリポジトリで作業する全エージェント（画像解析・編成入力生成・開発）は、
作業開始時にこのファイルを読むこと。詳細は各専門プロンプト（`prompts/` 配下）が優先されるが、
**データ出典の規律はこのファイルが大元**である。

## 最初に読むもの

| ファイル | 内容 |
|---|---|
| `PLAN.md` | 全体計画・フェーズ履歴 |
| `workspace_map.html` | **作業環境の可視化マップ**（ブラウザで開く）。2ディレクトリ・5エージェントの全体像・データフロー図・セッション年表・フェーズ進捗・ディレクトリ詳細 |
| `research/03_data_sources.md` | **ゲームデータの出典管理表**。どのデータをどこから取ってよいかはここが一次情報 |
| `research/12_implementation_log.md` | 実装ログ（末尾 = 最新）。**Phase 13（2026-09-05）以降のみ**を保持 |
| `research/12_implementation_log_archive_phase0-12.md` | 実装ログのアーカイブ（Phase 0〜12・2026-08-29〜09-04）。`research/12 §5` / `§7〜§9` / `Phase 3b` などの旧参照はここを指す |

## 作業環境の全体像（2ディレクトリ構成）

作業は2ディレクトリに分かれている。位置関係・データフローを誤解しないこと
（詳細は `workspace_map.html` の「全体マップ」「ディレクトリ詳細」タブ参照）:

| ディレクトリ | 役割 | 性質 |
|---|---|---|
| `C:\Users\umaro\Documents\アイプラ`（本リポジトリ） | シミュレータ開発・解析結果の集約先 | git 管理。コード変更は必ずここ |
| `C:\Users\umaro\Documents\aipura_nox` | NoxPlayer (ADB) からの実測データ収集 | **git 管理外**。撮影スクリプト・スクショ・`サンプルN/measured_data*.json` |

データの流れ: `aipura_nox/サンプルN/`（スクショ→解析→measured_data）→ 本リポジトリの
`research/`（乖離分析等）→ `src/`・`data/` へ反映。逆方向（aipura_nox 側の計算機コード変更）は起こらない。

**aipura_nox 側での作業規律**:
- 撮影作業は `aipura_nox/create_sample.md`（撮影プロンプト仕様書）に従う。同書最上位の
  暴走防止ルール（クラッシュ/`BEAT is None` 3回連失敗で即停止・勝手な再挑戦禁止＝ライブチケット保護）を遵守
- 撮影スクリプトは `capture_lane_generic.py`（中核）＋`capture_all_lanes.py`（全レーン実行+欠損検証）が現行。
  `capture_lane1_*.py`・`resume_lane3_*.py` 等は過去の試行錯誤の痕跡（`repair_missing_beats.py` は破損・使用しない）
- 実測サンプル内の既存ファイル（スクショ・measured_data 等）は削除・改名・上書きしない（欠損修復は追記のみ）

## ゲームデータの参照規則（最重要・過去に繰り返し失敗した箇所）

スキル・カード・譜面・ステージ等のゲーム内データは、**画面スクショの読み取りに頼らず
ゲーム内マスタから確定する**。マスタは2経路で入手でき、**内容は同一**（2026-08 突合済み・
全491カード/全2043スキル。出典の詳細と使ってよい範囲は `research/03_data_sources.md`
§2.1 [MD] / §2.2 [IP]・[IP-V] 参照）:

1. **Info Pride vendor API**（Info Pride = https://ip.outv.im ・日本版マスタ・週次更新）:
   - カード ID → スキル ID: `https://idoly-backend.outv.im/api/Card?id=<カードID>`
   - スキル ID → **レベル別効果テキスト**: `https://idoly-backend.outv.im/api/Skill?ids=<スキルID>`
     → `levels[]` に Lv1-6 の `description`（%値・段数・[Nビート]・**延長/増強の値**を含む）・
     スタミナ消費・CT が入る
   - カード ID 検索: `https://idoly-backend.outv.im/api/Card/List?level=230&rarity=10`
2. **リポジトリ内ローカルマスタ**（オフライン用。`tools/importers/build_data_phase6.mjs` が
   `vendor/` から生成）: `vendor/Skill.json`（同 `levels[].description` + 機械可読の
   `skillDetails[].efficacyId`）/ `vendor/Card.json` / `data/skills_levels.json`
   （コンパクト形式・デコーダは `src/skillLevels.ts`）

**スキル ID はカード ID から機械的に導出できる**: `card-<id>` → `sk-<id>-1/-2/-3`
（例: card-ski-05-waso-00 → sk-ski-05-waso-00-1/2/3。4 枠目は絆覚醒 -4）。
デッキの各キャラは `card_id` を持つので、**そのカードの全スキル（未発動を含む）の
名称・枠種別（A/P/SP）・レベル別効果がスクショなしで確定できる**。

### スクショが不要なもの / 必要なもの

- **不要（マスタで確定）**: スキル名・枠種別・Lv別効果テキスト・CT・スタミナ消費・
  スコア%・段数・[Nビート]・延長/増強の値。**未発動スキルも含む**
  （「スキル詳細画面の撮影が必要」という結論の前に必ずマスタ参照を試すこと）
- **必要（マスタに無い）**: フォトのスキル（レベル別テキストなし→`photo_skill_*.PNG`）/
  実測の挙動（発動タイミング・バフの乗り方・コンボ等のライブ中の事実）
- **レーン別スコアポップの数字は全ビート×全レーンで必ず記録する（2026-09-05 追加・最重要）**:
  `measured_data` の `gained_score_pop{color, text}`（text は `+38.6K` 等の K 単位表示のままでよい）。
  遮蔽・非表示のときのみ `null` + 理由。**5 レーン合計（`beat_gained_score`）では各レーンの
  乱数が平均化されるため、基本係数 λ・off-attr 扱い・フォト重複規則の検証はレーン別ポップなしでは
  不可能**（research/23 pack_v2/05 参照。S4 ではポップ未記録のため純白ビート検証が 4 件に激減した）。
  既存サンプルへの遡及取得は `prompts/backfill-lane-pops.md` を使う
- **ポップの充足率（`pop合計/バー増分`）を語るときは「ポップが読めたレーン数 n」で層別化する**
  （2026-09-30 追加）: n=5 の層が ~1.0 であれば記録は健全。n<5 を混ぜると 0.4〜0.8 に沈み、
  「スキル発動ビートは pop が足りない」のような**架空の異常**を追いかけた（`phase16_action2d_lane_pops_audit.md`）。
  実効検査: `node tools/dump_lane_pops.mjs S1,S2,S3,S4`
- **`deck.json` の `audience` には「個人（レーン平均）来場数」だけを入れる（2026-09-30 追加・最重要）**:
  `fan.png` には似た数字が 3 つ並ぶ — ①総ファン数（レーン別 17万人台など）・②**来場ファン数**（レーン別、
  満員なら合計が会場キャパと 1 人単位で一致／空席があるとそれより少ない）・③スコアボーナス（+x.x%）。`audience` に入れるのは **②の 5 レーン平均**
  （= 見出しの合計来場数 ÷ 5、上限は `capacity/5`）だけ。①や**画面左上の目標スコア**を入れると fan が
  桁違いになりライブ全体が数倍 over-produce する（サンプル1 は `audience: 71000` = 目標スコア `clear` の
  誤入力で +127% 乖離 → `cap=100` から 20人・fan 1,002‰ に補正すると +0.25% に収束。`fan.png` の
  「レーン別 19・19・18・22・22」「スコアボーナス +0.2%」と一致）。人数が読めない場合は省略
  （エンジンが `capacity/5` から導出）。**受け入れ検査: `node tools/audit_audience.mjs`**
  （詳報 `research/23_beat_score_analysis/phase16_action2b_s1_audience.md`）
  - なお fan.png の「スコアボーナス ※最大 +x%」は `f(capacity/5)`（その会場の上限値）の表示。
    **ボーナスの決まり方は満員かで切り替わる**（5サンプル 25/25 で確定 → `phase16_action3b_fan_full_house.md`）:
    **来場合計 ≥ 会場キャパ（満員）なら全レーン = `f(cap/5)`、空席があるときだけレーン別来場数の表引き**
    （S2・S5 は空席 → レーン別表示が表引きと 5/5 一致／S1・S3・S4 は満員 → レーン別来場が偏っても一律）。
    現行エンジンは単一 `audience`（レーン平均）を全レーンへ適用する近似で、**満員会場ではこれが正確に一致する**
    → **`lane_fans[]` を実装するときは満員ガードが必須**（なしだと S3 L5 が係数 −2.4% の後退になる）。
    `fan.png` を撮れた回はレーン別ボーナス%を `stage.lane_fans[]` に記録すること
- **ステージのライブボーナスは「画面で確認できた場合のみ」計算に入れる**: 実測サンプルに
  `live_bonus.png` が無い場合はマスタ定義があってもライボなしで計算し、
  `stage.live_bonus_check: "not_captured"` を記録 + **ユーザーに明示して報告する**
  （ライボなし計算は実測より低く出る可能性がある旨も添える）
- **禁止**: BWIKI（wiki.biligame.com）由来データの数値利用。info-pride リポジトリ内の
  `data/wikiPages/cards.json` は BWIKI（中国版wiki）クロール由来で CN サーバー基準のため、
  JP の数値には使わない（research/03 §2.2 の規約。日本語テキストの相互検証のみ）

## その他の基本規律

- **作業終了の規律（最優先・2026-09-01 に 2 度違反）**: タスク開始時に**完了条件**を書き出す
  （数値・テスト・成果物。todo 化してよい）。完了条件が満たされるまで**チャットへのテキスト出力で
  ターンを終了しない** — テキスト出力＝停止とみなされる（「出力したら止まるって言ったよね？」）。
  進捗レポート・中間報告・仮説整理をチャットに書かないこと。途中結果は `research/` のメモ・
  JSON・実行ログ・todo に記録する（チャットは完成品の報告のみ）。
  ターンを終えてよいのは次のいずれかだけ: (a) 完了条件を満たした（最終まとめ報告 1 通のみ）
  (b) ユーザーの判断・承認が必要な分岐 (c) データ・材料不足で続行不能（何が足りるか明記）
  (d) 暴走防止: 連続 60 回のツール呼び出し、または作業開始から約 2 時間経過（その場合は
  進捗と残タスクを明記した中断報告のみ）
- 実測サンプルの入力ファイル（`aipura_nox/サンプル*/deck.json` 等の既存ファイル）は変更しない
- 推測実装には【Estimate】/【Unknown】タグ。読めない値の捏造禁止（null + 注記）
- 公式質問箱の検索: `python tools/peing_search.py <キーワード>`
- 計算機コード変更時: `npx vitest run` 全件 + `npm run typecheck` +
  T5 ゴールデン不変（`prompts/continue-session.md` の検証コマンド参照）

## マルチエージェント運用の実績（参考）

本プロジェクトは複数エージェント（opencode / cline / zcode / hermes / antigravity）の
並行・跨ぎ作業で進めてきた。過去に機能した運用パターン:

- **作業の引継ぎはセッション跨ぎでも `prompts/` のプロンプト化で行う**
  （例: `continue-session.md`・`measure-sample1-antigravity.md`。プロンプトが手順書を兼ねるため、
  どのエージェントに渡っても同一手順で動く）
- **PLAN.md と `prompts/` が全エージェントの共通言語**。新しい作業種別が生まれたら
  prompts/ に手順書として追加すること（`readme.txt` に一覧を書く運用）
- **他エージェントのセッション完了待ち→後続作業**のような連携は、監視対象のセッションIDを
  明示して指示する（実績: zcode が antigravity のサンプル2キャプチャ完了を待ってサンプル2分析へ）
- 各エージェントの履歴データの場所（過去調査の読み出し用）: opencode=`~\.local\share\opencode\opencode.db` /
  cline=`~\.cline\data\sessions\` / zcode=`~\.zcode\cli\db\db.sqlite` /
  hermes=`~\AppData\Local\hermes\state.db` / antigravity=`~\.gemini\antigravity\conversations\*.db`
  （`workspace_map.html` の「エージェント×作業履歴」タブに年表あり）
