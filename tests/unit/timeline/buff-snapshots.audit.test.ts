/**
 * 【バフスナップショット全件監査テスト】（Phase 13 / prompts/audit-buff-snapshots.md）
 *
 * 全サンプルのタイムライン実行時における実効バフ段数（BuffSnapshot）を
 * ビート単位・レーン単位・キー単位で厳格に検証するゴールデンテスト。
 * スコア計算に渡る実効段数（ステップ8開始前スナップショット）が
 * 意図した通りに推移していることを保証する。
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
import { buildSimulateInput, type SimSourceData, type DeckJsonV2 } from "../../../src/sim/build.js";
import { simulateTimeline } from "../../../src/timeline/engine.js";
import { NeutralRng } from "../../../src/rng/neutral.js";
import { mergePhotoEquipStatuses, myPhotoToSkillDef, type MyPhotoDef } from "../../../src/photos.js";

const readJson = (p: string): any => JSON.parse(readFileSync(p, "utf-8"));
const dataDir = path.join(repoRoot, "data");

function loadSharedData(): SimSourceData {
  const STAGE3 = "qt-ex-tower-005-045";
  const CHART3 = "chart-thrx-004-001";
  const idx = readJson(path.join(dataDir, "stages_index.json"));
  const quest1 = idx.quests.find((x: any) => x.id === "qt-area-1-001")!;
  const cfg1 = idx.configs[quest1.c]!;
  const quest3 = idx.quests.find((x: any) => x.id === STAGE3)!;
  const cfg3 = idx.configs[quest3.c]!;
  const allCharts = readJson(path.join(dataDir, "charts_all.json"));

  return {
    cards: readJson(path.join(dataDir, "cards.json")).cards,
    cardParameters: readJson(path.join(dataDir, "card_parameters.json")).rows,
    skillsGolden: readJson(path.join(dataDir, "skills_golden.json")).skills,
    stages: {
      "qt-daily-003-19": readJson(path.join(dataDir, "stages/qt-daily-003-19.json")),
      "qt-area-1-001": {
        beatWeightsPermil: { vocal: cfg1.w[0]!, dance: cfg1.w[1]!, visual: cfg1.w[2]! },
        skillWeightsPermil: { active: cfg1.aw[0]!, special: cfg1.aw[1]! },
        laneAttributes: cfg1.a,
      },
      [STAGE3]: {
        beatWeightsPermil: { vocal: cfg3.w[0]!, dance: cfg3.w[1]!, visual: cfg3.w[2]! },
        skillWeightsPermil: { active: cfg3.aw[0]!, special: cfg3.aw[1]! },
        skillStaminaWeightPermil: cfg3.st ?? 1000,
        laneAttributes: cfg3.a,
      },
    },
    charts: {
      "chart-hsm-004-001": readJson(path.join(dataDir, "charts/chart-hsm-004-001.json")),
      "chart-hsm-006-001": {
        notes: (allCharts["chart-hsm-006-001"] as Array<[number, number]>).map(([t, p]: any, i: number) => ({
          beat: i + 1,
          type: t,
          position: p,
        })),
      },
      [CHART3]: {
        notes: (allCharts[CHART3] as Array<[number, number]>).map(([t, p]: any, i: number) => ({
          beat: i + 1,
          type: t,
          position: p,
        })),
      },
    },
    audienceAdvantage: readJson(path.join(dataDir, "stages/audience_advantage.json")),
    skillsByCard: readJson(path.join(dataDir, "skills_master.json")).byCard,
    skillLevels: readJson(path.join(dataDir, "skills_levels.json")),
    liveBonusesByQuest: readJson(path.join(dataDir, "live_bonuses.json")).byQuest,
    characterAdvantageByQuest: readJson(path.join(dataDir, "character_advantage.json")).byQuest,
  } as any;
}

function snap(beat: { buffSnapshots: readonly any[] }, laneIdx: number): any {
  const s = beat.buffSnapshots[laneIdx];
  if (!s) throw new Error(`no snapshot for lane ${laneIdx}`);
  return s;
}

describe("Buff Snapshot Stage Audit (S1 / T5 / S3)", () => {
  const data = loadSharedData();

  describe("S1 (qt-area-1-001 / chart-hsm-006-001)", () => {
    function runS1() {
      const cfgJson = readJson(path.join(repoRoot, "../aipura_nox/サンプル1/deck.json"));
      const d = cfgJson.deck;
      const myPhotos: MyPhotoDef[] = cfgJson.myPhotos ?? [];
      const photoEquip: string[][] = cfgJson.photoEquip ?? [];
      photoEquip.forEach((ids, i) => {
        const ch = d.characters[i];
        if (ch === undefined || !Array.isArray(ch.photos)) return;
        const equipped = ids
          .map((pid) => myPhotos.find((x) => x?.id === pid))
          .filter((p): p is MyPhotoDef => p !== undefined);
        ch.photos = mergePhotoEquipStatuses(ch.photos, equipped);
      });
      const userPhotoSkills =
        myPhotos.length > 0
          ? photoEquip.flatMap((ids, i) =>
              ids.flatMap((pid, j) => {
                const p = myPhotos.find((x) => x?.id === pid);
                if (p === undefined) return [];
                const def = myPhotoToSkillDef(p, (i + 1) as any, j + 1);
                return def !== null ? [def] : [];
              }),
            )
          : undefined;

      const built = buildSimulateInput({
        deck: d,
        stageFile: "qt-area-1-001",
        chartFile: "chart-hsm-006-001",
        data,
        audience: 20,
        disabledSkillIds: cfgJson.disabledSkillIds,
        userPhotoSkills,
      } as any);

      return simulateTimeline({
        ...built.base,
        rng: new NeutralRng(),
        criticalProvider: () => false,
      });
    }

    it("b8（クリーン回）: 全レーンのバフ段数が正しく推移していること", () => {
      const res = runS1();
      const b8 = res.beats.find((b) => b.beat === 8)!;
      expect(b8).toBeDefined();
      expect(snap(b8, 0).vocal_up).toBe(3);
      expect(snap(b8, 1).critical_rate_up).toBe(0);
      expect(snap(b8, 2).combo_score_up).toBe(0);
      expect(snap(b8, 2).focus).toBe(7);
      expect(snap(b8, 3).combo_score_up).toBe(0);
      expect(snap(b8, 4).combo_score_up).toBe(0);
    });

    it("b40-b41: L4 A（千紗ビーム）発動で L3/L5 に combo_score_up 6段が付与される", () => {
      const res = runS1();
      const b40 = res.beats.find((b) => b.beat === 40)!;
      const b41 = res.beats.find((b) => b.beat === 41)!;
      expect(snap(b40, 2).combo_score_up).toBe(0);
      expect(snap(b40, 4).combo_score_up).toBe(0);
      expect(snap(b41, 2).combo_score_up).toBe(6);
      expect(snap(b41, 4).combo_score_up).toBe(6);
    });

    it("b50-b51: L4 P（千紗SOS団）増強で L3 combo_score_up が 6→7段へ増強される", () => {
      const res = runS1();
      const b50 = res.beats.find((b) => b.beat === 50)!;
      const b51 = res.beats.find((b) => b.beat === 51)!;
      expect(snap(b50, 2).combo_score_up).toBe(6);
      expect(snap(b51, 2).combo_score_up).toBe(7);
    });

    it("b66-b67: L1 A（夏を先取り）+3増強で L3 combo_score_up が 7→10段へ増強される", () => {
      const res = runS1();
      const b66 = res.beats.find((b) => b.beat === 66)!;
      const b67 = res.beats.find((b) => b.beat === 67)!;
      expect(snap(b66, 2).combo_score_up).toBe(7);
      expect(snap(b67, 2).combo_score_up).toBe(10);
    });

    it("b97-b98: 千紗ビーム再発動で L3/L5 に combo_score_up が付与される", () => {
      const res = runS1();
      const b97 = res.beats.find((b) => b.beat === 97)!;
      const b98 = res.beats.find((b) => b.beat === 98)!;
      expect(snap(b97, 2).combo_score_up).toBe(0);
      expect(snap(b98, 2).combo_score_up).toBe(6);
    });

    it("b100-b101: 千紗SOS団 +1増強で L3 combo_score_up が 6→7段へ増強される", () => {
      const res = runS1();
      const b100 = res.beats.find((b) => b.beat === 100)!;
      const b101 = res.beats.find((b) => b.beat === 101)!;
      expect(snap(b100, 2).combo_score_up).toBe(6);
      expect(snap(b101, 2).combo_score_up).toBe(7);
    });

    it("b123-b124: 夏を先取り +3増強で L3 combo_score_up が 7→10段へ増強される", () => {
      const res = runS1();
      const b123 = res.beats.find((b) => b.beat === 123)!;
      const b124 = res.beats.find((b) => b.beat === 124)!;
      expect(snap(b123, 2).combo_score_up).toBe(7);
      expect(snap(b124, 2).combo_score_up).toBe(10);
    });

    it("b130-b133: 旧バフ消滅（b130終了時）と新バフ（6段）への切り替わりが実機通り推移すること", () => {
      const res = runS1();
      const b130 = res.beats.find((b) => b.beat === 130)!;
      const b131 = res.beats.find((b) => b.beat === 131)!;
      const b133 = res.beats.find((b) => b.beat === 133)!;
      expect(snap(b130, 2).combo_score_up).toBe(10);
      // 【実機仕様 2026-09-21 Phase 14】旧10段バフはb130終了時減算で消滅し、b131は新6段のみ
      expect(snap(b131, 2).combo_score_up).toBe(6);
      expect(snap(b133, 2).combo_score_up).toBe(6);
    });

    it("b60-b68: b60 すずP3（センター7延長）により莉央A1バフが延長され、b61-b67で維持、b68で消滅すること", () => {
      const res = runS1();
      const b61 = res.beats.find((b) => b.beat === 61)!;
      const b65 = res.beats.find((b) => b.beat === 65)!;
      const b67 = res.beats.find((b) => b.beat === 67)!;
      const b68 = res.beats.find((b) => b.beat === 68)!;
      // b61-b65: 莉央A1バフ(cr4, vb4) + すずA1(cr6) + フォト(vb3) = cr10, vb7
      expect(snap(b61, 2).critical_rate_up).toBe(10);
      expect(snap(b61, 2).vocal_boost).toBe(7);
      expect(snap(b65, 2).critical_rate_up).toBe(10);
      expect(snap(b65, 2).vocal_boost).toBe(7);
      // b67: こころA1(+3増強)後 = cr13, vb10
      expect(snap(b67, 2).critical_rate_up).toBe(13);
      expect(snap(b67, 2).vocal_boost).toBe(10);
      // b68: 莉央A1延長バフが期限切れ消滅 = cr9, vb6
      expect(snap(b68, 2).critical_rate_up).toBe(9);
      expect(snap(b68, 2).vocal_boost).toBe(6);
    });
  });

  describe("T5 (qt-daily-003-19 / chart-hsm-004-001)", () => {
    function runT5() {
      const ver = readJson(path.join(repoRoot, "スコア分析サンプル/verification_data_v2.json")) as DeckJsonV2;
      const t5 = readJson(path.join(repoRoot, "tests/golden/fixtures/t5_measured.json"));
      const replay = readJson(path.join(repoRoot, "tests/golden/fixtures/t5_replay_rands.json"));
      const CALIBRATED_MENTAL: Record<string, number> = { 1: 8996, 2: 5880, 3: 8074, 4: 5890, 5: 5880 };

      class ArrayRng {
        private i = 0;
        constructor(private readonly rolls: number[]) {}
        nextScoreRoll(): number { const r = this.rolls[this.i]; if (r === undefined) throw new Error("exhausted"); this.i++; return r; }
        nextCritical(): boolean { return false; }
        nextFloat(): number { return 0; }
        get consumed(): number { return this.i; }
      }

      const base = buildSimulateInput({
        deck: ver,
        stageFile: "qt-daily-003-19",
        chartFile: "chart-hsm-004-001",
        data,
        missedNotes: [1, 2, 3, 4, 5].map((lane) => ({ beat: 1, lane })),
        mentalOverride: CALIBRATED_MENTAL,
      }).base;
      base.fanBaseCount = 16000;

      return simulateTimeline({
        ...base,
        rng: new ArrayRng(replay.rands) as any,
        criticalProvider: (beat, lane) =>
          t5.critFlags.find((f: any) => f.beat === beat)?.yellow_lanes?.includes(String(lane)) ?? false,
      });
    }

    it("T5 ゴールデンの総スコアと主要ビートのバフ段数が整合していること", () => {
      const res = runT5();
      // 【2026-09-27 Phase 14-F 採用で更新】前ビート満了バフの延長復活を実装した新確定値
      // （旧 17,516,522,572）。根拠は research/26_data_integrity/phase14f_revival_audit.md
      expect(res.totalScore).toBe(17521599508);

      const b3 = res.beats.find((b) => b.beat === 3)!;
      expect(snap(b3, 2).vocal_up_extreme).toBe(5);

      const b103 = res.beats.find((b) => b.beat === 103)!;
      expect(snap(b103, 2).vocal_up).toBeGreaterThan(0);
      expect(snap(b103, 2).vocal_boost).toBeGreaterThan(0);
    });

    it("T5 改ざん復元と実機Decay適正化の検証（b44, b97, b107-114）", () => {
      const res = runT5();

      // 1. b44: 実機で旧バフが消滅し 11段（旧シミュレータの19段ズレが解消）
      const b44 = res.beats.find((b) => b.beat === 44)!;
      expect(snap(b44, 2).combo_score_up).toBe(11);

      // 2. b97: 実機で旧バフが消滅し 19段（旧シミュレータの27段ズレが解消）
      const b97 = res.beats.find((b) => b.beat === 97)!;
      expect(snap(b97, 2).combo_score_up).toBe(19);

      // 3. b107: 琴乃A（b106）を ccu に復元したことで、実機通り 26段 を維持（旧改ざん時の30段急増が解消）
      const b107 = res.beats.find((b) => b.beat === 107)!;
      expect(snap(b107, 2).combo_score_up).toBe(26);
      expect(snap(b107, 2).critical_coeff_up).toBe(30);
    });

    it("T5 v3 measured_data との全レーン・全ビート突合で Decay ラグが 0 件であること", () => {
      const res = runT5();
      const v3Path = path.join(repoRoot, "スコア分析サンプル/measured_data_v3.json");
      if (!existsSync(v3Path)) return;
      const v3 = JSON.parse(readFileSync(v3Path, "utf-8"));

      let decayTimingLagCount = 0;
      for (const row of v3.timeline) {
        if (row.beat === 0) continue;
        const simBeat = res.beats.find((b) => b.beat === row.beat);
        if (!simBeat) continue;

        for (const [laneStr, laneData] of Object.entries(row.lanes as Record<string, any>)) {
          const laneIdx = Number(laneStr) - 1;
          const simSnap = simBeat.buffSnapshots[laneIdx];
          if (!simSnap) continue;

          for (const eff of laneData.effects) {
            const simVal = (simSnap as any)[eff.id] ?? 0;
            // 実機で 0 に消滅しているのにシミュレータで残存している Decay 遅延
            if (eff.stage === 0 && simVal > 0) {
              decayTimingLagCount++;
            }
          }
        }
      }
      expect(decayTimingLagCount).toBe(0);
    });
  });

  describe("S3 (qt-ex-tower-005-045 / chart-thrx-004-001)", () => {
    function runS3() {
      const STAGE = "qt-ex-tower-005-045";
      const CHART = "chart-thrx-004-001";
      const cfgJson = readJson(path.join(repoRoot, "../aipura_nox/サンプル3/deck.json"));
      cfgJson.deck.characters[3].ct_cuts = [{ skill: 2, value: 5 }];
      for (const p of cfgJson.myPhotos as Array<{ id: string; skill: Record<string, unknown> | null }>) {
        if (p.id === "uph-lane5-3" && p.skill !== null) {
          p.skill.staminaScaling = "more_stamina";
        }
      }
      const d = cfgJson.deck;
      const myPhotos: MyPhotoDef[] = cfgJson.myPhotos ?? [];
      const photoEquip: string[][] = cfgJson.photoEquip ?? [];
      photoEquip.forEach((ids, i) => {
        const ch = d.characters[i];
        if (ch === undefined || !Array.isArray(ch.photos)) return;
        const equipped = ids
          .map((pid) => myPhotos.find((x) => x?.id === pid))
          .filter((p): p is MyPhotoDef => p !== undefined);
        ch.photos = mergePhotoEquipStatuses(ch.photos, equipped);
      });
      const userPhotoSkills =
        myPhotos.length > 0
          ? photoEquip.flatMap((ids, i) =>
              ids.flatMap((pid, j) => {
                const p = myPhotos.find((x) => x?.id === pid);
                if (p === undefined) return [];
                const def = myPhotoToSkillDef(p, (i + 1) as any, j + 1);
                return def !== null ? [def] : [];
              }),
            )
          : undefined;

      const built = buildSimulateInput({
        deck: d,
        stageFile: STAGE,
        chartFile: CHART,
        data,
        audience: 8000,
        mentalOverride: cfgJson.mentalOverride,
        disabledSkillIds: cfgJson.disabledSkillIds,
        userPhotoSkills,
      } as any);

      return simulateTimeline({
        ...built.base,
        rng: new NeutralRng(),
        criticalProvider: () => false,
      });
    }

    it("S3 主要ビートのバフ段数（超化・増強・上限開放）が期待値と完全一致すること", () => {
      const res = runS3();
      const b1 = res.beats.find((b) => b.beat === 1)!;
      const b15 = res.beats.find((b) => b.beat === 15)!;
      const b42 = res.beats.find((b) => b.beat === 42)!;

      // b1 開幕: L3 focus 10, score_up 7 / L4 visual_up 4, visual_boost 6
      expect(snap(b1, 2).focus).toBe(10);
      expect(snap(b1, 2).score_up).toBe(7);
      expect(snap(b1, 3).visual_up).toBe(4);
      expect(snap(b1, 3).visual_boost).toBe(6);

      // b15: L4 A1超化発動後（visual_up_extreme=5, critical_coeff_up=10）
      expect(snap(b15, 3).visual_up_extreme).toBe(5);
      expect(snap(b15, 3).critical_coeff_up).toBe(10);
      expect(snap(b15, 3).visual_up).toBe(11);

      // b42: L4 visual_up_extreme 5, critical_coeff_up 10
      expect(snap(b42, 3).visual_up_extreme).toBe(5);
      expect(snap(b42, 3).critical_coeff_up).toBe(10);
    });

    it("b125: すずA2の条件行（tg-someone_status-audience_amount_increase）不発により L3 vocal_up が 0 であること", () => {
      const res = runS3();
      const b125 = res.beats.find((b) => b.beat === 125)!;
      expect(snap(b125, 2).vocal_up).toBe(0);
    });
  });
});
