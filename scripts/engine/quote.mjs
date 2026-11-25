// What each side puts on the scale, and where the balance lands.

/**
 * @typedef {object} Settlement
 * @property {number} customerGives
 * @property {number} merchantGives
 * @property {number} net
 * @property {number} change
 * @property {number} overpay
 * @property {"short" | "even" | "generous"} state
 */

/**
 * @param {{ unit: number, quantity: number }[]} lines
 */
export function linesTotal(lines) {
  return lines.reduce((total, line) => total + line.unit * line.quantity, 0);
}

// Change comes back from coins the customer put up, unless they keep it as a tip.
/**
 * @param {object} offer
 * @param {number} offer.giveItems
 * @param {number} offer.takeItems
 * @param {number} offer.coinsGive
 * @param {number} offer.coinsTake
 * @param {boolean} [offer.keepChange]
 * @param {number} offer.sweetenStep
 * @returns {Settlement}
 */
export function settle({ giveItems, takeItems, coinsGive, coinsTake, keepChange = false, sweetenStep }) {
  const customerGives = giveItems + coinsGive;
  const merchantGives = takeItems + coinsTake;
  const net = customerGives - merchantGives;
  const change = net > 0 && !keepChange ? Math.min(net, coinsGive) : 0;
  const overpay = Math.max(0, net - change);
  let state = /** @type {Settlement["state"]} */ ("even");
  if (net < 0) state = "short";
  else if (merchantGives > 0 && overpay >= merchantGives * sweetenStep) state = "generous";
  return { customerGives, merchantGives, net, change, overpay, state };
}
