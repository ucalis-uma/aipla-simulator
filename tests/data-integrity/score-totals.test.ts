/**
 * T0 データ健全性: スコア合計の三重整合と gained=0 ビートの不変条件。
 *
 * 根拠: research/05_data_quality.md §5（I-02 / I-05 / I-08）
 * 対象: スコア分析サンプル/measured_data_v2.json
 */
import { describe, expect, it } from "vitest";
import { beatAt, ctx, loadMeasured, TOTAL_SCORE } from "./helpers.js";

const d = loadMeasured();
const t = d.timeline;

describe("I-02: Σbeat_gained_score = 最終cumulative_score = results.total_score = 17,529,132,014", () => {
  it("3 つの合計経路が 1 の位まで完全一致", () => {
    const sumGained = t.reduce((acc, e) => acc + e.beat_gained_score, 0);
    const lastCum = beatAt(t, 156).cumulative_score;
    expect(sumGained, ctx("-", "-", "Σ beat_gained_score", TOTAL_SCORE, sumGained)).toBe(TOTAL_SCORE);
    expect(lastCum, ctx(156, "-", "cumulative_score", TOTAL_SCORE, lastCum)).toBe(TOTAL_SCORE);
    expect(d.results.total_score, ctx("-", "-", "results.total_score", TOTAL_SCORE, d.results.total_score)).toBe(TOTAL_SCORE);
  });
});

describe("I-05: Σ results.scores_by_lane = results.total_score", () => {
  it("レーン別獲得スコア（5 レーン）の合計が最終スコアと一致", () => {
    const lanes = Object.keys(d.results.scores_by_lane);
    expect(lanes.sort(), ctx("-", "-", "scores_by_lane keys", ["1", "2", "3", "4", "5"], lanes)).toEqual(["1", "2", "3", "4", "5"]);
    const sum = Object.values(d.results.scores_by_lane).reduce((a, b) => a + b, 0);
    expect(sum, ctx("-", "-", "Σ scores_by_lane", d.results.total_score, sum)).toBe(d.results.total_score);
  });
});

describe("I-08: gained=0 のビートは {0, 1, 49} のみ", () => {
  it("beat_gained_score = 0 のビート集合はちょうど {0, 1, 49}", () => {
    const zeros = t.filter((e) => e.beat_gained_score === 0).map((e) => e.beat);
    // 既知の境界異常（research/05 §3-F）:
    // - beat 0: ライブ開始フレーム（スコア未発生）
    // - beat 1: 初回ノーツのスコアポップが「LIVE START」表示に隣接して未読取
    // beat 49 は SP FAIL（別テストで詳細検証）
    expect(zeros, ctx("-", "-", "gained==0 のビート集合", [0, 1, 49], zeros)).toEqual([0, 1, 49]);
  });

  it("beat 49 は SP FAIL: skill_activations に FAIL 行があり、コンボ継続・stamina 不変", () => {
    const b48 = beatAt(t, 48);
    const b49 = beatAt(t, 49);
    const acts = b49.skill_activations;
    expect(
      acts.some((a) => a.skill_name.includes("FAIL")),
      ctx(49, "-", "skill_activations[*].skill_name", "FAIL を含む", acts.map((a) => `${a.skill_type}:${a.skill_name}`)),
    ).toBe(true);

    const failAct = acts.find((a) => a.skill_name.includes("FAIL"));
    // SP FAIL は Lane 4（research/05 §3-L）
    expect(failAct?.lane, ctx(49, "-", "FAIL activation.lane", 4, failAct?.lane, failAct?.file)).toBe(4);

    // コンボは継続（前ビートから +1）＝スキル失敗時コンボ仕様の一次証拠
    expect(b49.combo, ctx(49, "-", "combo", b48.combo + 1, b49.combo)).toBe(b48.combo + 1);

    // スタミナ無消費（Lane 4: 13519 のまま）
    expect(b49.lanes["4"]?.current_stamina, ctx(49, 4, "current_stamina", b48.lanes["4"]?.current_stamina, b49.lanes["4"]?.current_stamina)).toBe(
      b48.lanes["4"]?.current_stamina,
    );

    // FAIL 行には根拠画像が付く（research/06 §6 の紐付け用）
    expect(failAct?.file, ctx(49, 4, "FAIL activation.file", "IMG_####.PNG 形式", failAct?.file)).toMatch(/^IMG_\d+\.PNG$/);
  });
});
