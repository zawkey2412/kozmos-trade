// Copper money: conversion, totals and coin splits.

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
  if (!Number.isInteger(copper) || copper < 0) throw new Error(`${copper} is not a whole number of copper`);
  const ordered = [...denominations].sort((a, b) => rates[b] - rates[a]);
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
