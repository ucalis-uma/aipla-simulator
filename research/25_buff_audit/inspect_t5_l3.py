import json

with open("research/25_buff_audit/diff_t5.json", "r", encoding="utf-8") as f:
    data = json.load(f)
diffs = data["diffs"]

print(f"Total diff records: {len(diffs)}")

l3_diffs = [d for d in diffs if d.get("lane") == 3]
print(f"Lane 3 diff records: {len(l3_diffs)}")

categories = {}
for d in l3_diffs:
    note = d.get("note", "")
    prefix = note.split(":")[0] if ":" in note else "OTHER"
    categories[prefix] = categories.get(prefix, 0) + 1

for cat, count in sorted(categories.items(), key=lambda x: -x[1]):
    print(f"  {cat}: {count}")

for cat in categories:
    examples = [d for d in l3_diffs if d.get("note", "").startswith(cat)][:3]
    print(f"\n=== Examples for {cat} ===")
    for ex in examples:
        print(f"  b{ex.get('beat')} {ex.get('key')}: meas={ex.get('measured_stage')} vs sim={ex.get('sim_stage')} (diff={ex.get('diff')})")
        print(f"    note: {ex.get('note')}")
