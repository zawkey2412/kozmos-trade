// Trades between two characters: each side's offer, and both Accepts, which any change resets.
import { COPPER } from "./money.mjs";

/**
 * @typedef {object} PlayerOffer
 * @property {[string, number][]} items
 * @property {Record<string, number>} coins
 */

/**
 * @typedef {object} PlayerSide
 * @property {string} actor
 * @property {string} userId
 * @property {PlayerOffer} offer
 * @property {boolean} accepted
 */

/**
 * @typedef {object} PlayerTrade
 * @property {string} id
 * @property {PlayerSide[]} sides
 * @property {number} version
 */

/** @returns {PlayerOffer} */
export function emptyPlayerOffer() {
  return { items: [], coins: Object.fromEntries(Object.keys(COPPER).map((coin) => [coin, 0])) };
}

/**
 * @param {string} id
 * @param {{ actor: string, userId: string }} first
 * @param {{ actor: string, userId: string }} second
 * @returns {PlayerTrade}
 */
export function startPlayerTrade(id, first, second) {
  const side = (/** @type {{ actor: string, userId: string }} */ who) => ({ actor: who.actor, userId: who.userId, offer: emptyPlayerOffer(), accepted: false });
  return { id, sides: [side(first), side(second)], version: 0 };
}

/**
 * @param {PlayerTrade} trade
 * @param {string} actor
 */
export function sideIndex(trade, actor) {
  return trade.sides.findIndex((side) => side.actor === actor);
}

// One line per item and whole coins, or null when anything in it is not a valid amount.
/**
 * @param {unknown} offer
 * @returns {PlayerOffer | null}
 */
export function cleanPlayerOffer(offer) {
  const source = /** @type {any} */ (offer && typeof offer === "object" ? offer : {});
  /** @type {Map<string, number>} */
  const items = new Map();
  for (const line of Array.isArray(source.items) ? source.items : []) {
    const [id, quantity] = Array.isArray(line) ? line : [];
    if (typeof id !== "string" || !id || !Number.isInteger(quantity) || quantity < 1) return null;
    items.set(id, (items.get(id) ?? 0) + quantity);
  }
  const coins = emptyPlayerOffer().coins;
  for (const coin of Object.keys(coins)) {
    const count = Number(source.coins?.[coin] ?? 0);
    if (!Number.isInteger(count) || count < 0) return null;
    coins[coin] = count;
  }
  return { items: [...items].sort(([a], [b]) => a.localeCompare(b)), coins };
}

// A new offer for one side. When it differs from the old one, both Accepts reset.
/**
 * @param {PlayerTrade} trade
 * @param {number} index
 * @param {PlayerOffer} offer
 * @returns {PlayerTrade}
 */
export function changeOffer(trade, index, offer) {
  if (JSON.stringify(trade.sides[index].offer) === JSON.stringify(offer)) return trade;
  return {
    ...trade,
    version: trade.version + 1,
    sides: trade.sides.map((side, i) => ({ ...side, offer: i === index ? offer : side.offer, accepted: false })),
  };
}

// One side accepts the offer as it saw it. Null when the offer changed since.
/**
 * @param {PlayerTrade} trade
 * @param {number} index
 * @param {number} version
 * @returns {PlayerTrade | null}
 */
export function acceptOffer(trade, index, version) {
  if (version !== trade.version) return null;
  return { ...trade, sides: trade.sides.map((side, i) => (i === index ? { ...side, accepted: true } : side)) };
}

// Both Accepts reset without a new offer, after a trade that could not go through.
/** @param {PlayerTrade} trade */
export function resetAccepts(trade) {
  return { ...trade, version: trade.version + 1, sides: trade.sides.map((side) => ({ ...side, accepted: false })) };
}

/** @param {PlayerTrade} trade */
export function bothAccepted(trade) {
  return trade.sides.every((side) => side.accepted);
}

/** @param {PlayerOffer} offer */
export function offerIsEmpty(offer) {
  return !offer.items.length && Object.values(offer.coins).every((count) => !count);
}
