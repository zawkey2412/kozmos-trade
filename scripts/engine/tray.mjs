// Offer trays: what is staged on each side, in what quantity, and the coins put up.
import { COPPER } from "./money.mjs";

/**
 * @typedef {object} Offer
 * @property {Map<string, number>} give
 * @property {Map<string, number>} take
 * @property {Map<string, number>} buyback
 * @property {Map<string, number>} services
 * @property {Record<string, number>} coinsGive
 * @property {Record<string, number>} coinsTake
 * @property {boolean} keepChange
 */

/** @returns {Record<string, number>} */
export function noCoins() {
  return Object.fromEntries(Object.keys(COPPER).map((coin) => [coin, 0]));
}

/** @returns {Offer} */
export function emptyOffer() {
  return { give: new Map(), take: new Map(), buyback: new Map(), services: new Map(), coinsGive: noCoins(), coinsTake: noCoins(), keepChange: false };
}

// How many a click stages: 1, half the stack with Shift, all of it with Ctrl or Cmd.
/**
 * @param {number} left
 * @param {{ half?: boolean, all?: boolean }} [modifiers]
 */
export function stageAmount(left, { half = false, all = false } = {}) {
  if (left <= 0) return 0;
  if (all) return left;
  if (half) return Math.max(1, Math.ceil(left / 2));
  return 1;
}

/**
 * @param {Map<string, number>} lines
 * @param {string} id
 * @param {number} quantity
 * @param {number} max
 */
export function setLine(lines, id, quantity, max) {
  const clamped = Math.min(Math.max(0, Math.floor(quantity)), max);
  if (clamped > 0) lines.set(id, clamped);
  else lines.delete(id);
  return clamped;
}

// Coin counts kept between 0 and what the holder has.
/**
 * @param {Record<string, number>} coins
 * @param {Record<string, number> | null} held
 */
export function clampCoins(coins, held) {
  return Object.fromEntries(
    Object.keys(COPPER).map((coin) => {
      const count = Math.max(0, Math.floor(Number(coins[coin]) || 0));
      return [coin, held ? Math.min(count, held[coin] ?? 0) : count];
    }),
  );
}

/**
 * @param {Record<string, number>} a
 * @param {Record<string, number>} b
 * @param {1 | -1} [sign]
 */
export function addCoins(a, b, sign = 1) {
  return Object.fromEntries(Object.keys(COPPER).map((coin) => [coin, (a[coin] ?? 0) + sign * (b[coin] ?? 0)]));
}

/** @param {Offer} offer */
export function isEmpty(offer) {
  const noCoinsIn = (coins) => Object.values(coins).every((count) => !count);
  return !offer.give.size && !offer.take.size && !offer.buyback.size && !offer.services?.size && noCoinsIn(offer.coinsGive) && noCoinsIn(offer.coinsTake);
}
