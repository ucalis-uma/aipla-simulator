/**
 * カード外ステータス計算（確定式）。
 *
 * 出典: PLAN.md §3.1（実測5レーン×4ステータス＝20/20項目が1の位まで一致で確定）
 * 確度: Confirmed
 *
 *   V_base = floor( floor( param[level] x ratioPermil / 1000 ) x rarityPermil / 1000 )
 *
 *   基礎ステータス（編成画面表示値）:
 *     Vo/Da/Vi: floor( V_base x (1000 + エール% + 交流%) / 1000 ) + スタッフ固定
 *     Sta/Men/Cri: floor( V_base x (1000 + 交流%) / 1000 ) + スタッフ固定 + エール固定
 *
 *   デッキ値（ライブ開始時・全バフの基準値）:
 *     floor( V_base x (1000 + エール% + 交流% + アクセ% + フォト%) / 1000 )
 *       + スタッフ固定 + アクセ固定 + フォト固定 + エール固定(Sta/Men/Cri)
 *
 * 注意:
 * - %加算プールに上限 +100% の制約は存在しない（実測 +362.7% で一致、PLAN.md §5-1）。
 * - 交流Lvは%として同一プールに入る（乗算ではない）。
 * - Men/Cri の V_base は 100（全員初期値。ライブ外で変化させるのは
 *   エール・スタッフ・アクセ・フォトのみ: research/01 §1.4）。
 */
import { mulPermil } from "../rounding.js";
import { kouryuCumulativePermil } from "../kouryu.js";
import {
  rarityBonusPermil,
  sumEquipmentBonuses,
  type CardDef,
  type CardParameterRow,
  type LaneEquipment,
  type StaffBonus,
  type StatValues,
  type YellBonus,
} from "../types.js";

export interface DeckStatusInput {
  card: CardDef;
  level: number;
  /** 現在のレアリティ（開花・限界突破後の値。☆5初期カードでも開花で ☆6+ になる）*/
  rarity: number;
  kouryuLevel: number;
  staff: StaffBonus;
  yell: YellBonus;
  equipment: LaneEquipment;
}

export interface DeckStatusResult {
  /** マスター値（レベル・レアリティ反映後。交流/エール等の反映前）*/
  master: StatValues<number>;
  /** 編成画面の基礎ステータス */
  basic: StatValues<number>;
  /** デッキ値（ライブ開始時・バフ基準値）*/
  deck: StatValues<number>;
}

const MAIN_STATS = ["vocal", "dance", "visual"] as const;
const SUB_STATS = ["stamina", "mental", "critical"] as const;

function masterValue(
  card: CardDef,
  rarity: number,
  row: CardParameterRow,
  stat: "vocal" | "dance" | "visual" | "stamina",
): number {
  const ratio =
    stat === "stamina" ? card.ratiosPermil.stamina : card.ratiosPermil[stat];
  const raw = stat === "stamina" ? row.staminaValue : row.value;
  const mid = mulPermil(raw, ratio);
  return mulPermil(mid, rarityBonusPermil(rarity));
}

function emptyStatValues(): StatValues<number> {
  return { vocal: 0, dance: 0, visual: 0, stamina: 0, mental: 0, critical: 0 };
}

/**
 * デッキ値（と基礎表示値）を計算する。
 * %補正（エール・交流・アクセ・フォト）は全て同一の加算プールに入る。
 */
export function computeDeckStatus(input: DeckStatusInput, paramRow: CardParameterRow): DeckStatusResult {
  const kouryu = kouryuCumulativePermil(input.kouryuLevel);
  const equip = sumEquipmentBonuses(input.equipment);

  const master = emptyStatValues();
  master.vocal = masterValue(input.card, input.rarity, paramRow, "vocal");
  master.dance = masterValue(input.card, input.rarity, paramRow, "dance");
  master.visual = masterValue(input.card, input.rarity, paramRow, "visual");
  master.stamina = masterValue(input.card, input.rarity, paramRow, "stamina");
  master.mental = 100;
  master.critical = 100;

  const basic = emptyStatValues();
  const deck = emptyStatValues();

  for (const stat of MAIN_STATS) {
    const poolBasic = 1000 + input.yell.statPct[stat] + kouryu[stat];
    basic[stat] = mulPermil(master[stat], poolBasic) + input.staff[stat];

    const poolDeck =
      1000 +
      input.yell.statPct[stat] +
      kouryu[stat] +
      (equip.pct[stat] ?? 0);
    deck[stat] = mulPermil(master[stat], poolDeck) + input.staff[stat] + (equip.fixed[stat] ?? 0);
  }

  for (const stat of SUB_STATS) {
    const poolBasic = 1000 + kouryu[stat];
    basic[stat] = mulPermil(master[stat], poolBasic) + input.staff[stat] + input.yell.statFix[stat];

    const poolDeck = 1000 + kouryu[stat] + (equip.pct[stat] ?? 0);
    deck[stat] =
      mulPermil(master[stat], poolDeck) +
      input.staff[stat] +
      input.yell.statFix[stat] +
      (equip.fixed[stat] ?? 0);
  }

  return { master, basic, deck };
}
