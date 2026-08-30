/** ドメイン型（Phase 0-1 で使用する範囲） */

export type MainStat = "vocal" | "dance" | "visual";
export type SubStat = "stamina" | "mental" | "critical";
export type Stat = MainStat | SubStat;
export type StatKey = Stat | "sp_score" | "a_score" | "beat_score" | "critical_score" | "p_score";

export interface StatValues<T> {
  vocal: T;
  dance: T;
  visual: T;
  stamina: T;
  mental: T;
  critical: T;
}

/** 装備・補正の統一形式（permil）*/
export interface StatBonus {
  /** % 系補正（permil）。例: +45.0% → 450 */
  pct: Partial<Record<StatKey, number>>;
  /** 固定値補正 */
  fixed: Partial<Record<StatKey, number>>;
}

/** カードのロール（INFO PRIDE のカードタイプ。1=Scorer / 2=Buffer / 3=Supporter） */
export type CardRole = "Scorer" | "Buffer" | "Supporter";

export interface CardDef {
  id: string;
  name: string;
  characterId: string;
  /** 画像アセットID（CDN img_card_thumb_{v}_{assetId}。id サフィックスと不一致のカードがごく一部ある） */
  assetId?: string;
  initialRarity: number;
  cardParameterId: string;
  ratiosPermil: { vocal: number; dance: number; visual: number; stamina: number };
  skillIds: string[];
  /** カード固有ロール（vendors Card.json type から導出・未定義は従来データ） */
  role?: CardRole;
}

/** CardParameter の1行（レベル別マスター値） */
export interface CardParameterRow {
  id: string;
  level: number;
  value: number;
  staminaValue: number;
}

/** レアリティボーナス（permil）。☆1=1000, ☆6=1250, ☆10=1450 */
export function rarityBonusPermil(rarity: number): number {
  if (!Number.isInteger(rarity) || rarity < 1 || rarity > 10) {
    throw new Error(`rarity out of range: ${rarity}`);
  }
  return 1000 + (rarity - 1) * 50;
}

/** スタッフ育成ボーナス（全レーン共通の固定値） */
export interface StaffBonus {
  vocal: number;
  dance: number;
  visual: number;
  stamina: number;
  mental: number;
  critical: number;
}

/** ライブエール（所持カードのエール総和・全レーン共通） */
export interface YellBonus {
  /** ボダビ%（permil）*/
  statPct: { vocal: number; dance: number; visual: number };
  /** Sta/Men/Cri 固定値 */
  statFix: { stamina: number; mental: number; critical: number };
  /** スコア補正%（permil）*/
  scorePct: { beat: number; active: number; special: number; criticalScore: number };
}

/** 1レーン分の装備（フォト・アクセサリ）*/
export interface LaneEquipment {
  photos: StatBonus[];
  accessories: StatBonus[];
}

/** 合計した装備補正（permil / 固定値）*/
export function sumEquipmentBonuses(equipment: LaneEquipment): StatBonus {
  const pct: Partial<Record<StatKey, number>> = {};
  const fixed: Partial<Record<StatKey, number>> = {};
  for (const item of [...equipment.photos, ...equipment.accessories]) {
    for (const [k, v] of Object.entries(item.pct)) {
      const key = k as StatKey;
      pct[key] = (pct[key] ?? 0) + (v as number);
    }
    for (const [k, v] of Object.entries(item.fixed)) {
      const key = k as StatKey;
      fixed[key] = (fixed[key] ?? 0) + (v as number);
    }
  }
  return { pct, fixed };
}
