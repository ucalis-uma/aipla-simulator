AGENTS.md（リポジトリルート）
は全エージェント共通の大元規約。prompts/ 配下の各プロンプトは冒頭でこれを読ませる前提

deck-json-from-images.md
は編成JSONを画像分析させるためのやつ

prompts/continue-session.md
は開発継続用の引継ぎプロンプト（0901 0:14 作成・09-02/09-03 のサンプル2対応で内容更新済み。
現状サマリ・テスト数・不変条件の数値はここが一次）

prompts/measure-new-sample.md
は新しいサンプルの画像解析→measured_data 生成（画像分析エージェント用）

prompts/improve-from-sample.md
は実測サンプルの計算機取り込み・確定仕様実装・乖離分析（計算機改良エージェント用）
2つのプロンプトはセットで使う: 先に measure-new-sample、その成果物を受けて improve-from-sample

prompts/measure-sample1-antigravity.md
はサンプル1測定時の記録（完了済み・新規は measure-new-sample.md を使う）

prompts/analyze-sample1-gap.md
はサンプル1乖離分析の診断専用プロンプト（完了済み 2026-09-02・S1 は ±5% 内で決着。
再利用の際は確定値を research/17_sample1_gap_analysis/CONCLUSION で更新してから使う）

prompts/continue-beat-score-session.md
は通常ビートスコア計算式の再推定・Fable回答検証用の引継ぎプロンプト（2026-09-05作成。
Fableに投げたプロンプトの回答URLとともに新セッションへ投入して検証・実装を進める用）

prompts/backfill-lane-pops.md
は既存サンプル（T5〜S4）のレーン別スコアポップ数字の遡及取得プロンプト（2026-09-05作成）。
LLM画像分析（OCR不使用）で元スクショから +38.6K 等のポップ数字を読み、
lane_pops_backfill.json に追記する。λ・off-attr・フォト重複規則のレーン単位検証に必須。
優先順位: S4 → S2 → S3 → S1/T5。新規サンプルでは measure-new-sample.md の規約どおり
初回解析時に gained_score_pop.text を必ず記録する（遡及は不要にする）


prompts/rollback-recapture-sample4.md
は S4 全面ロールバック+再撮影プロンプト（2026-09-05 作成・最優先）。カメラ自動遷移により
「全5フレームで目的レーンが非フォーカス」のビートが全レーンで発生したことが確定したため、
S4 のデータ・src 確定仕様・research/22/23 の S4 部分を無効化（隔離+マーカー方式）し、
フォーカス確認付きリテイクで再撮影→再解析する。
**ステップ実行式**: ユーザーが「Step A〜B まで」のように範囲を指示して起動する（撮影は人間補助が
要るため一括実行禁止）。進捗は research/22_sample4_rollback/progress.md が一次情報。
範囲未指定なら Step A のみ実行して停止。

prompts/continue-t5-backfill.md
は T5 欠損 111 セルの遡及引継ぎプロンプト（2026-09-05 作成・同日現状更新）。T5 は 1668×2420・IMG_NNNN 命名で
lane3 が「効果ウィンドウ状態数に応じ 1 ビート 1〜3 枚バースト」になるため、IMG↔beat 対応表の構築
（青ドット数ベース+既知シード照合）とクロップ座標再計測が前提。
画像分析のみで Nox 不要のため、**S4 再撮影（Step C）を待たずに並行実行してよい**
（2026-09-05 ユーザー承認。S4 は全面無効化済みのため本タスクでは触れない）。

prompts/continue-s1-backfill.md
は S1 レーン別スコアポップ遡及の引継ぎプロンプト（2026-09-05 作成・**完了 2026-09-05**:
793/885 セル取得・検証で 17 セル訂正・over-sum は b1 帰属ラグの 1 件のみ。詳細は research/12
2026-09-05 の「6. レーン別ポップ遡及の完了」）。S1 は標準フロー
（1080×1920・beat_NNN.PNG）なので make_pop_sheets.py がそのまま動き、対応表構築は不要。
未取得 885 セル全件が対象（170〜177 シート規模）。**T5 遡及と並列実行可**（2026-09-05 承認・
共存規律は各プロンプト §5/冒頭に記載: make_pop_sheets.py の改変は T5 セッション専任・
共有ファイルのコミット前には git status 確認）。

