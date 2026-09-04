// src/timeline/engine.ts の改修対象コード（抜粋・約150行）
// 目的: S4 の未習得FAIL / CT中FAIL / 強化譲渡 / 強化延長の実装箇所を特定する

import type {
  ActiveEffect,
  EffectType,
  LaneState,
  SkillDef,
  SkillEffect,
  ActivationTrace,
} from "./types.js";

// ============================================================================
// 1. スキルノーツ処理と FAIL 判定 (settleSkillNote)
// ============================================================================
// 現在の settleSkillNote (engine.ts 約1260行目周辺):
// ★課題:
//   ① candidates.length === 0 のとき: SP未所持サポーター配置 (b117)
//      → failReason: "no_skill", コンボ切断 (comboReset: true)
//   ② skill.ct != null かつ (state.skillCt.get(skill.id) ?? 0) > 0 のとき (b45)
//      → CT中判定でスキップ、候補が尽きたら failReason: "in_ct", コンボ切断
//   ③ MISS は加算しない（リザルト MISS=0 維持）

/*
function settleSkillNote(
  state: LaneState,
  note: BeatNote,
  kind: "A" | "SP",
  ctx: BeatContext,
  activations: ActivationTrace[],
  states: LaneState[],
): void {
  // ...
  const candidates = candidateSkills(state, kind);
  if (candidates.length === 0) {
    // 【S4 #1】SP未習得FAIL
    const reset = snapshotOf(state).combo_continue === 0;
    activations.push({
      beat: note.beat,
      phase: "main",
      lane: laneNum,
      skillId: "",
      kind,
      success: false,
      failReason: "no_skill",
      comboReset: reset,
    });
    applyComboFailOnNote(state, ctx, states);
    return;
  }

  const snap = snapshotOf(state);
  let chosen: SkillDef | null = null;
  let blockedStamina = false;
  let blockedCt = false;
  let costOfChosen = 0;
  for (const skill of candidates) {
    if (skill.ct != null && (state.skillCt.get(skill.id) ?? 0) > 0) {
      blockedCt = true;
      continue;
    }
    const cost = staminaCostOf(skill, snap, ctx.input.stage.skillStaminaWeightPermil, state.input.attribute);
    if (state.stamina < cost) {
      blockedStamina = true;
      continue;
    }
    chosen = skill;
    costOfChosen = cost;
    break;
  }
  if (chosen === null) {
    const failReason: ActivationTrace["failReason"] = blockedCt ? "in_ct" : "stamina_short";
    const reset = snapshotOf(state).combo_continue === 0;
    activations.push({
      beat: note.beat,
      phase: "main",
      lane: laneNum,
      skillId: candidates[0]?.id ?? "",
      kind,
      success: false,
      failReason,
      comboReset: reset,
    });
    applyComboFailOnNote(state, ctx, states);
    return;
  }
  // スキル発動成功処理...
}
*/

// ============================================================================
// 2. 効果適用処理 (applyEffect)
// ============================================================================
// 現在の applyEffect switch 文 (engine.ts 約800行目周辺):
// ★課題:
//   ① "effect_passing":
//      - 対象: score_type_1 (スコアラータイプ1人)
//      - 内容: 発動者(self)の全強化効果(isEnhancementEffect)を対象へ「移動」する
//   ② "effect_extension" (scope なし):
//      - 対象: score_type_1
//      - 内容: 対象レーンの全強化効果を beats (effect.value ?? effect.stages ?? 0) ビート延長する
//      - 注意: 直前の effect_passing で移動してきたインスタンスも延長対象に含める

/*
function applyEffect(
  effect: SkillEffect,
  self: LaneState,
  states: LaneState[],
  ctx: BeatContext,
  step: TimelineStep,
  activations: ActivationTrace[],
): void {
  switch (effect.type) {
    // ...
    case "effect_amplify": {
      // ...
      break;
    }
    case "effect_extension": {
      if (effect.scope != null) {
        // 与/被レタッチ (T5 ゴールデン用)
        applyRetouchExtension(effect, self, states);
        break;
      }
      // 【S4 #3】対象レーン型（scopeなし）:
      // ★マスタでは延長値は effect.value に入っている点に注意！
      const beats = effect.value ?? effect.stages ?? 0;
      for (const t of resolveTargets(effect.target, self, states)) {
        applyEffectExtensionToLane(t, beats);
      }
      break;
    }
    case "effect_passing": {
      // 【S4 #3】強化効果譲渡 = 移動（move）
      const targets = resolveTargets(effect.target, self, states);
      applyEffectPassing(self, targets);
      break;
    }
  }
}
*/
