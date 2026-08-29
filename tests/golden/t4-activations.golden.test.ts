/**
 * T4 ゴールデンテスト: 開幕発動（beat 1〜10）の発動ログ・スタミナ突合。
 *
 * 根拠:
 * - research/06_test_plan.md T4 行: 「開幕 9 連発動の処理順・効果付与・初手スコア。
 *   発動順・対象・効果 multiset（L1/2/4/5 完全一致、L3 部分一致）・stamina 完全一致。
 *   beat 1 のスコアは 0 扱い（既知の帰属不確実性）を許容」
 * - research/13_engine_spec.md §3-§7（エンジン仕様）
 * - 実測: tests/golden/fixtures/t4_measured.json（measured_data_v2.json から
 *   node で抽出した beat≤12 の発動15件 + timeline スタミナ。直接 read 禁止のため）
 *
 * 検証内容:
 * 1. beat 1〜3 の成功発動15件の (beat, lane, skillId, phase) 完全一致（順序含む）
 * 2. beat 4〜10 は発動ゼロ（全スキル/フォトが CT 中または条件不成立）
 * 3. スタミナ: L1/L2/L4/L5 は全点完全一致。L3 のみ ±300 許容
 *    （research/08 §1.4-2: 発動 cutscene とレーン画面の取得タイミング差により
 *     スタミナ差分検算は ±数百の粒度。実測 b2 の L3 は Δ432 vs 消費404 の +28 差）
 * 4. スコア数値は検証しない（T5 の対象）
 *
 * ゴールデン入力の組み立て:
 * - デッキステータス: verification_data_v2.json × マスタ（T3 と同一の導出。20/20 検証済み）
 * - レーン色: verification_data_v2.json characters[].lane_type の第2成分
 *   （L1=ボーカル, L2=ボーカル, L3=ボーカル, L4=ダンス, L5=ボーカル）。
 *   なお characters[].attribute（Dance/Visual 等）はアイドル固有のタイプでありレーン色ではない
 * - スキル/フォト: data/skills_golden.json（P3a・検証済み）
 * - メンタル: 実測データにメンタル値が存在しないため、P前半の実測発動順
 *   （L1→L4→L2→L5→L3・order 1-9）と整合する相対値を較正値として設定する。
 *   メンタル降順規則そのものの検証は不可能（research/13 §9-9）
 * - ライブボーナス等のライブ開始時プリバフは未シード（timeline の効果表示は
 *   スコア詳細画面のキャプチャ混入で変動が大きく、T5 のスコア検証課題とする）。
 *   T4 の発動可否にプリバフは影響しない（成功率100%・スタミナ十分）ことを実測が確認
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeDeckStatus } from "../../src/formula/baseStatus.js";
import { pctToPermil } from "../../src/rounding.js";
import { simulateTimeline } from "../../src/timeline/engine.js";
import type {
  ChartNote,
  LaneInput,
  LaneNumber,
  SimulateInput,
  SkillDef,
  StageInput,
} from "../../src/timeline/types.js";
import type { ScoreRng } from "../../src/rng/types.js";
import type { CardDef, CardParameterRow, StatBonus, StatValues, YellBonus } from "../../src/types.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const dataDir = path.join(repoRoot, "data");
const sampleDir = path.join(repoRoot, "スコア分析サンプル");

// ---- データ読み込み ----

interface CardsFile {
  cards: CardDef[];
}
interface CardParametersFile {
  rows: CardParameterRow[];
}
interface StructuredStat {
  stat: string;
  type: "pct" | "fixed";
  value: number;
}
interface PhotoOrAccessory {
  name: string;
  structured: StructuredStat[];
}
interface CharacterV2 {
  lane: number;
  card_id: string;
  level: number;
  rarity: number;
  /** 編成上の役割（Scorer/Buffer/Supporter） */
  role: string;
  kouryu_level: number;
  stats: {
    base: { vocal: number; dance: number; visual: number; stamina: number };
    total_after_non_skill_modifiers: { vocal: number; dance: number; visual: number; stamina: number };
  };
  photos: PhotoOrAccessory[];
  accessories: PhotoOrAccessory[];
}
interface VerificationV2 {
  staff_bonus: Record<"vocal" | "dance" | "visual" | "stamina" | "mental" | "critical", number>;
  yale_bonus: {
    vocal_pct: number;
    dance_pct: number;
    visual_pct: number;
    stamina: number;
    mental: number;
    critical: number;
    beat_score_pct: number;
    a_skill_score_pct: number;
    sp_skill_score_pct: number;
    critical_score_pct: number;
  };
  characters: CharacterV2[];
}
interface T4Measured {
  activations: Array<{
    order: number;
    beat: number;
    lane: number;
    skill_type: string;
    skill_name: string;
    stamina: string;
  }>;
  timeline: Array<{
    beat: number;
    combo: number;
    cumulative_score: number;
    beat_gained_score: number;
    stamina: Record<string, number>;
  }>;
}