prompts/create-pack-v3-inquiry.md
は research/23 pack_v3（S4 完全除外・係数修正版の外部 LLM 投入プロンプト）の作成タスク
（2026-09-05 作成・2026-09-06 投入先をサービス非依存に変更・旧名 create-pack-v3-fable-inquiry.md）。
主問題は「S2 白ビート系統的 +4.5% シフトの犯人特定」。
S4 は無効化のため混入禁止・pack_v2 は書き換えない。係数は現行エンジン実装（B2 テーブル・
fan 引力式 1356‰・deck 実値 basicSum）に修正する。投入プロンプト本文にはサービス/モデル固有名を
含まない（単発チャット完結前提・回答の厳密検証はローカル側責任）。
ユーザーが v0.app 等の任意の投入先に貼り付け、回答 URL を prompts/continue-beat-score-session.md
とともに新セッションへ投入して検証する。S1/T5 遡及は完了済みのため実行順の制約はなく随时実行可。（**完了 2026-09-06**: pack_v3 5 ファイル + verification 3 ファイルを作成。
新知見 = S2 シフトはレーン別定数オフセット構造（L1 +1.5〜L5 +95.9‰・S3 は混号で相殺）。
投入プロンプトは 04a（インライン）・04b（GitHub raw URL 読取版）・04c（URL のみの最小構成・入力トークン制限対策）のどれか。
詳細は research/12「2026-09-06 pack_v3 の作成」エントリ）


prompts/continue-t5-backfill.md
は T5 欠損 111 セル遡及の引継ぎプロンプト（2026-09-05 作成・**完了 2026-09-06**:
111/111 popなし（ダッシュ確認）・lane3対応表確定（b0=1・b1-37=2・b38-156=3枚、IMG_0632/1000欠番）・
flags白色25件はダッシュ誤検出・K合計はover-sum1件のみ（既存値の帰属ラグ）。詳細は research/12 §8）。

prompts/continue-beat-score-session.md
は v0.app 等の外部 LLM 回答（レーン別オフセット仮説ページ等）の検証用引継ぎプロンプト。
検証結果は research/23_beat_score_analysis/pack_v3/05_v0_response_verification.md に記録済み
（2026-09-06・E0 新規実行でビート専用要因に絞り込み済み。次は E3 レーン入れ替えラン）

prompts/audit-buff-snapshots.md
はバフスナップショット全件監査・修正セッション用の引継ぎプロンプト（2026-09-20 作成）。
発端は S1・b132・L3 のコンボ上昇が実測 6 段に対し sim 16 段だった件（重ね合わせ加算の疑い）。
T5/S1〜S3 の全ビート×全レーンの効果段数突合→画像検証→sim 修正→厳格テスト化の手順。
成果物は research/25_buff_audit/ に出すこと。（**完了 2026-09-21**: T5 実測画像 1,060 枚をマルチモーダル画像認識サブエージェント 48 分割で全件再抽出して measured_data_v3.json 生成。過去の T5 スコア合わせによる琴乃Aスキル改ざんが発覚）。

prompts/recover-golden-integrity.md
は Phase 14 データ健全化（改ざん全件調査・復元）とバフモデル適正化セッション用の引継ぎプロンプト（2026-09-21 作成・**完了 2026-09-21**:
琴乃A/かけがえのない二人の公式マスタ復元、実効N-1 Decayモデル適正化、DECAY_TIMING_LAG 0件、テスト刷新、単一HTML UI再ビルド完了）。

prompts/audit-samples-s1-s3.md
は S1〜S3 新バフ減衰モデル再突合・影響分析セッション用の引継ぎプロンプト（2026-09-21 作成・**完了 2026-09-21**:
実効N-1モデル実証、S3スクロール画像46枚・74件のバフ統合修復、DECAY_TIMING_LAG 229件→48件に激減、レポート作成完了）。

