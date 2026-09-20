/**
 * CLI の myPhotos/photoEquip 解決（Phase 8-B9）の単体テスト。
 * UI エクスポート形式の設定 JSON（myPhotos + photoEquip）を CLI で読み込み、
 * ユーザーフォトスキルがシミュレーションに反映されることを検証する。
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { writeFileSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** CLI を実行して confirmed totalScore を返す */
function runCli(cfg: Record<string, unknown>): { confirmed: { totalScore: number }; stderr: string } {
  const dir = mkdtempSync(path.join(os.tmpdir(), "aipura-cli-"));
  const input = path.join(dir, "config.json");
  writeFileSync(input, JSON.stringify(cfg));
  try {
    const out = execFileSync(
      "npx",
      ["tsx", path.join(repoRoot, "src/cli/simulate.ts"), "--input", input, "--n", "0", "--crit-rate", "0"],
      { encoding: "utf-8", cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"], shell: true },
    );
    return { confirmed: JSON.parse(out).confirmed, stderr: "" };
  } catch (e) {
    const err = e as { stderr?: string; stdout?: string };
    return { confirmed: { totalScore: -1 }, stderr: err.stderr ?? String(e) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const baseDeck = () => ({
  staff_bonus: { vocal: 0, dance: 0, visual: 0, stamina: 0, mental: 0, critical: 0 },
  yale_bonus: {
    vocal_pct: 0, dance_pct: 0, visual_pct: 0, stamina: 0, mental: 0, critical: 0,
    beat_score_pct: 0, a_skill_score_pct: 0, sp_skill_score_pct: 0, critical_score_pct: 0,
  },
  characters: [1, 2, 3, 4, 5].map((lane) => ({
    lane,
    // L1 のみボーカルカード（*_type_N の対象プールはメンバータイプ＝カード属性基準。
    // 全レーン visual カードだと vocal_type_1 のプールが空になるため・サンプル1確定仕様）
    card_id: lane === 1 ? "card-rio-05-fest-01" : "card-yu-05-birt-02",
    level: 215,
    rarity: 10,
    role: "Scorer",
    kouryu_level: 1,
    stats: {
      base: { vocal: 0, dance: 0, visual: 0, stamina: 0 },
      total_after_non_skill_modifiers: { vocal: 0, dance: 0, visual: 0, stamina: 0 },
    },
    photos: [],
    accessories: [],
  })),
});

const baseCfg = () => ({
  deck: baseDeck(),
  stage: { file: "qt-daily-003-19" },
  chart: { file: "chart-hsm-004-001" },
  critRate: 0,
});

describe("CLI myPhotos/photoEquip 解決（Phase 8-B9）", () => {
  it("myPhotos + photoEquip のユーザーフォトスキルが CLI のスコアに反映される", () => {
    const withoutSkill = runCli(baseCfg());
    const withSkill = runCli({
      ...baseCfg(),
      myPhotos: [
        {
          id: "uph-test-1",
          name: "テストブースト",
          kindLabel: "レタッチ",
          tags: [],
          retouch: true,
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
          frames: [],
        },
      ],
      photoEquip: [["uph-test-1"], [], [], [], []],
    });
    expect(withoutSkill.confirmed.totalScore).toBeGreaterThan(0);
    expect(withSkill.confirmed.totalScore).toBeGreaterThan(withoutSkill.confirmed.totalScore);
  });

  it("photoEquip 未指定・不明 ID は警告なしで無視される（T5 互換）", () => {
    const r = runCli({
      ...baseCfg(),
      myPhotos: [{ id: "uph-x", name: "x", kindLabel: "メモリアル", tags: [], retouch: false, skill: null, frames: [] }],
      photoEquip: [["unknown-id"], [], [], [], []],
    });
    expect(r.confirmed.totalScore).toBeGreaterThan(0);
    expect(r.stderr).not.toContain("[warn]");
  });

  it("T5 サンプル（myPhotos なし）は確定値 2,580,397,520 のまま（Phase 14 改ざん復元・Decay適正化後）", () => {
    const out = execFileSync(
      "npx",
      ["tsx", path.join(repoRoot, "src/cli/simulate.ts"), "--input", "examples/t5-sample.json", "--n", "0", "--crit-rate", "0"],
      { encoding: "utf-8", cwd: repoRoot, shell: true },
    );
    // 【2026-09-21 Phase 14】琴乃A(ccu)/かけがえのない二人(20%)復元・実効N-1 Decay適正化後確定値。
    expect(JSON.parse(out).confirmed.totalScore).toBe(2580397520);
  });

  it("frames ステータスのみの myPhotos も photos 側へ統合されスコアに反映される（Phase 8-B10）", () => {
    // 画像→JSON 生成フローの規約（prompts/deck-json-from-images.md）では myPhotos の
    // ステータスは characters[].photos 側に書かれるため、frames だけのファイルでも
    // CLI が UI と同一スコアになるよう photoEquip 装着分を photos へ統合する
    const withoutStatus = runCli(baseCfg());
    const withStatus = runCli({
      ...baseCfg(),
      myPhotos: [
        {
          id: "uph-test-st",
          name: "ステータス盛り",
          kindLabel: "メモリアルフォト",
          tags: ["手持ち"],
          retouch: false,
          skill: null,
          frames: [{ kind: "self", stat: "vocal", type: "pct", value: 100 }],
        },
      ],
      photoEquip: [["uph-test-st"], [], [], [], []],
    });
    expect(withStatus.confirmed.totalScore).toBeGreaterThan(withoutStatus.confirmed.totalScore);
  });

  it("photos 側に同名エントリがある場合は統合せず二重計算にならない（Phase 8-B10）", () => {
    // 画像→JSON 生成フローはステータスを photos 側にも書く。この場合 photoEquip 経由の
    // 追加統合をスキップし、UI applyConfig の重複除去と同一のスコアになる
    const cfg = baseCfg() as ReturnType<typeof baseCfg> & {
      myPhotos?: unknown[];
      photoEquip?: unknown[];
    };
    cfg.myPhotos = [
      {
        id: "uph-test-dup",
        name: "重複チェック",
        kindLabel: "メモリアルフォト",
        tags: [],
        retouch: false,
        skill: null,
        frames: [{ kind: "self", stat: "vocal", type: "pct", value: 100 }],
      },
    ];
    cfg.photoEquip = [["uph-test-dup"], [], [], [], []];
    const deduped = runCli(cfg);
    // photos 側に同名で書いた場合も同一値になる
    const withLegacy = runCli({
      ...cfg,
      deck: {
        ...baseDeck(),
        characters: baseDeck().characters.map((c, i) =>
          i === 0
            ? { ...c, photos: [{ name: "重複チェック", structured: [{ stat: "vocal", type: "pct", value: 100 }] }] }
            : c,
        ),
      },
    });
    expect(deduped.confirmed.totalScore).toBe(withLegacy.confirmed.totalScore);
  });
});
