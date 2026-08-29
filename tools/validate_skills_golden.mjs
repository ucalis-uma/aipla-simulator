import fs from 'fs';
const raw = fs.readFileSync('data/skills_golden.json');
const fails = [];
// BOM check
if (raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf) fails.push('BOM found');
const d = JSON.parse(raw.toString('utf8'));
// counts
const card = d.skills.filter(s => s.kind !== 'photo');
const photo = d.skills.filter(s => s.kind === 'photo');
if (card.length !== 15) fails.push(`card skills = ${card.length} (expect 15)`);
if (photo.length !== 20) fails.push(`photos = ${photo.length} (expect 20)`);
// lanes coverage
for (const lane of [1,2,3,4,5]) {
  if (card.filter(s=>s.lane===lane).length !== 3) fails.push(`lane${lane} card != 3`);
  if (photo.filter(s=>s.lane===lane).length !== 4) fails.push(`lane${lane} photo != 4`);
}
// tag lists (engine constants + documented extensions)
const TAGS = new Set(['vocal_up','vocal_boost','vocal_up_extreme','dance_up','dance_boost','dance_up_extreme',
 'visual_up','visual_boost','visual_up_extreme','tension_up','tension_limit','combo_score_up','combo_score_limit',
 'critical_coeff_up','critical_coeff_limit','critical_rate_up','score_up','a_skill_score_up','sp_skill_score_up',
 'stamina_cost_down','skill_success_up','combo_continue','focus','stamina_recovery','ct_reduction','ct_increase',
 'effect_extension','effect_amplify','score_get','score_get_by_score_ratio']);
const TARGETS = new Set(['self','score_type_1','score_type_2','vocal_type_1','vocal_type_2','vocal_type_3','all','center','neighbors','neighbor','same_lane_other','vocal_high_1','single']);
const CONDS = new Set(['none','combo>=50','combo>=80','combo>=100','once_per_live','someone_focus','someone_score_up','someone_skill_success_up','someone_critical_coeff_up','self_vocal_lane','self_visual_lane','battle_only']);
const KINDS = new Set(['A','SP','P','photo']);
let effects = 0;
const confCount = {Confirmed:0,'Strong estimate':0,Estimate:0,Unknown:0};
const ids = new Set();
for (const s of d.skills) {
  if (!s.id) fails.push('skill without id');
  if (ids.has(s.id)) fails.push('duplicate id ' + s.id);
  ids.add(s.id);
  if (!KINDS.has(s.kind)) fails.push(`${s.id}: bad kind ${s.kind}`);
  for (const e of s.effects) {
    effects++;
    if (!TAGS.has(e.type)) fails.push(`${s.id}: unknown effect type ${e.type}`);
    if (!TARGETS.has(e.target)) fails.push(`${s.id}: unknown target ${e.target}`);
    if (!CONDS.has(e.condition)) fails.push(`${s.id}: unknown condition ${e.condition}`);
    if (!e.confidence) fails.push(`${s.id}: effect ${e.type} without confidence`);
    const pref = ['Confirmed','Strong estimate','Estimate','Unknown'].find(p => e.confidence.startsWith(p));
    if (!pref) fails.push(`${s.id}: bad confidence prefix: ${e.confidence}`);
    else confCount[pref]++;
  }
}
// region
if (d.region !== 'jp') fails.push('region != jp');
// no BOM, parse, print
console.log('card:', card.length, 'photo:', photo.length, 'total effects:', effects);
console.log('confidence:', JSON.stringify(confCount));
if (fails.length) { console.log('FAIL'); for (const f of fails) console.log(' -', f); process.exit(1); }
console.log('ALL CHECKS PASSED');
