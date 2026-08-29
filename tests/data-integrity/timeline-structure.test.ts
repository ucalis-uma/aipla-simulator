/**
 * T0 データ健全性: timeline 構造・コンボの不変条件。
 *
 * 根拠: research/05_data_quality.md §5（I-01 / I-03 / I-04 / I-06）
 * 対象: スコア分析サンプル/measured_data_v2.json
 */
import { describe, expect, it } from "vitest";
import { beatAt, ctx, LANE_IDS, loadMeasured } from "./helpers.js";

const d = loadMeasured();
const t = d.timeline;

describe("I-01: beat index は 0〜156 がちょうど 1 回ずつ", () => {
  it("timeline は 157 件で beat が昇順かつ 0..156 と完全一致", () => {
    expect(t.length, ctx("-", "-", "timeline.length", 157, t.length)).toBe(157);
    for (let b = 0; b <= 156; b++) {
      const e = t[b];
      expect(e, ctx(b, "-", "timeline[b]", "存在する", undefined)).toBeDefined();
      expect(e?.beat, ctx(b, "-", "beat", b, e?.beat)).toBe(b);
    }
  });
});

describe("I-03: cum(b) = cum(b-1) + gained(b)（全ビート）", () => {
  it("全 156 区間で累積スコアの漸化式が成立（不一致 0 件）", () => {
    const diffs: string[] = [];
    for (let b = 1; b <= 156; b++) {
      const prev = beatAt(t, b - 1);
      const cur = beatAt(t, b);
      const expected = prev.cumulative_score + cur.beat_gained_score;
      if (cur.cumulative_score !== expected) {
        diffs.push(ctx(b, "-", "cumulative_score", expected, cur.cumulative_score));
      }
    }
    expect(diffs, `不一致 ${diffs.length} 件\n${diffs.slice(0, 10).join("\n")}`).toHaveLength(0);
  });
});

describe("I-04: cumulative_score 単調非減少・beat_gained_score >= 0", () => {
  it("cumulative_score は全ビートで非減少", () => {
    const bad: string[] = [];
    for (let b = 1; b <= 156; b++) {
      const prev = beatAt(t, b - 1).cumulative_score;
      const cur = beatAt(t, b).cumulative_score;
      if (cur < prev) bad.push(ctx(b, "-", "cumulative_score", `>= ${prev}`, cur));
    }
    expect(bad, `違反 ${bad.length} 件\n${bad.slice(0, 10).join("\n")}`).toHaveLength(0);
  });

  it("beat_gained_score は全ビートで 0 以上", () => {
    const bad: string[] = [];
    for (let b = 0; b <= 156; b++) {
      const g = beatAt(t, b).beat_gained_score;
      if (g < 0) bad.push(ctx(b, "-", "beat_gained_score", ">= 0", g));
    }
    expect(bad, `違反 ${bad.length} 件\n${bad.slice(0, 10).join("\n")}`).toHaveLength(0);
  });
});

describe("I-06: combo は beat 1〜155 で毎ビート +1、beat 0/156 は非減少、最大 = results.combo", () => {
  it("beat 0 は combo 0（開始値）", () => {
    expect(beatAt(t, 0).combo, ctx(0, "-", "combo", 0, beatAt(t, 0).combo)).toBe(0);
  });

  it("beat 1〜155 で毎ビートちょうど +1", () => {
    const bad: string[] = [];
    for (let b = 1; b <= 155; b++) {
      const expected = beatAt(t, b - 1).combo + 1;
      const actual = beatAt(t, b).combo;
      if (actual !== expected) bad.push(ctx(b, "-", "combo", expected, actual));
    }
    // 既知の境界異常はこのレンジに含まれない（research/05 §3-F/G は beat 0/156 のみ対象）
    expect(bad, `違反 ${bad.length} 件\n${bad.slice(0, 10).join("\n")}`).toHaveLength(0);
  });

  it("beat 0 と beat 156 は非減少のみ要求（research/05 §3-G: 最終フレーム更新前截取の境界異常）", () => {
    // beat 0 は単一ビートなので非減少の対象は実質 beat 156 のみ
    expect(beatAt(t, 156).combo, ctx(156, "-", "combo", `>= ${beatAt(t, 155).combo}`, beatAt(t, 156).combo)).toBeGreaterThanOrEqual(
      beatAt(t, 155).combo,
    );
  });

  it("コンボ最大値 = results.combo = 155", () => {
    const max = Math.max(...t.map((e) => e.combo));
    expect(max, ctx("-", "-", "max(combo)", d.results.combo, max)).toBe(d.results.combo);
    expect(d.results.combo, ctx("-", "-", "results.combo", 155, d.results.combo)).toBe(155);
  });
});

describe("構造補助: lanes は 5 レーン分のセルを持つ", () => {
  it("全ビートで lanes 1〜5 のキーが揃っている", () => {
    const bad: string[] = [];
    for (const e of t) {
      for (const ln of LANE_IDS) {
        if (!e.lanes[String(ln)]) bad.push(ctx(e.beat, ln, "lanes[lane]", "存在する", undefined));
      }
    }
    expect(bad, `欠落 ${bad.length} 件\n${bad.slice(0, 10).join("\n")}`).toHaveLength(0);
  });
});
