"""
research/26_data_integrity/run_audit_post_decay.py

Phase 14 バフ減衰（Decay）モデル適正化後の S1, S2, S3 全件再突合スクリプト。
新シミュレーショントレースと実測データを突合し、差分理由の自動分類・旧モデルとの比較集計を行う。

実行: python research/26_data_integrity/run_audit_post_decay.py
"""

import json
import os
import csv
import sys

sys.stdout.reconfigure(encoding='utf-8')

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT_DIR_26 = os.path.join(REPO_ROOT, "research", "26_data_integrity")
OUT_DIR_25 = os.path.join(REPO_ROOT, "research", "25_buff_audit")
os.makedirs(OUT_DIR_26, exist_ok=True)
os.makedirs(OUT_DIR_25, exist_ok=True)

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

def classify_diff_reason(sample_name, beat, lane, key, m_val, s_val, sim_beats, meas_tl, special_by_key=None):
    sb = sim_beats.get(beat, {})
    curr_acts = sb.get("activations", [])
    special_by_key = special_by_key or {}
    
    # 1. Combo continue flag
    if key == "combo_continue":
        return "FLAG_NOT_STAGED: combo_continue is a boolean flag without stages (recorded as stage: null in measured)"

    # 2. Critical coeff extreme separate display vs effective addition (m=8, s=13, diff=5)
    if key == "critical_coeff_up":
        if "critical_coeff_limit" in special_by_key or s_val - m_val == 5:
            return "EXTREME_DISPLAY_VS_EFFECTIVE: In-game UI displays separate 'critical_coeff_extreme_10', while simulator models effective +5 stages on critical_coeff_up"

    # 3. Extreme display vs effective stages (vocal_up_extreme, visual_up_extreme: display=10, effective=+5)
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

    # 4. Persistent SP score buff on idol
    if key == "sp_skill_score_up":
        if m_val > 0 and s_val == 0:
            return "PERSISTENT_SP_BUFF: SP score buff remains on idol after SP note in measured, whereas simulator consumes it"

    # 5. Activation beat phase lag (POST in measured vs PRE in sim, or b1 activated buff displayed at b2)
    next_s = sim_beats.get(beat + 1, {}).get("buffSnapshots", [{} for _ in range(5)])[lane - 1].get(key, 0) if beat + 1 in sim_beats else None
    prev_s = sim_beats.get(beat - 1, {}).get("buffSnapshots", [{} for _ in range(5)])[lane - 1].get(key, 0) if beat - 1 in sim_beats else None
    
    if m_val > s_val:
        if curr_acts or (next_s is not None and next_s == m_val):
            return f"PHASE_LAG_ACTIVATION: Activated on b{beat} (acts={[a.get('skillId') for a in curr_acts]}); measured reflects immediately (POST), sim reflects next beat (PRE)"

    if beat == 1 and m_val == 0 and s_val > 0:
        next_m = 0
        mb_next = meas_tl.get(2, {})
        lanes_next = mb_next.get("lanes", {})
        l_obj = lanes_next.get(str(lane)) or lanes_next.get(f"lane{lane}", {})
        for eff in l_obj.get("effects", []):
            if NAME_TO_BUFF_KEY.get(eff.get("name")) == key:
                next_m += eff.get("stage", 0)
        if next_m == s_val:
            return f"PHASE_LAG_ACTIVATION: b1 skill activated; screenshot at b1 is PRE-display, in-game UI displays buff from b2"

    # 6. Decay timing difference
    if m_val == 0 and s_val > 0:
        if prev_s is not None and prev_s > 0:
            return "DECAY_TIMING_LAG: Buff expired in measured 1-2 beats earlier than sim"

    if m_val > 0 and s_val == 0:
        if prev_s is not None and prev_s > 0:
            return "DECAY_TIMING_LAG: Buff expired in sim earlier than measured"

    # 7. Amplification or overlap difference
    if curr_acts:
        return f"AMPLIFY_OR_OVERLAP_ON_BEAT: Activation on b{beat} ({[a.get('skillId') for a in curr_acts]}); measured stage {m_val} vs sim stage {s_val}"

    return f"BUFF_STAGE_MISMATCH: Measured {m_val} vs Sim {s_val} (diff={s_val - m_val})"

