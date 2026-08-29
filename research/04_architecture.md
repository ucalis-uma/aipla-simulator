# 04. アーキテクチャ・Windows配布方式 比較検討レポート

- 役割: アーキテクチャ・Windows配布方式検討担当
- 作成日: 2026-08-28
- 対象: IDOLY PRIDE（日本版）ライブスコア計算機（段階A→B→C 想定）
- ステータス: **調査・提案（実装判断はPMが最終決定）**
- 参照: `prompt_plan.md`（アーキテクチャ要件・テスト要件）、`スコア分析サンプル/scratch/`（実測データ加工スクリプト群）

---

## 0. 結論サマリ（先に要点）

- **第一推奨（案）**: 計算コアを **TypeScript の純粋関数パッケージ** として独立させ、UIはWeb技術（React等）、**デスクトップ化は Tauri 2.x** で行う構成。
- **代替案1**: 同じTSコアを **ローカルWebアプリ（単一HTML）＋ZIP配布** で出す方式。ビルドチェーンが最軽量で、Tauri化は後から可能。
- **代替案2**: **C#/.NET 10 + WPF or Avalonia**。十進演算（`decimal`）が言語標準で数値再現性に最も強く、Windows専用割切りなら堅実。
- **非推奨気味**: Electron（配布サイズが過大）、Wails（v3が2026-08時点でベータ）、PyInstaller（AV誤検知・起動時間の運用リスク）。
- **本レポートは断定しない。** 判断根拠を明示するので、PMが開発者のスキルセットと照らして決定すること。

---

## 1. 前提条件の整理（要件→設計制約）

| 要件 | アーキテクチャ上の含意 |
|---|---|
| Windowsで容易に起動 | ダブルクリック起動可能（ランタイム要求ゼロが理想）、初期DLサイズは小さいほど良い |
| 通常利用はオフライン完結 | 起動時のネットワークアクセス不要。データ更新は手動差し替え/更新ファイル読込 |
| 計算コアとUIの分離 | コアはUIフレームワークに依存しない純粋関数ライブラリ（入力→出力、副作用なし） |
| データはJSON/CSV/SQLite等で更新可能 | カード・スキル・譜面をコードから分離。スキーマ検証付き |
| 編成の保存/読込、再現可能エクスポート | エクスポートに appバージョン・データバージョン・計算条件・乱数seed を含める |
| 単体テスト＋ゴールデンテスト（1の位照合） | コアはCIで完結する形でテスト可能。実測値（`measured_data.json`、最終 17,529,132,014）と突き合わせる |
| 開発環境はWindows・保守性重視 | 1人（+サブエージェント）で回る規模。特殊ツールチェーンの要求は最小化したい |
| 将来のWeb公開転用（評価軸） | コア＋UIの資産をそのまま静的サイトにできると相乗効果が大きい |

**重要な観点**: 本プロジェクトは「画面が複雑」ではなく「**ロジックが複雑で、数値の正しさが全て**」という種類のアプリである。したがって方式比較の軸は「UI toolkit の richness」よりも「**計算コアのテスト容易性・数値再現性・Web転用性**」を重く置くべきである。

---

## 2. 各方式の比較表（評価軸×方式）

評価記号: ◎=非常に良い / ○=良い / △=課題あり / ×=難しい

