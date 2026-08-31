/**
 * フォト付与（grant_* キー）とユーザーフォトスキルの buildSimulateInput 統合テスト（Phase 8-B）。
 *
 * 仕様出典:
 * - Peing id=1187940162「センタークリティカルスコアや隣接ステータスは通常のクリティカル
 *   スコア%やステータスと同種類として取り扱われます」→ 対象レーンの装備と同一プール
 * - 隣接 = 左右 1 レーンずつ（engine.ts の neighbors 解決と同一規則）
 * - センター = L3・スコアラー = role Scorer のレーン
 */
import { describe, expect, it } from "vitest";
import { buildSimulateInput, type DeckJsonV2, type SimSourceData } from "../../../src/sim/build.js";
import type { CardDef, CardParameterRow } from "../../../src/types.js";
import type { SkillDef } from "../../../src/timeline/types.js";

function makeData(): SimSourceData {
  const card: CardDef = {
    id: "card-c1",
    name: "C1",
    characterId: "char-x",
    initialRarity: 5,
    cardParameterId: "param-c1",
    ratiosPermil: { vocal: 400, dance: 300, visual: 300, stamina: 1000 },
    skillIds: [],
  };
  const cardParameters: CardParameterRow[] = [
    { id: "param-c1", level: 100, value: 1000, staminaValue: 1000 },
  ];
  return {
    cards: [card],
    cardParameters,
    skillsGolden: [],
    stages: {
      st: {
        beatWeightsPermil: { vocal: 600, dance: 250, visual: 150 },
        skillWeightsPermil: { active: 1000, special: 1000 },
        laneAttributes: [2, 2, 1, 2, 2],
      },
    },
    charts: {
      ch: { notes: [{ beat: 1, type: 1 as const, position: 0 as const }] },
    },
  };
}

type PhotoEntry = {
  name: string;
  structured: Array<{ stat: string; type: "pct" | "fixed"; value: number }>;
};

function makeDeck(photosByLane: ReadonlyArray<PhotoEntry[]>): DeckJsonV2 {
  return {
    staff_bonus: { vocal: 0, dance: 0, visual: 0, stamina: 0, mental: 0, critical: 0 },
    yale_bonus: {
      vocal_pct: 0,
      dance_pct: 0,
      visual_pct: 0,
      stamina: 0,
      mental: 0,
      critical: 0,
      beat_score_pct: 0,
      a_skill_score_pct: 0,
      sp_skill_score_pct: 0,
      critical_score_pct: 0,
    },
    characters: [1, 2, 3, 4, 5].map((lane, i) => ({
      lane,
      card_id: "card-c1",
      level: 100,
      rarity: 5,
      role: lane === 3 || lane === 4 ? "Scorer" : "Buffer",
      kouryu_level: 1,
      stats: {
        base: { vocal: 0, dance: 0, visual: 0, stamina: 0 },
        total_after_non_skill_modifiers: { vocal: 0, dance: 0, visual: 0, stamina: 0 },
      },
      photos: photosByLane[i] ?? [],
      accessories: [],
    })),
  };
}

const PHOTO = (structured: Array<{ stat: string; type: "pct" | "fixed"; value: number }>): PhotoEntry[] => [
  { name: "p", structured },
];

const BASE_OPTIONS = { stageFile: "st", chartFile: "ch" };

