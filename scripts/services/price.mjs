// Prices for the API: what a merchant pays for an item, or charges for one of its own, with every modifier.
// Documents are typed any here because their schema fields have no generated types.
import { TradeError } from "./errors.mjs";
import { buyQuote, sellQuote, shelfView } from "./offer.mjs";
import { priceContextFor, resolvePair, visibleShelf } from "./session.mjs";
import { MESSAGES, onRequest, request } from "./socket.mjs";

/** @import { ExtraFactor } from "../engine/pricing.mjs"; */

/**
 * @typedef {object} PriceAnswer
 * @property {"buy" | "sell"} side
 * @property {boolean} forSale
 * @property {number} copper
 * @property {number} base
 * @property {{ kind: string, factor: number, label?: string }[]} modifiers
 */

export function registerPriceHandlers() {
  onRequest(MESSAGES.PRICE_GET, answerPrice, { queueKey: (payload) => payload?.merchant });
}

// Sell side for an item the customer holds, buy side for an item on the merchant's shelf.
/**
 * @param {any | string} item
 * @param {{ merchant?: any | string, customer?: any | string, side?: "buy" | "sell" }} [options]
 * @returns {Promise<PriceAnswer>}
 */
export async function getPrice(item, { merchant, customer, side } = {}) {
  const doc = /** @type {any} */ (typeof item === "string" ? await foundry.utils.fromUuid(item) : item);
  if (!doc?.parent) throw new TradeError("KT.Error.Missing");
  const uuid = (/** @type {any} */ value) => (typeof value === "string" ? value : value?.uuid);
  const onShelf = side ? side === "buy" : Boolean(merchant) && uuid(merchant) === doc.parent.uuid;
  const merchantUuid = uuid(merchant) ?? (onShelf ? doc.parent.uuid : null);
  const customerUuid = uuid(customer) ?? (onShelf ? /** @type {any} */ (game.user).character?.uuid : doc.parent.uuid);
  if (!merchantUuid || !customerUuid) throw new TradeError("KT.Error.Missing");
  return request(MESSAGES.PRICE_GET, { item: doc.uuid, merchant: merchantUuid, customer: customerUuid, side: onShelf ? "buy" : "sell" });
}

/**
 * @param {{ item: string, merchant: string, customer: string, side: "buy" | "sell" }} payload
 * @param {any} sender
 * @returns {Promise<PriceAnswer>}
 */
async function answerPrice({ item, merchant: merchantUuid, customer: customerUuid, side }, sender) {
  const { merchant, customer } = await resolvePair(merchantUuid, customerUuid, sender);
  const doc = /** @type {any} */ (await foundry.utils.fromUuid(item));
  if (!doc) throw new TradeError("KT.Error.Missing");
  const context = priceContextFor(merchant, customer);
  if (side === "sell") {
    if (doc.parent !== customer && !sender.isGM) throw new TradeError("KT.Error.NotYours");
    const quote = sellQuote(doc, context);
    return { side, forSale: quote.forSale, copper: quote.unit, base: quote.base, modifiers: labelled(quote.modifiers, quote.extra) };
  }
  const entry = doc.parent === merchant ? visibleShelf(merchant, customer).find((e) => e.item.id === doc.id) : null;
  if (!entry || entry.price === null) return { side: "buy", forSale: false, copper: 0, base: 0, modifiers: [] };
  const quote = buyQuote(entry.price, context, entry.flags.limited, shelfView(entry));
  return { side: "buy", forSale: true, copper: quote.copper, base: entry.price, modifiers: labelled(quote.modifiers, quote.extra) };
}

// Modifiers with the label another module gave its own.
/**
 * @param {{ kind: string, factor: number }[]} modifiers
 * @param {ExtraFactor[]} extra
 */
function labelled(modifiers, extra) {
  return modifiers.map((modifier) => {
    const label = extra.find((factor) => factor.kind === modifier.kind && factor.factor === modifier.factor)?.label;
    return label ? { ...modifier, label } : modifier;
  });
}
