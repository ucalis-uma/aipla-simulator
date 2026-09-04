# 02. ビートスコアの数理モデルとマスタ仕様

## 1. ビートスコア計算のパイプライン

現行シミュレータエンジン（`src/timeline/engine.ts`）におけるビートスコア計算は、以下の構造をとります：

```
Score = computeEventScore({
  basicScore: basic,
  b1Permil: b1,
  comboFactorPermil: comboF,
  fanFactorPermil: fanF,
  stageFactorPermil: stageF,
  randPermil: rand,
  critFactorPermil: critF,
  roundingPolicy: "at-end"
})
```

- **丸めポリシー（at-end）**:
  ファクター列（千分率整数）を全て BigInt で乗算したのち、末尾で $1000^N$ で整数除算（floor）します。
  $$Score = \left\lfloor \frac{basic \times b_1 \times combo \times fan \times stage \times crit \times rand}{1000^6} \right\rfloor$$
- **スコア乱数（randPermil）**:
  各ノーツごとに $[950, 1050]$（一様乱数 $0.950 \sim 1.050$）が抽選されます。乱数中立時は $1000$。
- **ステージ倍率（stageFactorPermil）**:
  通常は $1000$（1.0倍）。
- **コンボ係数（comboFactorPermil）**:
  表示コンボ数 $C$ に対し、$1000 + \lfloor 2.5 \times C \rfloor$（千分率）。
- **来場ファン係数（fanFactorPermil）**:
  個人来場ファン数 $A$ によるテーブル引き値（例: 8000人 $\to$ 1375‰、16000人 $\to$ 1620‰）。
- **クリティカル係数（critFactorPermil）**:
  通常時は $1000$。クリティカル発生時は $1500 + \text{critExtrasPermil} + \text{ccu}$。

---

## 2. 基礎スコア（`basicScore`）の定義

### 2.1 マスタデータ（`Quest.json`）のステージ重み
マスタデータには各ステージの属性別ビート重み `beatWeightsPermil`（$w_{\text{vo}}, w_{\text{da}}, w_{\text{vi}}$）が千分率で格納されています：
- **通常ステージ（STAGE019, STAGE054等）**:
  $$w = [600, 250, 150] \quad (\Sigma w = 1000‰ = 1.0)$$
  （※センターがダンスの場合は $[150, 600, 250]$、ビジュアルの場合は $[250, 150, 600]$）
- **ビート特徴ステージ（STAGE045等・ビート2.0倍）**:
  $$w = [500, 300, 1200] \quad (\Sigma w = 2000‰ = 2.0)$$

### 2.2 重み付きステータス和（`basicSum`）
各レーンのライブ中ステータス（バフ適用後）に対し、マスタ重みを乗算します：
$$\text{basicSum} = \left\lfloor \frac{Vo \times w_{\text{vo}}}{1000} \right\rfloor + \left\lfloor \frac{Da \times w_{\text{da}}}{1000} \right\rfloor + \left\lfloor \frac{Vi \times w_{\text{vi}}}{1000} \right\rfloor$$

### 2.3 基礎スコア係数（$\lambda$）の比較
現行エンジンとやる気士docsの比較：
- **現行エンジン**:
  $$basic = \left\lfloor \frac{\text{basicSum} \times 8}{140} \right\rfloor \quad (\lambda = \frac{8}{140} \approx 0.057143 = \frac{1}{17.5})$$
- **やる気士docs**:
  通常ステージ（1.0倍）の重みは センター3.0% / 準属性1.25% / 劣勢0.75% であり、合計は **5.0%（= 1/20）**。
  $$basic = \left\lfloor \frac{\text{basicSum} \times 1}{20} \right\rfloor \quad (\lambda = 0.050 = \frac{1}{20})$$
- **両者の比率**:
  $$\frac{8/140}{1/20} = \frac{8 \times 20}{140} = \frac{160}{140} = \frac{8}{7} \approx 1.142857 \quad (\text{現行エンジンが約 } +14.3\% \text{ 高い})$$

---

## 3. スコア上昇ファクター（$B_1$）とフォト重複

通常ビートの $B_1$ ファクターは以下の要素から構成されます：
$$B_1 = 1000 + \text{score\_up\_buff} + \text{yale\_beat\_bonus} + \text{photo\_beat\_bonus}$$

- **score_up バフ**: 25‰ / 段階（T5確定仕様）。
- **エール（yale）**: 編成全体のエールボーナス（例: ビートスコア +6.0% $\to$ 60‰）。
- **フォト（photo）の重複ルール**:
  - **最大値ルール（現行）**: 同一アイドルが装備する複数枚のフォトのうち、最大の `beat_score` のみ加算。
    $$\text{photo\_beat} = \max(\text{photo}_1, \text{photo}_2, \dots)$$
  - **加算ルール（仮説）**: 同一アイドルが装備する複数枚のフォトの `beat_score` を合算。
    $$\text{photo\_beat} = \sum \text{photo}_i$$
