// The coins that change hands in a trade, worked out before anything moves.
import { addCoins } from "./tray.mjs";
import { COPPER, payFrom, splitCopper } from "./money.mjs";

/**
 * @typedef {object} CoinPlan
 * @property {Record<string, number>} paid
 * @property {Record<string, number>} customerAfter
 * @property {Record<string, number>} merchantAfter
 */

// The merchant pays from its purse plus the coins it just received, also those of joined characters. With no purse limit, coins it lacks are made up.
/**
 * @param {object} trade
 * @param {Record<string, number>} trade.customerHeld
 * @param {Record<string, number>} trade.merchantHeld
 * @param {Record<string, number>} trade.coinsGive
 * @param {Record<string, number>} [trade.extraGive]
 * @param {number} trade.payout
 * @param {number} trade.tolerance
 * @param {boolean} trade.purseLimit
 * @returns {CoinPlan | null}
 */
export function planCoins({ customerHeld, merchantHeld, coinsGive, extraGive = {}, payout, tolerance, purseLimit }) {
  for (const coin of Object.keys(COPPER)) if ((coinsGive[coin] ?? 0) > (customerHeld[coin] ?? 0)) return null;
  const pool = addCoins(addCoins(merchantHeld, coinsGive), extraGive);
  let paid = payout > 0 ? payFrom(pool, payout, { maxOver: tolerance }) : {};
  if (!paid) {
    if (purseLimit) return null;
    paid = splitCopper(payout);
  }
  const paidAll = addCoins(Object.fromEntries(Object.keys(COPPER).map((coin) => [coin, 0])), paid);
  const merchantAfter = addCoins(pool, paidAll, -1);
  for (const coin of Object.keys(merchantAfter)) merchantAfter[coin] = Math.max(0, merchantAfter[coin]);
  return {
    paid: paidAll,
    customerAfter: addCoins(addCoins(customerHeld, coinsGive, -1), paidAll),
    merchantAfter,
  };
}
