// Which items a merchant offers, and their shelf price.
import { roundToStep } from "./pricing.mjs";

/** @import { BaseValue, ItemFacts, PricingTables } from "./pricing.mjs"; */
/** @import { HoldingFacts } from "../adapter/dnd5e.mjs"; */

/** @type {readonly string[]} */
export const TRADE_TYPES = Object.freeze(["weapon", "equipment", "consumable", "tool", "loot", "container"]);

// Merchant items that are stock: physical, loose, not worn or wielded, and not a container with something inside.
/**
 * @param {ItemFacts} facts
 * @param {HoldingFacts} holding
 */
export function onShelf(facts, holding) {
  if (!TRADE_TYPES.includes(facts.type)) return false;
  if (holding.container || holding.equipped || holding.quantity < 1) return false;
  if (facts.type === "weapon" && facts.subtype === "natural") return false;
  return !(facts.type === "container" && holding.contents > 0);
}

// Customer items that can go into an offer.
/**
 * @param {ItemFacts} facts
 * @param {HoldingFacts} holding
 */
export function tradeable(facts, holding) {
  if (!TRADE_TYPES.includes(facts.type) || holding.quantity < 1) return false;
  return !(facts.type === "weapon" && facts.subtype === "natural");
}

// The GM's price, or the base value rounded to a natural step.
/**
 * @param {number | null} listedPrice
 * @param {BaseValue} value
 * @param {PricingTables} tables
 */
export function shelfPriceOf(listedPrice, value, tables) {
  if (!value.forSale) return null;
  if (listedPrice !== null && listedPrice !== undefined) return listedPrice;
  return roundToStep(value.copper, tables.rounding);
}