prompts/resolve-s3-rei-p-and-s1-stage-mismatch.md
は S3 怜Pスキル不発解明（38件の残差解消）＆ S1 バフ段数4段ズレ解明用の引継ぎプロンプト（2026-09-21 作成）。
S3 の DECAY_TIMING_LAG 41件中38件を占める b125 怜P（ボーカル上昇38ビート）不発のメカニズム解明・Sim是正と、
S1 b61〜b67 のクリ率/Voブースト4段食い違い（12件）の解明・是正を行う。

prompts/extract-s2-measured-buffs.md
は サンプル2（S2）実測バフ自動抽出 & 突合セッション用の引継ぎプロンプト（2026-09-21 作成・完了）。
effects が空配列だった S2 の実機スクショ（全167ビート×全5レーン）から OpenCV 列スキャンマッチングで
バフ一覧を高精度自動抽出し、measured_data_v3.json を新規作成して S2 初のバフ突合と Decay 検証を完了させる。

prompts/implement-unhandled-skill-triggers.md
は未対応条件トリガーの包括的実装プロンプト（2026-09-21 作成・ステップA）。
マスタインポーター（build_data_phase6.mjs）で Unknown となり無条件発動（condition: none）に
fallback していた全条件トリガー（自身状態 tg-status-*、スタミナ比率、配置 center/most_left/most_right、
コンボ以下等）を包括的に実装し、無条件発動バグを根絶する。

prompts/fix-remaining-buff-mismatches.md
は実測バフ不一致の修正プロンプト（2026-09-21 作成・ステップB）。
LLM直接画像分析により特定された S3 のボーカルブースト5段誤認（実体はビジュアルブースト3段）のパッチ除去、
T5 の L3 ボーカルブースト 3段不足（20段 vs 17段）、S1 の L1 ボーカル上昇 8ビート連続 Decay Lag（b136〜b143）
等のシミュレータ/実測データ不一致を解消する。

prompts/phase15-followups.md
は Phase 15 引継ぎプロンプト（2026-09-27 作成・Phase 14-F 採用直後の残課題）。
出発点の確定値（T5 replay 17,521,599,508 / confirmed 2,581,114,209・504 tests）と現行監査の
残不一致内訳を明記した上で、15-1 S1 b136 の「Step 11 では満了バフが復活しない」仮定の独立検証、
15-2 PHASE_LAG_ACTIVATION の方針決定、15-3 EXTREME_DISPLAY / PERSISTENT_SP_BUFF / T5 FLAG_NOT_STAGED
（combo_continue 653件）の扱い、15-4 14-F の S1 単独寄与の分離トレース、15-5 単一HTML UI 再ビルド、
15-6 S4 再撮影（着手前にユーザー確認必須）を優先度順に並べたチェックリスト。
**→ 2026-09-28 更新: 15-1〜15-5 完了。残りは 15-6（S4 再撮影・ライブチケット消費のため要ユーザー確認）のみ。
15-4 の結論（14-F 単独の差分は S1/S2/S3 で 0 セル、T5 の 14 セルのみ／旧「+0.22pt」推定は撤回）は
`research/26_data_integrity/phase14f_revival_audit.md` §5–§6 と実装ログ `research/12` Phase 15-4 節。
再現用の恒久スクリプト: `research/26_data_integrity/audit_phase14f_s1_divergence.mjs`。**

prompts/phase16-action1-beat-score-analysis.md
は Phase 16 アクション1（2026-09-29 作成・通常ビート計算式の同定および S3 乖離要因分解）。
バフ一致率 100%（adjusted）達成を受けてスコア側ギャップの解明に着手。やる気士 docs 式（λ=1/20 + フォト sum）vs
現行エンジン式（λ=8/140 + フォト max）を含む通常ビート 4 モデルを「全ビート個別に ±5.0% 範囲内収束」を
唯一の判定基準として個別検証する。あわせて S3 confirmed 乖離（−8.24%）の要因（通常/スキル/クリティカル）を分解する。

