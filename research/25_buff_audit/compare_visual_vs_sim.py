import json

with open("research/25_buff_audit/t5_sim_trace_full.json", "r", encoding="utf-8") as f:
    sim = json.load(f)

# Visual verified golden data from research/14_visual_verified_golden_data.md (Beat 6, Beat 38, Beat 68, Beat 103)
# Note: sim snapshots are PRE-activation (step 8 start).
# For steady beats without activation (e.g. b6, b20, b38, b68, b103):
checks = [
    {
        "beat": 6,
        "label": "b6 (通常ビート)",
        "visual": {
            "combo_score_up": 8, "score_up": 13, "a_skill_score_up": 9,
            "tension_up": 5, "vocal_boost": 9, "focus": 10, "vocal_up": 9,
            "vocal_up_extreme": 10 # in-game UI shows 10
        }
    },
    {
        "beat": 20,
        "label": "b20 (通常ビート・Crit)",
        "visual": {
            "combo_score_up": 8, "score_up": 13, "a_skill_score_up": 9,
            "tension_up": 5, "vocal_boost": 9, "focus": 10, "vocal_up": 9,
            "vocal_up_extreme": 10
        }
    },
    {
        "beat": 38,
        "label": "b38 (通常ビート)",
        "visual": {
            "combo_score_up": 11, "score_up": 16, "a_skill_score_up": 12,
            "tension_up": 8, "vocal_boost": 12, "focus": 10, "vocal_up": 12,
            "vocal_up_extreme": 10, "stamina_cost_down": 11, "critical_rate_up": 9
        }
    },
    {
        "beat": 68,
        "label": "b68 (通常ビート・Vo上限到達)",
        "visual": {
            "combo_score_up": 19, "score_up": 20, "a_skill_score_up": 20,
            "tension_up": 13, "vocal_boost": 20, "focus": 10, "vocal_up": 20,
            "vocal_up_extreme": 10, "critical_coeff_up": 16, "critical_rate_up": 11,
            "stamina_cost_down": 13, "skill_success_up": 4
        }
    },
    {
        "beat": 103,
        "label": "b103 (SP発動時)",
        "visual": {
            "combo_score_up": 26, "score_up": 20, "a_skill_score_up": 20,
            "tension_up": 15, "vocal_boost": 20, "focus": 10, "vocal_up": 20,
            "vocal_up_extreme": 10, "critical_coeff_up": 30, "critical_rate_up": 20,
            "stamina_cost_down": 20, "skill_success_up": 7
        }
    }
]

for c in checks:
    b_num = c["beat"]
    b_sim = next((x for x in sim["beats"] if x["beat"] == b_num), None)
    snap = b_sim["buffSnapshots"][2] if b_sim else {}
    print(f"\n==================== {c['label']} ====================")
    for k, v_vis in c["visual"].items():
        v_sim = snap.get(k, 0)
        # Handle extreme display vs effective (UI 10 vs sim 5)
        note = ""
        if k.endswith("_extreme"):
            note = f" (UI={v_vis} vs effective={v_sim})"
            match = (v_vis == 10 and v_sim == 5)
        else:
            match = (v_vis == v_sim)
        status = "MATCH" if match else "MISMATCH"
        print(f"  {k:20s}: Visual={v_vis:2d} | Sim={v_sim:2d} -> {status}{note}")
