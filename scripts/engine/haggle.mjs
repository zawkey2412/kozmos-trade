// Haggling: asks, the DC, results and locks.
import { attitudeMod } from "./attitude.mjs";

/** @typedef {typeof import("../data/tables.mjs").TABLES} Tables */
/** @typedef {import("./attitude.mjs").AttitudeEvent} AttitudeEvent */

/**
 * @typedef {object} HaggleResult
 * @property {boolean} success
 * @property {number} discount
 * @property {boolean} locked
 * @property {AttitudeEvent[]} events
 */

/**
 * @param {{ limited?: boolean }} offer
 * @param {Tables["haggle"]} tables
 */
export function allowedAsks({ limited = false }, tables) {
  return limited ? tables.asks.filter((ask) => ask <= tables.limitedMaxAsk) : [...tables.asks];
}

/**
 * @param {{ insight: number, ask: number, attitude?: number }} check
 * @param {Tables} tables
 */
export function haggleDC({ insight, ask, attitude = 0 }, tables) {
  const steps = Math.round(ask / tables.haggle.askStep);
  return insight + tables.haggle.dcPerStep * steps - attitudeMod(attitude, tables.attitude);
}

/**
 * @param {{ total: number, dc: number, ask: number, intimidation?: boolean }} roll
 * @param {Tables["haggle"]} tables
 * @returns {HaggleResult}
 */
export function haggleResult({ total, dc, ask, intimidation = false }, tables) {
  const margin = total - dc;
  /** @type {AttitudeEvent[]} */
  const events = [];
  if (margin >= 0) {
    if (margin >= tables.bigWin) events.push("haggleBigWin");
    if (intimidation) events.push("intimidate");
    return { success: true, discount: ask, locked: false, events };
  }
  if (-margin >= tables.bigLoss) events.push("haggleBigLoss");
  return { success: false, discount: 0, locked: true, events };
}

// World time the lock ends: the start of the next in-game day.
/**
 * @param {number} now
 * @param {number} dayLength
 */
export function lockUntil(now, dayLength) {
  return (Math.floor(now / dayLength) + 1) * dayLength;
}

/**
 * @param {number | undefined} until
 * @param {number} now
 */
export function isLocked(until, now) {
  return until !== undefined && now < until;
}
