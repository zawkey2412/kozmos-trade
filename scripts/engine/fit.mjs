// How an item fits a shop's archetype.
import { cleanReactions } from "./reactions.mjs";
import { cleanServices } from "./services.mjs";

/** @import { ItemFacts } from "./pricing.mjs"; */
/** @import { ReactionLines } from "./reactions.mjs"; */
/** @import { Service } from "./services.mjs"; */

/**
 * @typedef {object} ItemFilter
 * @property {string} [type]
 * @property {string[]} [subtypes]
 * @property {string[]} [baseItems]
 * @property {boolean} [magical]
 */

/**
 * @typedef {object} Archetype
 * @property {string} [label]
 * @property {ItemFilter[]} stocks
 * @property {ItemFilter[]} favored
 * @property {boolean} [fence]
 * @property {string[]} skills
 * @property {string[]} tools
 * @property {ReactionLines} [reactions]
 * @property {Service[]} [services]
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

// A filter with only the keys a filter may have, each of the right kind.
/** @param {unknown} filter */
export function cleanFilter(filter) {
  if (!filter || typeof filter !== "object" || Array.isArray(filter)) throw new Error("A filter must be an object");
  /** @type {ItemFilter} */
  const clean = {};
  for (const [key, value] of Object.entries(filter)) {
    if (key === "type") {
      if (typeof value !== "string" || !value) throw new Error(`"type" must be text`);
      clean.type = value;
    } else if (key === "subtypes" || key === "baseItems") {
      if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) throw new Error(`"${key}" must be a list of text`);
      clean[key] = [...value];
    } else if (key === "magical") {
      if (typeof value !== "boolean") throw new Error(`"magical" must be true or false`);
      clean.magical = value;
    } else {
      throw new Error(`"${key}" is not a filter key`);
    }
  }
  return clean;
}

// Takes any value because archetypes come from settings, other modules and the editor.
/**
 * @param {any} archetype
 * @returns {Archetype}
 */
export function cleanArchetype(archetype) {
  if (!archetype || typeof archetype !== "object") throw new Error("An archetype must be an object");
  const texts = (/** @type {unknown} */ value, /** @type {string} */ name) => {
    if (value === undefined) return [];
    if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) throw new Error(`"${name}" must be a list of text`);
    return [...value];
  };
  const filters = (/** @type {unknown} */ value, /** @type {string} */ name) => {
    if (value === undefined) return [];
    if (!Array.isArray(value)) throw new Error(`"${name}" must be a list of filters`);
    return value.map(cleanFilter);
  };
  /** @type {Archetype} */
  const clean = {
    stocks: filters(archetype.stocks, "stocks"),
    favored: filters(archetype.favored, "favored"),
    fence: Boolean(archetype.fence),
    skills: texts(archetype.skills, "skills"),
    tools: texts(archetype.tools, "tools"),
  };
  if (typeof archetype.label === "string" && archetype.label.trim()) clean.label = archetype.label.trim();
  const reactions = cleanReactions(archetype.reactions);
  if (Object.keys(reactions).length) clean.reactions = reactions;
  if (archetype.services !== undefined) clean.services = cleanServices(archetype.services);
  return clean;
}