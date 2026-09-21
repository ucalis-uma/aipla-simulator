# プロンプト：未対応条件トリガーの包括的実装（無条件発動バグの根絶）

## 1. 目的と背景
`tools/importers/build_data_phase6.mjs` の効果行単位トリガーパーサ（`triggerConditionOf`）およびスキル単位トリガーパーサにおいて、未対応の triggerId が `condition: "none"`（無条件）に fallback しているため、ゲーム内で条件を満たしていないスキル・効果行がシミュレータ上で無条件発動してしまう構造的バグが存在する。
本セッションでは、公式マスタ（`vendor/Skill.json`）に存在する未対応トリガーを徹底網羅し、スキル文章通りの条件判定が必ず行われ、条件不成立時には安全に不発となるよう包括的に実装する。

## 2. 実装対象の未対応トリガー一覧（全115種中、未対応の主要グループ）

1. **`tg-status-*`（自身が特定バフ・状態の時）**:
   - `tg-status-vocal_up` / `dance_up` / `visual_up` → `self_vocal_up`, `self_dance_up`, `self_visual_up`
   - `tg-status-critical_rate_up` / `critical_bonus_permil_up` → `self_critical_rate_up`, `self_critical_coeff_up`
   - `tg-status-score_up` / `skill_score_up` → `self_score_up`, `self_skill_score_up`
   - `tg-status-audience_amount_increase` → `self_focus`
   - `tg-status-audience_amount_reduction` → `self_stealth`
   - `tg-status-tension_up` → `self_tension_up`
   - `tg-status-stamina_consumption_reduction` → `self_stamina_cost_down`
2. **`tg-stamina_higher-N` / `tg-stamina_lower-N`（スタミナ割合条件）**:
   - `tg-stamina_higher-80`, `tg-stamina_higher-60` → `stamina>=80`, `stamina>=60`
   - `tg-stamina_lower-70`, `tg-stamina_lower-50`, `tg-stamina_lower-30` → `stamina<=70`, `stamina<=50`, `stamina<=30`
3. **配置レーン条件**:
   - `tg-center` → `position_center`（自レーン == 3）
   - `tg-most_left` → `position_most_left`（自レーン == 1）
   - `tg-most_right` → `position_most_right`（自レーン == 5）
4. **コンボ以下条件**:
   - `tg-combo_less_equal-50`, `tg-combo_less_equal-80`, `tg-combo_less_equal-100` → `combo<=50`, `combo<=80`, `combo<=100`
5. **段階数条件**:
   - `tg-someone_status_effect_grade_higher_<type>-<grade>` → `someone_<type>>=<grade>`
6. **行動直前トリガー**:
   - `tg-before_special_skill` → 自身のSPスキル発動前（自レーンがSPノートかつ発動可能なビートの前半）
   - `tg-before_active_skill_by_someone` → 誰かのAスキル発動前
7. **未対応のユニット・キャラ人数条件**:
   - `tg-more_than_character_count-<unit/char>-<count>`（未登録のユニット/キャラID）

## 3. 実装手順
1. **マスタインポーターの改修 (`tools/importers/build_data_phase6.mjs`)**:
   - `triggerConditionOf` およびスキル単位トリガーパーサを拡張し、上記トリガーを適切な `condition` 文字列へ写像する。
   - `Unknown` として `none` に落ちるトリガーをゼロ化する。
   - `node tools/importers/build_data_phase6.mjs` を実行し、`data/skills_levels.json` および `data/skills_master.json` を再生成。
2. **シミュレータエンジンの改修 (`src/timeline/engine.ts`)**:
   - `evalCondition`（または各発動判定箇所）に、新設した condition（自レーン状態、スタミナ比率、配置、コンボ以下、段階数条件等）の評価ロジックを実装。
3. **影響検証とリグレッションテスト**:
   - `npm run typecheck`
   - `npx vitest run`（既存テストおよび T5 ゴールデン不変 `2,580,397,520`）
   - 新規条件判定の単体テストを `tests/unit/timeline/` に追加。

## 4. 完了条件
- 全トリガーのパーサが整備され、`Unknown` による無条件 fallback が解消されること。
- 既存の全テスト（487 passed）が PASS を維持し、T5 ゴールデンスコアが変わらないこと。