function readJson(p: string): unknown {
  return JSON.parse(readFileSync(p, "utf-8"));
}

const cards = (readJson(path.join(dataDir, "cards.json")) as CardsFile).cards;
const params = (readJson(path.join(dataDir, "card_parameters.json")) as CardParametersFile).rows;
const ver = readJson(path.join(sampleDir, "verification_data_v2.json")) as VerificationV2;
const skillsGolden = readJson(path.join(dataDir, "skills_golden.json")) as { skills: SkillDef[] };
const chart = readJson(path.join(dataDir, "charts", "chart-hsm-004-001.json")) as {
  notes: Array<{ beat: number; type: number; position: number }>;
};
const stageData = readJson(path.join(dataDir, "stages", "qt-daily-003-19.json")) as {
  beatWeightsPermil: { vocal: number; dance: number; visual: number };
  skillWeightsPermil: { active: number; special: number; stamina: number };
};
const t4 = readJson(path.join(repoRoot, "tests/golden/fixtures/t4_measured.json")) as T4Measured;

// ---- レーン入力の組み立て（T3 と同一のデッキ導出）----

function toStatBonus(items: PhotoOrAccessory[]): StatBonus[] {
  return items.map((item) => {
    const pct: Record<string, number> = {};
    const fixed: Record<string, number> = {};
    for (const s of item.structured) {
      if (s.type === "pct") pct[s.stat] = (pct[s.stat] ?? 0) + pctToPermil(s.value);
      else fixed[s.stat] = (fixed[s.stat] ?? 0) + s.value;
    }
    return { pct, fixed };
  });
}

function sumScorePct(items: PhotoOrAccessory[], key: string): number {
  let sum = 0;
  for (const item of items) {
    for (const s of item.structured) {
      if (s.stat === key && s.type === "pct") {
        sum += pctToPermil(s.value);
      }
    }
  }
  return sum;
}

function yell(): YellBonus {
  const y = ver.yale_bonus;
  return {
    statPct: {
      vocal: pctToPermil(y.vocal_pct),
      dance: pctToPermil(y.dance_pct),
      visual: pctToPermil(y.visual_pct),
    },
    statFix: { stamina: y.stamina, mental: y.mental, critical: y.critical },
    scorePct: {
      beat: pctToPermil(y.beat_score_pct),
      active: pctToPermil(y.a_skill_score_pct),
      special: pctToPermil(y.sp_skill_score_pct),
      criticalScore: pctToPermil(y.critical_score_pct),
    },
  };
}

const STAFF = ver.staff_bonus;
const YELL = yell();

/** レーン色（verification_data_v2 の lane_type 第2成分から。L4 のみダンス） */
const LANE_ATTRIBUTE: Record<LaneNumber, "vocal" | "dance" | "visual"> = {
  1: "vocal",
  2: "vocal",
  3: "vocal",
  4: "dance",
  5: "vocal",
};

/**
 * メンタルの較正値（実測データにメンタル値なし → P前半の実測発動順
 * L1→L4→L2→L5→L3 と整合する相対値。research/13 §9-9）
 */
