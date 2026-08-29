# IDOLY PRIDE（日本版）ライブスコア計算機 ― データソース調査レポート (03_data_sources.md)

- 作成日: 2026-08-28（記載の取得日・commit確認日はすべて同日）
- 前提: 本レポートは「計算機に必要なマスタデータ（カード・スキル・譜面等）をどこからどう入手するか」を確定させるもの。実装は行っていない。
- 重要な前提知識: 調査の結果、**日本版サーバーのマスタデータ一式が JSON で公開されている**ことが判明した（§2.1）。これが本プロジェクトの第一データソース候補となり、従来の「攻略サイトをスクレイピング/手入力」する計画はほぼ不要になる。

## 0. 出典一覧（略称）

| 略称 | 出典 | 運営者 | 最終更新（確認日 2026-08-28 時点） | 地域 |
|---|---|---|---|---|
| [MD] | [MalitsPlus/ipr-master-diff](https://github.com/MalitsPlus/ipr-master-diff) | MalitsPlus（＝Vibbit。INFO PRIDE のデータ提供者、[V1] の解析者と同一人物） | **2026-08-27**（pushed_at。随時更新） | **日本版**（根拠 §2.1） |
| [IP] | [INFO PRIDE](https://ip.outv.im/ja) / [outloudvi/info-pride](https://github.com/outloudvi/info-pride) | Outvi V (outloudvi) | **2026-08-26**（GitHub Actions による週次 dataset 更新） | **日本版**（vendor API・根拠 §2.2） |
| [IP-V] | INFO PRIDE vendor backend API `https://idoly-backend.outv.im/api/*` | 同上 | 2026-08-28 に動作確認 | **日本版** |
| [VSL] | [vilebbit/VenusSysLib](https://github.com/vilebbit/VenusSysLib)（npm: hoshimi-venus） | Vibbit (vilebbit) | 2025-08-19（約1年更新なし・未完成） | 日本版 |
| [DBM] | [IDOLY PRIDE データベース M](https://mikirin123.github.io/idolyprideDB/) / [mikirin123/idolyprideDB](https://github.com/mikirin123/idolyprideDB) | mikirin123 | **2026-08-28**（pushed_at） | 日本版（手動） |
| [BW] | [Bilibili Wiki 偶像荣耀WIKI](https://wiki.biligame.com/idolypride/) | 星見攻略組（bilibili） | 継続更新（2026-08 のイベント告知あり） | **中国版** |
| [AP] | [AppMedia アイプラ攻略Wiki](https://appmedia.jp/idolypride) | AppMedia | **更新停止中**（2023-09-30 と公式明記） | 日本版（当時） |
| [S1-S8] | やるキ士 Google スプレッドシート群（01/02 レポート参照） | やるキ士 (@yarukishi) | 2021〜2023 頃（一部更新停止宣言あり） | 日本版・実測 |
| [IOM] | [AllenHeartcore/IdolyPrideObjectManager](https://github.com/AllenHeartcore/IdolyPrideObjectManager) | Ziyuan "Heartcore" Chen | 2026-08-27 | 日本版アセット取得ツール |
| [MUS] | [CyleAR/idoly-musics](https://github.com/CyleAR/idoly-musics) | CyleAR | 2026-07-30 | 楽曲メタDB（譜面なし） |

信頼度の基準は 01 レポートに準拠（高／中／低／Unknown）。

---

## 1. エグゼクティブサマリー

1. **日本版マスタデータ一式が [MD] ipr-master-diff に JSON で公開されている。** カード（パラメータ配分・スキルID・解放日）／スキル（**Lv別の数値効果・消費スタミナ・CT・成功率・強化コストまで完全数値**）／譜面（A/SPノーツのビート番号とレーン位置）／ステージ（**レーン色・ビート重み・A/SP重み・来場者数ボーナス**）／フォト・アクセサリー・スタッフ・コンボテーブル等、約160テーブル。**2026-08-27 にも更新されている現役リポジトリ**。
2. **譜面データは機械可読で入手可能。** 手入力・OCRは不要。`MusicChartPattern.json` に A/SP ノーツのビート番号＋レーン位置が入っており、通常ノーツは「全レーン同時」のためレーン位置がマスタに存在しなくても計算上問題ない（§4.2 で論証）。INFO PRIDE の API は A/SP マップをさらに見やすい形（レーン別配列）で提供する（§2.2）。
3. **レーン色はステージ（クエスト）ごとにマスタで固定**（`Quest.json` の position1-5AttributeType）。ランダム要素なし。「曲ごと」ですらなくステージごとに定義される。
4. **欠けているデータ**: ①エールの効果値テーブル（[MD] に名前が見当たらない。やるキ士 [S3] と INFO PRIDE の eru テキストで補完）、②交流Lvのステータス上昇値（`CharacterActivityLevel.json` は活動スタミナであってステータス上昇ではない）、③撮影フィルム枚数→STAGE の運用対応（マスタの STAGE1-13 クエストは完備、枚数対応のみ [S2] 参照）。
5. **ライセンスは全ソース「グレー」**: ゲームデータ自体の権利は QualiArts にあり、個人利用のファンプロジェクトとして出典明記が必須。[IP] のデータは CC BY-NC-SA 3.0（非商用・継承・表示）。

---

## 2. データソース詳細

### 2.1 [MD] MalitsPlus/ipr-master-diff ― 日本版マスタデータ一式（第一候補）

| 項目 | 内容 |
|---|---|
| URL | https://github.com/MalitsPlus/ipr-master-diff （raw: `https://raw.githubusercontent.com/MalitsPlus/ipr-master-diff/main/<Table>.json`） |
| 運営者 | MalitsPlus。INFO PRIDE の README が「Vendor data from Vibbit (github.com/Malitsplus)」と明記、IdolyPrideObjectManager の README も「SolisClient (MalitsPlus/SolisClient) by Vibbit」と記載しており **MalitsPlus＝Vibbit**（[V1] ゲームシステム解析の著者、IPR 解析コミュニティの第一人者）と確定 |
| 最終更新 | pushed_at **2026-08-27**。README によれば `!version.txt` が変わるコミット（=サーバーのマスタ更新）ごとに GitHub Actions が全 DB の zip アーティファクトを作成 |
| 地域 | **日本版**。根拠: (a) `Card.json` の `name`/`description` が日本語（例: 「えんそう」「大成功」「みんなで巡る…全国ツアー」）; (b) JP 限定のコラボ楽曲（`music-clb-004` Don't say "lazy"、`clb-009` Daydream café 等）を含む; (c) releaseDate が Asia/Tokyo の実装スケジュールと一致（max 2026-08-31 = 先行告知カード分） |
| フォーマット | テーブル名＝ファイル名の JSON 配列。ゲーム内マスタをそのままダンプした構造（proto 由来のスネーク/キャメル混在 ID） |
| ライセンス | **LICENSE ファイルなし**（GitHub API の license: null）。データの権利は元のゲーム（QualiArts）に帰属。「All Rights Reserved」扱いが妥当。ファン用途での利用は他のファンサイトと同等の慣行範囲。出典明記必須 |

#### 2.1.1 収載テーブルと本計算機への適合度（2026-08-28 に実DLして検証した数値）

| テーブル | 件数 | 主要フィールド（実測） | 計算機への適合 |
|---|---|---|---|
| `Card.json` | **491枚** | `id`(card-ai-02-eve-00 等), `characterId`, `type`(1/2/3), `initialRarity`(☆5=392/☆2=63/☆4=17/☆3=17/☆1=2), `cardParameterId`, `vocalRatioPermil`(404 等・千分率), `danceRatioPermil`, `visualRatioPermil`, `staminaRatioPermil`, `skillId1〜4`, `releaseDate`(UNIX ms。max=2026-08-31＝先行告知込み) | ◎ Vo/Da/Vi/Sta 配分（[V1] §1.1 の P_pam）と解放日まで完全網羅 |
| `CardParameter.json` | 80KB | card-param-01〜（[V1] の V_pam テーブル本体） | ◎ レベル別マスター値の基礎テーブル |
| `CardLevel.json` / `CardLevelRelease.json` / `CardRarity.json` / `CardEvolutionLevel*.json` | 各小 | レベル別成長、レベル上限解放、レアリティボーナス（[S4] Rarity の ☆10=1.45 と整合するはず・要照合） | ◎ |
| `Skill.json` | **2,043件** | `id`(sk-<char>-… / sk-live-* 160 / sk-phot-* 112), `categoryType`(1/2/3), **`levels[]`**: `level`, `description`(日本語), `stamina`, `probabilityPermil`, `coolTime`, **`skillDetails[]`**(`efficacyId`+`triggerId`), `requiredItemAmount`(強化コスト), `requiredCardLevel` | ◎◎ **スキルLv別効果値が完全数値化**。例: SPスキル Lv1-6 で「360%→460%のスコア獲得」「消費スタミナ110→155」「CT:30」「強化に500/2000/15000/100000/230000」まで収載 |
| `SkillEfficacy.json` | **11,577件** | `id`(ef-score_get-3600-chart_dependence 等・値がIDに埋め込み), `type`(SkillEfficacyType), `description`, `grade`/`maxGrade` | ◎ 効果の型+値。ID命名規則 `ef-<効果>-<値>-<条件>` が機械パース可能 |
| `SkillTarget.json` / `SkillTrigger.json` / `Condition.json`(7.6MB) / `ConditionDescription.json`(3.4MB) | 各大 | 対象・発動条件の構造化（tg-position_attribute_vocal 等） | ◎ バフ対象/発動条件の解決に必要 |
| `Music.json` | **129曲** | `id`(music-hsm-004), `name`, `singer`, `lyricist/composer/arranger`, `bars`/`beats`/`bpms`, `colorVariation`, `comboAdvantageId`, `notSelectableStageTypes`, `selectableStageIds`, `releaseTime` | ◎ 曲マスタ。ただし譜面実体は MusicChartPattern 側 |
| `MusicChartPattern.json` | **33,174行 / 111譜面** | `{id: "chart-hsm-004-001", number: ビート番号, type, position}`。type: **0=空ビート(14,989) / 1=通常Beatノーツ(16,193, position=0) / 2=Aノーツ(1,767, position=1〜5) / 3=SPノーツ(225, position=1〜5)**（enum は §2.3 の `MusicChartType` で確定） | ◎◎ **譜面の A/SP 配置が完全機械可読**（§4） |
| `Quest.json` | **5,916クエスト** | `musicChartPatternId`, **`position1〜5AttributeType`(レーン色)**, `beatVocal/Dance/VisualWeightPermil`(標準600/250/150), `activeSkill/specialSkill/skillStaminaWeightPermil`(1000/1500), `maxCapacity`, `mentalThreshold`, `questAudienceAdvantageId`, `comboAdvantageId`(via Music), `clearScore`, `areaId`(area-ex 3311 / area-tower 975 / area-main 939 / **area-daily 642** / area-exercise 24 / area-contest 23) | ◎◎ ステージ側パラメータ一式。**レーン色・重み・来場者数がここで確定**（§4.3, §5） |
| `QuestAudienceAdvantage.json` | 数百行 | `audienceAmount`(50人刻み) → `advantagePermil`（例 16,250人→1,625‰, 50,000人→2,000‰=+100%） | ◎ 来場ファン数ボーナステーブル（[S2] gid=969532646 のマスタ本体） |
| `ComboAdvantage.json` | 小 | コンボ数→ボーナス‰ | ◎ コンボボーナステーブル本体 |
| `PhotoAbility.json` | **374件** | `photoAbilityLevels[]`(Lv10〜250 → value 実数値), `photoAbilityGrades[]`(品質1〜10 → bonusPermil 1000→1400), `abilityType` | ◎◎ フォトの Lv/品質別効果が完全数値（[S2] 専用フォト表のマスタ版） |
| `Accessory.json` | **624件** | `classification`, `rarity`, `param1Type/param1Value/param1Permil`, `limitBreakPhase`, `characterId/characterGroupId`（専属指定） | ◎ アクセサリ基本効果（+N は AccessoryEnhancement/LiveAbility 側） |
| `LiveAbility.json` | **544件** | `levels[]`: `type`(効果種別ID), `value`(数値), `requiredCardLevel` | ◎ アクセサリ強化・カードのライブアビリティの数値テーブル |
| `StaffLevel.json` | **420行・Lv70まで** | `parameterType`, `level`, `advantage`(固定加算値), `unlockConditionId` | ◎◎ **[S6] シート(〜Lv60)を超える現行データ**。Lv70=Technique 8,150 等を確認 |
| `CharacterActivityLevel.json` | 60 | Lv1-60 の `maxStamina`/`baseActivityPoint`/`requiredExp` | × **交流Lvのステータス上昇値ではない**（交流の活動スタミナ管理）。ステータス上昇テーブルは別途要入手（§6） |
| その他 | — | Wording / Message / Story / Gacha / Character / Costume 等（UI・ストーリー・ガチャ） | 参考程度 |

- **欠落（このリポジトリに見つからなかったもの）**: エール効果テーブル（「エール」表記は全ファイルで僅か3箇所。カードのエール名・Lv別効果は未収載）、フォト品質の「因子/Power」内訳（PhotoAbility の value に集約済みの可能性）、ノーマルノーツの個別レーン配置（§4.2 のとおり不要なはず）。
- **アーティファクト**: README によると Actions の zip に「全データベースファイル」が入る。ただし **GitHub Artifacts API のダウンロードには認証が必要**なため、無認証で取れるのはリポジトリ HEAD のファイル群（上記一式で十分）。
- **日本版データと他地域版の混入リスク**: このリポジトリ単体なら無い（1サーバー分のみ）。逆に言えば「どのサーバーのデータか」はリポジトリ側に明記されていないため、導入時に日本語名・JP限定曲の存在で自動検証する（01 レポート JP1 の fail-closed 設計を推奨）。

### 2.2 [IP] INFO PRIDE（ip.outv.im）＋ vendor backend API

| 項目 | 内容 |
|---|---|
| URL | サイト https://ip.outv.im/ja ／ リポジトリ https://github.com/outloudvi/info-pride ／ vendor API `https://idoly-backend.outv.im/api/<エンドポイント>` |
| 運営者 | Outvi V (outloudvi) |
| 最終更新 | リポジトリ pushed **2026-08-26**。「feat: update dataset」コミットが **毎週日曜に GitHub Actions で自動実行**（2026-08-26 / 08-19 / 08-12 / 08-05 を確認） |
| 地域 | **日本版**。根拠: `utils/constants.ts` に `SOURCE_TIMEZONE = 'Asia/Tokyo'`, `MAX_LEVEL = 230`, `MAX_RARITY = 10`。vendor API の楽曲・譜面・スキルが JP サーバー実装と一致（2026-08 の曲まで収載） |
| ライセンス | コード **AGPL-3.0**、サイトデータ（`data/` 配下）**CC BY-NC-SA 3.0**、`data/vendor/` は元権利者 ARR（data/README.md 明記）。BWIKI 由来データは同 wiki のライセンスを継承 |
| 構造化度 | ○ `data/wikiPages/cards.json`(452KB) はカード別に `nameJa`/`nameCn`、`ski1〜3Typ`('SP'/'A'/'P')、`ski1〜3NameJa/DescJa`、`eru*`(エール) を JSON 化。ただし **スキル効果は日本語テキスト**（[MD] の数値テーブルが優位） |

- **Notemap 機能**: サイトに `/notemap` ページがあり、譜面の A/SP ノーツをビジュアル表示（`components/notemap/`）。レーン色は **閲覧者側で選択する見た目の設定**（TrackColorSelect）であり、ゲーム内レーン色は別途 `Quest.json` で確定（§4.3）。
- **vendor API（2026-08-28 に実呼び出しで動作確認）**:
  - `GET /api/MusicChartList` → 全曲＋譜面一覧。譜面説明は `"2SP16A"`（SP2個・A16個）形式。
  - `GET /api/MusicChart?chartId=chart-hsm-004-001` →
    ```json
    {"id":"chart-hsm-004-001","desc":"2SP16A","beats":156,
     "chart":{"1":[2,69,-103,156],"2":[38,86,115,144],"3":[23,-49,80,106],"4":[47,94,136],"5":[30,60,128]}}
    ```
    レーン(1-5)別に **正数=Aノーツのビート番号、負数=SPノーツのビート番号**（-103 → ビート103 にSP）。「2SP16A」と一致。**beats=156 は本プロジェクトの実測（The Sun, Moon and Stars 総ビート156）と完全一致**。
  - API のレスポンス型は npm パッケージ `hoshimi-types` で公開。ただしバックエンド実装リポジトリは公開確認できず（private の可能性）、**個人運営の無料 API につき SLA 無し**。一次利用は [MD] の MusicChartPattern とし、[IP-V] はクロスチェック用とするのが安全。
- cards.json は BWIKI（[BW]）由来のため、CN サーバー実装状況の影響を受ける（新カードの反映が JP より遅い場合がある）。**数値は使わず、日本語テキストの相互検証に限定**推奨。

### 2.3 [VSL] VenusSysLib（hoshimi-venus）― ライブシミュレータ先行実装

| 項目 | 内容 |
|---|---|
| URL | https://github.com/vilebbit/VenusSysLib （npm `hoshimi-venus`） |
| 運営者 | Vibbit (vilebbit) |
| 最終更新 | 2025-08-19（約1年停滞）。`concert/efficacy_proc.ts` は空ファイル等、未完成部分あり（02 レポート S4 の評価と整合） |
| 地域 | 日本版（[MD]/[IP] と同一系統の proto 型・解析） |
| ライセンス | **Apache-2.0**（コード流用可。要表示） |

- 本調査で確定した重要情報:
  - `types/proto/proto_enum.ts`: `MusicChartType { Unknown=0, Beat=1, ActiveSkill=2, SpecialSkill=3 }`、`ParameterType { Unknown=0, Dance=1, Vocal=2, Visual=3, Stamina=4, Mental=5, Technique=6 }`。→ `MusicChartPattern.json` の type/position、`Quest.json` の positionNAttributeType の解釈が確定。
  - `doc/beat_order.md`: **ビート内の処理順11段階**（移動効果→スキル存在確認→スタミナ確認→CT確認→バトル権利→Pスキル前半→SP/A/ビート発動→CT-1→効果時間-1→Pスキル後半）＋残スタミナ別調整表＋成功率段階別補正表。やるキ士 [S7]「ビート内の順番シート」の解析版で、スケジューラ実装の直接参照資料になる。
  - `concert/consts/eff_grades.ts`: バフ段階値テーブル（02 レポート Confirmed の出典）。
- 採用評価: **ライブラリとしてそのまま使うより、enum・beat_order.md・段階値テーブルの参照元として価値が高い**。更新停止気味のため現行バランス追従は期待しない。

### 2.4 [DBM] IDOLY PRIDE データベース M

| 項目 | 内容 |
|---|---|
| URL | https://mikirin123.github.io/idolyprideDB/ ／ ソース https://github.com/mikirin123/idolyprideDB |
| 運営者 | mikirin123 |
| 最終更新 | pushed **2026-08-28**（当日も更新）。GitHub Pages で公開 |
| 地域 | 日本版（日本語 UI・日本版カード） |
| ライセンス | **なし**（license: null）。無断転載を禁じる明記もなし。出典表記の上で参照 |
| 構造化度 | × 生成器は Python の静的サイトジェネレータ。カード・スキル・エールの一覧は **外部 Google スプレッドシート**（`gitignore/setting.txt` の `CHARACTERS_CSV_URL`、非公開）から CSV 取込→HTML 出力。リポジトリ内の機械可読データは `data/`（cd.csv/group.csv/music.csv/profiles）と `ex_photo.csv`（EXフォト）のみ |

- 評価: **更新は活発だがデータが HTML に埋め込まれるため機械可読性が低い**。スキル一覧・エール一覧・EXフォトの確認用サイトとして有用（特に [MD] に無い **エール一覧の日本語情報** はここで確認可能）。API 化・定期パースは非推奨（出力形式変更リスク）。手動参照 or 一時的な確認に限定。

### 2.5 [BW] Bilibili Wiki（偶像荣耀WIKI）

| 項目 | 内容 |
|---|---|
| URL | https://wiki.biligame.com/idolypride/ |
| 運営者 | 星見攻略組（bilibili 公認 wiki。2021-08-04 作成） |
| 最終更新 | 継続更新中（トップページのイベントカレンダーに 2026-08 の中国版イベント） |
| 地域 | **中国版**。カード名・実装順・イベントが CN サーバー基準 |
| ライセンス | **CC BY-NC-SA 3.0**（wiki トップに明記。表示-非営利-継承） |
| 構造化度 | MediaWiki。演出技能/卡牌排行/歌曲曲譜/日常演出 等のページ有。テンプレートデータ（info-pride の `wikiModules` が取込元）を除き基本的に HTML |

- 評価: **日本版計算機の数値ソースには使わない**。info-pride cards.json（ja名併記）の上流であること、CN 版で日本未実装要素の先行値が取れる可能性があることを踏まえ、「他地域版データ」として明確に隔離。日本版と同じ項目でも実装時期・バランス調整差の可能性があるため、`region: jp` 検証（日本語名スナップショット照合）で混入を防止する。

### 2.6 [AP] 日本語攻略サイト（AppMedia / Game8 / gamerch 等）

- AppMedia アイプラ攻略Wiki: **更新停止を自己申告**（「こちらの…は更新を停止中です。記事内容は古くなっている場合がございます」、最終更新 2023-09-30）。カードDB（星3/4/5別、評価とライブスキル/エール）はあるが 2023 年時点。**「当サイトが掲載しているデータ、画像等の無断使用・無断転載は固くお断り」** と明記 → スクレイピング利用不可。参照のみ。
- Game8 / gamerch 等: 本調査では詳細確認せず。AppMedia 同様 HTML・機械可読性なし・転載規約の余地あり。**数値ソースとして採用不可、日本語テキストのスポット照合のみ**。必要なテキストは [MD]（description 日本語）と [IP] cards.json（nameJa/DescJa）で賄えるため、採用必然性はほぼ皆無。

### 2.7 その他（ツール・周辺）

| リポジトリ | 最終push | ライセンス | 用途評価 |
|---|---|---|---|
| [IOM] AllenHeartcore/IdolyPrideObjectManager | 2026-08-27 | GPL-3.0 | **日本版サーバーの manifest/マスタ/アセットを直接取得・復号する Python ツール**（gkmasToolkit 系）。[MD] が更新停止した場合の代替取得経路として重要。運用にはゲーム API へのアクセス（アカウント準拠の注意）が必要 |
| outloudvi/SolisClient | 2025-07-29 | — | Vibbit 製 JP サーバークライアントの fork。[V1] 解析の実装系 |
| CyleAR/idoly-musics | 2026-07-30 | なし | 楽曲メタDB（idolypride.cyle.me）。譜面データなし |
| UMR-kira/IdolyPrideRankSystem | 2025-06-17 | MIT | カード一覧の **画像認識（OCR）**。CN wiki 用だが手法は参考可。本プロジェクトの譜面 OCR 代替は不要（§4） |

---

## 3. 既存データセットの「スキル構造化度」比較（調査項目1の答え）

| ソース | スキル効果 | Lv別効果値 | 数値パラメータ化 |
|---|---|---|---|
| [MD] ipr-master-diff | 日本語テキスト＋**skillDetails(efficacyId/triggerId)** | **あり**（levels[] に Lv1-6 相当の実値・消費スタミナ・CT・成功率・強化コスト） | ◎ 完全 |
| [IP] cards.json | nameJa/DescJa テキスト（+CN） | なし（表示のみ） | × テキスト |
| [BW] | テキスト（CN） | なし | × |
| [DBM] | テキスト（手動集計） | 部分的（HTML 表） | △ |
| 攻略サイト | テキスト | なし | × |
| やるキ士 [S1-S8] | 数値（実測手集計） | あり（2023年まで） | ○（ただし更新停止・手集計） |

---

## 4. 譜面（チャート）データ ― 調査項目2の結論

### 4.1 結論: **機械可読で完全入手可能。手入力・OCR は不要**

2系統の公開ソースがあり、相互検証可能:

1. **[MD] `MusicChartPattern.json`**（一次推奨）: `{id, number(ビート番号), type, position}` のフラット配列。111譜面・33,174行。type 意味は [VSL] proto で確定:
   - `type=0`（Unknown）… **空ビート（ノーツ無し）**。position 常に 0。
   - `type=1`（Beat）… 通常ノーツ。position 常に 0（理由は §4.2）。
   - `type=2`（ActiveSkill）… **Aノーツ。position = レーン 1〜5**（1,767個）。
   - `type=3`（SpecialSkill）… **SPノーツ。position = レーン 1〜5**（225個）。
   - 譜面ID: `chart-<曲assetId>-<001/002>`（001/002 はステージ側で選択されるパターン。例: 標準ライブは -001、デイリーは -002 等）。
2. **[IP-V] `GET /api/MusicChart?chartId=…`**（検証・可視化用）: レーン別配列に圧縮した形式（§2.2 引用）。正数=A、負数=SP。`beats` フィールドに総ビート数。

### 4.2 「通常ノーツのレーン位置がマスタに無い」ことの整理

`type=1`（通常ノーツ）にはレーン情報が無いが、これは仕様上の意図と整合する:

- スコア式（02 レポート §1.2/§3.2）では **ビートスコアは1ビートにつき全レーン分（各レーンの色属性 × そのレーンのステータス）を合算**する。個々の「通常ノーツがどのレーンに降るか」は scoring に寄与しない。
- ゲーム内表示（どのレーンにどの色のノーツが降るかの演出）はクライアント側アセット（`Music.json` の `colorVariation` がバリエーション指定）に属し、マスタ DB の管轄ではないと考えられる。
- 一方 **A/SP ノーツはレーン位置が scoring に直接効く**（発動レーンの色属性・ステータスが使われる）ためマスタに position が存在する。整合的。
- 検証の観点: 実測データ（The Sun, Moon and Stars）で beats=156、`chart-hsm-004-001` の desc が「2SP16A」＝2SP+16A+138通常＝**156** と一致（02 レポート §5 の実測内訳 2SP+16A+138 と完全一致）。この整合により上記の解釈はほぼ確実。

### 4.3 レーン色の決まり（調査項目3-a）

- **レーン色（レーン属性）は曲ごとではなく「クエスト（ステージ）ごと」に `Quest.json` の `position1AttributeType`〜`position5AttributeType` で固定定義**。値は `1=ダンス, 2=ボーカル, 3=ビジュアル`（ParameterType）。**ランダム要素なし**。
- 全クエスト5,916件中のパターン例（実測集計）: `21222`(Vo,Da,Vo,Vo,Vo)=755件、`32333`=757件、`13111`=753件、`22122`=737件、`33233`=732件、`11311`=729件、`11111`/`22222`/`33333`（単色)=307/294/216件 など多様。同一曲でもステージが違えば色構成が変わる。
- → 計算機は「曲」でなく「クエスト（stage）」を譜面・レーン色・重み・来場者ボーナスのキーにすべき。

### 4.4 A/SPノーツ配置の規則・SPノーツの条件（調査項目3-b）

- 配置に「ビート番号の数学的法則」はなく、**譜面制作者による手配がそのままマスタに入っている**（type=2/3 の number/position）。SP は 1 譜面あたり 1〜5 個（desc「2SP16A」等）。A は 10〜22 個程度。
- SPノーツの「条件」＝そのビート・そのレーンの SPノーツを叩くこと自体（スキル発動判定はスキル側の成功率/スタミナ/CT で行われる。発動メカニズムは [VSL] beat_order.md と 01 レポート参照）。
- INFO PRIDE の desc 計上（例: 2SP16A）と MusicChartPattern の type 集計が一致することは複数曲で確認済み（hsm-004-001: type3=2個, type2=16個）。

### 4.5 「The Sun, Moon and Stars」の譜面（調査項目2-c）

- **収載済み・即利用可能。** `music-hsm-004`（星見プロダクション。作詞 利根川貴之 / 作編曲 沖井礼二）。
  - `chart-hsm-004-001`: **2SP16A / beats=156**（実測ライブと同一の譜面。SP ビートは -103, -49 の2個 = ビート49と103。A は §2.2 のJSON参照）
  - `chart-hsm-004-002`: 2SP12A（別ステージ用）
- 実測検証データ（156ビート・82スキル発動）との突合がそのまま可能になる。ビート49/103 前後の実測ログ（SPスキル発動）で照合できる。

### 4.6 半自動抽出の現状（参考）

- 譜面そのものは不要だが、**計算結果の検証用にゲーム画面のスコア/バフを OCR する動線**は既に本プロジェクト内に存在（`スコア分析サンプル/scratch` の process_all_beats 等）。譜面データ入手に OCR を使う計画は取り下げてよい。
- コミュニティの有志譜面データ（外部）は確認限界では見つからなかった。BWIKI「歌曲曲譜」は CN 版の図示ページであり機械可読でない。

---

## 5. ライブ仕様データ ― 調査項目3の残部（マスタ由来で確定した範囲）

| 項目 | マスタでの確定内容 | 出典 |
|---|---|---|
| ビート重み | `beatVocal/Dance/VisualWeightPermil`。標準 600/250/150（合計1000=1.0倍）。daily STAGE では 200/300/400/600 等の変則値（409件が400 など）＝「ビートスコア1.5倍/2倍」表示の実体 | [MD] Quest.json。02 レポート S1 の 1000/1500/2000/3000‰ 説と整合（合計値が倍率） |
| A/SP重み | `activeSkillWeightPermil` / `specialSkillWeightPermil` / `skillStaminaWeightPermil`（1000 標準、daily STAGE13系で 1500 を確認） | 同上 |
| レーン色 | position1-5AttributeType（§4.3） | 同上 |
| 来場者数ボーナス | `maxCapacity`（クエスト定数）＋ `QuestAudienceAdvantage.json`（50人刻みの advantagePermil。50,000人で+100% 上限） | [MD] |
| コンボボーナス | `ComboAdvantage.json`（Music.comboAdvantageId で紐付け） | [MD] |
| デイリーライブ（撮影フィルム） | **`area-daily` 642クエスト（STAGE1…13 相当）がマスタに完備**。musicId 48曲・難易度・重み・`maxCapacity`・報酬まで数値化。ステージ補正＝上記重み差分で表現（02 レポート §5 で推定した ×2 仮定の実体はこの重み/advantage の組合せとして検証可能） | [MD] Quest.json。フィルム枚数→STAGE の運用は [S2] gid=534489351 参照 |
| スタッフ育成 | `StaffLevel.json` Lv1-70（固定値 advantage・解放条件） | [MD]（[S6] の Lv60 上限を超える現行値） |
| メンタル閾値等 | `mentalThreshold`（50 標準）等 | [MD] |

---

## 6. データ更新の運用評価（調査項目4）

### 6.1 更新追従性ランキング（2026-08-28 時点）

| ソース | 更新性 | 評価 |
|---|---|---|
| [DBM] idolyprideDB | 2026-08-28（手動・ほぼ日次） | 活発だが HTML/手動 |
| [MD] ipr-master-diff | 2026-08-27（サーバー更新連動・自動） | ◎ 最良。バージョン更新のたびに全テーブル差分 |
| [IOM] ObjectManager | 2026-08-27 | ツール自体は現役（自前取得経路） |
| [IP] info-pride | 2026-08-26（週次自動） | ◎ 安定。3年以上的運用実績（2022-03 開始） |
| [VSL] VenusSysLib | 2025-08-19 | △ 停滞気味。参照資料として使う |
| [BW] BWIKI | 継続（CN基準） | CN 版として隔離管理 |
| [AP] AppMedia | **停止中（2023-09-30）** | × |
| [S1-S8] やるキ士 | 2023-24 頃・一部停止宣言 | 過去実測の検証用 |

### 6.2 ライセンス・出典表記の要件

| ソース | ライセンス | 利用可否（本計算機: 個人・非商用想定） |
|---|---|---|
| [MD] | なし（ゲームデータ＝QualiArts ARR） | 出典明記・自己責任で使用可（ファン慣行）。再配布は最低限に |
| [IP] | コード AGPL-3.0 / データ CC BY-NC-SA 3.0 | 非商用＋表示＋継承で可。API・cards.json 利用時は出典必須 |
| [VSL] | Apache-2.0 | 可（表示） |
| [DBM] | なし | 参照のみ推奨。機械取得は避ける |
| [BW] | CC BY-NC-SA 3.0 | 非商用・表示・継承。ただし CN 版データとして隔離 |
| [AP] 等 | 無断転載禁止明記 | 使用不可（参照のみ） |
| やるキ士 | 明記なし（個人の実測資料） | 出典明記の上で数値検証に使用 |

### 6.3 「日本版データと他地域版データが混ざらない」ための運用ルール（06_test_plan JP1 の具体化）

1. 全マスタ行に `region` タグ（`jp`）。`jp` 以外はロード不可（fail-closed）。
2. [MD] 単一ソースから生成したデータのみ `region=jp` を付与可。[IP] cards.json・[BW] 由来は `region=cn-partial`（テキスト専用フィールドに限定し、数値フィールドには流用しない）。
3. 自動検証（データビルド時）: ①カード名が日本語（ひらがな/漢字を含む）こと ②`music-clb-*`（JPコラボ曲）が存在すること ③releaseDate が Asia/Tokyo で JST 経由の日付であること ④INFO PRIDE `MAX_LEVEL=230` 相当の Lv テーブルがあること。いずれも失敗したら「JP 以外の混入」としてビルド失敗。
4. CN 由来データの見分け方: 簡体字（滑雪/挚爱 等）が nameJa 以外の数値フィールドに混入していないかのスキャン。
5. [MD] のビルドハッシュ（`!version.txt` = `641f4aa8…`）を `data_version` として保存し、計算結果に紐付ける（04 レポートの再現性設計に接続）。

---

## 7. 欠落データと、ユーザーに提供を依頼すべきもの

| # | データ | 現状 | 調達方針 |
|---|---|---|---|
| 1 | **エール効果値テーブル（種類×Lv1-5）** | [MD] に未収載（「エール」出現わずか3箇所）。[DBM]/[IP] はテキスト、[S3] は 2023 年までの実測 | (a) ユーザー提供の上昇テーブル（既に保有と 01 レポートに記載）を基準に、[MD] の LiveAbility 型 (type, value) と同型式に変換。新エールはゲーム内表示→手入力運用 |
| 2 | **交流Lv のステータス上昇値** | `CharacterActivityLevel.json` は活動スタミナ管理であって上昇値ではない。01 レポート「1.6 Unknown」のまま | ユーザー提供の Lv51 までのテーブル＋[L1] 実測差分からの逆算（01 レポート §5 の方針を維持） |
| 3 | 撮影フィルム枚数→STAGE 開放の対応 | マスタの STAGE クエスト自体は完備、フィルム枚数の UI 運用は未収載 | [S2] シート（gid=534489351）＋ユーザー実測 |
| 4 | レーン色の「表示色」と属性（Vo/Da/Vi）の視覚対応表 | マスタは属性IDのみ（色コードなし）。ゲーム内色（例: Vo=桃色 等）の見た目対応は確認できず | 計算機では属性IDのみで十分（色は UI 装飾）。必要ならゲーム画面スクショからユーザー確認 |
| 5 | ノーマルノーツの視覚的レーン配置（type=0/1 の降り方） | マスタ外（クライアントアセット） | **スコア計算に不要**（§4.2）。タイムライン表示をゲーム風にしたい場合のみ、アセット抽出（[IOM]）が将来の課題 |
| 6 | フォト品質「因子/Power」の内訳 | PhotoAbility の value に集約済みの可能性（要照合） | [S2] スコア品質表との突合で検証 |
| 7 | ★10・Lv230 域の実測確認 | [MD] CardLevel/CardRarity に含まれるはず。info-pride も MAX_LEVEL=230 を定義 | [S4] と突合して検証（自動） |

---

## 8. 採用推奨の組み合わせ（結論）

```
一次（自動更新・数値の single source of truth）:
  [MD] MalitsPlus/ipr-master-diff の JSON 一式
    ├ カード/パラメータ/レベル/レアリティ   → Card*.json
    ├ スキル/Lv別効果/対象/条件            → Skill*.json, Condition*.json
    ├ 譜面（A/SP ノーツ）                  → MusicChartPattern.json
    ├ ステージ（レーン色・重み・来場者）    → Quest.json, QuestAudienceAdvantage.json, ComboAdvantage.json
    ├ フォト/アクセサリ/ライブアビリティ    → PhotoAbility.json, Accessory*.json, LiveAbility.json
    └ スタッフ                            → StaffLevel.json

二次（検証・テキスト・可視化）:
  [IP] INFO PRIDE vendor API（MusicChart で A/SP の人間可読確認）
  [IP] data/wikiPages/cards.json（日本語スキルテキストの相互照合）
  [VSL] VenusSysLib（enum・beat_order.md・バフ段階値の解析参照）
  [S1-S8] やるキ士シート（実測値との突合・エール/交流/フィルムの穴埋め）

参照のみ（数値は使わない）:
  [DBM] idolyprideDB M（エール一覧等の日本語情報確認）
  [BW] BWIKI（CN 版。region 隔離の対象として明記）
```

- 全体アーキテクチャ: [MD] を定期 fetch（Actions の週次更新に追随）→ 自前のスキーマ検証・`region=jp` 付与 → 計算機用の中間 JSON（04 レポートの `data/` 設計）に変換。UPDATE は `!version.txt` のハッシュ差分で検知。
- リスク: [MD] は個人運営・ライセンス明記なし。退避として (a) GitHub mirror 化（fork/定期アーカイブ）, (b) [IOM] による自前取得パイプラインの棚下げを推奨。

## 9. 参照URL一覧

- https://github.com/MalitsPlus/ipr-master-diff （raw JSON: https://raw.githubusercontent.com/MalitsPlus/ipr-master-diff/main/）
- https://github.com/outloudvi/info-pride ／ https://ip.outv.im/ja ／ https://idoly-backend.outv.im/api/MusicChartList ／ https://idoly-backend.outv.im/api/MusicChart?chartId=chart-hsm-004-001
- https://raw.githubusercontent.com/outloudvi/info-pride/master/data/wikiPages/cards.d.ts （カードJSONスキーマ）
- https://raw.githubusercontent.com/outloudvi/info-pride/master/utils/constants.ts （Asia/Tokyo・MAX_LEVEL=230）
- https://github.com/vilebbit/VenusSysLib （doc/beat_order.md, concert/consts/chart_consts.ts, types/proto/proto_enum.ts）
- https://mikirin123.github.io/idolyprideDB/ ／ https://github.com/mikirin123/idolyprideDB
- https://wiki.biligame.com/idolypride/ （CC BY-NC-SA 3.0）
- https://appmedia.jp/idolypride （更新停止中・転載禁止）
- https://github.com/AllenHeartcore/IdolyPrideObjectManager （GPL-3.0）
- https://github.com/CyleAR/idoly-musics