| 評価軸 | 1. ローカルWebアプリ<br>(SPA+静的配信) | 2. Tauri 2.x<br>(Rust+WebView2) | 3. Electron | 4. Python<br>(PySide6+PyInstaller) | 5. C#/.NET 10<br>(WPF/Avalonia) | 6. その他<br>(Flutter/Wails) |
|---|---|---|---|---|---|---|
| **Windows起動のしやすさ** | ○ HTMLダブルクリック（※file://制約あり、後述） | ◎ 単一exe。WebView2はWin10 20H2+/Win11に同梱 | ◎ 単一exe/インストーラ | △ onefile起動が数秒かかることがある | ○ 自己完結exe可（サイズ大） | ◎ Flutter: 単一exe / △ Wails: v3はベータ |
| **配布方法・サイズ（目安）** | ◎ ZIP解凍のみ。HTML 1〜3MB + data | ◎ NSIS/MSI or ZIP。exe 3〜10MB+data | ○ NSIS/portable。90〜150MB | △ onefile 40〜80MB。AV誤検知リスク | ○ self-contained 60〜150MB（トリムで圧縮可） | ○ Flutter 20〜50MB / ◎ Wails 5〜10MB |
| **純粋関数コアのテスト容易性** | ◎ TS + Vitest。CI最速 | ◎ **同一TSコアを流用**。Vitest | ◎ 同左 | ○ Python単体テストは容易。UI(PySide)とコアの分離は規律次第 | ○ xUnit/NUnit。UI非依存クラスライブラリに分離可 | △ Flutter: Dartはテスト容易だがWeb転用はDart資産にロック |
| **コア/UI分離・Web公開転用性** | ◎ 最初からWeb資産 | ◎ **コア・UIともWeb資産をそのまま流用** | ◎ 同左 | × UIをPythonで書くとWeb転用不可（コアは再実装） | △ コアはBlazor等で転用可能だがUI資産は転用不可 | △ FlutterはDart→Web変換が現実的でない / ◎ WailsはTauri類似 |
| **依存の寿命・メンテ状況（2026-08時点）** | ◎ ブラウザ標準のみ | ○ Tauri 2.11.x（2026-07リリース継続、★111k）。WebView2はMicrosoft Evergreen | ◎ Electron v44（2026-08、Chromium 152/Node 24、4週サイクル） | ○ Python公式。PyInstaller 6.22.x（2026-08活動中）。PySide6（Qt公式、LGPL） | ◎ .NET 10 LTS（〜2028-11）。WPF/WinFormsはWindows標準。Avalonia 12.1/11.3LTS が活動中 | ○ Flutter desktop は継続 / △ Wails v3 は 2026-08 でも 3.0.0-beta.15 |
| **ローカル完結（オフライン）** | ◎（データはバンドル or 手動読込） | ◎ | ◎ | ◎ | ◎ | ◎ |
| **数値計算の信頼性** | △ JS numberはIEEE754倍精度。固定小数点/BigInt/decimal.jsの規律が必要 | △ 同左（コア内で解決） | △ 同左 | ◎ int/`decimal`/`fractions` 標準搭載 | ◎ **`decimal`型が言語標準**。整数演算も素直 | △ Dart は double 主体（int は64bit固定） |
| **Windows開発環境の保守性** | ◎ Node.jsのみ | ○ Node + Rust + MSVC Build Tools（初回構築が重い。**Rustコードはほぼ書かずに済む**） | ◎ Node.jsのみ | ◎ Pythonのみ（exe化の知識は別途） | ◎ Visual Studio / dotnet CLI。Windows公式UI | ○ Flutter SDK / △ WailsはGo |
| **初回開発の学習コスト（Windows開発者想定）** | ◎ 低 | ○ Tauri設定の学習 + Rustビルド環境 | ◎ 低 | ○ 低〜中（配布で癖がある） | ○〜△ XAML習得。WPFなら情報量豊富 | △ Flutter/Dart or Go を新規習得 |
| **総合（本プロジェクト適合度）** | **◎ 代替案1** | **◎ 第一推奨** | ○（過剰） | ○ | ○ **代替案2** | △ |

### 各方式の補足（2026年時点の状況）