def audit_sample(sample_name, meas_path, sim_path, notes_count):
    print(f"\n=== Auditing {sample_name} (Post-Decay Model) ===")
    
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
            
            # Map measured effects
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
                    reason = classify_diff_reason(sample_name, beat, lane_num, key, m_val, s_val, sim_beats, meas_tl, special_by_key)
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

    # 集計内訳
    category_counts = {}
    for r in diff_records:
        cat = r["note"].split(":")[0]
        category_counts[cat] = category_counts.get(cat, 0) + 1

    summary = {
        "sample": sample_name,
        "meas_path": meas_path,
        "sim_path": sim_path,
        "meas_present": bool(meas_data),
        "meas_has_effects": any(len((b.get("lanes", {}).get("1") or b.get("lanes", {}).get("lane1", {})).get("effects", [])) > 0 for b in meas_tl.values()) if meas_tl else False,
        "sim_present": bool(sim_data),
        "max_beat": max_beat,
        "total_comparisons": total_comparisons,
        "match_count": match_count,
        "match_rate_pct": round((match_count / total_comparisons * 100), 2) if total_comparisons > 0 else 0,
        "discrepancy_count": discrepancy_count,
        "category_counts": category_counts,
        "special_effects_count": len(special_records),
    }
    
    # 26 および 25 の両方に書き出す
    for base_dir in [OUT_DIR_26, OUT_DIR_25]:
        csv_file = os.path.join(base_dir, f"diff_{sample_name.lower()}_v2.csv")
        with open(csv_file, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=["sample", "beat", "lane", "key", "measured_stage", "sim_stage", "diff", "note"])
            writer.writeheader()
            for r in diff_records:
                writer.writerow(r)
                
        json_file = os.path.join(base_dir, f"diff_{sample_name.lower()}_v2.json")
        with open(json_file, "w", encoding="utf-8") as f:
            json.dump({
                "summary": summary,
                "diffs": diff_records,
                "special_effects": special_records
            }, f, indent=2, ensure_ascii=False)
            
    print(f"  Total comparisons: {total_comparisons}")
    print(f"  Matches: {match_count} ({summary['match_rate_pct']}%)")
    print(f"  Discrepancies: {discrepancy_count}")
    print(f"  Category breakdown: {category_counts}")
    
    return summary, diff_records, special_records

