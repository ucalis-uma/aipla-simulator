import json
import sys
sys.stdout.reconfigure(encoding='utf-8')
with open('research/26_data_integrity/skills_audit_raw.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

for item in data:
    if not item['is_photo']:
        print(f"\n=== {item['id']} ({item['name']}) [Lane {item['lane']}, Lv {item['level']}] ===")
        if item['discrepancies']:
            print('  Discrepancies:', item['discrepancies'])
        if item['has_suspicious_confidence']:
            print('  Suspicious:')
            for c in item['confidence_texts']:
                print('    *', c)
        vinfo = item['vendor_level_info']
        if vinfo:
            print('  Vendor desc:', repr(vinfo.get('description')))
            print('  Vendor details:', len(vinfo.get('skillDetails', [])))
            for d in vinfo.get('skillDetails', []):
                print(f"    - effId={d['efficacyId']}, trig={d['triggerId']}, effType={d['efficacyType']}({d['efficacyTypeName']}), gr={d['grade']}, dur={d['duration']}")
        print('  Golden effects:', len(item['golden_effects']))
        for g in item['golden_effects']:
            print(f"    - type={g.get('type')}, stages={g.get('stages')}, power={g.get('powerPermil')}, dur={g.get('durationBeats')}, target={g.get('target')}, cond={g.get('condition')}")
