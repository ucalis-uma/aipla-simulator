/**
 * 【2026-09-30 移設・注意】このファイルは使い捨て解析ツール（旧 `tools/probe_beats.ts`）。
 *   tsconfig の include が `tools/**/*.ts` を含むため、typecheck ゲートを壊さないよう
 *   research/23_beat_score_analysis/ へ移設した（research 配下は typecheck 対象外）。
 *   **現状は動作しない**: 参照する `src/timeline/stageId.ts` / `src/types/skillTypes.ts` は
 *   存在せず（API 変更で放置された死んだスクリプト）、`BuildSimOptions.questId`・
 *   `BuildSimResult.fanBaseCount` も現行型に無い。`research/23_beat_score_analysis/probe_tmp.txt`
 *   にモジュール解決エラーの痕跡どおり、一度も正常実行されていない。
 *   再使うなら import 経路（この階層では `../../src/...`）と上記 API 差分を直すこと。
 *
 * Phase 16 action3 probe（使い捨て解析ツール）
 *   実測バー増分 vs レーン別pop合計の乖離ビート・実測のみ発動ビートを
 *   ビート単位で全詳細ダンプする。sim は replay（実測 crit 再現・rand=1000）。
 *   使い方: npx tsx research/23_beat_score_analysis/probe_beats.ts S3 60,61,62 （beat 省略 = 実測発動ビート全部）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSimulateInput, type SimulateInput, type SimCharacter } from '../../src/sim/build.js';
import { simulate } from '../../src/timeline/engine.js';
import { loadSongChart } from '../../src/chart/song.js';
import { loadLiveBonusSkills } from '../../src/data/loaders.js';
import { parseStageId } from '../../src/timeline/stageId.js';
import type { LiveBonusSkillDef, SkillTimelineEvent } from '../../src/types/skillTypes.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..'); // research/23_beat_score_analysis → repo root（2026-09-30 移設に合わせて階層修正）
const NOX = 'C:\\Users\\umaro\\Documents\\aipura_nox';
const CRIT_ORDER = { small: 1, mid: 2, large: 3 } as const;

/** samples4 の S2/S3 形式を dump_t5_trace と同じローダー形状に変換 */
function loadSample(key: string) {
  const dir = path.join(NOX, key);
  const deckRaw = JSON.parse(fs.readFileSync(path.join(dir, 'deck.json'), 'utf8')) as {
    deck: SimCharacter[]; stage: { file: string; live_bonus_check?: string }; chart: { file: string };
    audience?: number; critRate?: { probabilityPermil: number }; missedNotes?: SimulateInput['missedNotes'];
    photoEquip?: { laneIndex: number; photoIds: [string, string, string] }[];
  };
  const beatTruth = JSON.parse(fs.readFileSync(path.join(dir, 'beat_truth.json'), 'utf8')) as {
    total_beats: number;
    beats: { beat: number; score?: number; lanes?: (number | null)[]; score_pop?: ({ text: string } | null)[]; crit_level?: string | null }[];
  };
  const measured = {
    beatTruth,
    scoreActivations: JSON.parse(fs.readFileSync(path.join(dir, 'score_activations.json'), 'utf8')) as {
      activations: { beat: number; lane: number | null; name: string; score: number }[];
    },
    skillActivations: JSON.parse(fs.readFileSync(path.join(dir, 'skill_activations.json'), 'utf8')) as {
      activations: { beat: number; lane: number | null; name: string; kind?: string }[];
    },
    stateTimeline: fs.existsSync(path.join(dir, 'state_timeline.json'))
      ? (JSON.parse(fs.readFileSync(path.join(dir, 'state_timeline.json'), 'utf8')) as {
          frames: { beat: number; lanes: { power?: number | null; effects?: { name?: string; count?: number | null }[] }[] }[];
        })
      : null,
  };
  const byQuest = loadLiveBonusSkills(path.join(ROOT, 'data/live_bonuses.json')).byQuest as Record<string, LiveBonusSkillDef[]>;
  const questId = deckRaw.stage.file;
  const check = deckRaw.stage.live_bonus_check;
  const lb = check !== 'not_captured' && check !== 'absent' ? byQuest[questId] ?? [] : [];
  const input = buildSimulateInput({
    questId,
    difficulty: 'normal',
    capacity: (() => { try { return parseStageId(loadSongChart(path.join(ROOT, `data/charts/${questId}.json`))).capacity; } catch { return null; } })(),
    audience: deckRaw.audience,
    chars: deckRaw.deck,
    chartFile: deckRaw.chart.file,
    critRate: deckRaw.critRate ?? { probabilityPermil: 0 },
    liveBonuses: lb,
    missedNotes: deckRaw.missedNotes ?? [],
    photoEquip: deckRaw.photoEquip,
  });
  const critByBeat = new Map<number, number[]>();
  for (const a of measured.scoreActivations?.activations ?? []) {
    if (!a.name.includes(' crit ')) continue;
    const c = critByBeat.get(a.beat) ?? [];
    c.push(CRIT_ORDER[(a.name.match(/\b(small|mid|large)\b/)?.[1] ?? 'small') as 'small' | 'mid' | 'large']);
    critByBeat.set(a.beat, c);
  }
  const withReplay: SimulateInput = {
    ...input,
    fanBaseCount: input.fanBaseCount ?? 0,
    activations: { byBeat: new Map([...critByBeat.entries()].sort((a, b) => a[0] - b[0])) },
  };
  return { input: withReplay, measured };
}

const key = process.argv[2] ?? 'S3';
const beatArg = (process.argv[3] ?? '')
  .split(',').map((s) => Number.parseInt(s, 10)).filter((n) => Number.isFinite(n));
const { input, measured } = loadSample(key);
const sim = simulate(input, { deterministic: false, rand: 1000 });
const rows = new Map<number, any>();
for (const b of measured.beatTruth.beats) rows.set(b.beat, b);
const simByBeat = new Map<number, { total: number; lanes: number[]; events: string[] }>();
for (const b of sim.beats) {
  const lanes = [0, 0, 0, 0, 0];
  for (const lb of b.laneBreakdown ?? []) if (lb.lane >= 1) lanes[lb.lane - 1] = lb.total;
  simByBeat.set(b.beat, {
    total: b.total, lanes,
    events: b.events.map((e) => `${e.kind}${e.lane ? `(L${e.lane})` : ''}:${e.name}`),
  });
}
const actMeas = new Map<number, string[]>();
for (const a of measured.skillActivations?.activations ?? []) {
  const cur = actMeas.get(a.beat) ?? [];
  cur.push(`L${a.lane ?? '-'} ${a.kind ?? '?'} ${a.name}`);
  actMeas.set(a.beat, cur);
}
const frames = new Map<number, any>();
for (const f of measured.stateTimeline?.frames ?? []) frames.set(f.beat, f);
const list = beatArg.length > 0 ? beatArg : [...actMeas.keys()].sort((a, b) => a - b);
for (const bt of list) {
  const r = rows.get(bt) ?? {};
  const measPops = (r.score_pop ?? []).map((p: any) => {
    if (!p?.text) return null;
    const m = /^([\d.,]+)([MK])?$/i.exec(String(p.text).replace(/[+∞+\s]/g, ''));
    if (!m) return null;
    const n = Number.parseFloat(m[1]!.replace(/,/g, ''));
    return m[2] ? (/^m$/i.test(m[2]) ? n * 1_000_000 : n * 1_000) : n;
  });
  const popSum = measPops.reduce((a: number, v: number | null) => a + (v ?? 0), 0);
  const s = simByBeat.get(bt);
  const simLaneSum = s ? s.lanes.reduce((a, v) => a + v, 0) : 0;
  const bar = r.score ?? 0;
  console.log(`\n=== ${key} b${bt} ===`);
  console.log(`  bar ${bar.toLocaleString('en-US')} | popSum ${popSum.toLocaleString('en-US')} | diff ${(bar - popSum).toLocaleString('en-US')} (${((bar - popSum) / Math.max(1, bar) * 100).toFixed(1)}%)`);
  console.log(`  pops: ${measPops.map((v: number | null) => (v === null ? '-' : v.toLocaleString('en-US'))).join(' | ')}`);
  console.log(`  crit: ${JSON.stringify(r.crit_level ?? null)} | power ${JSON.stringify(r.lanes ?? null)}`);
  console.log(`  measAct: ${(actMeas.get(bt) ?? []).join(' / ') || '(none)'}`);
  console.log(`  simTotal ${s?.total ?? 'n/a'} | simLanes ${s ? s.lanes.map((v) => v.toLocaleString('en-US')).join(' | ') : ''} | simLaneSum ${simLaneSum.toLocaleString('en-US')} (${(simLaneSum / Math.max(1, s?.total ?? 1) * 100).toFixed(1)}%)`);
  console.log(`  simEvents: ${(s?.events ?? []).join(' / ') || '(none)'}`);
  for (const back of [0, 1, 2, 3, 4, 5]) {
    const f = frames.get(bt - back);
    if (f) {
      console.log(`  state b${bt - back}: ${f.lanes.map((l: any, i: number) => `L${i + 1} pow=${l.power ?? '-'} eff=${(l.effects ?? []).map((e: any) => `${e.name}x${e.count ?? ''}`).join(',') || '-'}`).join(' / ')}`);
      break;
    }
  }
}
