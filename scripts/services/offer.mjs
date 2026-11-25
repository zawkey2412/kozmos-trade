// Unit prices for the lines of an offer, the same in the customer's window and in the GM's check.
import { itemFacts, rulesVersion } from "../adapter/dnd5e.mjs";
import { itemFlags } from "../data/flags.mjs";
import { getArchetypes } from "./archetypes.mjs";
import { sellFit } from "../engine/fit.mjs";
import { baseValue, buyPrice, sellBasis, sellPrice, sellRate } from "../engine/pricing.mjs";
import { getTables } from "../settings.mjs";

/** @import { Price } from "../engine/pricing.mjs"; */

/**
 * @typedef {object} PriceContext
 * @property {string} archetype
 * @property {number} attitudeAdjustment
 * @property {number} haggle
 * @property {number} market
 * @property {string[]} [appraised]
 */

/**
 * @typedef {object} SellQuote
 * @property {boolean} forSale
 * @property {number} unit
 * @property {Price["modifiers"]} modifiers
 * @property {boolean} scrap
 * @property {boolean} favored
 */

// What the merchant pays for one of the customer's items.
/**
 * @param {any} item
 * @param {PriceContext} context
 * @returns {SellQuote}
 */
export function sellQuote(item, context) {
  const tables = getTables().pricing;
  const facts = itemFacts(item);
  const value = baseValue(facts, tables, { rules: rulesVersion() });
  if (!value.forSale) return { forSale: false, unit: 0, modifiers: [], scrap: false, favored: false };
  const basis = sellBasis(facts, value, tables, { appraised: Boolean(context.appraised?.includes(item.id)), trueValue: itemFlags(item).trueValue });
  const fit = sellFit(facts, getArchetypes()[context.archetype]);
  const rate = sellRate({ scrap: basis.scrap, fence: fit.fence, favored: fit.favored }, tables);
  const price = sellPrice(basis.copper, { rate, attitudeAdjustment: context.attitudeAdjustment, market: context.market });
  return { forSale: true, unit: price.copper, modifiers: price.modifiers, scrap: basis.scrap, favored: fit.favored };
}

// What the customer pays for one of a shelf item. Limited Stock caps the haggle discount.
/**
 * @param {number} shelfPrice
 * @param {PriceContext} context
 * @param {boolean} [limited]
 */
export function buyQuote(shelfPrice, context, limited = false) {
  const haggle = limited ? Math.min(context.haggle, getTables().haggle.limitedMaxAsk) : context.haggle;
  return buyPrice(shelfPrice, { attitudeAdjustment: context.attitudeAdjustment, haggle, market: context.market });
}
