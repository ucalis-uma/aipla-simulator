import json
import os
import sys

sys.stdout.reconfigure(encoding='utf-8')

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

with open(os.path.join(root, "data", "skills_golden.json"), "r", encoding="utf-8") as f:
    golden = json.load(f)

with open(os.path.join(root, "data", "skills_master.json"), "r", encoding="utf-8") as f:
    sm = json.load(f)

by_card = sm.get("byCard", {})
all_master_skills = {}
for card_id, skills in by_card.items():
    for s in skills:
        all_master_skills[s["id"]] = s

print("Auditing skills_golden.json vs skills_master.json...")

diff_list = []

for gs in golden.get("skills", []):
    s_id = gs["id"]
    if s_id.startswith("photo-"):
        # Check photo skills
        # Look for suspicious confidence or powerPermil
        for idx, eff in enumerate(gs.get("effects", [])):
            conf = eff.get("confidence", "")
            if any(w in conf for w in ["フィット", "修正", "T5", "要求", "矛盾", "仮", "推定", "合わせ", "クランプ"]):
                diff_list.append({
                    "id": s_id,
                    "name": gs.get("name"),
                    "type": "photo_fitting",
                    "effect_index": idx,
                    "effect": eff,
                    "note": conf
                })
        continue

    # Card skills
    ms = all_master_skills.get(s_id)
    if not ms:
        print(f"[WARN] Skill {s_id} not found in skills_master.json!")
        continue

    # Compare properties
    card_diffs = []
    if gs.get("ct") != ms.get("ct"):
        card_diffs.append(f"CT: golden={gs.get('ct')} vs master={ms.get('ct')}")
    # Note: gs level might differ from Lv6 if card is lower level (e.g., Lv5)
    # But let's check effects
    g_effs = gs.get("effects", [])
    m_effs = ms.get("effects", [])
    
    # Check each effect
    for i, ge in enumerate(g_effs):
        if i >= len(m_effs):
            card_diffs.append(f"Extra effect at index {i} in golden: {ge}")
            continue
        me = m_effs[i]
        
        # Check type
        if ge.get("type") != me.get("type"):
            card_diffs.append(f"Effect[{i}] type: golden={ge.get('type')} vs master={me.get('type')}")
        # Check target
        if ge.get("target") != me.get("target"):
            card_diffs.append(f"Effect[{i}] target: golden={ge.get('target')} vs master={me.get('target')}")
        # Check condition
        if ge.get("condition") != me.get("condition"):
            card_diffs.append(f"Effect[{i}] condition: golden={ge.get('condition')} vs master={me.get('condition')}")
        # Check stages / duration
        if ge.get("stages") != me.get("stages"):
            # Could be level difference or fitting
            card_diffs.append(f"Effect[{i}] stages: golden={ge.get('stages')} vs master={me.get('stages')}")
        if ge.get("durationBeats") != me.get("durationBeats"):
            card_diffs.append(f"Effect[{i}] durationBeats: golden={ge.get('durationBeats')} vs master={me.get('durationBeats')}")
            
    if card_diffs:
        diff_list.append({
            "id": s_id,
            "name": gs.get("name"),
            "type": "card_skill_diff",
            "diffs": card_diffs
        })

print(f"\nTotal differences found: {len(diff_list)}")
for d in diff_list:
    print(json.dumps(d, ensure_ascii=False, indent=2))
