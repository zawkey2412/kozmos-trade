// Unit prices for the lines of an offer, the same in the customer's window and in the GM's check.
import { holdingFacts, itemFacts, itemSource, rulesVersion } from "../adapter/dnd5e.mjs";
import { wantedRate } from "../engine/wanted.mjs";
import { itemFlags } from "../data/flags.mjs";
import { getArchetypes } from "./archetypes.mjs";
import { sellFit } from "../engine/fit.mjs";
import { marketFactor } from "../engine/market.mjs";
import { baseValue, buyPrice, sellBasis, sellPrice, sellRate } from "../engine/pricing.mjs";
import { tradeable } from "../engine/shelf.mjs";
import { getTables } from "../settings.mjs";
import { TradeError } from "./errors.mjs";

/** @import { TradeLine } from "./trade.mjs"; */
/** @import { MarketItem, MarketRule } from "../engine/market.mjs"; */

/** @import { Price } from "../engine/pricing.mjs"; */
/** @import { WantedEntry } from "../engine/wanted.mjs"; */

/**
 * @typedef {object} PriceContext
 * @property {string} archetype
 * @property {number} attitudeAdjustment
 * @property {number} haggle
 * @property {MarketRule[]} market
 * @property {string[]} [appraised]
 * @property {WantedEntry[]} [wanted]
 */

/**
 * @typedef {object} SellQuote
 * @property {boolean} forSale
 * @property {number} unit
 * @property {Price["modifiers"]} modifiers
 * @property {boolean} scrap
 * @property {boolean} favored
 * @property {boolean} wanted
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
  if (!value.forSale) return { forSale: false, unit: 0, modifiers: [], scrap: false, favored: false, wanted: false };
  const basis = sellBasis(facts, value, tables, { appraised: Boolean(context.appraised?.includes(item.id)), trueValue: itemFlags(item).trueValue });
  const fit = sellFit(facts, getArchetypes()[context.archetype]);
  const wanted = wantedRate({ ...facts, name: item.name, source: itemSource(item) }, context.wanted ?? []);
  const rate = sellRate({ scrap: basis.scrap, wanted, fence: fit.fence, favored: fit.favored }, tables);
  const price = sellPrice(basis.copper, { rate, attitudeAdjustment: context.attitudeAdjustment, market: marketFactor(facts, context.market ?? []) });
  return { forSale: true, unit: price.copper, modifiers: price.modifiers, scrap: basis.scrap, favored: fit.favored, wanted: wanted !== null && !basis.scrap };
}

// One of a character's items put up for sale, checked against what it holds now.
/**
 * @param {any} actor
 * @param {string} id
 * @param {number} quantity
 * @param {PriceContext} context
 * @returns {TradeLine}
 */
export function sellLine(actor, id, quantity, context) {
  const item = actor.items.get(id);
  if (!item) throw new TradeError("KT.Error.SoldOut");
  const facts = itemFacts(item);
  const holding = holdingFacts(item);
  const full = facts.type === "container" && holding.contents > 0;
  if (!tradeable(facts, holding) || full || quantity > holding.quantity) throw new TradeError("KT.Error.ItemGone", { name: item.name });
  const quote = sellQuote(item, context);
  if (!quote.forSale) throw new TradeError("KT.Error.NotForSale", { name: item.name });
  return { item, quantity, unit: quote.unit, held: holding.quantity };
}

// What the customer pays for one of a shelf item. Limited Stock caps the haggle discount.
/**
 * @param {number} shelfPrice
 * @param {PriceContext} context
 * @param {boolean} [limited]
 * @param {MarketItem | null} [item]
 */
export function buyQuote(shelfPrice, context, limited = false, item = null) {
  const haggle = limited ? Math.min(context.haggle, getTables().haggle.limitedMaxAsk) : context.haggle;
  return buyPrice(shelfPrice, { attitudeAdjustment: context.attitudeAdjustment, haggle, market: marketFactor(item, context.market ?? []) });
}
