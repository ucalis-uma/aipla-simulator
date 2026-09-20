import json

with open("スコア分析サンプル/verification_data_v2.json", "r", encoding="utf-8") as f:
    deck = json.load(f)

for ch in deck["characters"]:
    print(f"Lane {ch['lane']}: {ch['idol_name']} ({ch['card_name']})")
    for sk in ch.get("skills", []):
        print(f"  Skill {sk.get('slot')}: {sk.get('name')} (type {sk.get('type')}, CT {sk.get('ct')})")
    for ph in ch.get("photos", []):
        if ph.get("skill"):
            print(f"  Photo skill: {ph.get('skill')}")
