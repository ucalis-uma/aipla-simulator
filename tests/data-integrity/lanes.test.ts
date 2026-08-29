/**
 * T0 データ健全性: レーン状態（stat_value / stamina）の不変条件。
 *
 * 根拠: research/05_data_quality.md §5（I-09 / I-10 / I-14）、research/11 §2-1
 * 対象: スコア分析サンプル/measured_data_v2.json × verification_data_v2.json
 */
import { describe, expect, it } from "vitest";
import { beatAt, ctx, LANE_IDS, loadMeasured, loadVerification, type LaneId } from "./helpers.js";

const d = loadMeasured();
const v = loadVerification();
const t = d.timeline;

describe("I-09: beat 0 の全レーン stat = 補正後総合ステータス・stamina = max", () => {
  it("measured と verification の characters が同一の補正後ステータスを持つ（入力ソース間整合）", () => {
    expect(d.characters.length, ctx("-", "-", "characters.length", 5, d.characters.length)).toBe(5);
    for (const vc of v.characters) {
      const mc = d.characters.find((c) => c.lane === vc.lane);
      expect(mc, ctx("-", vc.lane, "characters[lane]", "存在する", undefined)).toBeDefined();
      for (const key of ["vocal", "dance", "visual", "stamina"] as const) {
        expect(
          mc?.stats.total_after_non_skill_modifiers[key],
          ctx(0, vc.lane, `characters.total_after_non_skill_modifiers.${key}`, vc.stats.total_after_non_skill_modifiers[key], mc?.stats.total_after_non_skill_modifiers[key]),
        ).toBe(vc.stats.total_after_non_skill_modifiers[key]);
      }
    }
  });

  it("beat 0 の全レーン stat_value が補正後総合ステータス（4 種のいずれか＝レーン色参照ステータス）と一致", () => {
    for (const ch of v.characters) {
      const cell = beatAt(t, 0).lanes[String(ch.lane)];
      const totals = Object.values(ch.stats.total_after_non_skill_modifiers);
      expect(cell != null && totals.includes(cell.stat_value), ctx(0, ch.lane, "stat_value", `total_after_non_skill_modifiers の値のうちの一つ ${totals}`, cell?.stat_value)).toBe(
        true,
      );
    }
  });

  it("beat 0 の全レーン current_stamina = max_stamina（かつ max = 補正後スタミナ）", () => {
    for (const ch of v.characters) {
      const cell = beatAt(t, 0).lanes[String(ch.lane)];
      expect(cell?.current_stamina, ctx(0, ch.lane, "current_stamina", cell?.max_stamina, cell?.current_stamina)).toBe(cell?.max_stamina);
      expect(
        cell?.max_stamina,
        ctx(0, ch.lane, "max_stamina", ch.stats.total_after_non_skill_modifiers.stamina, cell?.max_stamina),
      ).toBe(ch.stats.total_after_non_skill_modifiers.stamina);
    }
  });
});

describe("I-10: 全セルで 0 <= current_stamina <= max_stamina（v2 で 217 セル修正済みのため全セル厳格チェック）", () => {
  it("785 セル（157 ビート × 5 レーン）で範囲内", () => {
    const bad: string[] = [];
    for (const e of t) {
      for (const ln of LANE_IDS) {
        const c = e.lanes[String(ln)];
        if (!c) {
          bad.push(ctx(e.beat, ln, "current_stamina", "セル存在", undefined));
          continue;
        }
        if (c.current_stamina < 0 || c.current_stamina > c.max_stamina) {
          bad.push(ctx(e.beat, ln, "current_stamina", `[0, ${c.max_stamina}]`, c.current_stamina));
        }
      }
    }
    // 旧 v1 の Lane2 b97〜101 = 60,911 超過（research/05 §3-A）は v2 で修正済み。違反は 0 件でなければならない。
    expect(bad, `違反 ${bad.length} 件\n${bad.slice(0, 10).join("\n")}`).toHaveLength(0);
  });
});

describe("I-14: Lane 3 の stat_value は beat 68〜156 で 2,348,336（= floor(626,223 × 3.75)）で固定", () => {
  it("beat 68..156 の 89 ビートすべてが平台上限値", () => {
    const expected = Math.floor(626_223 * 3.75);
    expect(expected, ctx("-", 3, "floor(626223 × 3.75)", 2_348_336, expected)).toBe(2_348_336);
    const bad: string[] = [];
    for (let b = 68; b <= 156; b++) {
      const actual = beatAt(t, b).lanes["3"]?.stat_value;
      if (actual !== expected) bad.push(ctx(b, 3, "stat_value", expected, actual));
    }
    // 中間ビートの個別値（バフ段階が表示に反映されない表示上限）は照合しない（research/05 §3-J の非推奨事項）
    expect(bad, `違反 ${bad.length} 件\n${bad.slice(0, 10).join("\n")}`).toHaveLength(0);
  });
});

describe("v2-追加1: スタミナは「スキル発動のないビートでは変化しない」", () => {
  /** 既知の表示位相例外（research/06 §6 の理由コード: FRAME_TIMING）。
   *  - (beat 61, lane 5): beat 60 に Lane5 が同レーン2発動（A「アイドルの掟への反抗」+ P「さらけ出す」）しており、
   *    2 スキル分の消費（-103 → -168）が連続 2 フレームに分割表示された。b2 の A スコア反映ずれ
   *    （research/09 §5）と同系のフレーム位相起因の観測例外。 */
  const KNOWN_STAMINA_PHASE_EXCEPTIONS: { beat: number; lane: LaneId; reason: string }[] = [
    { beat: 61, lane: 5, reason: "FRAME_TIMING: b60 の同レーン2発動分の消費が b61 フレームに分割表示（-168）" },
  ];

  it("スタミナ変化ビートでは timeline[b].skill_activations が空でない（既知例外を除く）", () => {
    const bad: string[] = [];
    for (let b = 1; b <= 156; b++) {
      for (const ln of LANE_IDS) {
        const cur = beatAt(t, b).lanes[String(ln)]?.current_stamina;
        const prev = beatAt(t, b - 1).lanes[String(ln)]?.current_stamina;
        if (cur !== prev) {
          const known = KNOWN_STAMINA_PHASE_EXCEPTIONS.find((x) => x.beat === b && x.lane === ln);
          if (known) continue; // 理由付きで明示除外（黙示 skip 禁止: research/06 §6）
          if (beatAt(t, b).skill_activations.length === 0) {
            bad.push(ctx(b, ln, "current_stamina(変化)", `skill_activations が空でない（${prev} -> ${cur}）`, "skill_activations = []"));
          }
        }
      }
    }
    expect(bad, `違反 ${bad.length} 件\n${bad.slice(0, 10).join("\n")}`).toHaveLength(0);
  });

  it("既知例外リストに挙げたセルは実際にスタミナ変化が存在する（リストの陳腐化検知）", () => {
    for (const x of KNOWN_STAMINA_PHASE_EXCEPTIONS) {
      const cur = beatAt(t, x.beat).lanes[String(x.lane)]?.current_stamina;
      const prev = beatAt(t, x.beat - 1).lanes[String(x.lane)]?.current_stamina;
      expect(cur !== prev, ctx(x.beat, x.lane, "既知例外の実在", "スタミナ変化あり", `${prev} -> ${cur}`)).toBe(true);
    }
  });
});