def main():
    s1_sum, s1_diff, s1_spec = audit_sample(
        "S1",
        os.path.join(REPO_ROOT, "../aipura_nox/サンプル1/measured_data.json"),
        os.path.join(REPO_ROOT, "research/17_sample1_gap_analysis/sim_trace_full.json"),
        176
    )
    s2_sum, s2_diff, s2_spec = audit_sample(
        "S2",
        os.path.join(REPO_ROOT, "research/26_data_integrity/measured_data_s2_v3.json"),
        os.path.join(REPO_ROOT, "research/20_sample2_gap_analysis/sim_trace_full.json"),
        167
    )
    s3_sum, s3_diff, s3_spec = audit_sample(
        "S3",
        os.path.join(REPO_ROOT, "research/26_data_integrity/measured_data_s3_v3.json"),
        os.path.join(REPO_ROOT, "research/21_sample3_gap_analysis/sim_trace_full.json"),
        169
    )

    all_summaries = {
        "S1": s1_sum,
        "S2": s2_sum,
        "S3": s3_sum,
    }

    # 旧モデル（Phase 13時点）の audit_summary.json を読み込んで比較
    old_summary_path = os.path.join(OUT_DIR_25, "audit_summary.json")
    old_summaries = {}
    if os.path.exists(old_summary_path):
        old_summaries = json.load(open(old_summary_path, "r", encoding="utf-8"))

    # 旧モデルの diff_s1.json, diff_s3.json から旧カテゴリ集計
    old_cat_counts = {}
    for s_name in ["s1", "s2", "s3"]:
        old_diff_path = os.path.join(OUT_DIR_25, f"diff_{s_name}.json")
        if os.path.exists(old_diff_path):
            old_data = json.load(open(old_diff_path, "r", encoding="utf-8"))
            counts = {}
            for d in old_data.get("diffs", []):
                cat = d["note"].split(":")[0]
                counts[cat] = counts.get(cat, 0) + 1
            old_cat_counts[s_name.upper()] = counts

    comparison = {
        "timestamp": "2026-09-21",
        "description": "Comparison between Old Model (Phase 13-B) and New Model (Phase 14 Post-Decay Optimization)",
        "samples": {}
    }

    for s_name in ["S1", "S2", "S3"]:
        new_s = all_summaries[s_name]
        old_s = old_summaries.get(s_name, {})
        old_cats = old_cat_counts.get(s_name, {})
        new_cats = new_s["category_counts"]

        old_match_count = old_s.get("match_count", 0)
        old_total = old_s.get("total_comparisons", 0)
        old_rate = round((old_match_count / old_total * 100), 2) if old_total > 0 else 0

        comparison["samples"][s_name] = {
            "total_comparisons": {"old": old_total, "new": new_s["total_comparisons"]},
            "match_count": {"old": old_match_count, "new": new_s["match_count"], "delta": new_s["match_count"] - old_match_count},
            "match_rate_pct": {"old": old_rate, "new": new_s["match_rate_pct"], "delta": round(new_s["match_rate_pct"] - old_rate, 2)},
            "discrepancies": {"old": old_s.get("discrepancy_count", 0), "new": new_s["discrepancy_count"], "delta": new_s["discrepancy_count"] - old_s.get("discrepancy_count", 0)},
            "decay_timing_lag": {"old": old_cats.get("DECAY_TIMING_LAG", 0), "new": new_cats.get("DECAY_TIMING_LAG", 0), "delta": new_cats.get("DECAY_TIMING_LAG", 0) - old_cats.get("DECAY_TIMING_LAG", 0)},
            "phase_lag_activation": {"old": old_cats.get("PHASE_LAG_ACTIVATION", 0), "new": new_cats.get("PHASE_LAG_ACTIVATION", 0), "delta": new_cats.get("PHASE_LAG_ACTIVATION", 0) - old_cats.get("PHASE_LAG_ACTIVATION", 0)},
            "stage_mismatch": {"old": old_cats.get("BUFF_STAGE_MISMATCH", 0), "new": new_cats.get("BUFF_STAGE_MISMATCH", 0), "delta": new_cats.get("BUFF_STAGE_MISMATCH", 0) - old_cats.get("BUFF_STAGE_MISMATCH", 0)},
            "extreme_display": {"old": old_cats.get("EXTREME_DISPLAY_VS_EFFECTIVE", 0), "new": new_cats.get("EXTREME_DISPLAY_VS_EFFECTIVE", 0), "delta": new_cats.get("EXTREME_DISPLAY_VS_EFFECTIVE", 0) - old_cats.get("EXTREME_DISPLAY_VS_EFFECTIVE", 0)},
            "amplify_or_overlap": {"old": old_cats.get("AMPLIFY_OR_OVERLAP_ON_BEAT", 0), "new": new_cats.get("AMPLIFY_OR_OVERLAP_ON_BEAT", 0), "delta": new_cats.get("AMPLIFY_OR_OVERLAP_ON_BEAT", 0) - old_cats.get("AMPLIFY_OR_OVERLAP_ON_BEAT", 0)},
        }

    comp_file = os.path.join(OUT_DIR_26, "decay_improvement_comparison.json")
    with open(comp_file, "w", encoding="utf-8") as f:
        json.dump(comparison, f, indent=2, ensure_ascii=False)

    print("\n=== Model Improvement Summary ===")
    print(json.dumps(comparison, indent=2, ensure_ascii=False))

if __name__ == "__main__":
    main()