- **Tauri 2.x**: 2026-07に v2.11.5 がリリースされる等、2.x系が安定してメンテされている。Windows描画はOS同梱の WebView2 (Edge/Chromium系) を利用。バックエンドはRustだが、本プロジェクトでは「コマンド呼び出し・ファイル保存」程度にRustを触る範囲を限定でき、計算はすべてフロントのTSコアに閉じ込められる。既知の注意点: 開発に Rust toolchain (MSVC) と Visual Studio Build Tools が必要、GTK3依存クレートのRustSec警告はLinux向けでありWindows動作には影響しない。
- **Electron**: v44（2026-08-25安定版、Chromium 152）。メンテは極めて健全だが、Chromium一式を同梱するため配布サイズが90MB超・メモリ消費も大。本アプリのようなデータ計算・フォームUIには過剰スペックで、WebView2がOS標準となった2026年において選ぶ動機が薄い。
- **Python (PySide6 + PyInstaller)**: 解析スクリプト（`scratch/`）がPythonで書かれている事実上の実績はある。数値は `decimal`/`fractions`/int で安全。ただし PyInstaller onefile は起動時解凍で数秒〜、**Windows Defender等の誤検知（false positive）が定番問題**で、配布のたびに説明コストが生じる。UI資産がWeb転用できないため、将来Web公開するなら計算コアを結局2言語で書くことになる。
- **C#/.NET**: .NET 10 LTS（2025-11〜2028-11サポート）。**`decimal` 128bit十進型が言語標準**で、ゲーム側の端数処理（切り捨て・四捨五入の位置）を固定小数点で忠実に再現するタスクと相性が最も良い。WPFはWindows専用で成熟、Avalonia 12.x/11.3 LTS はクロスプラットフォームで活発。欠点は、UI資産のWeb転用ができないこと、XAMLの学習コスト。
- **ローカルWebアプリ**: `file://` 直開きには2つの制約がある。①ESモジュールがCORSで読めない ②`fetch()`でローカルJSONを読めない。**対策として単一HTMLバンドル（vite-plugin-singlefile 等）にし、データはUI上の「ファイルを開く」ダイアログ（`<input type=file>`は`file://`でも動く）で読ませる**設計にすれば実用になる。Tauri化への移行パスが最も短い。
- **Flutter desktop**: 安定・単一exe配布可だが、計算コアがDaragon…Dart資産となりWeb転用は実質再実装。フォーム×タイムライン表UIにFlutterの利点（アニメーション等）が活きにくい。
- **Wails (Go+WebView2)**: Tauri類似の軽量構成だが、**v3が2026-08時点で未だベータ（3.0.0-beta.15）**。新規採用には時期尚早と判断。

---

## 3. 第一推奨＋代替案

### 3.1 第一推奨（案）: TypeScript計算コア + Tauri 2.x（WebView2）

**構成**:
```
packages/core     … 計算コア（TS純粋関数、依存ゼロ。Node/ブラウザ両対応）
packages/app      … UI（React or Svelte + Vite）
src-tauri         … Tauriシェル（Rustはほぼ触らない。ファイル保存等のコマンドのみ）
```

**判断根拠**（断定ではなく根拠の列挙）:

1. **計算コアのテスト容易性と将来のWeb転用が両立する**。コアはUI非依存のTSパッケージなので、Vitestで単体・境界・ゴールデンテストをCI完結させやすく、将来Web公開する場合は同じコア＋同じUIを静的配信するだけでよい。二重実装が発生しない。
2. **Windows配布が「解凍してダブルクリック」で済む規模になる**。Tauriのexeは数MB規模で、WebView2はWin10/11に同梱済み。配布サイズ・起動速度・オフライン性の要件を最も安価に満たせる見込み。
3. **フレームワークの寿命リスクが比較的小さい**。Tauri 2.xは2026年時点で活発にメンテされており、仮に将来Tauriから離脱しても、コアもUIも素のWeb資産なのでElectron化・純Web化への引っ越しが容易（=ベンダーロックが弱い）。

**採用時のコスト**: 開発マシンに Rust toolchain (MSVC) + VS Build Tools が必要（初回のみ）。Rustを「書く」場面は実質ほぼないが、「ビルドが通る環境」の維持コストはNodeだけの構成よりやや重い。

### 3.2 代替案1: ローカルWebアプリ（単一HTML + ZIP配布）

