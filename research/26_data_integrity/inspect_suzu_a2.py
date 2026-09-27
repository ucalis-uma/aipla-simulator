import json, sys
sys.stdout.reconfigure(encoding='utf-8')
lv = json.load(open('data/skills_levels.json', encoding='utf-8'))
skills = lv['skills']
print('skills type:', type(skills), 'len:', len(skills))
if isinstance(skills, dict):
    print('sample keys:', list(skills.keys())[:5])
    entry = skills.get('sk-ski-05-waso-00-2')
else:
    entry = next((s for s in skills if isinstance(s, dict) and s.get('id') == 'sk-ski-05-waso-00-2'), None)
print(json.dumps(entry, ensure_ascii=False, indent=1) if entry else 'NOT FOUND in skills_levels')
mas = json.load(open('data/skills_master.json', encoding='utf-8'))
print('skills_master top keys:', list(mas.keys()))
card = mas.get('byCard', {}).get('card-ski-05-waso-00')
print(json.dumps(card, ensure_ascii=False, indent=1)[:3500] if card else 'NOT FOUND')
