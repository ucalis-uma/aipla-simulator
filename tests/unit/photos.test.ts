/**
 * src/photos.ts（マイフォト帳コアモデル・Phase 8-B）の単体テスト。
 * - MyPhotoDef → structured / SkillDef 変換（CLI 互換キー・grant_ 拡張含む）
 * - バリデーション（ステータス枠上限・レタッチ1枚制限・付与は % のみ）
 * - 同梱テンプレートの構造
 */
import { describe, expect, it } from "vitest";
import {
  defaultPhotoTemplates,
  grantStructuredKey,
  myPhotoToEquipEntry,
  myPhotoToSkillDef,
  parseGrantKey,
  photoSummary,
  statFrameLimit,
  userPhotoSkillId,
  validateMyPhoto,
  validatePhotoEquip,
  type MyPhotoDef,
  type PhotoFrame,
} from "../../src/photos.js";
import type { LaneNumber } from "../../src/timeline/types.js";

function frame(partial: Partial<PhotoFrame> = {}): PhotoFrame {
  return { kind: "self", stat: "vocal", type: "pct", value: 10, ...partial };
}

function photo(partial: Partial<MyPhotoDef>): MyPhotoDef {
  return {
    id: "p1",
    name: "テストフォト",
    kindLabel: "イメトレ",
    tags: ["手持ち"],
    retouch: false,
    skill: null,
    frames: [],
    ...partial,
  };
}

describe("MyPhotoDef 変換", () => {
  it("自己ステ枠は既存キー（vocal 等）のまま structured になる", () => {
    const p = photo({
      frames: [frame({ kind: "self", stat: "vocal", type: "pct", value: 44 }), frame({ kind: "self", stat: "critical_score", type: "pct", value: 27 }), frame({ kind: "self", stat: "vocal", type: "fixed", value: 30000 })],
    });
    expect(myPhotoToEquipEntry(p)).toEqual({
      name: "【マイフォト】テストフォト",
      structured: [
        { stat: "vocal", type: "pct", value: 44 },
        { stat: "critical_score", type: "pct", value: 27 },
        { stat: "vocal", type: "fixed", value: 30000 },
      ],
    });
  });

  it("付与枠は grant_<target>_<stat> キー（常に pct）になる", () => {
    const p = photo({
      frames: [frame({ kind: "grant_neighbors", stat: "vocal", value: 15 }), frame({ kind: "grant_center", stat: "critical_score", value: 27 }), frame({ kind: "grant_scorer", stat: "a_score", value: 13 })],
    });
    expect(myPhotoToEquipEntry(p).structured).toEqual([
      { stat: "grant_neighbors_vocal", type: "pct", value: 15 },
      { stat: "grant_center_critical_score", type: "pct", value: 27 },
      { stat: "grant_scorer_a_score", type: "pct", value: 13 },
    ]);
  });

  it("grantStructuredKey / parseGrantKey が可逆", () => {
    expect(grantStructuredKey("grant_neighbors", "vocal")).toBe("grant_neighbors_vocal");
    expect(parseGrantKey("grant_neighbors_vocal")).toEqual({ target: "neighbors", stat: "vocal" });
    expect(parseGrantKey("grant_center_critical_score")).toEqual({ target: "center", stat: "critical_score" });
    expect(parseGrantKey("grant_unknown_x")).toBeNull();
    expect(parseGrantKey("vocal")).toBeNull();
  });

  it("スキルなしフォト → SkillDef null・スキル付きは kind:photo の SkillDef になる", () => {
    expect(myPhotoToSkillDef(photo({}), 1, 1)).toBeNull();
    const p = photo({
      id: "abc",
      name: "Voブーストフォト",
      skill: {
        type: "vocal_boost",
        stages: 4,
        durationBeats: 28,
        target: "vocal_type_1",
        condition: "none",
        ct: 60,
        staminaCost: 1795,
        limitPerLive: null,
      },
    });
    const def = myPhotoToSkillDef(p, 3 as LaneNumber, 2)!;
    expect(def.kind).toBe("photo");
    expect(def.id).toBe(userPhotoSkillId("abc"));
    expect(def.lane).toBe(3);
    expect(def.photoIndex).toBe(2);
    expect(def.ct).toBe(60);
    expect(def.staminaCost).toBe(1795);
    expect(def.effects[0]).toMatchObject({ type: "vocal_boost", stages: 4, durationBeats: 28 });
  });

  it("スコア獲得スキルは powerPermil、即時系は value に写像される", () => {
    const scoreGet = myPhotoToSkillDef(
      photo({ skill: { type: "score_get", powerPermil: 4000, target: "self", condition: "none", ct: 70, staminaCost: 180 } }),
      1,
      1,
    )!;
    expect(scoreGet.effects[0]).toMatchObject({ type: "score_get", powerPermil: 4000 });
    const ctCut = myPhotoToSkillDef(
      photo({ skill: { type: "ct_reduction", value: 15, target: "self", condition: "none", ct: null, staminaCost: null } }),
      1,
      1,
    )!;
    expect(ctCut.effects[0]).toMatchObject({ type: "ct_reduction", value: 15 });
  });

  it("photoSummary がスキルと枠の要約を返す", () => {
    const p = photo({
      frames: [frame({ kind: "grant_center", stat: "critical_score", value: 27 })],
    });
    expect(photoSummary(p)).toContain("センター・Criスコア +27%");
    expect(photoSummary(photo({}))).toBe("（効果なし）");
  });

  it("延長/増強レタッチは buffKey・scope を写像し、要約は「与・」「被・」表記になる（Phase 8-B4）", () => {
    // 与・クリティカル率延長
    const given = myPhotoToSkillDef(
      photo({
        skill: {
          type: "effect_extension",
          value: 4,
          buffKey: "critical_rate_up",
          scope: "given",
          target: "self",
          condition: "none",
          ct: null,
          staminaCost: null,
        },
      }),
      1,
      1,
    )!;
    expect(given.effects[0]).toMatchObject({ type: "effect_extension", value: 4, buffKey: "critical_rate_up", scope: "given" });
    // 被・ボーカルブースト増強
    const received = myPhotoToSkillDef(
      photo({
        skill: {
          type: "effect_amplify",
          value: 2,
          buffKey: "vocal_boost",
          scope: "received",
          target: "self",
          condition: "none",
          ct: null,
          staminaCost: null,
        },
      }),
      1,
      1,
    )!;
    expect(received.effects[0]).toMatchObject({ type: "effect_amplify", value: 2, buffKey: "vocal_boost", scope: "received" });
    // 要約表記（ゲーム内準拠の 与・/被・ プレフィックス）
    expect(photoSummary(photo({
      skill: { type: "effect_extension", value: 4, buffKey: "critical_rate_up", scope: "given", target: "self", condition: "none", ct: null, staminaCost: null },
    }))).toContain("与・クリ率延長+4");
    expect(photoSummary(photo({
      skill: { type: "effect_amplify", value: 2, buffKey: "vocal_boost", scope: "received", target: "self", condition: "none", ct: null, staminaCost: null },
    }))).toContain("被・Voブースト増強+2");
  });
});

