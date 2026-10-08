/**
 * Phase 16 Action14 / A3 後半: λ と属性重みを「分離して」フィットする（A11 は重みだけをフィットした）
 *
 *   node research/23_beat_score_analysis/phase16_action14_a3_lambda.mjs S2
 *
 * モデル（`src/timeline/engine.ts` L2205-2216）:
 *   basicSum = Σ_a mulPermil( mulPermil(deck_a, live_a), w_a )      （a = vocal/dance/visual）
 *   basic    = floor( basicSum × λ )                                 （λ = 8/140 = BEAT_LAMBDA）
 *   セル得点 = seq(basic, [b1, combo, fan, rand, crit]) × advantage
 * よってバフが 1 つも乗っていない（b1=combo=crit=rand=1000）純 beat セルでは
 *   basic = 実測 / (fan × advantage)
 * として **実測から basic を逆算**でき、`basic ≈ Σ_a deck_a × (w_a·λ)` の 3 未知（q_a = w_a·λ/1000）を
 * 15 レーンぶんのセルから最小二乗で解ける。q が全レーン共通で説明できれば
 * 「重み・λ は正しく、レーン別オフセットは別要因」、説明できなければ各レーンの q が正体になる。
 */
import fs from "node:fs";
import path from "node:path";

const repo = process.cwd();
const J = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const TAG = (process.argv[2] ?? "S2").toUpperCase();
const DIR = { S1: "サンプル1", S2: "サンプル2", S3: "サンプル3" }[TAG];
const A = path.join(repo, "research", "23_beat_score_analysis");

const ev = J(path.join(A, `phase16_action14_a2_${TAG.toLowerCase()}_events.json`)).samples[TAG];
const ledger = J(path.join(A, `phase16_action14_a2_${TAG.toLowerCase()}_ratio.json`));
const deckDoc = J(path.join(A, `phase16_action14_a3_deck.json`)).samples[TAG];

/** レーン別の実測復元（a2 の台帳を再利用。S2 は unknown 0 で厳密） */
const measuredOf = new Map();
for (const b of ledger.beats) {
  for (let l = 1; l <= 5; l++) if (b.measured[l] !== null) measuredOf.set(`${b.beat}:${l}`, b.measured[l]);
}
/** レーン別 deck 素ステータス（sim が使った値＝記録値と 1 の位まで一致済み） */
const deckOf = new Map();
for (const d of deckDoc.deckCheck.laneDecks) deckOf.set(d.lane, d.deck);

/** ステージの属性重み（laneAttributes）を data から引く（比較用） */
let stageWeights = null;
try {
  const idx = J(path.join(repo, "data", "stages_index.json"));
  const q = (idx.quests ?? []).find((x) => x.id === (ev.stage ?? "qt-tower-680"));
  const conf = idx.configs?.[q?.c] ?? q;
  stageWeights = conf?.w ?? conf?.beatWeightsPermil ?? null;
  console.log(`stage ${q?.id} laneAttributes = ${JSON.stringify(stageWeights)}`);
} catch (e) {
  console.log(`stage weights 取得失敗: ${String(e)}`);
}

const rows = [];
for (const [k, evs] of Object.entries(ev.cellEvents ?? {})) {
  const [b, l] = k.split(":").map(Number);
  if (evs.length !== 1) continue;
  const e = evs[0];
  if (e.sourceKind !== "beat") continue;
  if (!(e.gainedScore > 0)) continue;
  const measured = measuredOf.get(k);
  if (measured === undefined || measured === null) continue;
  // 実測を満たす basic（バフ類は正しいと仮定し、basic の倍率だけを逆算する）
  const phi = measured / e.gainedScore;
  rows.push({ cell: k, beat: b, lane: l, simBasic: e.basicScore, basicReq: e.basicScore * phi, phi, measured, sim: e.gainedScore });
}
console.log(`=== ${TAG}: 単独 beat セル ${rows.length} セル（実測は台帳から復元） ===`);
const byLane = new Map();
for (const r of rows) {
  const a = byLane.get(r.lane) ?? [];
  a.push(r);
  byLane.set(r.lane, a);
}
for (const [lane, arr] of [...byLane.entries()].sort((x, y) => x[0] - y[0])) {
  const d = deckOf.get(lane);
  const sum = arr.reduce((a, r) => a + r.basicReq / r.simBasic, 0) / arr.length;
  console.log(
    `  L${lane}: ${String(arr.length).padStart(3)} セル / 実測 basic / sim basic の平均比 = ${sum.toFixed(5)}` +
      ` / deck Vo ${d.vocal} Da ${d.dance} Vi ${d.visual}`,
  );
}

