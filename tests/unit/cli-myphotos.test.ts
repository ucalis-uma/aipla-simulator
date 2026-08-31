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
    card_id: "card-yu-05-birt-02",
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

  it("T5 サンプル（myPhotos なし）は確定値 2,436,373,427 のまま", () => {
    const out = execFileSync(
      "npx",
      ["tsx", path.join(repoRoot, "src/cli/simulate.ts"), "--input", "examples/t5-sample.json", "--n", "0", "--crit-rate", "0"],
      { encoding: "utf-8", cwd: repoRoot, shell: true },
    );
    expect(JSON.parse(out).confirmed.totalScore).toBe(2436373427);
  });
});
