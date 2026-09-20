import json
import os
import csv
import sys

sys.stdout.reconfigure(encoding='utf-8')

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT_DIR = os.path.join(REPO_ROOT, "research", "25_buff_audit")
os.makedirs(OUT_DIR, exist_ok=True)

# Mapping from Japanese effect name to BuffKey
NAME_TO_BUFF_KEY = {
    "ボーカル上昇": "vocal_up",
    "ボーカルブースト": "vocal_boost",
    "ボーカル上昇超化": "vocal_up_extreme",
    "ボーカル低下": "vocal_down",
    "ダンス上昇": "dance_up",
    "ダンスブースト": "dance_boost",
    "ダンス上昇超化": "dance_up_extreme",
    "ダンス低下": "dance_down",
    "ビジュアル上昇": "visual_up",
    "ビジュアルブースト": "visual_boost",
    "ビジュアル上昇超化": "visual_up_extreme",
    "ビジュアル低下": "visual_down",
    "スコア上昇": "score_up",
    "ビートスコア上昇": "beat_score_up",
    "Aスキルスコア上昇": "a_skill_score_up",
    "SPスキルスコア上昇": "sp_skill_score_up",
    "Pスキルスコア上昇": "p_skill_score_up",
    "コンボスコア上昇": "combo_score_up",
    "クリティカル率上昇": "critical_rate_up",
    "クリティカル係数上昇": "critical_coeff_up",
    "テンションUP": "tension_up",
    "集目": "focus",
    "ステルス": "stealth",
    "スキル成功率上昇": "skill_success_up",
    "消費スタミナ低下": "stamina_cost_down",
    "消費スタミナ上昇": "stamina_cost_up",
}

SPECIAL_EFFECTS = {
    "コンボ継続": "combo_continue",
    "テンションUP上限開放": "tension_limit",
    "コンボスコア上昇上限開放": "combo_score_limit",
    "クリティカル係数上昇上限開放": "critical_coeff_limit",
    "ビジュアル上昇上限開放": "visual_limit",
    "スタミナ継続回復": "stamina_continuous_recovery",
}

def classify_diff_reason(sample_name, beat, lane, key, m_val, s_val, sim_beats, meas_tl):
    sb = sim_beats.get(beat, {})
    curr_acts = sb.get("activations", [])
    
    # 1. S2 is completely missing effects data
    if sample_name == "S2":
        return "MISSING_MEASURED_EFFECTS: Sample 2 measured_data_v2.json has no effect items recorded"

    # 2. Combo continue flag
    if key == "combo_continue":
        return "FLAG_NOT_STAGED: combo_continue is a boolean flag without stages (recorded as stage: null in measured)"

    # 3. Extreme display vs effective stages (vocal_up_extreme, visual_up_extreme: display=10, effective=+5)
    if "extreme" in key:
        if m_val == 10 and s_val == 5:
            return "EXTREME_DISPLAY_VS_EFFECTIVE: In-game UI displays 10 stages, but simulator engine models effective +5 stages"
        if m_val == 0 and s_val > 0:
            return "DECAY_TIMING_LAG: Extreme buff expired in measured before sim decay"
        if m_val > 0 and s_val == 0:
            return "PHASE_LAG_ACTIVATION: Activated on current beat; measured reflects POST-activation, sim reflects PRE-activation"

    # 4. Activation beat phase lag (POST in measured vs PRE in sim)
    next_s = sim_beats.get(beat + 1, {}).get("buffSnapshots", [{} for _ in range(5)])[lane - 1].get(key, 0) if beat + 1 in sim_beats else None
    prev_s = sim_beats.get(beat - 1, {}).get("buffSnapshots", [{} for _ in range(5)])[lane - 1].get(key, 0) if beat - 1 in sim_beats else None
    
    if m_val > s_val:
        # Check if an activation happened on this beat
        if curr_acts or (next_s is not None and next_s == m_val):
            return f"PHASE_LAG_ACTIVATION: Activated on b{beat} (acts={[a.get('skillId') for a in curr_acts]}); measured reflects immediately (POST), sim reflects next beat (PRE)"

    # 5. S1 b130-b132 overlap / decay
    if sample_name == "S1" and key == "combo_score_up" and beat in [130, 131, 132]:
        if beat == 130:
            return "PHASE_LAG_ACTIVATION: L4 A (sk-chs-05-hruh-00-1) activated on b130 (+6 stages); measured shows overlap 10+6=16, sim reflects b131"
        elif beat in [131, 132]:
            return f"DECAY_TIMING_LAG: Old 10-stage buff expired in measured at b130 end (leaving only new 6-stage buff), while sim retained old buff through b132 due to skipFirstDecay"

    # 6. Decay timing difference
    if m_val == 0 and s_val > 0:
        if prev_s is not None and prev_s == s_val:
            return "DECAY_TIMING_LAG: Buff expired in measured 1-2 beats earlier than sim (in-game decay counts activation beat)"

    if m_val > 0 and s_val == 0:
        if prev_s is not None and prev_s > 0:
            return "DECAY_TIMING_LAG: Buff expired in sim earlier than measured"

    # 7. Amplification or overlap difference
    if curr_acts:
        return f"AMPLIFY_OR_OVERLAP_ON_BEAT: Activation on b{beat} ({[a.get('skillId') for a in curr_acts]}); measured stage {m_val} vs sim stage {s_val}"

    return f"BUFF_STAGE_MISMATCH: Measured {m_val} vs Sim {s_val} (diff={s_val - m_val})"