const CALIBRATED_MENTAL: Record<LaneNumber, number> = {
  1: 105,
  2: 103,
  3: 101,
  4: 104,
  5: 102,
};

function buildLanes(): LaneInput[] {
  const lanes: LaneInput[] = [];
  for (const ch of ver.characters) {
    const lane = ch.lane as LaneNumber;
    const card = cards.find((c) => c.id === ch.card_id);
    if (!card) throw new Error(`card not found: ${ch.card_id}`);
    const row = params.find((r) => r.id === card.cardParameterId && r.level === ch.level);
    if (!row) throw new Error(`card parameter not found: ${card.cardParameterId} @Lv${ch.level}`);
    const result = computeDeckStatus(
      {
        card,
        level: ch.level,
        rarity: ch.rarity,
        kouryuLevel: ch.kouryu_level,
        staff: STAFF,
        yell: YELL,
        equipment: {
          photos: toStatBonus(ch.photos),
          accessories: toStatBonus(ch.accessories),
        },
      },
      row,
    );
    const deck: StatValues<number> = {
      ...result.deck,
      mental: CALIBRATED_MENTAL[lane],
      critical: 0,
    };
    // スコア%系（エール+フォト+アクセ）。T4 の発動判定には無関係だが T5 と共通の入力形式にする
    const equipment = [...ch.photos, ...ch.accessories];
    const skills = skillsGolden.skills.filter(
      (s) => s.lane === lane && (s.kind === "A" || s.kind === "SP" || s.kind === "P"),
    );
    // 判読不能フォト（effects 空・P3a で null 記載）は発火予測不能のため除外する。
    // 実測でもこれらの発動は記録されていない（beat 1〜10 に L1-4/L3-1 の発動なし）
    const photos = skillsGolden.skills.filter(
      (s) => s.lane === lane && s.kind === "photo" && (s.effects?.length ?? 0) > 0,
    );
    lanes.push({
      lane,
      attribute: LANE_ATTRIBUTE[lane],
      role: ch.role as LaneInput["role"],
      deck,
      skills,
      photos,
      scoreBonusPct: {
        beat: YELL.scorePct.beat + sumScorePct(equipment, "beat_score"),
        active: YELL.scorePct.active + sumScorePct(equipment, "a_score"),
        special: YELL.scorePct.special + sumScorePct(equipment, "sp_score"),
        passive: sumScorePct(equipment, "p_score"),
      },
      critExtrasPermil: YELL.scorePct.criticalScore + sumScorePct(equipment, "critical_score"),
    });
  }
  lanes.sort((a, b) => a.lane - b.lane);
  return lanes;
}

/** 常に中立（乱数1000=±0%・クリティカルなし）の固定 RNG。T4 は発動・スタミナ照合が目的 */
class NeutralRng implements ScoreRng {
  nextScoreRoll(): number {
    return 1000;
  }
  nextCritical(): boolean {
    return false;
  }
}

function buildInput(lanes: LaneInput[]): SimulateInput {
  const notes: ChartNote[] = chart.notes
    .filter((n) => n.beat <= 10)
    .map((n) => ({
      beat: n.beat,
      noteType: n.type as 1 | 2 | 3,
      position: n.position as ChartNote["position"],
    }));
  const stage: StageInput = {
    id: "qt-daily-003-19",
    laneAttributes: [2, 2, 1, 2, 2],
    beatWeightsPermil: stageData.beatWeightsPermil,
    skillWeightsPermil: {
      active: stageData.skillWeightsPermil.active,
      special: stageData.skillWeightsPermil.special,
    },
    stageFactorPermil: 1000, // スコア倍率特徴なし（research/11）
  };
  return {
    lanes,
    notes,
    stage,
    fanFactorPermil: 1620, // 80,000人 → 16,000人/人 → +62.0%（research/02 §3.1 実測一致）
    successBasePermil: 1000, // スキル成功率 100%×5（verification stage 実測）
    criticalProvider: () => false,
    rng: new NeutralRng(),
    roundingPolicy: "sequential",
  };
}

