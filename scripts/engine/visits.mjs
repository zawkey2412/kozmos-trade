// Visits: when the party last stood at a merchant.

/** @import { Clock } from "./attitude.mjs"; */

// The latest visit by any of these characters.
/**
 * @param {Record<string, { last: number }>} visits
 * @param {Iterable<string>} ids
 * @returns {number | null}
 */
export function lastVisit(visits, ids) {
  let latest = null;
  for (const id of ids) {
    const last = visits[id]?.last;
    if (Number.isFinite(last) && (latest === null || last > latest)) latest = last;
  }
  return latest;
}

// In-game days between the day of a world time and today.
/**
 * @param {number} time
 * @param {Clock} clock
 */
export function daysSince(time, clock) {
  return Math.max(0, Math.floor(clock.now / clock.day) - Math.floor(time / clock.day));
}