prompts/phase16-action2-systematic-offset.md
は Phase 16 アクション2（2026-09-29 作成・**完了 2026-09-30**: コミット 0fe3383。
S1 の +127% 乖離は audience: 71000 = クリア目標スコアの誤入力と特定、cap/5=20人に補正して +0.25% に収束。
通常ビート式 λ=8/140・フォト max・crit・バフ計算はすべて無変更でよいと証明。
レーン別ポップ健全性 0.9965〜1.0000 実証。ファンボーナスはレーン別と判明）。

prompts/phase16-action3-per-lane-and-offset.md
は Phase 16 アクション3（2026-09-30 作成・**完了 2026-09-30**:
S4/S5 の fan.png 直接検証により、ファンボーナスの真の仕様が 5 サンプル 25/25 完全一致で確定。
「満員なら全レーン一律 f(cap/5)、空席ならレーン別表引き」の二段規則を特定。
素朴なレーン別表引きは 13/25 不一致で S3 L5 を −2.4% 改悪するため、実装には満員ガードが必須と証明。
S3 レーン別乖離は fan 原因から完全除外。tools/probe_beats.ts 移設で typecheck 0エラー復帰）。

prompts/phase16-action4-engine-fan-and-offsets.md
は Phase 16 アクション4（2026-09-30 作成・満員ガード付きレーン別ファンボーナス実装と発動ビート・系統オフセットの解明）。
アクション3bで確定した満員ガード付きファンボーナスの src/ 実装、トレース fan 欄微小差の解明、
S3 発動ビート+10%超過（b63/b71/b141）の真因特定、S1 残分散・フォト重複規則の最終決着を行う。

prompts/phase16-action5-* はプロンプト化していない（2026-09-30〜10-01 実行・完了 14c99e8。
CLI 経由 E2E は検B/C/D/後方互換すべて PASS、乖離マッピングで A/SP 失点と b90 上振れを特定。
詳報 research/23_beat_score_analysis/phase16_action5_report.md / 実装ログ §10）

prompts/phase16-action6-stamina-ledger-and-asp-activation.md
は Phase 16 アクション6（2026-10-01 作成・**最優先**・単独で着手可）。レーン別スタミナ記帳の初回分岐ビートを
特定して訂正し、「sim=0 かつ実測 pop>0」5 セル（S3 b4L2/b34L2/b169L3、S2 b112L5/b148L4）を発動成功＋pop±15% で
再現する。**発動成功セルの実測 pop（2.0〜3.9M）と失点疑いの pop（1.0〜3.2M）が同規模**のため、
「A/SP をヒット時点で払う（発動と独立）」規則変更よりも「実機では発動していた（= sim のスタミナ帳簿が過少）」が最有力。
規則変更はフォールバックで、engine を触る前にユーザー承認必須。ゲート: vitest 全件 / T5 golden 不変 / S1 ±1% 維持 / S3 ±3% 以内。

prompts/phase16-action7-s2-l3-sp-b90-overpay.md
は Phase 16 アクション7（2026-10-01 作成・**アクション6 依存**）。S2 +37.10% の大半 = b90 L3 の SP 1 点
（sim 63,317,124 / 実測 pop 29,500,000・バー増分 29,538,545）の乗因子分解を b100 L3・b41 L3 対照で行い、
掛けすぎ位置を 1 つに特定して b90 ±15% / L3 ±20% / S2 ±10% に持っていく。engine.ts は 1 ファイル 1 エージェント。

prompts/phase16-action8-pop-vs-lane-total-integrity.md
は Phase 16 アクション8（2026-10-01 作成・**読み取り専用なので 6/7 と並行可**）。S3 L5 の
「pop 読込セルでは sim とほぼ同額（Σ(pop−sim) = −113,820）なのにレーン合計は sim の 72.8%」という構造矛盾を、
15 レーン分の Σpop/レーン合計 表・over-sum 検出・帰属一致率・scores_by_lane vs total_score 照合で確定させる。
S3 L5 の +37% が実測側のデータ問題ならシミュレータの欠陥として扱うのは中止する。

