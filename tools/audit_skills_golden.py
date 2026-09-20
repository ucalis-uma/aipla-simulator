import json
import os
import re

def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    
    # 1. Load data/skills_golden.json
    golden_path = os.path.join(root, "data", "skills_golden.json")
    with open(golden_path, "r", encoding="utf-8") as f:
        golden = json.load(f)
        
    # 2. Load vendor/Skill.json
    skill_vendor_path = os.path.join(root, "vendor", "Skill.json")
    with open(skill_vendor_path, "r", encoding="utf-8") as f:
        vendor_skills = json.load(f)
    vendor_skill_map = {s["id"]: s for s in vendor_skills}
    
    # 3. Load vendor/SkillEfficacy.json
    eff_path = os.path.join(root, "vendor", "SkillEfficacy.json")
    with open(eff_path, "r", encoding="utf-8") as f:
        vendor_effs = json.load(f)
    eff_map = {e["id"]: e for e in vendor_effs}

    # 4. Load vendor/SkillEfficacyType.json if exists
    eff_type_path = os.path.join(root, "vendor", "SkillEfficacyType.json")
    eff_types = {}
    if os.path.exists(eff_type_path):
        with open(eff_type_path, "r", encoding="utf-8") as f:
            eff_types = {t["id"]: t["name"] for t in json.load(f)}

    # 5. Load data/skills_master.json
    master_skills_path = os.path.join(root, "data", "skills_master.json")
    master_skills = {}
    if os.path.exists(master_skills_path):
        with open(master_skills_path, "r", encoding="utf-8") as f:
            master_skills = json.load(f)

    # 6. Load data/skills_levels.json
    levels_path = os.path.join(root, "data", "skills_levels.json")
    levels_data = {}
    if os.path.exists(levels_path):
        with open(levels_path, "r", encoding="utf-8") as f:
            levels_data = json.load(f)

    print(f"Total skills in skills_golden.json: {len(golden.get('skills', []))}")

    audit_results = []
    
    for s in golden.get("skills", []):
        s_id = s.get("id")
        s_name = s.get("name")
        s_lane = s.get("lane")
        s_level = s.get("level", 6)
        s_kind = s.get("kind")
        s_effects = s.get("effects", [])
        
        # Check confidence note for suspicious words
        has_suspicious_confidence = False
        confidence_texts = []
        for eff in s_effects:
            conf = eff.get("confidence", "")
            if conf:
                confidence_texts.append(conf)
                if any(w in conf for w in ["フィット", "修正", "T5", "要求", "矛盾", "仮", "推定", "合わせ", "クランプ"]):
                    has_suspicious_confidence = True

        is_photo = s_id.startswith("photo-")
        v_skill = vendor_skill_map.get(s_id)
        
        item_audit = {
            "id": s_id,
            "name": s_name,
            "lane": s_lane,
            "level": s_level,
            "kind": s_kind,
            "is_photo": is_photo,
            "has_suspicious_confidence": has_suspicious_confidence,
            "confidence_texts": confidence_texts,
            "vendor_found": v_skill is not None,
            "discrepancies": [],
            "golden_effects": s_effects,
            "vendor_level_info": None
        }

        if v_skill:
            # Find level in vendor
            v_levels = v_skill.get("levels", [])
            target_v_lvl = None
            for lvl in v_levels:
                if lvl.get("level") == s_level:
                    target_v_lvl = lvl
                    break
            
            if not target_v_lvl and v_levels:
                target_v_lvl = v_levels[-1] # fallback to highest

            if target_v_lvl:
                item_audit["vendor_level_info"] = {
                    "level": target_v_lvl.get("level"),
                    "description": target_v_lvl.get("description"),
                    "triggerId": target_v_lvl.get("triggerId"),
                    "coolTime": target_v_lvl.get("coolTime"),
                    "stamina": target_v_lvl.get("stamina"),
                    "skillDetails": []
                }
                
                # Check CT
                if s.get("ct") != target_v_lvl.get("coolTime"):
                    item_audit["discrepancies"].append(f"CT mismatch: golden={s.get('ct')} vs vendor={target_v_lvl.get('coolTime')}")
                
                # Check stamina
                if s.get("staminaCost") != target_v_lvl.get("stamina"):
                    item_audit["discrepancies"].append(f"Stamina mismatch: golden={s.get('staminaCost')} vs vendor={target_v_lvl.get('stamina')}")

                # Check details
                for dt in target_v_lvl.get("skillDetails", []):
                    e_id = dt.get("efficacyId")
                    eff_obj = eff_map.get(e_id, {})
                    eff_type_id = eff_obj.get("efficacyType")
                    eff_type_name = eff_types.get(eff_type_id, str(eff_type_id))
                    item_audit["vendor_level_info"]["skillDetails"].append({
                        "efficacyId": e_id,
                        "triggerId": dt.get("triggerId"),
                        "efficacyType": eff_type_id,
                        "efficacyTypeName": eff_type_name,
                        "grade": eff_obj.get("grade"),
                        "duration": eff_obj.get("duration"),
                        "skillTarget": eff_obj.get("skillTarget")
                    })
        
        audit_results.append(item_audit)

    # Output detailed report
    out_dir = os.path.join(root, "research", "26_data_integrity")
    os.makedirs(out_dir, exist_ok=True)
    out_json = os.path.join(out_dir, "skills_audit_raw.json")
    with open(out_json, "w", encoding="utf-8") as f:
        json.dump(audit_results, f, ensure_ascii=False, indent=2)

    print(f"Audit raw output written to {out_json}")

if __name__ == "__main__":
    main()