describe("フォト付与（grant_*）の解決", () => {
  it("隣接付与は左右 1 レーンずつのデッキ値プールに入る（L1/L5 は 1 レーン）", () => {
    const data = makeData();
    const base = buildSimulateInput({ ...BASE_OPTIONS, data, deck: makeDeck([]) });
    const granted = buildSimulateInput({
      ...BASE_OPTIONS,
      data,
      // L2 が隣接 Vo +10% を付与 → L1 と L3 が受領
      deck: makeDeck([[], PHOTO([{ stat: "grant_neighbors_vocal", type: "pct", value: 10 }]), [], [], []]),
    });
    const deckVocalOf = (r: typeof base, lane: number): number =>
      r.lanes.find((l) => l.lane === lane)!.deck.vocal;
    // master Vo = floor(floor(1000×400/1000)×☆5レアボナ1200/1000) = 480
    // L2 の Vo デッキ値 = 480（付与は自分にはかからない）
    expect(deckVocalOf(base, 2)).toBe(480);
    expect(deckVocalOf(granted, 2)).toBe(480);
    // L1/L3 は +10%（+100‰）→ floor(480×1100/1000) = 528
    expect(deckVocalOf(granted, 1)).toBe(528);
    expect(deckVocalOf(granted, 3)).toBe(528);
    // L4/L5 は隣接でないので不変
    expect(deckVocalOf(granted, 4)).toBe(480);
    expect(deckVocalOf(granted, 5)).toBe(480);
  });

  it("センター付与は L3・スコアラー付与は role Scorer のレーンに入る", () => {
    const data = makeData();
    const granted = buildSimulateInput({
      ...BASE_OPTIONS,
      data,
      // L1 が センター Da +5% と スコアラー Vi +20% を付与
      deck: makeDeck([
        PHOTO([
          { stat: "grant_center_dance", type: "pct", value: 5 },
          { stat: "grant_scorer_visual", type: "pct", value: 20 },
        ]),
        [], [], [], [],
      ]),
    });
    const deckOf = (lane: number) => granted.lanes.find((l) => l.lane === lane)!.deck;
    // master Da = 360。センター +5%（+50‰）→ L3: floor(360×1050/1000) = 378
    expect(deckOf(3).dance).toBe(378);
    // master Vi = 360。スコアラー +20%（+200‰）→ Scorer（L3/L4）: floor(360×1200/1000)=432
    expect(deckOf(3).visual).toBe(432);
    expect(deckOf(4).visual).toBe(432);
    expect(deckOf(5).visual).toBe(360);
  });

  it("スコア系付与（クリスコ等）は critExtrasPermil / scoreBonusPct に入る", () => {
    const data = makeData();
    const granted = buildSimulateInput({
      ...BASE_OPTIONS,
      data,
      deck: makeDeck([[], PHOTO([{ stat: "grant_neighbors_critical_score", type: "pct", value: 27 }]), [], [], []]),
    });
    // L2 が隣接クリスコ +27% → L1 と L3 が +270‰
    expect(granted.lanes.find((l) => l.lane === 1)!.critExtrasPermil).toBe(270);
    expect(granted.lanes.find((l) => l.lane === 3)!.critExtrasPermil).toBe(270);
    expect(granted.lanes.find((l) => l.lane === 2)!.critExtrasPermil).toBe(0);
    // A スコア付与は scoreBonusPct.active へ
    const aGrant = buildSimulateInput({
      ...BASE_OPTIONS,
      data,
      deck: makeDeck([[], PHOTO([{ stat: "grant_neighbors_a_score", type: "pct", value: 13.5 }]), [], [], []]),
    });
    expect(aGrant.lanes.find((l) => l.lane === 1)!.scoreBonusPct.active).toBe(135);
  });

  it("付与キーが混在する複数フォト・複数レーンでも合算される", () => {
    const data = makeData();
    const granted = buildSimulateInput({
      ...BASE_OPTIONS,
      data,
      deck: makeDeck([
        PHOTO([{ stat: "grant_neighbors_vocal", type: "pct", value: 5 }]),
        PHOTO([{ stat: "grant_neighbors_vocal", type: "pct", value: 5 }]),
        [],
        [],
        [],
      ]),
    });
    // L1 と L2 の隣接 Vo 付与（各+5%）: L2 が受けるのは L1 分のみ（自分の付与は自分にかからない）
    // → floor(480×1050/1000) = 504
    expect(granted.lanes.find((l) => l.lane === 2)!.deck.vocal).toBe(504);
  });
});

describe("ユーザーフォトスキル（userPhotoSkills）", () => {
  it("lane 設定済みの photo スキルが LaneInput.photos にマージされる", () => {
    const data = makeData();
    const skill: SkillDef = {
      id: "uph-x",
      name: "ユーザーフォトX",
      kind: "photo",
      level: 1,
      lane: 2,
      photoIndex: 1,
      ct: 50,
      staminaCost: 500,
      limitPerLive: 1,
      effects: [
        { type: "score_up", stages: 3, durationBeats: 30, target: "score_type_1", condition: "none" },
      ],
    };
    const built = buildSimulateInput({
      ...BASE_OPTIONS,
      data,
      deck: makeDeck([]),
      userPhotoSkills: [skill],
    });
    const lane2 = built.lanes.find((l) => l.lane === 2)!;
    expect(lane2.photos.map((p) => p.id)).toContain("uph-x");
    // 他レーンには載らない
    expect(built.lanes.find((l) => l.lane === 1)!.photos.map((p) => p.id)).not.toContain("uph-x");
    // disabledSkillIds で無効化できる
    const disabled = buildSimulateInput({
      ...BASE_OPTIONS,
      data,
      deck: makeDeck([]),
      userPhotoSkills: [skill],
      disabledSkillIds: ["uph-x"],
    });
    expect(disabled.lanes.find((l) => l.lane === 2)!.photos.map((p) => p.id)).not.toContain("uph-x");
  });
});
