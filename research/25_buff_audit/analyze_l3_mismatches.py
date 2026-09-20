import json

with open("research/25_buff_audit/diff_t5.json", "r", encoding="utf-8") as f:
    data = json.load(f)
diffs = data["diffs"]

l3_mismatches = [d for d in diffs if d.get("lane") == 3 and d.get("note", "").startswith("BUFF_STAGE_MISMATCH")]
print(f"Total BUFF_STAGE_MISMATCH in Lane 3: {len(l3_mismatches)}")

# Group by key
by_key = {}
for d in l3_mismatches:
    k = d.get("key")
    by_key[k] = by_key.get(k, 0) + 1

for k, c in sorted(by_key.items(), key=lambda x: -x[1]):
    print(f"  {k}: {c} beats")

# Look at examples for top keys
for k in sorted(by_key.keys()):
    examples = [d for d in l3_mismatches if d.get("key") == k]
    print(f"\n--- Key: {k} (total {len(examples)} beats) ---")
    for ex in examples[:5]:
        print(f"  b{ex.get('beat')}: meas={ex.get('measured_stage')} vs sim={ex.get('sim_stage')} (diff={ex.get('diff')})")
    if len(examples) > 5:
        print(f"  ... and more up to b{examples[-1].get('beat')}")