- 同じTSコア・同じUIを、Tauriなしで単一HTMLにバンドルし、ZIPで配布。ユーザーは解凍→HTMLダブルクリック。
- **強み**: ビルドチェーンがNodeのみ。Rust環境不要で最も保守が軽い。配布サイズ最小。Web公開時のコード差分ほぼゼロ。
- **弱み**: `file://` 制約のため「データファイルの自動読込」がダイアログ経由になり、JSONの常駐キャッシュがlocalStorage頼みになる。exe配布に比べ「アプリ感」は劣る。
- **位置づけ**: **第一推奨への移行パスとして常に確保しておくべき形**。実は「フェーズ1（段階A/B検証用）は代替案1で始め、段階CでTauri化する」段階導入も合理的。

### 3.3 代替案2: C#/.NET 10 + WPF（or Avalonia）

- **強み**: `decimal`型による十進演算が言語標準で、端数処理の再現性検証（1の位照合ゴールデンテスト）に最も有利。.NET 10 LTS（〜2028-11）で寿命も長い。Windows専用割切りのUIとしては成熟。
- **弱み**: UI資産がWeb転用不可。将来Web公開する際、計算コアをTS/C#の二重化するか、C#コアをWebAssembly化する追加投資が必要。
- **選ぶべき条件**: 「Web公開を最初から想定しない」「開発者のC#経験が豊富」「端数処理の解析で浮動小数点問題に深く悩まされると予測される」場合に優先度が上がる。

### 3.4 Electron / Python / Flutter / Wails を避けた理由（要約）

- **Electron**: 全要件を満たすがサイズ・メモリが過大。WebView2がOS標準の2026年ではTauriの下位互換に近い。
- **Python+PyInstaller**: AV誤検知と起動時間の運用リスク、UIのWeb転用不可。解析ツールとしては相性が良いが、配布アプリとしては課題が多い。
- **Flutter**: Dart資産のWeb転用性が弱く、本アプリのUI特性に合わない。
- **Wails**: v3が2026-08でもベータ。成熟を待つか、Tauriで代替可能。

> **PMへの申し送り**: 開発者の既存スキル（Python解析スクリプトの実績あり / TS・Rust・C#の習熟度不明）によって最適解は変わり得る。第1候補はTauriだが、「Rustビルド環境の維持が嫌なら代替案1から開始」「C#が最も得意なら代替案2」という条件付き推奨である。

---

## 4. 推奨構成のプロジェクト構造案

