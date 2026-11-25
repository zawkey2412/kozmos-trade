// How an item fits a shop's archetype.

/** @import { ItemFacts } from "./pricing.mjs"; */

/**
 * @typedef {object} ItemFilter
 * @property {string} [type]
 * @property {string[]} [subtypes]
 * @property {string[]} [baseItems]
 * @property {boolean} [magical]
 */

/**
 * @typedef {object} Archetype
 * @property {ItemFilter[]} stocks
 * @property {ItemFilter[]} favored
 * @property {boolean} [fence]
 * @property {string[]} skills
 * @property {string[]} tools
 */

/**
 * @param {ItemFacts & { baseItem?: string }} item
 * @param {ItemFilter} filter
 */
export function matchesFilter(item, filter) {
  if (filter.type && filter.type !== item.type) return false;
  if (filter.subtypes && !filter.subtypes.includes(item.subtype ?? "")) return false;
  if (filter.baseItems && !filter.baseItems.includes(item.baseItem ?? "")) return false;
  if (filter.magical && !(item.magical || item.attunement || item.magicalBonus > 0 || item.rarity)) return false;
  return true;
}

/**
 * @param {ItemFacts & { baseItem?: string }} item
 * @param {ItemFilter[]} filters
 */
export function matchesAny(item, filters) {
  return filters.some((filter) => matchesFilter(item, filter));
}

// What a shop makes of a customer's item when buying it.
/**
 * @param {ItemFacts & { baseItem?: string }} item
 * @param {Archetype | undefined} archetype
 */
export function sellFit(item, archetype) {
  if (!archetype) return { fence: false, favored: false };
  return { fence: Boolean(archetype.fence), favored: matchesAny(item, archetype.favored) };
}
