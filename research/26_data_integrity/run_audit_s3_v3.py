"""
research/26_data_integrity/run_audit_s3_v3.py

Sample 3 (S3) において、スクロール画像（_2.PNG）のバフ統合を行った
measured_data_v3.json と最新 Sim トレースを突合し、
measured_data_v2.json との差分・改善効果を精密検証するスクリプト。

実行: python research/26_data_integrity/run_audit_s3_v3.py
"""

import json
import os
import csv
import sys

sys.stdout.reconfigure(encoding='utf-8')

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
    "ビジュアル上昇上限開放": "visual_limit",
    "スタミナ継続回復": "stamina_continuous_recovery",
}

def classify_diff_reason(sample_name, beat, lane, key, m_val, s_val, sim_beats, meas_tl):
    sb = sim_beats.get(beat, {})
    curr_acts = sb.get("activations", [])
    
    # Extreme display vs effective stages (vocal_up_extreme, visual_up_extreme: display=10, effective=+5)
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

    # Activation beat phase lag (POST in measured vs PRE in sim)
    next_s = sim_beats.get(beat + 1, {}).get("buffSnapshots", [{} for _ in range(5)])[lane - 1].get(key, 0) if beat + 1 in sim_beats else None
    prev_s = sim_beats.get(beat - 1, {}).get("buffSnapshots", [{} for _ in range(5)])[lane - 1].get(key, 0) if beat - 1 in sim_beats else None
    
    if m_val > s_val:
        if curr_acts or (next_s is not None and next_s == m_val):
            return f"PHASE_LAG_ACTIVATION: Activated on b{beat} (acts={[a.get('skillId') for a in curr_acts]}); measured reflects immediately (POST), sim reflects next beat (PRE)"

    # Decay timing difference
    if m_val == 0 and s_val > 0:
        if prev_s is not None and prev_s > 0:
            return "DECAY_TIMING_LAG: Buff expired in measured 1-2 beats earlier than sim"

    if m_val > 0 and s_val == 0:
        if prev_s is not None and prev_s > 0:
            return "DECAY_TIMING_LAG: Buff expired in sim earlier than measured"

    # Amplification or overlap difference
    if curr_acts:
        return f"AMPLIFY_OR_OVERLAP_ON_BEAT: Activation on b{beat} ({[a.get('skillId') for a in curr_acts]}); measured stage {m_val} vs sim stage {s_val}"

    return f"BUFF_STAGE_MISMATCH: Measured {m_val} vs Sim {s_val} (diff={s_val - m_val})"

def audit_data(meas_data, sim_data, max_beat=169):
    meas_tl = {b["beat"]: b for b in meas_data.get("timeline", [])} if meas_data else {}
    sim_beats = {b["beat"]: b for b in sim_data.get("beats", [])} if sim_data else {}
    
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
            
            m_effects = []
            if mb and "lanes" in mb:
                lanes = mb["lanes"]
                if isinstance(lanes, dict):
                    m_effects = lanes.get(lane_str, {}).get("effects", [])
                elif isinstance(lanes, list) and lane_idx < len(lanes):
                    m_effects = lanes[lane_idx].get("effects", [])
            
            s_snap = sb["buffSnapshots"][lane_idx] if sb and "buffSnapshots" in sb and lane_idx < len(sb["buffSnapshots"]) else {}
            
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
            
            keys_to_check = set(m_by_key.keys())
            for k, v in s_snap.items():
                if v > 0:
                    keys_to_check.add(k)
                    
            for key in sorted(keys_to_check):
                total_comparisons += 1
                m_val = m_by_key.get(key, 0)
                s_val = s_snap.get(key, 0)
                
                is_match = (m_val == s_val)
                if is_match:
                    match_count += 1
                else:
                    discrepancy_count += 1
                    reason = classify_diff_reason("S3", beat, lane_num, key, m_val, s_val, sim_beats, meas_tl)
                    diff_records.append({
                        "sample": "S3",
                        "beat": beat,
                        "lane": lane_num,
                        "key": key,
                        "measured_stage": m_val,
                        "sim_stage": s_val,
                        "diff": s_val - m_val,
                        "note": reason,
                    })
                    
    category_counts = {}
    for d in diff_records:
        cat = d["note"].split(":")[0]
        category_counts[cat] = category_counts.get(cat, 0) + 1
        
    summary = {
        "total_comparisons": total_comparisons,
        "match_count": match_count,
        "discrepancy_count": discrepancy_count,
        "match_rate_pct": round((match_count / total_comparisons * 100), 2) if total_comparisons > 0 else 0,
        "category_counts": category_counts
    }
    
    return summary, diff_records

