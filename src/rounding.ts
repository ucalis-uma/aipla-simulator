/**
 * 丸め・整数演算の一元化モジュール。
 *
 * 規律（PLAN.md §10 / research/02 §1.14）:
 * - 計算コアでは浮動小数点の「計算結果そのもの」を信用しない。
 * - ゲーム側は千分率整数演算で動作していることが実測で確認されている
 *   （例: floor(5780 x 1150 / 1000) = 6647 が実測値。IEEE754 で 5780*1.15 を
 *    計算して floor すると 6646 になりズレる）。
 * - そのため全ての割合計算は permil（千分率）整数で行い、
 *   「乗算してから 1000 で割る」順序を守る。
 * - このモジュール以外で Math.floor / Math.trunc / Math.round を使わないこと
 *   （ESLint 相当の規律は Phase 1 で導入）。
 */

/**
 * 非負整数に対する切り捨て除算（floor division）。
 * ゲーム内の丸めは実測上すべて切り捨て（floor）。
 */
export function floorDiv(a: number, b: number): number {
  if (!Number.isInteger(a) || !Number.isInteger(b)) {
    throw new Error(`floorDiv requires integers, got ${a} / ${b}`);
  }
  if (b === 0) throw new Error("floorDiv by zero");
  const q = Math.floor(a / b);
  return q;
}

/**
 * 値 × permil(千分率) / 1000 の切り捨て。
 * 例: mulPermil(5780, 1150) = 6647
 * 積算途中の値が 2^53 を超えない範囲で Number を使用する。
 * （コア内の値は最大でも ~10^10 x 10^5 = 10^15 未満に収まることを
 *   呼び出し側で保証する。超える場合は BigInt 版を使う。）
 */
export function mulPermil(value: number, permil: number): number {
  if (!Number.isInteger(value) || !Number.isInteger(permil)) {
    throw new Error(`mulPermil requires integers, got ${value} x ${permil}`);
  }
  const product = value * permil;
  if (!Number.isSafeInteger(product)) {
    throw new Error(`mulPermil overflow: ${value} x ${permil}`);
  }
  return floorDiv(product, 1000);
}

/** BigInt 版の mulPermil（巨大な積算用） */
export function mulPermilBig(value: bigint, permil: bigint): bigint {
  return (value * permil) / 1000n;
}

/** パーセント表記（例: 45.0%）を permil に変換（450） */
export function pctToPermil(pct: number): number {
  const p = pct * 10;
  if (!Number.isInteger(p)) {
    // 0.1% 単位を許容する（例: 27.5% → 275）
    const r = Math.round(p);
    if (Math.abs(p - r) > 1e-9) throw new Error(`pctToPermil: non-representable ${pct}`);
    return r;
  }
  return p;
}

/**
 * 任意の有限実数に対する切り捨て（floor）。
 *
 * 千分率整数演算の枠外（例: FixedRng のクリティカル閾値 = floor(確率 × 2^32)）で
 * 必要になった場合にのみ使用する。スコア計算コアでは mulPermil / floorDiv を使うこと。
 * （規律: このモジュール以外で Math.floor を直接呼ばない）
 */
export function floorOf(x: number): number {
  if (!Number.isFinite(x)) {
    throw new Error(`floorOf requires a finite number, got ${x}`);
  }
  return Math.floor(x);
}
