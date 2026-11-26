// The Wanted board: what a merchant pays a premium for, and whether an item is on it.
import { CATEGORIES, categoriesOf } from "./catalog.mjs";
import { matchesAny } from "./fit.mjs";
import { randomInt, rollable, weightedPick } from "./stock.mjs";

/** @import { Archetype } from "./fit.mjs"; */
/** @import { Candidate } from "./stock.mjs"; */
/** @typedef {typeof import("../data/tables.mjs").TABLES} Tables */

/**
 * @typedef {object} WantedEntry
 * @property {string} category
 * @property {string} uuid
 * @property {string} name
 * @property {number} multiplier
 */

/**
 * @typedef {object} WantedItem
 * @property {string} type
 * @property {string} [subtype]
 * @property {boolean} [magical]
 * @property {string} [rarity]
 * @property {string} [name]
 * @property {string | null} [source]
 */

// A rate in steps between low and high, both included.
/**
 * @param {[number, number]} range
 * @param {number} step
 * @param {() => number} random
 */
function rollRate([low, high], step, random) {
  const steps = Math.round((high - low) / step);
  return Math.round((low + randomInt(0, steps, random) * step) * 100) / 100;
}

// One named item from the archetype's stock at a premium, or one or two categories.
/**
 * @param {Candidate[]} candidates
 * @param {{ archetype: Archetype, tier: string, tables: Tables, random: () => number, exclude?: string[] }} options
 * @returns {WantedEntry[]}
 */
export function rollWanted(candidates, { archetype, tier, tables, random, exclude = [] }) {
  const settings = tables.stock.wanted;
  const rates = tables.pricing.wanted;
  if (random() < settings.namedChance) {
    const tierTable = tables.tiers[tier] ?? tables.tiers.modest;
    const weights = tables.stock.weights[tier] ?? tables.stock.weights.modest;
    const pool = candidates.filter((c) => !exclude.includes(c.uuid) && rollable(c, tierTable.maxRarity, tierTable.maxMundane) && matchesAny(c.facts, archetype.stocks));
    const [named] = weightedPick(pool, weights, 1, random);
    if (named) return [{ category: "", uuid: named.uuid, name: named.name, multiplier: rollRate(/** @type {[number, number]} */ (rates.namedRange), rates.step, random) }];
  }
  const count = randomInt(settings.categories[0], settings.categories[1], random);
  const shuffled = [...CATEGORIES].map((category) => ({ category, key: random() })).sort((a, b) => a.key - b.key);
  return shuffled.slice(0, count).map(({ category }) => ({ category, uuid: "", name: "", multiplier: rollRate(/** @type {[number, number]} */ (rates.category), rates.step, random) }));
}

// The best Wanted rate for an item, or null when the board does not want it.
/**
 * @param {WantedItem} item
 * @param {WantedEntry[]} board
 */
export function wantedRate(item, board) {
  let best = null;
  for (const entry of board) {
    const named = entry.uuid && (entry.uuid === item.source || (entry.name && entry.name === item.name));
    const category = entry.category && categoriesOf({ name: item.name ?? "", ...item }).has(entry.category);
    if ((named || category) && (best === null || entry.multiplier > best)) best = entry.multiplier;
  }
  return best;
}

// Named entries the given items fill.
/**
 * @param {WantedItem[]} items
 * @param {WantedEntry[]} board
 */
export function namedFilled(items, board) {
  return board.filter((entry) => entry.uuid && items.some((item) => entry.uuid === item.source || (entry.name && entry.name === item.name)));
}
