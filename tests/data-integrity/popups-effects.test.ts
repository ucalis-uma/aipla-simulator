/**
 * T0 データ健全性: スコアポップアップ・effects の不変条件。
 *
 * 根拠: research/05_data_quality.md §5（I-12 / I-13 / I-15）、§3-I、research/11 §1（Lane3 統合）
 * 対象: スコア分析サンプル/measured_data_v2.json
 */
import { describe, expect, it } from "vitest";
import { ctx, LANE_IDS, loadMeasured, type LaneId } from "./helpers.js";

const d = loadMeasured();
const t = d.timeline;

const UNIT: Record<string, number> = { K: 1e3, M: 1e6, G: 1e9 };

/** "+4.1M" / "+57.3K" / "+1234G" をパースして 10^k 倍の整数を返す（小数 1 桁前提で round により正確に復元） */
function parseDisplayed(s: string): number | null {
  const m = /^\+([0-9.]+)([KMG])$/.exec(s);
  if (!m) return null;
  return Math.round(Number.parseFloat(m[1] as string) * UNIT[m[2] as string]!);
}

describe("I-12: gained_score は gained_score_displayed を 10 の冪で切り捨てた値と一致", () => {
  /** 厳密一致しない既知セル（10 件）。research/05 §3-I は「10^k の整数倍でない例は 0 件」としたが、
   *  v2 全件走査の結果 10 セルで 1 少ない値が記録されている。切り捨て方向（actual = expected - 1）かつ
   *  K/M/G の区切りのけたでのみ発生するため、抽出パイプラインの浮動小数切捨て（float truncation）
   *  アーティファクトと判定（例: +4.1M → 4,099,999 / +261.9K → 261,899）。 */
  const KNOWN_OFF_BY_ONE_CELLS: { beat: number; lane: LaneId; disp: string; expected: number; actual: number }[] = [
    { beat: 70, lane: 5, disp: "+261.9K", expected: 261_900, actual: 261_899 },
    { beat: 119, lane: 3, disp: "+4.1M", expected: 4_100_000, actual: 4_099_999 },
    { beat: 129, lane: 3, disp: "+4.1M", expected: 4_100_000, actual: 4_099_999 },
    { beat: 131, lane: 3, disp: "+4.1M", expected: 4_100_000, actual: 4_099_999 },
    { beat: 138, lane: 3, disp: "+4.1M", expected: 4_100_000, actual: 4_099_999 },
    { beat: 145, lane: 3, disp: "+4.1M", expected: 4_100_000, actual: 4_099_999 },
    { beat: 145, lane: 4, disp: "+64.1K", expected: 64_100, actual: 64_099 },
    { beat: 147, lane: 3, disp: "+4.1M", expected: 4_100_000, actual: 4_099_999 },
    { beat: 149, lane: 3, disp: "+4.1M", expected: 4_100_000, actual: 4_099_999 },
    { beat: 154, lane: 3, disp: "+4.1M", expected: 4_100_000, actual: 4_099_999 },
  ];

  it("ポップ表示のある全セルで |gained_score - 表示値×10^k| <= 1", () => {
    const bad: string[] = [];
    let covered = 0;
    for (const e of t) {
      for (const ln of LANE_IDS) {
        const c = e.lanes[String(ln)];
        if (c?.gained_score == null) continue; // 表示値がないセルはスキップ（カバレッジ 674/785）
        covered++;
        if (c.gained_score_displayed == null) {
          bad.push(ctx(e.beat, ln, "gained_score_displayed", "文字列", null));
          continue;
        }
        const parsed = parseDisplayed(c.gained_score_displayed);
        if (parsed == null) {
          bad.push(ctx(e.beat, ln, "gained_score_displayed", "+X.YK|M|G 形式", c.gained_score_displayed));
          continue;
        }
        if (Math.abs(c.gained_score - parsed) > 1) {
          bad.push(ctx(e.beat, ln, "gained_score", `≈ ${parsed} (disp ${c.gained_score_displayed})`, c.gained_score));
        }
      }
    }
    expect(covered, ctx("-", "-", "ポップ表示セル数（research/05 §2: 674/785）", 674, covered)).toBe(674);
    expect(bad, `乖離 > 1 の違反 ${bad.length} 件\n${bad.slice(0, 10).join("\n")}`).toHaveLength(0);
  });

  it("厳密一致しないセルは既知の 10 件のみ（既知リストの陳腐化検知）", () => {
    const offByOne: { beat: number; lane: LaneId; disp: string; expected: number; actual: number }[] = [];
    for (const e of t) {
      for (const ln of LANE_IDS) {
        const c = e.lanes[String(ln)];
        if (c?.gained_score == null || c.gained_score_displayed == null) continue;
        const parsed = parseDisplayed(c.gained_score_displayed);
        if (parsed != null && c.gained_score !== parsed) {
          offByOne.push({ beat: e.beat, lane: ln, disp: c.gained_score_displayed, expected: parsed, actual: c.gained_score });
        }
      }
    }
    expect(offByOne, ctx("-", "-", "off-by-one セル", KNOWN_OFF_BY_ONE_CELLS, offByOne)).toEqual(KNOWN_OFF_BY_ONE_CELLS);
    expect(offByOne.every((x) => x.expected - x.actual === 1), ctx("-", "-", "off-by-one の方向", "expected - actual = 1（切り捨て方向）", offByOne.map((x) => x.expected - x.actual))).toBe(true);
  });
});