```
aipura-score-calc/
├─ packages/
│  ├─ core/                          # 【計算コア】UI非依存・依存パッケージゼロ・純粋関数
│  │  ├─ src/
│  │  │  ├─ types/                   # ドメイン型（Formation, Card, Skill, Chart, Buff...）
│  │  │  │  ├─ card.ts
│  │  │  │  ├─ skill.ts
│  │  │  │  ├─ chart.ts
│  │  │  │  └─ formation.ts
│  │  │  ├─ rounding/                # 端数処理を一元化（最重要）
│  │  │  │  ├─ fixed.ts              #   固定小数点ユーティリティ（基礎値×10000等）
│  │  │  │  └─ truncate.ts           #   floor/roundHalfUp 等を1箇所で定義
│  │  │  ├─ formula/                 # 純粋計算式（段階A相当）
│  │  │  │  ├─ baseStatus.ts         #   カード外ステータス合成（交流Lv・スタッフ等）
│  │  │  │  ├─ liveStatus.ts         #   ライブ中Vo/Da/Vi・バフ合成
│  │  │  │  ├─ beatScore.ts          #   通常ビートスコア
│  │  │  │  ├─ skillScore.ts         #   A/SP/Pスキルスコア
│  │  │  │  ├─ critical.ts           #   クリティカル（率/係数/期待値）
│  │  │  │  └─ comboBonus.ts
│  │  │  ├─ timeline/                # 【タイムラインエンジン】（段階B相当）
│  │  │  │  ├─ engine.ts             #   simulate(state, events) → TimelineResult
│  │  │  │  ├─ scheduler.ts          #   同一ビート内の発動順・メンタル順解決
│  │  │  │  ├─ buffs.ts              #   バフ付与/経過/切替/上限の状態遷移
│  │  │  │  ├─ stamina.ts            #   スタミナ消費・回復・CT管理
│  │  │  │  └─ rng.ts                #   シード固定可能なPRNG（再現性の要）
│  │  │  └─ index.ts                 #   公開API（computeScore(), simulateLive() 等）
│  │  └─ tests/
│  │     ├─ unit/                    # 単体・境界値（CT、off-by-one、バフ上限...）
│  │     ├─ golden/                  # measured_data.json 照合（1の位まで）
│  │     │  ├─ measured_data.json    #   実測データ（検証専用として取り込み）
│  │     │  └─ timeline.golden.test.ts
│  │     └─ fixtures/                # 最小編成・最小譜面のフィクスチャ
│  ├─ schema/                        # 【データ層スキーマ】（zod等で検証）
│  │  ├─ src/cards.ts, skills.ts, charts.ts, formation.ts, export.ts
│  │  └─ tests/                      # スキーマ検証・日本版/他地域版混入防止タグのテスト
│  ├─ data-repo/                     # 【データ管理】JSON読込・更新・フィンガープリント
│  │  └─ src/{load,validate,fingerprint}.ts
│  └─ app/                           # 【UI】（React/Svelte + Vite）
│     ├─ src/
│     │  ├─ views/                   # 編成編集 / 譜面選択 / タイムライン表示 / 設定
│     │  ├─ stores/                  # 状態管理（UI状態のみ。計算はcore呼び出し）
│     │  ├─ io/                      # 編成の保存・読込・エクスポートUI
│     │  └─ main.tsx
│     └─ src-tauri/                  # Tauriシェル（ファイル保存ダイアログ等のコマンド）
├─ data/                             # 【更新可能データ】（アプリにバンドル、差し替え可能）
│  ├─ meta.json                      #   data_version / region / updated_at / 出典
│  ├─ cards.json
│  ├─ skills.json
│  ├─ skill_levels.json
│  ├─ charts/
│  │  └─ {song_id}.json
│  ├─ stages.json                    #   会場補正・来場ファン等のステージ側定数
│  ├─ aijou.json                     #   交流Lvテーブル（prompt_plan.md記載の59個）
│  └─ constants.json                 #   計算定数（式の定数。Confirmed/Estimateを明記）
├─ tools/
│  ├─ importers/                     # スプレッドシート/外部DB → data/*.json 変換スクリプト
│  └─ validate-data/                 # CI用データ検証（スキーマ・範囲・重複IDチェック）
├─ docs/
│  ├─ formulas/                      # 式ごとの出典・確度（Confirmed/Estimate等）を記したMD
│  └─ architecture/                  # 本レポート等
├─ research/                         # 調査レポート（既存）
└─ .github/workflows/
   ├─ test.yml                       #   core単体+ゴールデン+データ検証
   └─ release.yml                    #   Windowsビルド→ZIP/NSIS公開
```

**分離のルール（これがレビュー基準）**:
- `core` は `app`, `tauri`, DOM, Node API に依存**しない**（importをCIのlintで禁止）。
- 端数処理・丸めは `rounding/` にのみ書く。式ファイルに生の `Math.floor` を書かせない。
- `data/` のスキーマは `schema` パッケージが唯一の真実（single source of truth）。
- UIはcoreを「呼ぶ」だけ。計算結果の解釈（期待値/最小/最大の表示）もcoreが構造化して返す。

---

## 5. データファイル構成案

### 5.1 マスタデータ（`data/*.json`）のスキーマ例

```jsonc
// data/cards.json （抜粋イメージ）
{
  "data_version": "2026.08.28-1",
  "region": "JP",                      // 日本版専用。他地域版は絶対に混入させない
  "cards": [
    {
      "id": "c_0001",
      "name": "長瀬琴乃",
      "rarity": "R5",
      "type": "vocal",                 // vocal|dance|visual|score|support 等（確定後）
      "base_stats": { "vocal": 1234, "dance": 1100, "visual": 1050, "stamina": 800 },
      "skills": ["s_0001_a", "s_0001_sp", "s_0001_p"],
      "sources": ["INFO PRIDE", "実測 IMG_1385.PNG"]   // 出典の記録を必須化
    }
  ]
}
```

