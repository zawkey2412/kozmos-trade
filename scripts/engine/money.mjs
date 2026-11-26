// Copper money: conversion, paying from a purse and display.

// Copper per coin, largest first.
export const COPPER = Object.freeze({ pp: 1000, gp: 100, ep: 50, sp: 10, cp: 1 });

// Coins the balance bar reads out in.
export const READOUT = Object.freeze(["gp", "sp", "cp"]);

/**
 * @param {number} amount
 * @param {string} denomination
 * @param {Record<string, number>} [rates]
 */
export function toCopper(amount, denomination, rates = COPPER) {
  const rate = rates[denomination];
  if (!rate) throw new Error(`"${denomination}" is not a coin`);
  return Math.round(amount * rate);
}

/**
 * @param {Record<string, number>} coins
 * @param {Record<string, number>} [rates]
 */
export function coinsToCopper(coins, rates = COPPER) {
  let total = 0;
  for (const [denomination, count] of Object.entries(coins)) {
    if (count) total += toCopper(count, denomination, rates);
  }
  return total;
}

// Fewest coins, largest first.
/**
 * @param {number} copper
 * @param {readonly string[]} [denominations]
 * @param {Record<string, number>} [rates]
 */
export function splitCopper(copper, denominations = READOUT, rates = COPPER) {
  assertCopper(copper);
  const ordered = byValue(denominations, rates);
  /** @type {Record<string, number>} */
  const coins = {};
  let left = copper;
  for (const denomination of ordered) {
    coins[denomination] = Math.floor(left / rates[denomination]);
    left -= coins[denomination] * rates[denomination];
  }
  if (left) throw new Error(`${copper} cp cannot be paid in ${ordered.join(", ")}`);
  return coins;
}

// Coins from a purse that cover the amount with the least overpay, then the fewest coins.
/**
 * @param {Record<string, number>} purse
 * @param {number} amount
 * @param {{ maxOver?: number, rates?: Record<string, number> }} [options]
 * @returns {Record<string, number> | null}
 */
export function payFrom(purse, amount, { maxOver = Infinity, rates = COPPER } = {}) {
  assertCopper(amount);
  const held = byValue(Object.keys(purse).filter((denomination) => purse[denomination] > 0), rates);
  if (!held.length) return amount ? null : {};
  const limit = amount + Math.min(maxOver, rates[held[0]] - 1);
  for (let total = amount; total <= limit; total++) {
    const coins = payExactly(purse, held, total, rates);
    if (coins) return coins;
  }
  return null;
}

// Copper as coins in the reader's number format, without empty coins.
/**
 * @param {number} copper
 * @param {{ locale?: string, labels?: Record<string, string>, denominations?: readonly string[], rates?: Record<string, number> }} [options]
 */
export function formatCopper(copper, { locale, labels = {}, denominations = READOUT, rates = COPPER } = {}) {
  const coins = splitCopper(copper, denominations, rates);
  const number = new Intl.NumberFormat(locale);
  const shown = Object.entries(coins).filter(([, count]) => count);
  if (!shown.length) shown.push([Object.keys(coins)[0], 0]);
  return shown.map(([denomination, count]) => `${number.format(count)} ${labels[denomination] ?? denomination}`).join(" ");
}

// Coins as they are, largest first, without empty coins.
/**
 * @param {Record<string, number>} coins
 * @param {{ locale?: string, labels?: Record<string, string>, rates?: Record<string, number> }} [options]
 */
export function formatCoins(coins, { locale, labels = {}, rates = COPPER } = {}) {
  const number = new Intl.NumberFormat(locale);
  return byValue(Object.keys(coins).filter((coin) => coins[coin] > 0), rates)
    .map((coin) => `${number.format(coins[coin])} ${labels[coin] ?? coin}`)
    .join(" ");
}

/** @param {number} copper */
function assertCopper(copper) {
  if (!Number.isInteger(copper) || copper < 0) throw new Error(`${copper} is not a whole number of copper`);
}

/**
 * @param {readonly string[]} denominations
 * @param {Record<string, number>} rates
 */
function byValue(denominations, rates) {
  for (const denomination of denominations) {
    if (!rates[denomination]) throw new Error(`"${denomination}" is not a coin`);
  }
  return [...denominations].sort((a, b) => rates[b] - rates[a]);
}

/**
 * @param {Record<string, number>} purse
 * @param {string[]} held
 * @param {number} total
 * @param {Record<string, number>} rates
 */
function payExactly(purse, held, total, rates) {
  /** @type {Record<string, number>} */
  const coins = {};
  let left = total;
  for (const denomination of held) {
    const count = Math.min(purse[denomination], Math.floor(left / rates[denomination]));
    if (count) coins[denomination] = count;
    left -= count * rates[denomination];
  }
  return left ? null : coins;
}