describe("バリデーション", () => {
  it("ステータス枠上限: スキルなし 5 枠・スキルあり 4 枠", () => {
    expect(statFrameLimit(photo({}))).toBe(5);
    expect(statFrameLimit(photo({ skill: { type: "vocal_boost", stages: 1, target: "self", condition: "none", ct: null, staminaCost: null } }))).toBe(4);
  });

  it("スキル持ちで 5 枠は過剰盛りエラー", () => {
    const p = photo({
      skill: { type: "vocal_up", stages: 3, target: "self", condition: "none", ct: null, staminaCost: null },
      frames: [frame(), frame(), frame(), frame(), frame()],
    });
    const errors = validateMyPhoto(p);
    expect(errors.some((e) => e.includes("上限"))).toBe(true);
    expect(validateMyPhoto({ ...p, frames: p.frames.slice(0, 4) })).toEqual([]);
  });

  it("付与枠の fixed は不可・自己枠は fixed 可", () => {
    expect(validateMyPhoto(photo({ frames: [frame({ kind: "grant_neighbors", stat: "vocal", type: "fixed", value: 100 })] })).length).toBeGreaterThan(0);
    expect(validateMyPhoto(photo({ frames: [frame({ type: "fixed", value: 100 })] }))).toEqual([]);
  });

  it("レタッチ1枚制限・最大5枚", () => {
    const retouch = { id: "r1", name: "レタッチ1", retouch: true };
    const normal = { id: "n1", name: "通常1", retouch: false };
    expect(validatePhotoEquip([normal], retouch)).toEqual([]);
    expect(validatePhotoEquip([retouch], { id: "r2", name: "レタッチ2", retouch: true }).length).toBeGreaterThan(0);
    const four = [normal, normal, normal, normal];
    expect(validatePhotoEquip(four, normal)).toEqual([]);
    expect(validatePhotoEquip([...four, normal], normal).length).toBeGreaterThan(0);
  });
});

