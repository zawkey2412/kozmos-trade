// Visits: when the party last stood at a merchant, and what each character traded there.

/** @import { Clock } from "./attitude.mjs"; */

/** @typedef {{ name: string, quantity: number }} VisitLine */

/**
 * @typedef {object} VisitRecord
 * @property {number} last
 * @property {number | null} [tradedAt]
 * @property {VisitLine[]} [sold]
 * @property {VisitLine[]} [bought]
 */

/**
 * @typedef {object} VisitNote
 * @property {number} days
 * @property {number | null} tradedDays
 * @property {VisitLine[]} sold
 * @property {VisitLine[]} bought
 */

// The record after a trade: lines join the visit's lists, which start again on the first trade of a visit.
/**
 * @param {VisitRecord} record
 * @param {{ sold: VisitLine[], bought: VisitLine[], now: number, max: number, fresh: boolean }} trade
 * @returns {VisitRecord}
 */
export function addTraded(record, { sold, bought, now, max, fresh }) {
  return {
    last: record.last,
    tradedAt: now,
    sold: mergeLines(fresh ? [] : (record.sold ?? []), sold, max),
    bought: mergeLines(fresh ? [] : (record.bought ?? []), bought, max),
  };
}

// What a returning character should remember: when they came last, and their last trade here.
/**
 * @param {VisitRecord | undefined} record
 * @param {Clock} clock
 * @returns {VisitNote | null}
 */
export function visitNote(record, clock) {
  if (!record || !Number.isFinite(record.last)) return null;
  const traded = record.tradedAt != null && Boolean(record.sold?.length || record.bought?.length);
  return {
    days: daysSince(record.last, clock),
    tradedDays: traded ? daysSince(Number(record.tradedAt), clock) : null,
    sold: traded ? [...(record.sold ?? [])] : [],
    bought: traded ? [...(record.bought ?? [])] : [],
  };
}

// Same names add up, and the list keeps its first entries up to the limit.
/**
 * @param {VisitLine[]} known
 * @param {VisitLine[]} added
 * @param {number} max
 */
function mergeLines(known, added, max) {
  /** @type {Map<string, number>} */
  const totals = new Map(known.map((line) => [line.name, line.quantity]));
  for (const line of added) totals.set(line.name, (totals.get(line.name) ?? 0) + line.quantity);
  return [...totals].slice(0, max).map(([name, quantity]) => ({ name, quantity }));
}

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