```jsonc
// data/skills.json （効果は構造化して書く。テキストで持たない）
{
  "skills": [
    {
      "id": "s_0001_p",
      "name": "かんしょ〜かい",
      "kind": "P",                     // A|SP|P|photo
      "ct": 44,
      "effects": [
        { "type": "combo_score_up",    "targets": "score_type_1", "duration_beats": 44 },
        { "type": "combo_score_limit", "targets": "score_type_1", "duration_beats": 44 }
      ],
      "confidence": "Strong estimate", // Confirmed|Strong estimate|Estimate|Unknown|Version-dependent
      "evidence": ["all_skill_orders.json#order=1"]
    }
  ]
}
```

- 効果テキストは**日本語文字列ではなく構造化タグ**（`combo_score_up` 等、`buff_meta.json` の識別子を流用）で持ち、表示名は別途 `i18n` キーにする。これでタイムラインエンジンがデータ駆動で動く。
- `constants.json` は「計算式の定数」のみ（係数・閾値・上限段階数）。式の形そのものはコード、定数はデータ、という切り分けで**式を変えずにデータ更新**を実現する。
- 各ファイルに `data_version`・`region` を持たせ、ロード時に `schema` パッケージが検証 + `region !== "JP"` を検知したら例外にする（日本版/他地域版混入防止のテスト要件に対応）。

### 5.2 ユーザー編成ファイル（`*.formation.json`）

```jsonc
{
  "format": "aipura-formation",
  "schema_version": 1,
  "app_version": "0.3.0",
  "core_version": "0.3.0",
  "data_fingerprint": {              // データ依存の明示（後述fingerprint）
    "data_version": "2026.08.28-1",
    "cards_sha256": "…",
    "skills_sha256": "…"
  },
  "name": "ハイスコア用 編成その2",
  "stage": { "song_id": "song_123", "mode": "high_score_live", "audience": 50000 },
  "cards": [ "c_0001", "c_0102", "c_0034", "c_0456", "c_0078" ],
  "options": {
    "aijou_lv": [60, 60, 60, 55, 55],
    "staff": { "…": "…" },
    "photo": { "…": "…" },
    "accessory": { "…": "…" }
  },
  "calc_conditions": {               // 【再現可能性の核】計算条件を必ず含む
    "mode": "min|max|expected|monte_carlo",
    "rng_seed": 12345,               // 固定seed（monte_carlo時）
    "critical": "always|never|probabilistic",
    "skill_order_overrides": [],     // 手動発動順の上書き
    "known_gaps": ["未実装: 集目のXX条件"]  // 未実装・未確定の明示
  }
}
```

### 5.3 エクスポート形式（`.aipura-calc.json`）

再現に必要な全要素を1ファイルに:

| 含める情報 | 目的 |
|---|---|
| `app_version` / `core_version` | アプリ・計算エンジンの版（バグ報告・再現に必須） |
| `data_version` + 各データのsha256 | どのカードマスタ・譜面で計算したかの特定 |
| `formation`（上記5.2全体） | 編成・育成・交流Lv・計算条件・seed |
| `result_summary` | 最終スコア・モード別の値（期待値/最小/最大） |
| `rounding_policy` | 使用した丸め規約のバージョンタグ（端数処理を変えた場合の区別用） |

- 読み込み時は `data_fingerprint` を照合し、不一致なら「現在のデータでは結果が変わる可能性」と警告。**古いエクスポートを新しいデータで開いた際の乖離を検知可能**にする。
- 保存先: 編成は `Documents` 配下 or アプリのデータフォルダ（Tauriのfs API）。単一HTML構成時はlocalStorage＋手動エクスポート。

### 5.4 数値表現ポリシー（全方式共通の必須ルール）