describe("I-13: レーン別ポップアップ合計 <= results レーン別スコア、差が -4%〜0%", () => {
  it("5 レーンすべてで差分が [-4%, 0%]（research/05 §3-I の実測差分範囲）", () => {
    const rows: { lane: LaneId; popupSum: number; result: number; diffPct: number }[] = [];
    const bad: string[] = [];
    for (const ln of LANE_IDS) {
      let popupSum = 0;
      for (const e of t) popupSum += e.lanes[String(ln)]?.gained_score ?? 0;
      const result = d.results.scores_by_lane[String(ln)] as number;
      const diffPct = ((popupSum - result) / result) * 100;
      rows.push({ lane: ln, popupSum, result, diffPct });
      if (diffPct < -4 || diffPct > 0) {
        bad.push(ctx("-", ln, "レーン別ポップ合計 vs results", "[-4%, 0%]", `${diffPct.toFixed(2)}% (popupSum=${popupSum}, result=${result})`));
      }
    }
    // 参考実測値（research/05 §3-I）: L1 -3.0 / L2 -2.2 / L3 -0.4 / L4 -3.4 / L5 -2.6（%）
    expect(rows.map((r) => `${r.lane}:${r.diffPct.toFixed(2)}%`)).toEqual(["1:-3.04%", "2:-2.20%", "3:-0.40%", "4:-3.36%", "5:-2.63%"]);
    expect(bad, `レンジ外 ${bad.length} 件\n${bad.join("\n")}`).toHaveLength(0);
  });
});

describe("I-15: 同一レーン同一ビートに同 id effect の重複がない（v2 統合済みのため全レーン厳格チェック）", () => {
  it("785 セルすべてで effects の id が一意", () => {
    const bad: string[] = [];
    for (const e of t) {
      for (const ln of LANE_IDS) {
        const ids = (e.lanes[String(ln)]?.effects ?? []).map((f) => f.id);
        if (new Set(ids).size !== ids.length) {
          const dupIds = ids.filter((id, i) => ids.indexOf(id) !== i);
          bad.push(ctx(e.beat, ln, "effects[*].id", "重複なし", `重複 id: ${[...new Set(dupIds)].join(",")}`));
        }
      }
    }
    // 旧 v1 の Lane3 重複 460 件（research/05 §3-D）は v2 で統合済み。全レーンで違反 0 件でなければならない。
    expect(bad, `重複 ${bad.length} 件\n${bad.slice(0, 10).join("\n")}`).toHaveLength(0);
  });

  it("combo_continue は全セルで stage = null（段階なし効果: research/05 §3-E / research/11 §1）", () => {
    const bad: string[] = [];
    for (const e of t) {
      for (const ln of LANE_IDS) {
        for (const f of e.lanes[String(ln)]?.effects ?? []) {
          if (f.id === "combo_continue" && f.stage !== null) {
            bad.push(ctx(e.beat, ln, "combo_continue.stage", null, f.stage));
          }
        }
      }
    }
    // 旧 v1 の Lane3 22 件 + Lane2 33 件（research/11 §1 で「55 件すべて Lane3」を訂正）は v2 で修正済み。
    expect(bad, `違反 ${bad.length} 件\n${bad.slice(0, 10).join("\n")}`).toHaveLength(0);
  });
});