describe("同梱テンプレート", () => {
  it("理論値/実用/レタッチ/スコア獲得のテンプレートが定義されている", () => {
    const templates = defaultPhotoTemplates();
    expect(templates.length).toBeGreaterThanOrEqual(5);
    for (const t of templates) {
      expect(t.id.startsWith("tpl-")).toBe(true);
      expect(validateMyPhoto(t)).toEqual([]);
    }
    const names = templates.map((t) => t.name);
    expect(names.some((n) => n.includes("理論値"))).toBe(true);
    expect(names.some((n) => n.includes("実用"))).toBe(true);
    expect(names.some((n) => n.includes("隣接"))).toBe(true);
    // センクリテンプレートはセンター付与のクリスコ
    const centerCrit = templates.find((t) => t.name.includes("センタークリスコ"))!;
    expect(centerCrit.frames[0]).toMatchObject({ kind: "grant_center", stat: "critical_score", type: "pct" });
  });
});

// ---------------------------------------------------------------------------
// フォトマスタ変換（Phase 8-B2・data/photos_master.json の実データで検証）
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { photoMasterToMyPhoto, type PhotoMasterEntry } from "../../src/photos.js";
import type { SkillDef } from "../../src/timeline/types.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("フォトマスタ（photos_master.json）変換", () => {
  const master = JSON.parse(
    readFileSync(path.join(repoRoot, "data/photos_master.json"), "utf-8"),
  ) as { photos: PhotoMasterEntry[]; skillsById: Record<string, SkillDef> };

  it("262 枚のフォトが読み込める・初期品質を持つ", () => {
    expect(master.photos.length).toBe(262);
    const withQuality = master.photos.filter((p) => p.initialQuality != null);
    expect(withQuality.length).toBe(262);
  });

  it("実測検証済みフォト（ふつつかものですが）の初期値が実測と一致する", () => {
    const p = master.photos.find((x) => x.name === "ふつつかものですが");
    expect(p).toBeDefined();
    // T5 実測（品質35）: Vo+20.0% Da+20.0% Vi+20.0% Sta+4.0%
    expect(p!.structured).toEqual([
      { stat: "vocal", type: "pct", value: 20 },
      { stat: "dance", type: "pct", value: 20 },
      { stat: "visual", type: "pct", value: 20 },
      { stat: "stamina", type: "pct", value: 4 },
    ]);
    expect(p!.initialQuality).toBe(35);
  });

  it("MyPhotoDef への変換でマスタフォトの能力が frames になり・スキル付きは枠1スキルになる", () => {
    const skilled = master.photos.find((p) => p.skills.length > 0)!;
    const def = photoMasterToMyPhoto(skilled, master.skillsById);
    // スキル名のフォトは structured が 4 枠以内（スキルあり = ステータス枠 4）の過剰盛りチェックに通る
    expect(validateMyPhoto(def)).toEqual([]);
    if (skilled.structured.length <= 4) {
      expect(def.skill).not.toBeNull();
      expect(def.skill!.ct).toBe(master.skillsById[skilled.skills[0]!]!.ct);
    }
    // すべてのマスタフォトがバリデーションを通る（スキルありで 5 枠のものは除く）
    for (const p of master.photos) {
      const d = photoMasterToMyPhoto(p, master.skillsById);
      const limit = d.skill !== null ? 4 : 5;
      if (d.frames.length <= limit) {
        expect(validateMyPhoto(d)).toEqual([]);
      }
    }
  });

  it("撮影キャラ付きフォトには「撮影キャラ」タグとキャラ名が付く（専用フォトとは別物）", () => {
    const focused = master.photos.find((p) => p.focusCharacterId && p.focusCharacterName)!;
    const def = photoMasterToMyPhoto(focused, master.skillsById);
    expect(def.tags).toContain("撮影キャラ");
    expect(def.tags).toContain(focused.focusCharacterName!);
    expect(def.tags).not.toContain("専用");
    expect(def.kindLabel).toBe(focused.eventName || "メモリアル");
  });
});
