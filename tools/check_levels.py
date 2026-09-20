import json
import sys

sys.stdout.reconfigure(encoding='utf-8')

with open('vendor/Skill.json', 'r', encoding='utf-8') as f:
    skills = {s['id']: s for s in json.load(f)}

for sid in ['sk-yu-05-birt-02-3', 'sk-ski-05-onep-00-3', 'sk-ski-05-waso-00-3']:
    s = skills[sid]
    print(f"=== {sid} ({s['name']}) ===")
    for lvl in s['levels']:
        print(f"  Lv {lvl['level']}: {repr(lvl['description'])}")
