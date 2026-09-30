/**
 * Phase 16 アクション8 補助プローブ（read-only）:
 *   アクション8 T5 が推定した「sim が pop 読込不能セルに置くスコア」を実際の engine 出力で確定させる。
 *   S3 の全レーンについて、ポップが読めないセル（＝実測側で検証不能なセル）に sim が何をどれだけ
 *   配置しているかを、実測の発動ログ（成功/FAIL・スタミナ）と並べて print する。
 *
 * 実行: npx tsx research/23_beat_score_analysis/phase16_action8_sim_hidden_cells.ts
 *   （出力は shell のリダイレクトで phase16_action8_sim_hidden_cells_out.txt に落とす。本スクリプトは書き込まない）
 * build 手順は phase16_action5_lane_gap.ts / tmp_a4_s3_beats.ts の lanefans 経路と同一
 *   （検証: tmp_a4 の lanefans 合計 73,020,495 = action5 出力の mode=lanefans 合計と一致することを確認済み）
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildSimulateInput, type SimSourceData } from "../../src/sim/build.js";
import { simulateTimeline } from "../../src/timeline/engine.js";
import { NeutralRng } from "../../src/rng/neutral.js";
import { mergePhotoEquipStatuses, myPhotoToSkillDef, type MyPhotoDef } from "../../src/photos.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const noxRoot = path.resolve(repoRoot, "..", "aipura_nox");
const readJson = (p: string): any => JSON.parse(readFileSync(p, "utf-8"));
const fmt = (v: number | null | undefined): string =>
  v === null || v === undefined || Number.isNaN(v) ? "null" : Math.round(v).toLocaleString("en-US");

function loadData(): SimSourceData {
  const dataDir = path.join(repoRoot, "data");
  const idx = readJson(path.join(dataDir, "stages_index.json"));
  const allCharts = readJson(path.join(dataDir, "charts_all.json"));
  const mkStage = (qid: string): [string, any] => {
    const q = idx.quests.find((x: any) => x.id === qid);
    const c = idx.configs[q.c];
    return [
      qid,
      {
        beatWeightsPermil: { vocal: c.w[0], dance: c.w[1], visual: c.w[2] },
        skillWeightsPermil: { active: c.aw[0], special: c.aw[1] },
        skillStaminaWeightPermil: c.st ?? 1000,
        laneAttributes: c.a,
      },
    ];
  };
  const mkChart = (cid: string): [string, any] => [
    cid,
    {
      notes: (allCharts[cid] as Array<[number, number]>).map((n: any, i: number) => ({
        beat: i + 1,
        type: n[0],
        position: n[1],
      })),
    },
  ];
  return {
    cards: readJson(path.join(dataDir, "cards.json")).cards,
    cardParameters: readJson(path.join(dataDir, "card_parameters.json")).rows,
    skillsGolden: readJson(path.join(dataDir, "skills_golden.json")).skills,
    stages: Object.fromEntries([mkStage("qt-ex-tower-005-045")]),
    charts: Object.fromEntries([mkChart("chart-thrx-004-001")]),
    audienceAdvantage: readJson(path.join(dataDir, "stages/audience_advantage.json")),
    skillsByCard: readJson(path.join(dataDir, "skills_master.json")).byCard,
    skillLevels: readJson(path.join(dataDir, "skills_levels.json")),
    liveBonusesByQuest: readJson(path.join(dataDir, "live_bonuses.json")).byQuest,
    characterAdvantageByQuest: readJson(path.join(dataDir, "character_advantage.json")).byQuest,
  };
}

const cfgJson = readJson(path.join(noxRoot, "サンプル3", "deck.json"));
cfgJson.deck.characters[3].ct_cuts = [{ skill: 2, value: 5 }];
for (const ph of cfgJson.myPhotos as any[]) {
  if (ph.id === "uph-lane5-3" && ph.skill !== null) ph.skill.staminaScaling = "more_stamina";
}
const d = cfgJson.deck;
const myPhotos: MyPhotoDef[] = cfgJson.myPhotos ?? [];
const photoEquip: string[][] = cfgJson.photoEquip ?? [];
photoEquip.forEach((ids: string[], i: number) => {
  const ch = d.characters[i];
  if (ch === undefined || !Array.isArray(ch.photos)) return;
  const equipped = ids
    .map((pid: string) => myPhotos.find((x: any) => x?.id === pid))
    .filter((p: any): p is MyPhotoDef => p !== undefined);
  ch.photos = mergePhotoEquipStatuses(ch.photos, equipped);
});
const userPhotoSkills = myPhotos.length > 0
  ? photoEquip.flatMap((ids: string[], i: number) =>
      ids.flatMap((pid: string, j: number) => {
        const p = myPhotos.find((x: any) => x?.id === pid);
        if (p === undefined) return [];
        const def = myPhotoToSkillDef(p, (i + 1) as any, j + 1);
        return def !== null ? [def] : [];
      }),
    )
  : undefined;


const built = buildSimulateInput({
  deck: d,
  stageFile: "qt-ex-tower-005-045",
  chartFile: "chart-thrx-004-001",
  data: loadData(),
  audience: 8000,
  laneFans: [8515, 7748, 8535, 8518, 6684],
  maxCapacity: 40000,
  mentalOverride: cfgJson.mentalOverride,
  missedNotes: cfgJson.missedNotes,
  disabledSkillIds: cfgJson.disabledSkillIds,
  userPhotoSkills,
} as any);

const m = readJson(path.join(noxRoot, "サンプル3", "measured_data_v3.json"));
const critRaw = readJson(path.join(noxRoot, "サンプル3", "measured_data_v2.json")).critical_flags;
const crit = new Map<number, boolean[]>();
for (const row of critRaw.beats as Array<{ beat: number; lanes: boolean[] }>) {
  crit.set(row.beat, row.lanes ?? [false, false, false, false, false]);
}
const res: any = simulateTimeline({
  ...built.base,
  rng: new NeutralRng(),
  criticalProvider: (beat: number, lane: number) => crit.get(beat)?.[lane - 1] === true,
});

// 実測の発動ログ（成功ならスキル名、FAIL なら理由）を beat×lane で引けるようにする
const actLog = new Map<string, any[]>();
for (const a of m.skill_activations_summary ?? []) {
  const k = `${a.beat}:${a.lane}`;
  if (!actLog.has(k)) actLog.set(k, []);
  actLog.get(k)!.push(a);
}
const failReason = (a: any): string =>
  /FAIL・CT中表示/.test(String(a.note ?? "")) ? "FAIL(CT)"
    : /FAIL・スタミナ不足/.test(String(a.note ?? "")) ? "FAIL(stamina)" : "OK";

const simByCell = new Map<string, { total: number; ev: any[] }>();
for (const b of res.beats as any[]) {
  for (const ev of b.events as any[]) {
    const k = `${b.beat}:${ev.lane}`;
    const cur = simByCell.get(k) ?? { total: 0, ev: [] };
    cur.total += ev.gainedScore;
    cur.ev.push(ev);
    simByCell.set(k, cur);
  }
}

const LANES = [1, 2, 3, 4, 5];
const laneTotalKey = m.results?.scores_by_lane ?? m.results?.lane_scores ?? null;
console.log("=== S3: pop が読めないセルでの sim 配置（lanefans 経路・実測クリ再現・rand=1000） ===");
console.log(`  sim 合計 ${fmt(res.totalScore)} / 実測 ${fmt(m.results?.total_score)} / laneFanFactorPermil ${JSON.stringify(built.base.laneFanFactorPermil)}`);
console.log("");

type Row = { beat: number; lane: number; sim: number; bar: number; note: string; act: string; ev: string };
const hidden: Row[] = [];
const perLane = LANES.map((l) => ({ lane: l, simHidden: 0, n: 0, popSum: 0 }));
for (const row of m.timeline as any[]) {
  const beat = row.beat as number;
  if (typeof beat !== "number") continue;
  const bar = typeof row.beat_gained_score === "number" ? row.beat_gained_score : 0;
  for (const l of LANES) {
    const cell = row.lanes?.[String(l)] ?? {};
    const text = cell.gained_score_pop?.text ?? null;
    const sim = simByCell.get(`${beat}:${l}`)?.total ?? 0;
    if (text !== null) {
      perLane[l - 1].popSum += Math.round(Number(String(text).replace(/[+K]/g, "")) * (/[Kk]/.test(String(text)) ? 1000 : 1));
      continue;
    }
    perLane[l - 1].simHidden += sim;
    perLane[l - 1].n++;
    const acts = actLog.get(`${beat}:${l}`) ?? [];
    hidden.push({
      beat, lane: l, sim, bar,
      note: String(cell.note ?? "").slice(0, 24),
      act: acts.map((a) => `${a.type}/${failReason(a)}:${a.skill_name}`).join(" + ") || "（発動ログなし）",
      ev: (simByCell.get(`${beat}:${l}`)?.ev ?? []).map((e: any) => `${e.sourceKind}=${fmt(e.gainedScore)}`).join(" "),
    });
  }
}
console.log("  レーン別の総括（pop 読込不能セルだけ）");
console.log("   レーン |  隠れセル数 |    sim(隠れセル) |   実測の隠れ枠 |   sim−実測 | 実測発動ログのあるセル数");
for (const p of perLane) {
  const laneTotal = Number(laneTotalKey?.[String(p.lane)] ?? 0);
  const obsHidden = laneTotal - p.popSum;
  const withLog = hidden.filter((h) => h.lane === p.lane && h.act !== "（発動ログなし）").length;
  console.log(
    `      L${p.lane}   | ${String(p.n).padStart(9)} | ${fmt(p.simHidden).padStart(15)} | ${fmt(obsHidden).padStart(14)} | ` +
      `${fmt(p.simHidden - obsHidden).padStart(11)} | ${withLog}`,
  );
}
console.log("");
for (const l of LANES) {
  const rows = hidden.filter((h) => h.lane === l).sort((a, b) => b.sim - a.sim);
  console.log(`  --- L${l}: pop 読込不能セル（sim 順・上位 ${Math.min(10, rows.length)} / ${rows.length} セル）`);
  for (const r of rows.slice(0, 10))
    console.log(
      `      b${String(r.beat).padStart(3)} sim ${fmt(r.sim).padStart(10)} バー ${fmt(r.bar).padStart(10)} | ${r.act} | ${r.ev}${r.note ? " | " + r.note : ""}`,
    );
}
console.log("");
console.log("  参考: 実測発動ログが FAIL を記録しているビート×レーンでの sim 配置（sim 大順 14 件）");
for (const r of hidden.filter((h) => /FAIL/.test(h.act)).sort((a, b) => b.sim - a.sim).slice(0, 14))
  console.log(`      b${String(r.beat).padStart(3)} L${r.lane} sim ${fmt(r.sim).padStart(10)} バー ${fmt(r.bar).padStart(10)} | ${r.act} | ${r.ev}`);

