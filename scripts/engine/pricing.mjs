// Prices: base value, shelf price, and what each side pays at trade time.
import { COPPER, toCopper } from "./money.mjs";

/** @typedef {typeof import("../data/tables.mjs").TABLES.pricing} PricingTables */
/** @typedef {"modern" | "legacy"} Rules */
/** @typedef {"price" | "rarity" | "metadata" | "floor"} ValueSource */

/**
 * @typedef {object} ItemFacts
 * @property {string} type
 * @property {string} [subtype]
 * @property {string} [baseItem]
 * @property {{ value: number, denomination: string }} [price]
 * @property {string} [rarity]
 * @property {boolean} [scroll]
 * @property {number | null} [spellLevel]
 * @property {number} [magicalBonus]
 * @property {boolean} [attunement]
 * @property {boolean} [magical]
 * @property {boolean} [identified]
 */

/**
 * @typedef {object} BaseValue
 * @property {number} copper
 * @property {ValueSource | null} source
 * @property {boolean} forSale
 */

/**
 * @typedef {object} Price
 * @property {number} copper
 * @property {{ kind: string, factor: number }[]} modifiers
 */

const NOT_FOR_SALE = Object.freeze({ copper: 0, source: null, forSale: false });

// Base value from the price waterfall.
/**
 * @param {ItemFacts} item
 * @param {PricingTables} tables
 * @param {{ rules?: Rules, random?: () => number }} [options]
 * @returns {BaseValue}
 */
export function baseValue(item, tables, { rules = "modern", random } = {}) {
  if (tables.notForSale.includes(item.rarity)) return NOT_FOR_SALE;
  if (item.price?.value > 0) return found(toCopper(item.price.value, item.price.denomination), "price");

  const byRarity = rarityValue(item, item.rarity, tables, rules, random);
  if (byRarity !== null) return found(byRarity, "rarity");

  const byMetadata = metadataValue(item, tables, rules, random);
  if (byMetadata !== null) return found(byMetadata, "metadata");

  return found(tables.typeFloor[item.type] ?? 0, "floor");
}

// Rolled once at stock time.
/**
 * @param {number} base
 * @param {PricingTables} tables
 * @param {{ random: () => number, tier?: string }} options
 */
export function shelfPrice(base, tables, { random, tier }) {
  const variance = 1 + (random() * 2 - 1) * tables.variance;
  const scarcity = 1 + (tables.scarcity[tier] ?? 0);
  return roundToStep(base * variance * scarcity, tables.rounding);
}

// Nearest natural step for the size of the price.
/**
 * @param {number} copper
 * @param {PricingTables["rounding"]} rounding
 */
export function roundToStep(copper, rounding) {
  if (copper <= 0) return 0;
  const { step } = rounding.find((band) => band.below === undefined || copper < band.below);
  return Math.max(step, Math.round(copper / step) * step);
}

// Value a merchant starts from for a customer's item, and whether it only offers scrap.
/**
 * @param {ItemFacts} item
 * @param {BaseValue} value
 * @param {PricingTables} tables
 * @param {{ appraised?: boolean, trueValue?: number | null }} [options]
 */
export function sellBasis(item, value, tables, { appraised = false, trueValue = null } = {}) {
  const floor = tables.typeFloor[item.type] ?? 0;
  if (item.identified === false) return { copper: floor, scrap: false };
  if (value.source !== "floor") return { copper: value.copper, scrap: false };
  if (!appraised) return { copper: floor, scrap: true };
  return { copper: trueValue ?? floor, scrap: false };
}

// Share of the value a merchant pays, by how the item fits the shop.
/**
 * @param {{ scrap?: boolean, wanted?: number | null, fence?: boolean, favored?: boolean }} fit
 * @param {PricingTables} tables
 */
export function sellRate({ scrap = false, wanted = null, fence = false, favored = false }, tables) {
  if (scrap) return tables.rates.scrap;
  if (wanted !== null) return wanted;
  if (fence) return tables.rates.fence;
  return favored ? tables.rates.favored : tables.rates.offArchetype;
}

// What the customer pays for one of a shelf item.
/**
 * @param {number} shelf
 * @param {{ attitudeAdjustment?: number, haggle?: number, market?: number }} [modifiers]
 * @returns {Price}
 */
export function buyPrice(shelf, { attitudeAdjustment = 0, haggle = 0, market = 1 } = {}) {
  return applyModifiers(shelf, [
    ["attitude", 1 - attitudeAdjustment],
    ["haggle", 1 - haggle],
    ["market", market],
  ]);
}

// What the merchant pays for one of the customer's items.
/**
 * @param {number} basis
 * @param {{ rate: number, attitudeAdjustment?: number, market?: number }} modifiers
 * @returns {Price}
 */
export function sellPrice(basis, { rate, attitudeAdjustment = 0, market = 1 }) {
  return applyModifiers(basis, [
    ["rate", rate],
    ["attitude", 1 + attitudeAdjustment],
    ["market", market],
  ]);
}

/**
 * @param {number} copper
 * @param {ValueSource} source
 * @returns {BaseValue}
 */
function found(copper, source) {
  return { copper, source, forSale: true };
}

/**
 * @param {number} start
 * @param {[string, number][]} factors
 * @returns {Price}
 */
function applyModifiers(start, factors) {
  const modifiers = factors.filter(([, factor]) => factor !== 1).map(([kind, factor]) => ({ kind, factor }));
  const copper = Math.round(modifiers.reduce((total, { factor }) => total * factor, start));
  return { copper, modifiers };
}

/**
 * @param {ItemFacts} item
 * @param {string | undefined} rarity
 * @param {PricingTables} tables
 * @param {Rules} rules
 * @param {(() => number) | undefined} random
 */
function rarityValue(item, rarity, tables, rules, random) {
  const entry = tables.rarity[rules][rarity];
  if (entry === undefined) return null;
  const copper = Array.isArray(entry) ? rollRange(entry, random) : entry;
  return item.type === "consumable" && !item.scroll ? Math.round(copper * tables.consumableFactor) : copper;
}

/**
 * @param {ItemFacts} item
 * @param {PricingTables} tables
 * @param {Rules} rules
 * @param {(() => number) | undefined} random
 */
function metadataValue(item, tables, rules, random) {
  if (item.scroll && item.spellLevel != null) {
    const copper = tables.scrolls[item.spellLevel];
    if (copper !== undefined) return copper;
  }
  const bonusRarity = tables.magicalBonus[item.magicalBonus];
  if (bonusRarity) return rarityValue(item, bonusRarity, tables, rules, random);
  if (item.attunement || item.magical) return rarityValue(item, tables.magicRarity, tables, rules, random);
  return null;
}

// Whole gold pieces inside the range, or its middle without a random source.
/**
 * @param {number[]} range
 * @param {(() => number) | undefined} random
 */
function rollRange([low, high], random) {
  const gp = COPPER.gp;
  if (!random) return Math.round((low + high) / 2 / gp) * gp;
  const lowGp = Math.ceil(low / gp);
  const highGp = Math.floor(high / gp);
  return (lowGp + Math.floor(random() * (highGp - lowGp + 1))) * gp;
}
