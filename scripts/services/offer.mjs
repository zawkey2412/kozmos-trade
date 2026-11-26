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
/** @import { MarketRule } from "../engine/market.mjs"; */
/** @import { ExtraFactor, ItemFacts, Price } from "../engine/pricing.mjs"; */
/** @import { WantedEntry } from "../engine/wanted.mjs"; */

/**
 * @typedef {object} PriceContext
 * @property {string} merchant
 * @property {string} customer
 * @property {string} archetype
 * @property {number} attitudeAdjustment
 * @property {number} haggle
 * @property {MarketRule[]} market
 * @property {string[]} [appraised]
 * @property {WantedEntry[]} [wanted]
 */

// A shelf item or service as the customer sees it, the same on both clients.
/**
 * @typedef {object} ShelfView
 * @property {string} id
 * @property {string} name
 * @property {string} type
 * @property {string} [subtype]
 * @property {string} [rarity]
 * @property {boolean} [magical]
 */

/**
 * @typedef {object} SellQuote
 * @property {boolean} forSale
 * @property {number} unit
 * @property {number} base
 * @property {Price["modifiers"]} modifiers
 * @property {ExtraFactor[]} extra
 * @property {boolean} scrap
 * @property {boolean} favored
 * @property {boolean} wanted
 */

/** @typedef {Price & { extra: ExtraFactor[] }} BuyQuote */

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
  if (!value.forSale) return { forSale: false, unit: 0, base: 0, modifiers: [], extra: [], scrap: false, favored: false, wanted: false };
  const basis = sellBasis(facts, value, tables, { appraised: Boolean(context.appraised?.includes(item.id)), trueValue: itemFlags(item).trueValue });
  const fit = sellFit(facts, getArchetypes()[context.archetype]);
  const wanted = wantedRate({ ...facts, name: item.name, source: itemSource(item) }, context.wanted ?? []);
  const rate = sellRate({ scrap: basis.scrap, wanted, fence: fit.fence, favored: fit.favored }, tables);
  const extra = hookFactors({ side: "sell", item, base: basis.copper, context });
  const price = sellPrice(basis.copper, { rate, attitudeAdjustment: context.attitudeAdjustment, market: marketFactor(facts, context.market ?? []), extra });
  return { forSale: true, unit: price.copper, base: basis.copper, modifiers: price.modifiers, extra, scrap: basis.scrap, favored: fit.favored, wanted: wanted !== null && !basis.scrap };
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

// What the customer pays for one of a shelf item or a service. Limited Stock caps the haggle discount.
/**
 * @param {number} shelfPrice
 * @param {PriceContext} context
 * @param {boolean} [limited]
 * @param {ShelfView | null} [item]
 * @returns {BuyQuote}
 */
export function buyQuote(shelfPrice, context, limited = false, item = null) {
  const haggle = limited ? Math.min(context.haggle, getTables().haggle.limitedMaxAsk) : context.haggle;
  const market = item && item.type !== "service" ? marketFactor(item, context.market ?? []) : 1;
  const extra = item ? hookFactors({ side: "buy", item, base: shelfPrice, context }) : [];
  return { ...buyPrice(shelfPrice, { attitudeAdjustment: context.attitudeAdjustment, haggle, market, extra }), extra };
}

// A shelf entry on the GM as the customer's snapshot shows it.
/** @param {{ item: any, facts: ItemFacts }} entry */
export function shelfView({ item, facts }) {
  const identified = facts.identified !== false;
  return {
    id: item.id,
    name: item.name,
    type: facts.type,
    subtype: facts.subtype ?? "",
    rarity: identified ? (facts.rarity ?? "") : "",
    magical: Boolean(facts.magical || facts.rarity || facts.magicalBonus),
  };
}

// Price changes other modules add through the prePrice hook.
/**
 * @param {{ side: "buy" | "sell", item: any, base: number, context: PriceContext }} price
 * @returns {ExtraFactor[]}
 */
function hookFactors({ side, item, base, context }) {
  /** @type {ExtraFactor[]} */
  const factors = [];
  Hooks.callAll("kozmosTrade.prePrice", { side, item, base, context, factors });
  return factors.filter((entry) => Number.isFinite(entry?.factor) && entry.factor > 0);
}