// ---- ゴールデン期待値（measured_data_v2 発動ログ order 1〜15 の写像）----
// skill_name → skillId は data/skills_golden.json の name 照合で確定させている
// （波ダンジョンの文字种違いを避けるため ID を直書きする）

interface ExpectedActivation {
  beat: number;
  lane: LaneNumber;
  skillId: string;
  phase: "first" | "main" | "last";
}

const EXPECTED_ACTIVATIONS: ExpectedActivation[] = [
  // beat 1: 前半8件（L1→L4→L2→L5 の順で P+フォト）+ 後半1件（L3 の条件付きP）
  { beat: 1, lane: 1, skillId: "sk-yu-05-birt-02-2", phase: "first" }, // order1 かんしょ〜かい
  { beat: 1, lane: 1, skillId: "photo-L1-1", phase: "first" }, // order2 スコアUPスキル
  { beat: 1, lane: 4, skillId: "sk-ktn-05-wedd-00-3", phase: "first" }, // order3 結婚への願望
  { beat: 1, lane: 4, skillId: "photo-L4-2", phase: "first" }, // order4 AスキルスコアUPスキル
  { beat: 1, lane: 2, skillId: "sk-ski-05-onep-00-3", phase: "first" }, // order5 気持ちを和歌に乗せて
  { beat: 1, lane: 2, skillId: "photo-L2-1", phase: "first" }, // order6 Voブーストスキル
  { beat: 1, lane: 5, skillId: "sk-ski-05-waso-00-3", phase: "first" }, // order7 さらけ出す
  { beat: 1, lane: 5, skillId: "photo-L5-1", phase: "first" }, // order8 スコア獲得スキル
  { beat: 1, lane: 3, skillId: "sk-chs-05-fest-03-3", phase: "last" }, // order9 逆襲のドッキリ企画
  // beat 2: 前半フォト2件 + A発動1件 + 後半フォト1件
  { beat: 2, lane: 1, skillId: "photo-L1-2", phase: "first" }, // order10 スコアUPスキル(vocal_type_2)
  { beat: 2, lane: 5, skillId: "photo-L5-2", phase: "first" }, // order11 スコア獲得スキル
  { beat: 2, lane: 3, skillId: "sk-chs-05-fest-03-2", phase: "main" }, // order12 A星見プロ(pos1→L3)
  { beat: 2, lane: 2, skillId: "photo-L2-2", phase: "last" }, // order13 強化効果延長(someone_score_up)
  // beat 3: 後半フォト2件
  { beat: 3, lane: 2, skillId: "photo-L2-4", phase: "last" }, // order14 強化効果延長(someone_focus)
  { beat: 3, lane: 5, skillId: "photo-L5-3", phase: "last" }, // order15 強化効果増強(self_vocal_lane)
];

const result = simulateTimeline(buildInput(buildLanes()));

describe("T4 golden: 開幕発動ログ（beat 1〜10）", () => {
  it("beat 1〜3 の成功発動15件が (beat, lane, skillId, phase) の順序込みで完全一致する", () => {
    const actual = result.activations
      .filter((a) => a.success)
      .map((a) => ({ beat: a.beat, lane: a.lane, skillId: a.skillId, phase: a.phase }));
    expect(actual).toEqual(EXPECTED_ACTIVATIONS);
  });

  it("beat 4〜10 は発動ゼロ（全候補が CT 中または条件不成立）", () => {
    const inRange = result.activations.filter((a) => a.beat >= 4 && a.beat <= 10);
    expect(inRange).toEqual([]);
  });

  it("実測ログに存在しない FAIL も含めた発動試行のレーン集合が妥当である", () => {
    // A/SP ノートは該当レーンのみ挑戦（b2 の A は L3 のみ）。
    // b2 の A 発動トレースが 1 件（L3）だけで、他レーンの FAIL が紛れ込んでいないこと
    const b2Main = result.activations.filter((a) => a.beat === 2 && a.phase === "main");
    expect(b2Main).toHaveLength(1);
    expect(b2Main[0]?.lane).toBe(3);
    expect(b2Main[0]?.skillId).toBe("sk-chs-05-fest-03-2");
    expect(b2Main[0]?.success).toBe(true);
  });
});

