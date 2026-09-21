"""
research/26_data_integrity/run_audit_s2_v3.py

Sample 2 (S2: タワー680 / qt-tower-680) において、
全レーン・全ビートから抽出した measured_data_v3.json と
最新 Sim トレース（research/20_sample2_gap_analysis/sim_trace_full.json）を突合し、
差分理由の自動分類・完全一致率・Decay 整合性評価を行うスクリプト。

実行: python research/26_data_integrity/run_audit_s2_v3.py
"""

import json
import os
import csv
import sys

sys.stdout.reconfigure(encoding="utf-8")

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT_DIR_26 = os.path.join(REPO_ROOT, "research", "26_data_integrity")

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
    "クリティカル係数上昇超化": "critical_coeff_limit",
    "ビジュアル上昇上限開放": "visual_limit",
    "スタミナ継続回復": "stamina_continuous_recovery",
}

def classify_diff_reason(beat, lane, key, m_val, s_val, sim_beats, meas_tl, m_by_key, special_by_key):
    sb = sim_beats.get(beat, {})
    curr_acts = sb.get("activations", [])
    
    # 1. クリティカル係数上昇の超化表記差
    # 実機 UI は critical_coeff_up (8段) と critical_coeff_extreme (10段) を分けて表示するが、
    # Sim エンジンは critical_coeff_up に +5段 を合算 (8 + 5 = 13段) してモデル化している
    if key == "critical_coeff_up":
        if "critical_coeff_limit" in special_by_key and s_val - m_val == 5:
            return "EXTREME_DISPLAY_VS_EFFECTIVE: In-game UI displays separate 'critical_coeff_extreme_10', while simulator models effective +5 stages on critical_coeff_up"
        if s_val - m_val == 5:
            # 前後ビートに超化がある場合
            mb = meas_tl.get(beat, {})
            return "EXTREME_DISPLAY_VS_EFFECTIVE: In-game UI displays separate 'critical_coeff_extreme_10', while simulator models effective +5 stages on critical_coeff_up"

    # 2. ビジュアル上昇超化の表記差 (m=10, s=5)
    if "extreme" in key:
        if m_val == 10 and s_val == 5:
            return "EXTREME_DISPLAY_VS_EFFECTIVE: In-game UI displays 10 stages, but simulator engine models effective +5 stages"
        if m_val == 0 and s_val > 0:
            prev_s = sim_beats.get(beat - 1, {}).get("buffSnapshots", [{} for _ in range(5)])[lane - 1].get(key, 0)
            if prev_s == s_val:
                return "DECAY_TIMING_LAG: Extreme buff expired in measured before sim decay"
        if m_val > 0 and s_val == 0:
            next_s = sim_beats.get(beat + 1, {}).get("buffSnapshots", [{} for _ in range(5)])[lane - 1].get(key, 0)
            if next_s > 0:
                return "PHASE_LAG_ACTIVATION: Activated on current beat; measured reflects POST-activation, sim reflects PRE-activation"

    # 3. SPスキルスコア上昇の持続性
    if key == "sp_skill_score_up":
        if m_val > 0 and s_val == 0:
            return "PERSISTENT_SP_BUFF: SP score buff remains on idol after SP note in measured, whereas simulator consumes it"

    # 4. 発動ビートの位相差 (POST in measured vs PRE in sim, または b1 発動バフが b2 反映)
    next_s = sim_beats.get(beat + 1, {}).get("buffSnapshots", [{} for _ in range(5)])[lane - 1].get(key, 0) if beat + 1 in sim_beats else None
    prev_s = sim_beats.get(beat - 1, {}).get("buffSnapshots", [{} for _ in range(5)])[lane - 1].get(key, 0) if beat - 1 in sim_beats else None
    
    if m_val > s_val:
        if curr_acts or (next_s is not None and next_s == m_val):
            return f"PHASE_LAG_ACTIVATION: Activated on b{beat} (acts={[a.get('skillId') for a in curr_acts]}); measured reflects immediately (POST), sim reflects next beat (PRE)"

    if beat == 1 and m_val == 0 and s_val > 0:
        # b1 で発動したバフが実機スクショでは b2 から反映される現象
        next_m = 0
        mb_next = meas_tl.get(2, {})
        lanes_next = mb_next.get("lanes", {})
        l_obj = lanes_next.get(str(lane)) or lanes_next.get(f"lane{lane}", {})
        for eff in l_obj.get("effects", []):
            if NAME_TO_BUFF_KEY.get(eff.get("name")) == key:
                next_m += eff.get("stage", 0)
        if next_m == s_val:
            return f"PHASE_LAG_ACTIVATION: b1 skill activated; screenshot at b1 is PRE-display, in-game UI displays buff from b2"

    # 5. 減衰タイミングの差異 (1-2ビートの境界ズレ)
    if m_val == 0 and s_val > 0:
        if prev_s is not None and prev_s > 0:
            return "DECAY_TIMING_LAG: Buff expired in measured 1-2 beats earlier than sim"

    if m_val > 0 and s_val == 0:
        if prev_s is not None and prev_s > 0:
            return "DECAY_TIMING_LAG: Buff expired in sim earlier than measured"

    # 6. 増強または重複タイミング
    if curr_acts:
        return f"AMPLIFY_OR_OVERLAP_ON_BEAT: Activation on b{beat} ({[a.get('skillId') for a in curr_acts]}); measured stage {m_val} vs sim stage {s_val}"

    return f"BUFF_STAGE_MISMATCH: Measured {m_val} vs Sim {s_val} (diff={s_val - m_val})"

