import json, sys
sys.stdout.reconfigure(encoding='utf-8')

plan = json.load(open('research/26_data_integrity/patch_plan_s3.json', 'r', encoding='utf-8'))
print(f'Total beats to patch: {len(plan)}')

total_added = 0
for k, v in plan.items():
    b = v['beat']
    lane = v['lane']
    adds = v['to_add']
    total_added += len(adds)
    adds_str = ', '.join([a['name'] + ' ' + str(a['stage']) + '段' for a in adds])
    print(f"Beat {b:03d} (Lane {lane}): +[{adds_str}] (existing: {v['existing_count']} -> {v['existing_count'] + len(adds)})")

print(f"Total buff instances to restore: {total_added}")