describe("T4 golden: スタミナ突合（beat 1〜10）", () => {
  // beat 1〜3 のビート終了時スタミナは発動ログの各ビート最終 order の表示値
  // （timeline 側の b1 キャプチャはビート途中のためアンカーには使えない。
  //   例: timeline b1 L1=19787 は order1 後・order2 前の値。b2 以降は整合確認済み）
  const ANCHORS: Record<number, Record<LaneNumber, number>> = {
    1: { 1: 19023, 2: 13552, 3: 18730, 4: 14082, 5: 15872 },
    2: { 1: 17460, 2: 12702, 3: 18298, 4: 14082, 5: 15692 },
    3: { 1: 17460, 2: 11852, 3: 18298, 4: 14082, 5: 13676 },
  };
  function measuredStamina(beat: number, lane: LaneNumber): number {
    if (beat <= 3) {
      return ANCHORS[beat]?.[lane] ?? (() => { throw new Error(`anchor missing b${beat} L${lane}`); })();
    }
    const row = t4.timeline.find((t) => t.beat === beat);
    if (!row) throw new Error(`timeline row not found for beat ${beat}`);
    const v = row.stamina[String(lane)];
    if (v === undefined) throw new Error(`stamina not found for L${lane} @b${beat}`);
    return v;
  }
  function simStamina(beat: number, lane: LaneNumber): number {
    const row = result.beats.find((b) => b.beat === beat);
    if (!row) throw new Error(`sim beat trace not found for beat ${beat}`);
    const v = row.staminaAfter[lane - 1];
    if (v === undefined) throw new Error(`sim stamina not found for L${lane} @b${beat}`);
    return v;
  }

  it("L1/L2/L4/L5 のスタミナは beat 1〜10 の全点で 1 の位まで完全一致する", () => {
    for (const lane of [1, 2, 4, 5] as LaneNumber[]) {
      for (let beat = 1; beat <= 10; beat++) {
        expect(simStamina(beat, lane), `L${lane} @b${beat}`).toBe(measuredStamina(beat, lane));
      }
    }
  });

  it("L3 のスタミナは ±300 の許容差で一致する（cutscene とレーン画面の取得タイミング差）", () => {
    // research/08 §1.4-2: スタミナ差分検算は ±数百スタミナの粒度。
    // 実測 b2 は Δ432（消費404 + 表示タイミング差 +28）。シミュレーションは
    // プリバフ（ライブボーナス由来の消費系バフ）をシードしていないため純コスト計算になる
    for (let beat = 1; beat <= 10; beat++) {
      const diff = Math.abs(simStamina(beat, 3) - measuredStamina(beat, 3));
      expect(diff, `L3 @b${beat} (sim=${simStamina(beat, 3)}, measured=${measuredStamina(beat, 3)})`).toBeLessThanOrEqual(300);
    }
  });

  it("beat 1 直後の全レーンのスタミナが発動ログ表示値と一致する（アンカー照合）", () => {
    // order1-9 の発動ログ stamina 表示値（cost 差分が純コストと一致するビート）
    expect(simStamina(1, 1)).toBe(19023); // 20066 −279(かんしょ) −764(photo-L1-1)
    expect(simStamina(1, 2)).toBe(13552); // 15609 −262(和歌) −1795(photo-L2-1)
    expect(simStamina(1, 4)).toBe(14082); // 16033 −273(結婚) −1678(photo-L4-2)
    expect(simStamina(1, 5)).toBe(15872); // 16332 −280(さらけ) −180(photo-L5-1)
    expect(simStamina(1, 3)).toBe(18730); // 18730 −866 +2560 → max でクランプ
  });
});