def main():
    sim_path = os.path.join(REPO_ROOT, "research/21_sample3_gap_analysis/sim_trace_full.json")
    v2_path = os.path.join(REPO_ROOT, "../aipura_nox/サンプル3/measured_data_v2.json")
    v3_path = os.path.join(REPO_ROOT, "research/26_data_integrity/measured_data_s3_v3.json")
    
    sim_data = json.load(open(sim_path, "r", encoding="utf-8"))
    v2_data = json.load(open(v2_path, "r", encoding="utf-8"))
    v3_data = json.load(open(v3_path, "r", encoding="utf-8"))
    
    print("==================================================")
    print("           Auditing S3 with v2 (Before Merge)      ")
    print("==================================================")
    sum_v2, diffs_v2 = audit_data(v2_data, sim_data)
    print(f"Total: {sum_v2['total_comparisons']}, Match: {sum_v2['match_count']} ({sum_v2['match_rate_pct']}%), Discrepancy: {sum_v2['discrepancy_count']}")
    print("Categories:", json.dumps(sum_v2["category_counts"], indent=2, ensure_ascii=False))
    
    print("\n==================================================")
    print("           Auditing S3 with v3 (After Merge)       ")
    print("==================================================")
    sum_v3, diffs_v3 = audit_data(v3_data, sim_data)
    print(f"Total: {sum_v3['total_comparisons']}, Match: {sum_v3['match_count']} ({sum_v3['match_rate_pct']}%), Discrepancy: {sum_v3['discrepancy_count']}")
    print("Categories:", json.dumps(sum_v3["category_counts"], indent=2, ensure_ascii=False))
    
    # 差分出力
    out_diff_v3_json = os.path.join(OUT_DIR_26, "diff_s3_v3.json")
    with open(out_diff_v3_json, "w", encoding="utf-8") as f:
        json.dump({"sample": "S3_v3", "summary": sum_v3, "diffs": diffs_v3}, f, indent=2, ensure_ascii=False)
        
    out_diff_v3_csv = os.path.join(OUT_DIR_26, "diff_s3_v3.csv")
    with open(out_diff_v3_csv, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["sample", "beat", "lane", "key", "measured_stage", "sim_stage", "diff", "note"])
        writer.writeheader()
        writer.writerows(diffs_v3)
        
    # 解消された差分の分析
    # (beat, lane, key) をキーにしたセット
    diff_keys_v2 = {(d["beat"], d["lane"], d["key"]): d for d in diffs_v2}
    diff_keys_v3 = {(d["beat"], d["lane"], d["key"]): d for d in diffs_v3}
    
    resolved_keys = set(diff_keys_v2.keys()) - set(diff_keys_v3.keys())
    new_diff_keys = set(diff_keys_v3.keys()) - set(diff_keys_v2.keys())
    
    resolved_by_cat = {}
    for k in sorted(resolved_keys):
        d = diff_keys_v2[k]
        cat = d["note"].split(":")[0]
        resolved_by_cat[cat] = resolved_by_cat.get(cat, 0) + 1
        
    print(f"\n==================================================")
    print(f"               IMPROVEMENT SUMMARY                ")
    print(f"==================================================")
    print(f"Total Discrepancies Resolved: {len(resolved_keys)}")
    print("Resolved by Category:", json.dumps(resolved_by_cat, indent=2, ensure_ascii=False))
    if new_diff_keys:
        print(f"New Discrepancies Introduced: {len(new_diff_keys)}")
        for k in sorted(new_diff_keys):
            print(f"  {k}: {diff_keys_v3[k]}")
    else:
        print("New Discrepancies Introduced: 0 (No regressions!)")
        
    delta_report = {
        "v2": sum_v2,
        "v3": sum_v3,
        "delta": {
            "match_count": sum_v3["match_count"] - sum_v2["match_count"],
            "discrepancies": sum_v3["discrepancy_count"] - sum_v2["discrepancy_count"],
            "match_rate_pct": round(sum_v3["match_rate_pct"] - sum_v2["match_rate_pct"], 2),
            "resolved_count": len(resolved_keys),
            "resolved_by_category": resolved_by_cat,
        }
    }
    
    report_p = os.path.join(OUT_DIR_26, "s3_v3_improvement_report.json")
    with open(report_p, "w", encoding="utf-8") as f:
        json.dump(delta_report, f, indent=2, ensure_ascii=False)
    print(f"\nSaved improvement report to {report_p}")

if __name__ == "__main__":
    main()
