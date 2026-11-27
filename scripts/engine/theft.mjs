// Theft: what can be pocketed, the hidden DC, outcomes and Suspicion.
import { rarityRank } from "./catalog.mjs";

/** @typedef {typeof import("../data/tables.mjs").TABLES.theft} TheftTables */
/** @typedef {"small" | "normal" | "bulky"} PocketSize */
/** @typedef {"clean" | "taken" | "fumble" | "caught"} TheftOutcome */
/** @typedef {"none" | "rare" | "all"} TheftApproval */

/**
 * @typedef {object} SizeFacts
 * @property {string} type
 * @property {string} [subtype]
 * @property {number} weight
 * @property {string[]} properties
 */

/**
 * @typedef {object} TheftCheck
 * @property {number} perception
 * @property {PocketSize} size
 * @property {boolean} [limited]
 * @property {boolean} [pinned]
 * @property {number} [suspicion]
 * @property {boolean} [friendly]
 * @property {boolean} [guarded]
 */

/**
 * @param {SizeFacts} item
 * @param {TheftTables} tables
 * @returns {PocketSize}
 */
export function pocketSize(item, tables) {
  const listed = (/** @type {Record<string, string[]>} */ lists) => (lists[item.type] ?? []).includes(item.subtype ?? "");
  const heavy = item.properties.some((property) => tables.bulky.properties.includes(property));
  if (listed(tables.bulky.subtypes) || heavy || item.weight >= tables.bulky.minWeight) return "bulky";
  if (listed(tables.small.subtypes) || (item.weight > 0 && item.weight <= tables.small.maxWeight)) return "small";
  return "normal";
}

// The hidden DC, with each factor that moved it.
/**
 * @param {TheftCheck} check
 * @param {TheftTables} tables
 */
export function theftDC({ perception, size, limited = false, pinned = false, suspicion = 0, friendly = false, guarded = false }, tables) {
  /** @type {{ kind: string, value: number }[]} */
  const factors = [];
  if (size === "small") factors.push({ kind: "small", value: tables.small.dc });
  if (limited || pinned) factors.push({ kind: "limited", value: tables.limited });
  if (suspicion > 0) factors.push({ kind: "suspicion", value: tables.perSuspicion * Math.min(suspicion, tables.maxSuspicion) });
  if (friendly) factors.push({ kind: "friendly", value: tables.friendly });
  if (guarded) factors.push({ kind: "guard", value: tables.guard });
  return { dc: perception + factors.reduce((total, factor) => total + factor.value, 0), factors };
}

/**
 * @param {number} total
 * @param {number} dc
 * @param {TheftTables} tables
 * @returns {TheftOutcome}
 */
export function theftOutcome(total, dc, tables) {
  const margin = total - dc;
  if (margin >= tables.clean) return "clean";
  if (margin >= 0) return "taken";
  return -margin >= tables.caught ? "caught" : "fumble";
}

// Counts Suspicion only on the in-game day it was raised.
/**
 * @param {number} suspicion
 * @param {number | null} day
 * @param {number} today
 */
export function suspicionToday(suspicion, day, today) {
  return day === today ? suspicion : 0;
}

/**
 * @param {number} suspicion
 * @param {number | null} day
 * @param {number} today
 * @param {TheftTables} tables
 */
export function raiseSuspicion(suspicion, day, today, tables) {
  return { suspicion: Math.min(tables.maxSuspicion, suspicionToday(suspicion, day, today) + 1), day: today };
}

// Whether a theft waits for a GM's approval before the roll.
/**
 * @param {TheftApproval} rule
 * @param {string | undefined} rarity
 * @param {TheftTables} tables
 */
export function needsApproval(rule, rarity, tables) {
  if (rule === "all") return true;
  return rule === "rare" && rarityRank(rarity) > rarityRank(tables.approvalAbove);
}

// The customer who visited last, by the visits record.
/** @param {Record<string, { last: number }>} visits */
export function lastCustomer(visits) {
  let best = null;
  for (const [id, visit] of Object.entries(visits)) if (best === null || visit.last > visits[best].last) best = id;
  return best;
}
