/**
 * T0 データ健全性: スキル発動ログの不変条件（件数・順序・CT 間隔・発動条件）。
 *
 * 根拠: research/05_data_quality.md §5（I-07 / I-11 / I-16）、§3-L、research/08 §2.5、research/11 §1
 * 対象: スコア分析サンプル/measured_data_v2.json
 */
import { describe, expect, it } from "vitest";
import { beatAt, ctx, loadMeasured, type LaneId, type TimelineActivation } from "./helpers.js";

const d = loadMeasured();
const t = d.timeline;
const acts = d.skill_activations_summary.all_activations;

/** CT 短縮イベントの明示的定数（research/11 §1 / research/08 §2.5 の実測）。
 *  beat 106 の L4 A「ドリームウエディング」が隣接アイドルの CT を -15 ビート。
 *  実測: L3 P「逆襲のドッキリ企画」の発動間隔 50→35（b101→b136）、L5 P「さらけ出す」b60→b106。 */
const CT_REDUCTION_EVENT = {
  beat: 106,
  amountBeats: 15,
  targetLanes: [3, 5], // L3 slot3 P「フケのドッキンピ...」/ L5 slot3 P「さらけ出す」
} as const;

describe("I-07: 発動ログ 82 件・order 1〜82 が一意・beat 単調非減少", () => {
  it("合計 82 件（P19 / Photo45 / A16 / SP2、内 FAIL 1: research/05 §2）", () => {
    expect(acts.length, ctx("-", "-", "all_activations.length", 82, acts.length)).toBe(82);
    const byType: Record<string, number> = {};
    for (const a of acts) byType[a.skill_type] = (byType[a.skill_type] ?? 0) + 1;
    expect(byType, ctx("-", "-", "skill_type 内訳", { P: 19, Photo: 45, A: 16, SP: 2 }, byType)).toEqual({ P: 19, Photo: 45, A: 16, SP: 2 });
  });

  it("order が 1..82 の順で一意", () => {
    acts.forEach((a, i) => {
      expect(a.order, ctx("-", "-", `all_activations[${i}].order`, i + 1, a.order, a.file)).toBe(i + 1);
    });
  });

  it("beat は単調非減少", () => {
    for (let i = 1; i < acts.length; i++) {
      expect(
        acts[i]?.beat,
        ctx("-", "-", `all_activations[${i}].beat`, `>= ${acts[i - 1]?.beat}`, acts[i]?.beat, acts[i]?.file),
      ).toBeGreaterThanOrEqual(acts[i - 1]?.beat ?? -1);
    }
  });

  it("summary 集計（total / by_lane）とログ・timeline 側の発動一覧が相互整合", () => {
    expect(d.skill_activations_summary.total_activations, ctx("-", "-", "total_activations", 82, d.skill_activations_summary.total_activations)).toBe(82);
    const byLane: Record<string, number> = {};
    for (const a of acts) byLane[String(a.lane)] = (byLane[String(a.lane)] ?? 0) + 1;
    expect(byLane, ctx("-", "-", "activations_by_lane", d.skill_activations_summary.activations_by_lane, byLane)).toEqual(
      d.skill_activations_summary.activations_by_lane,
    );
    // timeline[].skill_activations をフラット化したものと summary.all_activations が同じ系列
    const fromTimeline = t.flatMap((e) => e.skill_activations);
    expect(fromTimeline.map((a) => a.order), ctx("-", "-", "timeline 発動 order 列", acts.map((a) => a.order), fromTimeline.map((a) => a.order))).toEqual(
      acts.map((a) => a.order),
    );
  });
});