- **浮動小数点を計算コアで使わない**。すべて整数（または固定小数点×10000の基礎点率）で持つ。
- 割合・倍率は基礎点率（basis point）の整数で表現（例: +15.5% → 1550）。積算は `BigInt` かスケール管理付き固定小数点で行い、最後に明示的な丸め関数を通す。
- 丸め（切り捨て/四捨五入/整数化）は `rounding/` に一元化し、**丸め位置ごとに式IDを付けてテスト**する。これはTSでもC#でも同じ規律。C# `decimal` は安全側の補助輪にはなるが、ゲーム側がどこで切り捨てているかという**知識自体はデータ/テストで固定するしかない**点は変わらない。
- ゴールデンテストは `measured_data.json` の全ビート（156 BEAT・82スキル発動・最終 17,529,132,014）を**1の位まで完全照合**。乱数が絡む箇所は min/max/期待値モードと固定seedで検証。

---

## 6. Windowsでの起動・ビルド・配布 手順案（Tauri推奨構成）

### 6.1 開発環境の構築（1回のみ）

1. Node.js LTS（22系以上）をインストール
2. Rust（`rustup`、`stable-msvc` ツールチェーン）をインストール
3. Visual Studio 2022 **Build Tools**（C++ワークロード）をインストール（Tauri/WRYのリンクに必要）
4. WebView2ランタイム: Win10 20H2以降/Win11ならOS同梱のため不要
5. `npm install` → `npm run tauri dev` で開発起動（ViteのHMRが使える）

### 6.2 ビルド

```
npm run build:core        # core の型チェック+テスト（ゴールデン含む、CIでも実行）
npm run validate:data     # data/*.json のスキーマ検証・fingerprint生成
npm run tauri build       # フロントビルド + Rustビルド + バンドラ
```

成果物:
- `src-tauri/target/release/bundle/nsis/*-setup.exe`（NSISインストーラ）
- `src-tauri/target/release/bundle/msi/*.msi`
- または `target/release/*.exe` + `data/` を同梱した **ZIP（ポータブル版）**

### 6.3 配布（推奨: 2種を併売）

| 形態 | 対象ユーザー | 手順 |
|---|---|---|
| **ZIP（ポータブル）** | 迷わせたくない一般ユーザー | 解凍 → `aipura-calc.exe` ダブルクリック。レジストリ不要・削除はフォルダ削除 |
| NSISインストーラ | 常用したいユーザー | セットアップ実行。スタートメニュー登録。**コード署名なしの場合SmartScreen警告が出る旨をREADMEに明記** |

- データ更新: `data/` フォルダ差し替え or アプリ内「データ読み込み」で更新JSONを指定（5.1の検証を通す）。アプリの再配布を不要にする。
- CI（GitHub Actions, `windows-latest`）でタグpush→ビルド→Releaseに添付まで自動化する。
- 署名: 初期は無署名+README案内で始め、利用者が増えたらコードサイニング証明書（OV/EV）を検討、という段階づけでよいと考える。

### 6.4 代替案1（単一HTML）の場合の手順

- `npm run build:web-single`（vite-plugin-singlefile で1HTMLに統合）→ `dist/` + `data/` をZIP
- 起動: HTMLをダブルクリック（既定ブラウザ）。データ読込は `<input type=file>` で。Tauri化は `src-tauri` を足すだけ。

### 6.5 代替案2（.NET）の場合の手順（概要）

- `dotnet publish -c Release -r win-x64 --self-contained -p:PublishSingleFile=true -p:PublishTrimmed=true`
- 成果物は単一exe（トリム後 30〜80MB目安）。配布はZIP推奨（ClickOnceはイントラネット的で今一つ）。

---

## 7. リスクと緩和策

