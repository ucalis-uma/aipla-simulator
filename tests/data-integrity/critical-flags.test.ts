/**
 * T0 データ健全性: クリティカルフラグ（v2 新規データ）の構造とレート整合。
 *
 * 根拠: research/09_buffs_criticals.md §2（ポップ色解析）、research/05 §3-H、research/11 §1
 * 対象: スコア分析サンプル/measured_data_v2.json critical_flags
 *
 * 注意: クリティカル率の「分母」には 2 つの解釈が残存する（research/09 §1.1 / §2.3）。
 *   (A) ノート単位（分母 155）: 22.3% × 155 = 34.6 → 33〜35 枚のレンジ
 *   (B) メンバー単位（分母 775 = 155 × 5）: 22.3% × 775 = 172.8 → 可視黄ポップ + 遮蔽分で整合
 * 実測の可視黄ポップ合計 148 は (A) と矛盾し (B) と整合するため、
 * この検査は 2 解釈に分割して記録する（少なくとも片方のレンジに入ることを主要アサーションとする）。
 */
import { describe, expect, it } from "vitest";
import { ctx, LANE_IDS, loadMeasured } from "./helpers.js";

const d = loadMeasured();
const cf = d.critical_flags;
const beats = cf.beats;
const LAST_BEAT = 156;
const ALL_LANES = ["1", "2", "3", "4", "5"];

function sumBy(list: "yellow_lanes" | "white_lanes" | "no_pop_lanes"): number {
  let n = 0;
  for (let b = 0; b <= LAST_BEAT; b++) n += beats[String(b)]?.[list].length ?? 0;
  return n;
}

describe("v2-追加2: critical_flags.beats が 0〜156 の 157 ビート分あり、各要素に必須フィールドがある", () => {
  it("beats のキーは 0..156 がちょうど 157 件", () => {
    const keys = Object.keys(beats).map(Number).sort((a, b) => a - b);
    expect(keys, ctx("-", "-", "critical_flags.beats keys", "0..156 の 157 件", `${keys.length} 件`)).toHaveLength(157);
    keys.forEach((k, i) => {
      expect(k, ctx(k, "-", "beats key", i, k)).toBe(i);
    });
  });

  it("各要素に any_yellow / any_white / yellow_lanes / white_lanes / no_pop_lanes があり型が正しい", () => {
    const bad: string[] = [];
    for (let b = 0; b <= LAST_BEAT; b++) {
      const e = beats[String(b)];
      if (!e) {
        bad.push(ctx(b, "-", "critical_flags.beats[beat]", "存在する", undefined));
        continue;
      }
      if (typeof e.any_yellow !== "boolean") bad.push(ctx(b, "-", "any_yellow", "boolean", e.any_yellow));
      if (typeof e.any_white !== "boolean") bad.push(ctx(b, "-", "any_white", "boolean", e.any_white));
      for (const field of ["yellow_lanes", "white_lanes", "no_pop_lanes"] as const) {
        const arr = e[field];
        if (!Array.isArray(arr)) bad.push(ctx(b, "-", field, "string[]", arr));
        else if (arr.some((x) => !(ALL_LANES as string[]).includes(x))) bad.push(ctx(b, "-", field, "レーン id '1'〜'5'", arr));
      }
    }
    expect(bad, `違反 ${bad.length} 件\n${bad.slice(0, 10).join("\n")}`).toHaveLength(0);
  });

  it("フラグ内部整合: any_yellow ⟺ yellow_lanes 非空、3 リストは 5 レーンの分割（重複なし・過不足なし）", () => {
    const bad: string[] = [];
    for (let b = 0; b <= LAST_BEAT; b++) {
      const e = beats[String(b)];
      if (!e) continue;
      if (e.any_yellow !== e.yellow_lanes.length > 0) bad.push(ctx(b, "-", "any_yellow vs yellow_lanes", e.yellow_lanes.length > 0, e.any_yellow));
      if (e.any_white !== e.white_lanes.length > 0) bad.push(ctx(b, "-", "any_white vs white_lanes", e.white_lanes.length > 0, e.any_white));
      const all = [...e.yellow_lanes, ...e.white_lanes, ...e.no_pop_lanes].sort();
      if (all.length !== 5 || new Set(all).size !== 5) {
        bad.push(ctx(b, "-", "yellow+white+no_pop の分割", "5 レーンの重複なし分割", all.join(",")));
      }
    }
    expect(bad, `違反 ${bad.length} 件\n${bad.slice(0, 10).join("\n")}`).toHaveLength(0);
  });

  it("ビート別集計が critical_flags.per_lane_counts と一致", () => {
    for (const ln of ALL_LANES) {
      let y = 0;
      let w = 0;
      let n = 0;
      for (let b = 0; b <= LAST_BEAT; b++) {
        const e = beats[String(b)];
        if (e?.yellow_lanes.includes(ln)) y++;
        if (e?.white_lanes.includes(ln)) w++;
        if (e?.no_pop_lanes.includes(ln)) n++;
      }
      const ref = cf.per_lane_counts[ln];
      expect(y, ctx("-", ln, "per_lane_counts.yellow（ビート集計と照合）", ref?.yellow, y)).toBe(ref?.yellow);
      expect(w, ctx("-", ln, "per_lane_counts.white（ビート集計と照合）", ref?.white, w)).toBe(ref?.white);
      expect(n, ctx("-", ln, "per_lane_counts.no_pop（ビート集計と照合）", ref?.no_pop, n)).toBe(ref?.no_pop);
    }
  });
});