describe("I-11: A/P スキルの同一スロット発動間隔 >= CT-1（beat 106 の CT-15 区間は CT-1-15 を許容）", () => {
  // A/P スキルのみ対象（Photo は characters[].skills に CT 持ちデータがなく、SP は FAIL 含むため対象外）。
  // スロット対応は skill_name の一致で解決する（characters[].skills[i].name === activation.skill_name）。
  const gaps: { lane: LaneId; slot: number; type: string; ct: number; from: number; to: number; gap: number; min: number; relaxed: boolean }[] = [];

  for (const ch of d.characters) {
    ch.skills.forEach((sk, si) => {
      if (sk.type !== "A" && sk.type !== "P") return;
      const beats = acts
        .filter((a) => a.lane === ch.lane && a.skill_type === sk.type && a.skill_name === sk.name)
        .map((a) => a.beat)
        .sort((a, b) => a - b);
      for (let i = 1; i < beats.length; i++) {
        const from = beats[i - 1] as number;
        const to = beats[i] as number;
        // CT短縮の許容区間: 区間が beat 106 を跨ぐ（from < 106 <= to）かつ対象レーン（Lane3/Lane5）のみ。
        // 理由: b106 の L4 A「ドリームウエディング」による隣接 CT-15（research/08 §2.5 実測）。
        const relaxed =
          (CT_REDUCTION_EVENT.targetLanes as readonly number[]).includes(ch.lane) && from < CT_REDUCTION_EVENT.beat && CT_REDUCTION_EVENT.beat <= to;
        const min = sk.ct - 1 - (relaxed ? CT_REDUCTION_EVENT.amountBeats : 0);
        gaps.push({ lane: ch.lane, slot: si + 1, type: sk.type, ct: sk.ct, from, to, gap: to - from, min, relaxed });
      }
    });
  }

  it("A/P スキルの全発動間隔が CT-1（または短縮区間は CT-1-15）以上", () => {
    expect(gaps.length, ctx("-", "-", "A/P 発動間隔データ数", 19, gaps.length)).toBe(19); // P19+A16=35 発動のうち同一スロット2回以上の組19
    const bad = gaps.filter((g) => g.gap < g.min);
    expect(
      bad,
      `CT 違反 ${bad.length} 件\n${bad.map((g) => ctx(g.to, g.lane, `slot${g.slot} gap(${g.from}->${g.to})`, `>= ${g.min}`, g.gap)).join("\n")}`,
    ).toHaveLength(0);
  });

  it("CT-15 許容区間のうち実際に緩和が効いているのは Lane3/Lane5 の既知区間のみ", () => {
    // 緩和なしでも成立する区間に緩和を適用していないことの確認（実質効能は L3 101→136 / L5 60→106 のみ）
    const binding = gaps.filter((g) => g.relaxed && g.gap < g.ct - 1);
    expect(binding.map((g) => `${g.lane}:${g.from}->${g.to}`), ctx("-", "-", "緩和が実効ある区間", ["3:101->136", "5:60->106"], binding.map((g) => `${g.lane}:${g.from}->${g.to}`))).toEqual(
      ["3:101->136", "5:60->106"],
    );
  });
});

describe("I-16: 「80コンボ以上」条件のフォトスキル（Lane1 クリティカルスキル）は combo >= 80 のビートでのみ発火", () => {
  // Lane1 のフォト「80コンボ以上～クリティカルジャンプ上昇（ライブ中1回のみ）」の発動は
  // 発動ログ上 skill_name = "クリティカルスキル"（research/05 §3-L の実測: beat 81 に 1 回のみ）
  const critPhotoActs = acts.filter((a) => a.lane === 1 && a.skill_type === "Photo" && a.skill_name === "クリティカルスキル");

  it("ライブ中 1 回のみ（フォトの条件文どおり）発火", () => {
    expect(critPhotoActs.length, ctx("-", "-", "Lane1 クリティカルスキル発火数", 1, critPhotoActs.length)).toBe(1);
  });

  it("発火ビート 81 で combo = 81 >= 80", () => {
    const a = critPhotoActs[0];
    expect(a, ctx("-", 1, "クリティカルスキル発火", "存在する", undefined)).toBeDefined();
    const combo = beatAt(t, a!.beat).combo;
    expect(a!.beat, ctx("-", 1, "クリティカルスキル発火ビート", 81, a!.beat, a?.file)).toBe(81);
    expect(combo, ctx(a!.beat, 1, "combo@発火ビート", ">= 80", combo)).toBeGreaterThanOrEqual(80);
  });
});
