import json
import os
import sys

sys.stdout.reconfigure(encoding='utf-8')

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
raw_path = os.path.join(root, "research", "26_data_integrity", "skills_audit_raw.json")
with open(raw_path, "r", encoding="utf-8") as f:
    data = json.load(f)

print(f"Total skills audited: {len(data)}")
for item in data:
    suspicious = []
    for c in item['confidence_texts']:
        if any(w in c for w in ["フィット", "修正", "T5", "要求", "矛盾", "仮", "推定", "合わせ", "クランプ"]):
            suspicious.append(c)
            
    if suspicious or item['discrepancies'] or item['is_photo']:
        print(f"\n=== {item['id']} ({item['name']}) [Lane {item['lane']}, Lv {item['level']}] ===")
        if item['discrepancies']:
            print("  Discrepancies:", item['discrepancies'])
        if suspicious:
            print("  Suspicious notes:")
            for s in suspicious:
                print("   *", s)
        if item['is_photo']:
            print("  [Photo Skill] effects:")
            for eff in item['golden_effects']:
                print(f"    - type={eff.get('type')}, stages={eff.get('stages')}, powerPermil={eff.get('powerPermil')}, dur={eff.get('durationBeats')}, conf={eff.get('confidence')}")
        if item['vendor_level_info']:
            vinfo = item['vendor_level_info']
            print("  Vendor text:", vinfo.get('description'))
            print("  Vendor details:", vinfo.get('skillDetails'))