describe("v2-追加3: 黄ポップ合計が results.critical_rate_pct 22.3% の整合レンジ内（2 解釈に分割して記録）", () => {
  const yellow = sumBy("yellow_lanes");
  const visible = yellow + sumBy("white_lanes");
  const noPop = sumBy("no_pop_lanes");

  // レンジ (A) ノート単位: 22.3% × 155 = 34.6（research/05 §3-H: クリティカル枚数は 33〜35 枚のレンジでのみ拘束）
  const RANGE_A: [number, number] = [33, 35];
  // レンジ (B) メンバー単位: 分母 775 で期待 172.8 個。可視黄 148 + 遮蔽 86 セル中の隠れクリティカルで整合
  //   （research/09 §2.3）ので、可視黄は 173 を超えない。下限は実測アンカー 142〜148（コンセンサス不確実性込み）。
  const RANGE_B: [number, number] = [142, 173];

  it("[主要アサーション] 黄ポップ合計は少なくとも片方の解釈の整合レンジに入る", () => {
    const inA = yellow >= RANGE_A[0] && yellow <= RANGE_A[1];
    const inB = yellow >= RANGE_B[0] && yellow <= RANGE_B[1];
    expect(inA || inB, ctx("-", "-", "yellow ポップ合計", `解釈A ${RANGE_A} のいずれか / 解釈B ${RANGE_B} のいずれか`, yellow)).toBe(true);
  });

  it("[解釈B: メンバー単位] 可視黄率 ≈ 21.2% が表示 22.3% と ±2pp 以内で整合し、775 分母の期待値以下（research/09 §2.3）", () => {
    const rate = yellow / visible;
    expect(
      Math.abs(rate - d.results.critical_rate_pct / 100),
      ctx("-", "-", "可視黄率 vs critical_rate_pct", `22.3% ± 2pp（yellow=${yellow}, visible=${visible}）`, `${(rate * 100).toFixed(2)}%`),
    ).toBeLessThanOrEqual(0.02);
    expect(yellow, ctx("-", "-", "yellow ポップ合計（可視）", `<= ${RANGE_B[1]}（775 分母の期待値、遮蔽分は加算方向）`, yellow)).toBeLessThanOrEqual(RANGE_B[1]);
  });

  it(
    "[解釈A: ノート単位・低信頼/skip] 22.3% × 155 = 34.6 → 33〜35 枚のレンジ（research/05 §3-H）" +
      "— 実測 148 と矛盾のため低信頼 skip（research/09 §1.1・§7-1）",
    (tc) => {
      // 低信頼タグ（research/09 §1.1 の通り）: ポップ色実測（148 個、L3 だけで 95 個）はノート単位解釈の
      // 33〜35 枚と矛盾する。research/09 §2.3 の「クリティカルはメンバー（レーン）ごとに独立ロール」の
      // 証拠（同ビートでレーンごとに色が割れる）が解釈 B を支持する。矛盾が解けるまで（HIT 94.4% の
      // 分母確定まで）は明示 skip とする（黙示 skip 禁止: research/06 §6 → 理由はテスト名と本コメントで明示。
      // vitest 2.1 の context.skip() は引数なし型のため理由はコメント記載）。
      tc.skip();
      // skip されなければ（将来データが変わった場合）レンジ照合を実施
      expect(yellow, ctx("-", "-", "yellow ポップ合計（ノート単位解釈）", RANGE_A, yellow)).toBeGreaterThanOrEqual(RANGE_A[0]);
      expect(yellow, ctx("-", "-", "yellow ポップ合計（ノート単位解釈）", RANGE_A, yellow)).toBeLessThanOrEqual(RANGE_A[1]);
    },
  );

  it("実測アンカー: 可視黄ポップ合計は 142〜148 の観測レンジ内（research/09 §2.2 のレーン別黄数の総和）", () => {
    // レーン別黄数（L1=2, L2=40, L3=95, L4=7, L5=4）の総和 = 148
    expect(yellow, ctx("-", "-", "yellow ポップ合計（観測アンカー）", "[142, 148]", yellow)).toBeGreaterThanOrEqual(142);
    expect(yellow, ctx("-", "-", "yellow ポップ合計（観測アンカー）", "[142, 148]", yellow)).toBeLessThanOrEqual(148);
  });
});
