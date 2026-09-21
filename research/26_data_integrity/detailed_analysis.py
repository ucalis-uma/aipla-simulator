"""
research/26_data_integrity/detailed_analysis.py

S1, S2, S3 の残差とバフ推移の詳細分析スクリプト。
"""

import json
import os
from collections import Counter

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT_DIR = os.path.join(REPO_ROOT, "research", "26_data_integrity")

def analyze_s1():
    print("================ S1 DETAILED ANALYSIS ================")
    d1 = json.load(open(os.path.join(OUT_DIR, "diff_s1_v2.json"), "r", encoding="utf-8"))
    diffs = d1["diffs"]
    
    # 1. Decay timing lags
    decay_lags = [d for d in diffs if "DECAY_TIMING_LAG" in d["note"]]
    print(f"S1 DECAY_TIMING_LAG: {len(decay_lags)} items")
    for d in decay_lags:
        print(f"  b{d['beat']} L{d['lane']} {d['key']}: meas={d['measured_stage']}, sim={d['sim_stage']}")

    # 2. Key beats check: b66, b67, b68 (Chisa beam L5 combo_score_up)
    sim1 = json.load(open(os.path.join(REPO_ROOT, "research/17_sample1_gap_analysis/sim_trace_full.json"), "r", encoding="utf-8"))
    meas1 = json.load(open(os.path.join(REPO_ROOT, "../aipura_nox/サンプル1/measured_data.json"), "r", encoding="utf-8"))
    
    print("\nS1 Chisa Beam L5 combo_score_up around b66-b68:")
    for b in [65, 66, 67, 68]:
        sb = next((x for x in sim1["beats"] if x["beat"] == b), None)
        mb = next((x for x in meas1["timeline"] if x["beat"] == b), None)
        s_csu = sb["buffSnapshots"][4].get("combo_score_up", 0) if sb else None
        m_effs = mb["lanes"]["5"]["effects"] if mb and "5" in mb["lanes"] else []
        m_csu = next((e["stage"] for e in m_effs if e["name"] == "コンボスコア上昇"), 0)
        print(f"  b{b}: Meas={m_csu}, Sim={s_csu} -> {'MATCH' if m_csu == s_csu else 'DIFF'}")

    print("\nS1 b130-b133 L3 combo_score_up transition:")
    for b in [130, 131, 132, 133]:
        sb = next((x for x in sim1["beats"] if x["beat"] == b), None)
        mb = next((x for x in meas1["timeline"] if x["beat"] == b), None)
        s_csu = sb["buffSnapshots"][2].get("combo_score_up", 0) if sb else None
        m_effs = mb["lanes"]["3"]["effects"] if mb and "3" in mb["lanes"] else []
        m_csu = next((e["stage"] for e in m_effs if e["name"] == "コンボスコア上昇"), 0)
        print(f"  b{b}: Meas={m_csu}, Sim={s_csu} -> {'MATCH' if m_csu == s_csu else 'DIFF'}")

    # 3. Stage mismatches
    stage_mismatches = [d for d in diffs if "BUFF_STAGE_MISMATCH" in d["note"]]
    print(f"\nS1 BUFF_STAGE_MISMATCH: {len(stage_mismatches)} items")
    for d in stage_mismatches:
        print(f"  b{d['beat']} L{d['lane']} {d['key']}: meas={d['measured_stage']}, sim={d['sim_stage']}")

def analyze_s3():
    print("\n================ S3 DETAILED ANALYSIS ================")
    d3 = json.load(open(os.path.join(OUT_DIR, "diff_s3_v2.json"), "r", encoding="utf-8"))
    diffs = d3["diffs"]
    
    # Category summary
    cats = Counter(d["note"].split(":")[0] for d in diffs)
    print("S3 Diff Categories:", dict(cats))

    # 1. Decay timing lags by key & lane
    decay_lags = [d for d in diffs if "DECAY_TIMING_LAG" in d["note"]]
    print(f"\nS3 DECAY_TIMING_LAG: {len(decay_lags)} items")
    decay_by_key = Counter(d["key"] for d in decay_lags)
    print("  Decay lag by key:", dict(decay_by_key))
    decay_by_lane = Counter(d["lane"] for d in decay_lags)
    print("  Decay lag by lane:", dict(decay_by_lane))
    
    print("\n  Sample Decay lags:")
    for d in decay_lags[:15]:
        print(f"    b{d['beat']} L{d['lane']} {d['key']}: meas={d['measured_stage']}, sim={d['sim_stage']}")

    # 2. Extreme display vs effective
    extremes = [d for d in diffs if "EXTREME_DISPLAY_VS_EFFECTIVE" in d["note"]]
    print(f"\nS3 EXTREME_DISPLAY_VS_EFFECTIVE: {len(extremes)} items")
    extreme_by_key = Counter(d["key"] for d in extremes)
    print("  Extreme display diff by key:", dict(extreme_by_key))
    for d in extremes[:5]:
        print(f"    b{d['beat']} L{d['lane']} {d['key']}: meas={d['measured_stage']}, sim={d['sim_stage']}")

    # 3. Amplify or overlap
    amplifies = [d for d in diffs if "AMPLIFY_OR_OVERLAP_ON_BEAT" in d["note"]]
    print(f"\nS3 AMPLIFY_OR_OVERLAP_ON_BEAT: {len(amplifies)} items")
    for d in amplifies:
        print(f"    b{d['beat']} L{d['lane']} {d['key']}: meas={d['measured_stage']}, sim={d['sim_stage']} ({d['note'][:60]}...)")

    # 4. Stage mismatch
    mismatches = [d for d in diffs if "BUFF_STAGE_MISMATCH" in d["note"]]
    print(f"\nS3 BUFF_STAGE_MISMATCH: {len(mismatches)} items")
    for d in mismatches:
        print(f"    b{d['beat']} L{d['lane']} {d['key']}: meas={d['measured_stage']}, sim={d['sim_stage']}")

    # 5. Key beat transitions in S3
    sim3 = json.load(open(os.path.join(REPO_ROOT, "research/21_sample3_gap_analysis/sim_trace_full.json"), "r", encoding="utf-8"))
    meas3 = json.load(open(os.path.join(REPO_ROOT, "../aipura_nox/サンプル3/measured_data_v2.json"), "r", encoding="utf-8"))
    
    print("\nS3 L4 Visual Buffs (visual_up, visual_up_extreme, critical_coeff_up) around b14-b17:")
    for b in range(14, 18):
        sb = next((x for x in sim3["beats"] if x["beat"] == b), None)
        mb = next((x for x in meas3["timeline"] if x["beat"] == b), None)
        s_snap = sb["buffSnapshots"][3] if sb else {}
        m_effs = mb["lanes"]["4"]["effects"] if mb and "4" in mb["lanes"] else []
        print(f"  b{b}:")
        print(f"    Sim:  vu={s_snap.get('visual_up', 0)}, vue={s_snap.get('visual_up_extreme', 0)}, ccu={s_snap.get('critical_coeff_up', 0)}")
        print(f"    Meas: {[(e['name'], e['stage']) for e in m_effs]}")

def main():
    analyze_s1()
    analyze_s3()

if __name__ == "__main__":
    main()
