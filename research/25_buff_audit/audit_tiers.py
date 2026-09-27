"""Phase 15-2 / 15-3: バフ監査の一致率 tier 分類（display_spec_rules.json と対で運用）。

strict   : 段数の完全一致のみ（旧来定義・後方互換のため match_rate_pct に保持）
adjusted : strict の不一致から「表示仕様・段数の単位系・撮影/sim 位相」で説明できるセルを一致に寄せる
residual : adjusted でも説明がつかないセル（= 真の不一致）。Phase 16 で 0 にする対象

黙示 skip 禁止（PLAN.md §16）: どの tier にも入らない不一致は UNCLASSIFIED として residual に残す。
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
RULES_PATH = os.path.join(HERE, "display_spec_rules.json")

TIERS = ("explained_unit", "explained_display_spec", "explained_display_phase", "residual")


def build_rules():
    """rules JSON を読み、(rules, tag→(rule_id, tier), flag_keys) を返す。"""
    with open(RULES_PATH, "r", encoding="utf-8") as f:
        rules = json.load(f)
    tag2 = {}
    for rule in rules["rules"]:
        for tag in rule.get("tags", []):
            tag2[tag] = (rule["id"], rule["tier"])
    return rules, tag2, set(rules.get("flag_keys", []))


def note_tag(note):
    """diff の note 文字列（"TAG: 説明"）から TAG を取り出す。"""
    return (note or "").split(":", 1)[0].strip() or "UNCLASSIFIED"


def classify(key, note, flag_keys, tag2tier):
    """不一致 1 セルを (rule_id, tier) に分類する。"""
    if key in flag_keys:
        return "FLAG_PRESENCE", "explained_unit"
    return tag2tier.get(note_tag(note), ("UNCLASSIFIED", "residual"))


def empty_counters():
    return {t: 0 for t in TIERS}


def finalize(total_comparisons, match_count, discrepancy_count, explained, rule_counts, residual_extra=0):
    """strict / adjusted / residual の 3 値と内訳をまとめて返す（両監査スクリプト共通の出力形）。"""
    explained_count = sum(explained.values())
    adjusted_match = match_count + explained_count
    residual = discrepancy_count - explained_count + residual_extra
    return {
        "total_comparisons": total_comparisons,
        # --- strict（旧来定義: 変更しない） ---
        "strict_match_count": match_count,
        "strict_match_rate_pct": round(match_count / total_comparisons * 100, 2) if total_comparisons else None,
        "strict_mismatch_count": discrepancy_count,
        # --- adjusted（Phase 15-2/15-3 で確定した主指標） ---
        "adjusted_match_count": adjusted_match,
        "adjusted_match_rate_pct": round(adjusted_match / total_comparisons * 100, 2) if total_comparisons else None,
        "explained_match_count": explained_count,
        "explained_tier_counts": dict(explained),
        "rule_hit_counts": dict(sorted(rule_counts.items(), key=lambda kv: -kv[1])),
        # --- residual（真の不一致・Phase 16 の削減対象） ---
        "residual_mismatch_count": residual,
        "residual_rate_pct": round(residual / total_comparisons * 100, 2) if total_comparisons else None,
        "rules_file": os.path.relpath(RULES_PATH, os.path.join(HERE, "..", "..")).replace("\\", "/"),
        "rules_version": json.load(open(RULES_PATH, "r", encoding="utf-8"))["version"],
    }