def audit_sample(sample_name, meas_path, sim_path, notes_count):
    print(f"=== Auditing {sample_name} ===")
    
    meas_data = None
    if meas_path and os.path.exists(meas_path):
        meas_data = json.load(open(meas_path, "r", encoding="utf-8"))
    
    sim_data = None
    if sim_path and os.path.exists(sim_path):
        sim_data = json.load(open(sim_path, "r", encoding="utf-8"))
    
    meas_tl = {b["beat"]: b for b in meas_data.get("timeline", [])} if meas_data else {}
    sim_beats = {b["beat"]: b for b in sim_data.get("beats", [])} if sim_data else {}
    
    diff_records = []
    special_records = []
    total_comparisons = 0
    match_count = 0
    discrepancy_count = 0
    
    max_beat = notes_count
    if sim_beats:
        max_beat = max(max_beat, max(sim_beats.keys()))
    if meas_tl:
        max_beat = max(max_beat, max(meas_tl.keys()))
        
    for beat in range(1, max_beat + 1):
        mb = meas_tl.get(beat)
        sb = sim_beats.get(beat)
        
        for lane_idx in range(5):
            lane_num = lane_idx + 1
            lane_str = str(lane_num)
            
            m_effects = []
            if mb and "lanes" in mb:
                lanes = mb["lanes"]
                if isinstance(lanes, dict):
                    m_effects = lanes.get(lane_str, {}).get("effects", [])
                elif isinstance(lanes, list) and lane_idx < len(lanes):
                    m_effects = lanes[lane_idx].get("effects", [])
            
            s_snap = sb["buffSnapshots"][lane_idx] if sb and "buffSnapshots" in sb and lane_idx < len(sb["buffSnapshots"]) else {}
            
            # Map measured effects
            m_by_key = {}
            for eff in m_effects:
                ename = eff.get("name")
                stage = eff.get("stage")
                if ename in NAME_TO_BUFF_KEY:
                    bkey = NAME_TO_BUFF_KEY[ename]
                    m_by_key[bkey] = m_by_key.get(bkey, 0) + (stage if stage is not None else 0)
                elif ename in SPECIAL_EFFECTS:
                    special_records.append({
                        "beat": beat,
                        "lane": lane_num,
                        "name": ename,
                        "type": SPECIAL_EFFECTS[ename],
                        "stage": stage
                    })
                else:
                    special_records.append({
                        "beat": beat,
                        "lane": lane_num,
                        "name": ename,
                        "type": "UNKNOWN",
                        "stage": stage
                    })
            
            keys_to_check = set(m_by_key.keys())
            for k, v in s_snap.items():
                if v > 0:
                    keys_to_check.add(k)
                    
            for key in sorted(keys_to_check):
                total_comparisons += 1
                m_val = m_by_key.get(key, 0)
                s_val = s_snap.get(key, 0)
                diff = s_val - m_val
                
                # Check match
                # Extreme display vs effective: in-game UI shows 10, sim shows 5
                is_extreme_match = ("extreme" in key and m_val == 10 and s_val == 5)
                is_match = (m_val == s_val) or is_extreme_match
                
                if is_match:
                    match_count += 1
                else:
                    discrepancy_count += 1
                    reason = classify_diff_reason(sample_name, beat, lane_num, key, m_val, s_val, sim_beats, meas_tl)
                    diff_records.append({
                        "sample": sample_name,
                        "beat": beat,
                        "lane": lane_num,
                        "key": key,
                        "measured_stage": m_val,
                        "sim_stage": s_val,
                        "diff": diff,
                        "note": reason
                    })

    summary = {
        "sample": sample_name,
        "meas_path": meas_path,
        "sim_path": sim_path,
        "meas_present": bool(meas_data),
        "meas_has_effects": any(len(b.get("lanes", {}).get("1", {}).get("effects", [])) > 0 for b in meas_tl.values()) if meas_tl else False,
        "sim_present": bool(sim_data),
        "max_beat": max_beat,
        "total_comparisons": total_comparisons,
        "match_count": match_count,
        "discrepancy_count": discrepancy_count,
        "special_effects_count": len(special_records)
    }
    
    out_suffix = "_v3" if sample_name == "T5" else ""
    csv_file = os.path.join(OUT_DIR, f"diff_{sample_name.lower()}{out_suffix}.csv")
    with open(csv_file, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["sample", "beat", "lane", "key", "measured_stage", "sim_stage", "diff", "note"])
        writer.writeheader()
        for r in diff_records:
            writer.writerow(r)
            
    json_file = os.path.join(OUT_DIR, f"diff_{sample_name.lower()}{out_suffix}.json")
    with open(json_file, "w", encoding="utf-8") as f:
        json.dump({
            "summary": summary,
            "diffs": diff_records,
            "special_effects": special_records
        }, f, indent=2, ensure_ascii=False)
        
    print(f"  Total comparisons: {total_comparisons}")
    print(f"  Matches: {match_count} ({(match_count/total_comparisons*100):.1f}%)")
    print(f"  Discrepancies: {discrepancy_count} ({(discrepancy_count/total_comparisons*100):.1f}%)")
    print(f"  Special effects logged: {len(special_records)}")
    print(f"  Written to {csv_file} and {json_file}")
    
    return summary, diff_records, special_records

t5_sum, t5_diff, t5_spec = audit_sample("T5", os.path.join(REPO_ROOT, "スコア分析サンプル/measured_data_v3.json"), os.path.join(REPO_ROOT, "research/25_buff_audit/t5_sim_trace_full.json"), 156)

# 不一致の内訳を集計
reasons_count = {}
for d in t5_diff:
    r = d["note"].split(":")[0]
    reasons_count[r] = reasons_count.get(r, 0) + 1

print("\nT5 Discrepancy Breakdown by Reason Category:")
for r, c in sorted(reasons_count.items(), key=lambda x: x[1], reverse=True):
    print(f"  {r}: {c} ({c/len(t5_diff)*100:.1f}%)")