| # | リスク | 影響 | 緩和策 |
|---|---|---|---|
| 1 | **端数処理の仕様が確定できず、1の位照合ゴールデンテストが通らない** | 大（プロジェクトの生命線） | 丸め一元化 (`rounding/`)・丸め位置ごとの式ID・実測156BEATとの差分レポート機能（どこで初めてズレたかを自動特定）を最初に作る。仕様未確定箇所は `Estimate` 扱いで分離表示 |
| 2 | JS（倍精度浮動小数点）による丸め誤差 | 大 | §5.4 の固定小数点/BigIntポリシーを強制（lintで `Math.*`・`*` 演算子の使用箇所を制限）。C#代替案はこのリスク自体を消すが転用性で失うもの大 |
| 3 | WebView2ランタイムが入っていない旧Win10 | 小〜中 | Tauriの `webviewInstallMode`（ブートストラップ同梱）を設定。または単一HTML版を併売 |
| 4 | 無署名exeのSmartScreen警告・AV誤検知 | 中（利用者が離脱） | READMEに初回起動手順を明記。ZIP配布中心に。将来はコード署名。PyInstallerの様な致命的誤検知はTauriでは報告が少ない |
| 5 | Tauri/Rustツールチェーンの学習・維持コスト | 中 | Rustで書く範囲を「コマンド数個」に限定。CIでビルドを日々回し、ツールチェーン更新を小刻みに。ダメなら代替案1（単一HTML）へ即降格可能な構造 |
| 6 | ゲーム更新による仕様変更（Version-dependent） | 中（継続的に発生） | `constants.json` + `data_version` 分離、式の `confidence` タグ、実測データの追加収集フロー。アプリ版とデータ版のバージョンを分離表示 |
| 7 | データ入力の手間（全カード・全譜面の登録） | 中〜大（段階Cの真のボトルネック） | スプレッドシート→JSON変換ツール（`tools/importers`）を整備し、カードDBサイト（INFO PRIDE等）からの取り込みを半自動化。全対応を約束せず段階的に拡大（prompt_planの禁止事項に準拠） |
| 8 | 他地域版データの混入 | 中 | 全データに `region` フィールド、ロード時検証、混入防止テスト（テスト要件に明記あり） |
| 9 | クリティカル仕様の未解明（率の計算式がUnknown） | 中 | 「確定値/期待値/最小/最大」を分けて表示する設計（prompt_plan準拠）。率はEstimateタグ。モンテカルロはseed固定で再現可能に |
| 10 | フレームワークの寿命（Tauriのメンテ低下等、数年スケール） | 小 | コア・UIがWeb標準のみに依存するため移行先（Electron/純Web）は常に開いている。依存最小化をレビュー規律に |

---

## 8. 情報源（本レポートで確認した現状データ）

| 項目 | 内容 | 取得日 |
|---|---|---|
| Tauri releases | v2.11.5（2026-07-01）、v2.11.4（06-30）等、2.x系が活発にリリース継続。GitHub ★111k | 2026-08-28 |
| Electron releases | v44.0.0 stable（2026-08-25、Chromium 152 / Node 24.18）、v45 alpha進行中、4週リリースサイクル | 2026-08-28 |
| Avalonia releases | 12.1.1 latest（2026-07-29）、11.3 LTS系も11.3.20（2026-08-10）までメンテ | 2026-08-28 |
| PyInstaller releases | v6.22.2（2026-08-17）など継続メンテ | 2026-08-28 |
| Wails releases | v3.0.0-beta.15（2026-08-27）— **v3は未だベータ** | 2026-08-28 |
| .NETサポート状況 (endoflife.date) | .NET 10 LTS（2025-11-11、EOS 2028-11-14）。.NET 8 LTS EOS 2026-11-10（**近づいている点に注意**） | 2026-08-28 |
| ローカル実測データ | `スコア分析サンプル/scratch/`（all_skill_orders.json、buff_meta.json 等）— データ設計の実装イメージとして参照 | 2026-08-28 |

※ 各サイズ目安（exe数MB、90〜150MB等）は一般的な経験値ベースの目安であり、実ビルドで要確認。

---

## 9. PMへの決定依頼事項（このレポートだけで確定しないもの）

1. 開発者のスキル優先度: TypeScript / Rust環境維持 / C# のうちどれに馴染みがあるか → 第一推奨・代替案の選択に直結
2. Web公開を「将来的に確定」とみなすか「あるかもしれない」程度か → それにより 3.1 vs 3.3 が入れ替わり得る
3. フェーズ1（段階A/B）を単一HTMLで始め、段階CでTauri化する**段階導入**を採るか、最初からTauriで進めるか
4. コード署名に予算を割くか（利用者層が拡大してからの判断でよい見込み）
