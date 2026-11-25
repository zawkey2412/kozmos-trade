// Appraisal of unpriced loot: the DC, and what a merchant remembers of earlier tries.

/** @typedef {typeof import("../data/tables.mjs").TABLES.appraisal} AppraisalTables */

/**
 * @typedef {object} AppraisalRecord
 * @property {number} day
 * @property {boolean} success
 */

/**
 * @param {{ magical?: boolean, attunement?: boolean, magicalBonus?: number, rarity?: string }} facts
 * @param {AppraisalTables} tables
 */
export function appraisalDC(facts, tables) {
  const magical = facts.magical || facts.attunement || (facts.magicalBonus ?? 0) > 0 || Boolean(facts.rarity);
  return magical ? tables.magicalDc : tables.dc;
}

// One record per customer and item. Flag keys cannot hold dots.
/**
 * @param {string} customerId
 * @param {string} itemId
 */
export function appraisalKey(customerId, itemId) {
  return `${customerId}-${itemId}`;
}

// A success stays. A failure only counts on the day it happened.
/**
 * @param {AppraisalRecord | undefined} record
 * @param {number} today
 * @returns {"appraised" | "failed" | null}
 */
export function appraisalState(record, today) {
  if (!record) return null;
  if (record.success) return "appraised";
  return record.day === today ? "failed" : null;
}