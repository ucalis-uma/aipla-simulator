import json
import os
import sys

sys.stdout.reconfigure(encoding='utf-8')

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Load files
with open(os.path.join(root, "data", "skills_golden.json"), "r", encoding="utf-8") as f:
    golden = json.load(f)

with open(os.path.join(root, "vendor", "Skill.json"), "r", encoding="utf-8") as f:
    vendor_skills = {s["id"]: s for s in json.load(f)}

with open(os.path.join(root, "vendor", "SkillEfficacy.json"), "r", encoding="utf-8") as f:
    vendor_effs = {e["id"]: e for e in json.load(f)}

master_skills = {}
master_skills_path = os.path.join(root, "data", "skills_master.json")
if os.path.exists(master_skills_path):
    with open(master_skills_path, "r", encoding="utf-8") as f:
        master_skills = json.load(f)

levels_data = {}
levels_path = os.path.join(root, "data", "skills_levels.json")
if os.path.exists(levels_path):
    with open(levels_path, "r", encoding="utf-8") as f:
        levels_data = json.load(f)

print(f"=== COMPREHENSIVE SKILL AUDIT ===")

for skill in golden.get("skills", []):
    s_id = skill.get("id")
    s_name = skill.get("name")
    s_level = skill.get("level", 6)
    s_lane = skill.get("lane")
    s_kind = skill.get("kind")
    
    print(f"\n------------------------------------------------------------")
    print(f"Skill: {s_id} ({s_name}) | Lane {s_lane} | Kind {s_kind} | Lv {s_level}")
    
    if s_id.startswith("sk-"):
        # Card skill
        v_skill = vendor_skills.get(s_id)
        if not v_skill:
            print(f"  [ERROR] Not found in vendor/Skill.json!")
            continue
            
        # find target level
        v_lvl = None
        for lvl in v_skill.get("levels", []):
            if lvl.get("level") == s_level:
                v_lvl = lvl
                break
        if not v_lvl:
            print(f"  [WARN] Level {s_level} not found in vendor! Available: {[lvl.get('level') for lvl in v_skill.get('levels', [])]}")
            v_lvl = v_skill.get("levels", [])[-1]
            
        print(f"  Vendor Desc: {repr(v_lvl.get('description'))}")
        print(f"  Vendor Trigger: {v_lvl.get('triggerId')}, CT: {v_lvl.get('coolTime')}, Stamina: {v_lvl.get('stamina')}")
        
        # Compare effects
        golden_effs = skill.get("effects", [])
        vendor_details = v_lvl.get("skillDetails", [])
        
        print(f"  Golden effects count: {len(golden_effs)}")
        for idx, ge in enumerate(golden_effs):
            print(f"    G[{idx}]: type={ge.get('type')}, stages={ge.get('stages')}, power={ge.get('powerPermil')}, dur={ge.get('durationBeats')}, target={ge.get('target')}, cond={ge.get('condition')}, conf={ge.get('confidence')}")
            
        print(f"  Vendor details count: {len(vendor_details)}")
        for idx, vd in enumerate(vendor_details):
            eff_id = vd.get("efficacyId")
            eff_obj = vendor_effs.get(eff_id, {})
            print(f"    V[{idx}]: effId={eff_id}, trig={vd.get('triggerId')}, effType={eff_obj.get('efficacyType')}, grade={eff_obj.get('grade')}, dur={eff_obj.get('duration')}, target={eff_obj.get('skillTarget')}")
            
        # Check master definition if available
        if s_id in master_skills:
            ms = master_skills[s_id]
            print(f"  Master effects count: {len(ms.get('effects', []))}")
            for idx, me in enumerate(ms.get('effects', [])):
                print(f"    M[{idx}]: type={me.get('type')}, stages={me.get('stages')}, power={me.get('powerPermil')}, dur={me.get('durationBeats')}, target={me.get('target')}, cond={me.get('condition')}")

    elif s_id.startswith("photo-"):
        # Photo skill
        print(f"  Photo skill: {skill.get('optionSkill')} | ct={skill.get('ct')}, st={skill.get('staminaCost')}")
        golden_effs = skill.get("effects", [])
        for idx, ge in enumerate(golden_effs):
            print(f"    P[{idx}]: type={ge.get('type')}, stages={ge.get('stages')}, power={ge.get('powerPermil')}, dur={ge.get('durationBeats')}, target={ge.get('target')}, cond={ge.get('condition')}, conf={ge.get('confidence')}")