/** 最小二乗: basicReq ≈ (q_v·Vo + q_d·Da + q_vi·Vi) / 1000 */
const fit = (subset) => {
  // 正規方程式（3x3）
  let m = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  let v = [0, 0, 0];
  for (const r of subset) {
    const d = deckOf.get(r.lane);
    const x = [d.vocal / 1000, d.dance / 1000, d.visual / 1000];
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) m[i][j] += x[i] * x[j];
      v[i] += x[i] * r.basicReq;
    }
  }
  // ガウス消去
  for (let i = 0; i < 3; i++) {
    let p = i;
    for (let k2 = i + 1; k2 < 3; k2++) if (Math.abs(m[k2][i]) > Math.abs(m[p][i])) p = k2;
    [m[i], m[p]] = [m[p], m[i]];
    [v[i], v[p]] = [v[p], v[i]];
    for (let k2 = i + 1; k2 < 3; k2++) {
      const f = m[k2][i] / m[i][i];
      for (let j = i; j < 3; j++) m[k2][j] -= f * m[i][j];
      v[k2] -= f * v[i];
    }
  }
  const q = [0, 0, 0];
  for (let i = 2; i >= 0; i--) {
    let s = v[i];
    for (let j = i + 1; j < 3; j++) s -= m[i][j] * q[j];
    q[i] = s / m[i][i];
  }
  return q;
};
const q = fit(rows);
const LAMBDA = 8 / 140;
console.log(
  `\n全 15 レーン共通フィット: q = [Vo ${q[0].toFixed(6)}, Da ${q[1].toFixed(6)}, Vi ${q[2].toFixed(6)}]` +
    ` → λ = ${LAMBDA.toFixed(6)} とすると重み w = [${(q[0] / LAMBDA).toFixed(1)}, ${(q[1] / LAMBDA).toFixed(1)}, ${(q[2] / LAMBDA).toFixed(1)}]‰`,
);
const pred = (r) => {
  const d = deckOf.get(r.lane);
  return (q[0] * d.vocal + q[1] * d.dance + q[2] * d.visual) / 1000;
};
let n = 0;
let sAbs = 0;
let sSq = 0;
for (const r of rows) {
  const e = r.basicReq - pred(r);
  n++;
  sAbs += Math.abs(e);
  sSq += e * e;
}
console.log(
  `  残差: 平均|誤差| ${(sAbs / n).toFixed(1)} / rms ${Math.sqrt(sSq / n).toFixed(1)}（basic の典型値 ~${Math.round(rows[0]?.simBasic ?? 0)}）`,
);
console.log("\n--- レーン別（共通 q でどれだけ説明できるか） ---");
for (const [lane, arr] of [...byLane.entries()].sort((x, y) => x[0] - y[0])) {
  const ratios = arr.map((r) => r.basicReq / pred(r));
  const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length;
  const sd = Math.sqrt(ratios.reduce((a, b) => a + (b - mean) ** 2, 0) / ratios.length);
  console.log(
    `  L${lane}: n ${String(arr.length).padStart(3)} / 実測/共通q = ${mean.toFixed(5)}（sd ${sd.toFixed(5)}）` +
      ` / sim/共通q = ${(arr.reduce((a, r) => a + r.simBasic / pred(r), 0) / arr.length).toFixed(5)}`,
  );
}
console.log(
  "\n※ 「実測/共通q」がレーンごとに一定（sd 小）なら、そのレーンのずれは **deck 素ステータスに比例する一様倍率**。\n" +
    "   sd が大きいレーンは同一レーン内でもセルごとにずれる＝一様倍率では説明できない。",
);