def audit_s2(meas_path, sim_path, max_beat=167):
    meas_data = json.load(open(meas_path, "r", encoding="utf-8"))
    sim_data = json.load(open(sim_path, "r", encoding="utf-8"))
    
    meas_tl = {b["beat"]: b for b in meas_data.get("timeline", [])}
    sim_beats = {b["beat"]: b for b in sim_data.get("beats", [])}
    
    diff_records = []
    special_records = []
    total_comparisons = 0
    match_count = 0
    discrepancy_count = 0
    
    for beat in range(1, max_beat + 1):
        mb = meas_tl.get(beat)
        sb = sim_beats.get(beat)
        
        for lane_idx in range(5):
            lane_num = lane_idx + 1
            lane_str = str(lane_num)
            lane_key = f"lane{lane_num}"
            
            m_effects = []
            if mb and "lanes" in mb:
                lanes = mb["lanes"]
                if isinstance(lanes, dict):
                    lane_obj = lanes.get(lane_str) or lanes.get(lane_key, {})
                    m_effects = lane_obj.get("effects", [])
                elif isinstance(lanes, list) and lane_idx < len(lanes):
                    m_effects = lanes[lane_idx].get("effects", [])
                    
            s_snap = sb["buffSnapshots"][lane_idx] if sb and "buffSnapshots" in sb and lane_idx < len(sb["buffSnapshots"]) else {}
            
            m_by_key = {}
            special_by_key = {}
            for eff in m_effects:
                ename = eff.get("name")
                stage = eff.get("stage")
                if ename in NAME_TO_BUFF_KEY:
                    bkey = NAME_TO_BUFF_KEY[ename]
                    m_by_key[bkey] = m_by_key.get(bkey, 0) + (stage if stage is not None else 0)
                elif ename in SPECIAL_EFFECTS:
                    skey = SPECIAL_EFFECTS[ename]
                    special_by_key[skey] = stage
                    special_records.append({
                        "beat": beat,
                        "lane": lane_num,
                        "name": ename,
                        "type": skey,
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
                
                is_match = (m_val == s_val)
                if is_match:
                    match_count += 1
                else:
                    discrepancy_count += 1
                    reason = classify_diff_reason(beat, lane_num, key, m_val, s_val, sim_beats, meas_tl, m_by_key, special_by_key)
                    diff_records.append({
                        "sample": "S2",
                        "beat": beat,
                        "lane": lane_num,
                        "key": key,
                        "measured_stage": m_val,
                        "sim_stage": s_val,
                        "diff": diff,
                        "note": reason
                    })
                    
    category_counts = {}
    for d in diff_records:
        cat = d["note"].split(":")[0]
        category_counts[cat] = category_counts.get(cat, 0) + 1
        
    summary = {
        "sample": "S2",
        "meas_path": meas_path,
        "sim_path": sim_path,
        "total_comparisons": total_comparisons,
        "match_count": match_count,
        "match_rate_pct": round((match_count / total_comparisons * 100), 2) if total_comparisons > 0 else 0,
        "discrepancy_count": discrepancy_count,
        "category_counts": category_counts,
        "special_effects_count": len(special_records),
    }
    
    return summary, diff_records, special_records

def main():
    sim_path = os.path.join(REPO_ROOT, "research/20_sample2_gap_analysis/sim_trace_full.json")
    v3_path = os.path.join(OUT_DIR_26, "measured_data_s2_v3.json")
    
    print("==================================================")
    print("           Auditing S2 with measured_data_v3       ")
    print("==================================================")
    summary, diffs, specials = audit_s2(v3_path, sim_path, max_beat=167)
    
    print(f"Total Comparisons: {summary['total_comparisons']}")
    print(f"Match Count:       {summary['match_count']} ({summary['match_rate_pct']}%)")
    print(f"Discrepancies:     {summary['discrepancy_count']}")
    print("Category Breakdown:")
    for cat, cnt in sorted(summary["category_counts"].items(), key=lambda x: -x[1]):
        print(f"  {cat}: {cnt}")
    print(f"Special Effects:   {summary['special_effects_count']}")
    
    # JSON / CSV 出力
    out_json = os.path.join(OUT_DIR_26, "diff_s2_v3.json")
    with open(out_json, "w", encoding="utf-8") as f:
        json.dump({
            "sample": "S2",
            "summary": summary,
            "diffs": diffs,
            "special_effects": specials
        }, f, indent=2, ensure_ascii=False)
    print(f"\nSaved diff_s2_v3.json to {out_json}")
    
    out_csv = os.path.join(OUT_DIR_26, "diff_s2_v3.csv")
    with open(out_csv, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["sample", "beat", "lane", "key", "measured_stage", "sim_stage", "diff", "note"])
        writer.writeheader()
        writer.writerows(diffs)
    print(f"Saved diff_s2_v3.csv to {out_csv}")

if __name__ == "__main__":
    main()