/* --- レーン別 φ（実測 / sim）の統計と時間依存 --- */
console.log("\n--- レーン別 φ = 実測 / sim（セル倍率）: 一様性と時間依存の検査 ---");
for (const [lane, arr] of [...byLane.entries()].sort((x, y) => x[0] - y[0])) {
  const phis = arr.map((r) => r.phi);
  const mean = phis.reduce((a, b) => a + b, 0) / phis.length;
  const sd = Math.sqrt(phis.reduce((a, b) => a + (b - mean) ** 2, 0) / phis.length);
  const early = arr.filter((r) => r.beat <= 84);
  const late = arr.filter((r) => r.beat > 84);
  const m = (a) => (a.length === 0 ? NaN : a.reduce((x, r) => x + r.phi, 0) / a.length);
  console.log(
    `  L${lane}: φ 平均 ${mean.toFixed(5)}（sd ${sd.toFixed(5)} / min ${Math.min(...phis).toFixed(4)} / max ${Math.max(...phis).toFixed(4)}）` +
      ` 前半(b≤84) ${m(early).toFixed(5)} / 後半 ${m(late).toFixed(5)}`,
  );
}
/** 相対重み付き最小二乗（レーン当たりの相対誤差を最小化＝大型レーンに引きずられない） */
const fitRel = (subset) => {
  let m = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  let v = [0, 0, 0];
  for (const r of subset) {
    const d = deckOf.get(r.lane);
    const x = [d.vocal / 1000, d.dance / 1000, d.visual / 1000];
    const wgt = 1 / (r.basicReq * r.basicReq);
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) m[i][j] += wgt * x[i] * x[j];
      v[i] += wgt * x[i] * r.basicReq;
    }
  }
  for (let i = 0; i < 3; i++) {
    let p = i;
    for (let k2 = i + 1; k2 < 3; k2++) if (Math.abs(m[k2][i]) > Math.abs(m[p][i])) p = k2;
    [m[i], m[p]] = [m[p], m[i]];
    [v[i], v[p]] = [v[p], v[i]];
    for (let k2 = i + 1; k2 < 3; k2++) {
      const f = m[k2][i] / m[i][i];
      for (let j = i; j < 3; j++) m[k2][j] -= f * m[i][j];
      v[k2] -= f * v[i];
    }
  }
  const q = [0, 0, 0];
  for (let i = 2; i >= 0; i--) {
    let s = v[i];
    for (let j = i + 1; j < 3; j++) s -= m[i][j] * q[j];
    q[i] = s / m[i][i];
  }
  return q;
};
const qRel = fitRel(rows);
console.log(
  `\n相対フィット q_rel = [${qRel.map((x) => x.toFixed(4)).join(", ")}]` +
    `（λ = 8/140 とすると重み w = [${qRel.map((x) => (x / LAMBDA).toFixed(1)).join(", ")}]‰）`,
);
for (const [lane, arr] of [...byLane.entries()].sort((x, y) => x[0] - y[0])) {
  const d = deckOf.get(lane);
  const p = (qRel[0] * d.vocal + qRel[1] * d.dance + qRel[2] * d.visual) / 1000;
  const ratios = arr.map((r) => r.basicReq / p);
  const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length;
  const sd = Math.sqrt(ratios.reduce((a, b) => a + (b - mean) ** 2, 0) / ratios.length);
  console.log(`  L${lane}: 実測/相対q = ${mean.toFixed(5)}（sd ${sd.toFixed(5)}）`);
}
console.log(
  "  ※ ここで per-lane が 1.000 に揃わないなら、**属性重みでは 5 レーンの φ のばらつきを説明できない**" +
    "（＝重みの自由度 3 に対しレーン 5 本）。",
);

if (stageWeights !== null) {
  const qSim = stageWeights.map((w) => (Number(w) * LAMBDA) / 1000);
  console.log(
    `\n--- sim が使っている重みとの比較 ---\n  sim 重み w = [${stageWeights.join(", ")}]‰ → q_sim = [${qSim.map((x) => x.toFixed(4)).join(", ")}]\n` +
      `  フィット q    = [${q.map((x) => x.toFixed(4)).join(", ")}]（比 ${q.map((x, i) => (x / qSim[i]).toFixed(4)).join(", ")}）`,
  );
}
fs.writeFileSync(
  path.join(A, `phase16_action14_a3_lambda_${TAG.toLowerCase()}.json`),
  `${JSON.stringify({ generatedBy: "phase16_action14_a3_lambda.mjs", tag: TAG, q, lambda: LAMBDA, rows, byLane: Object.fromEntries([...byLane].map(([k, v]) => [k, v.length])) }, null, 1)}\n`,
  "utf8",
);
