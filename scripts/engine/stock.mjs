// Rolling a shelf: which items, how many of each, at what price, and the purse.
import { matchesAny } from "./fit.mjs";
import { COPPER } from "./money.mjs";
import { shelfPrice } from "./pricing.mjs";
import { rarityRank } from "./catalog.mjs";

/** @import { Archetype } from "./fit.mjs"; */
/** @import { BaseValue, ItemFacts } from "./pricing.mjs"; */

/** @typedef {typeof import("../data/tables.mjs").TABLES} Tables */

/**
 * @typedef {object} Candidate
 * @property {string} uuid
 * @property {string} name
 * @property {ItemFacts} facts
 * @property {BaseValue} value
 */

/**
 * @typedef {object} Pick
 * @property {string} uuid
 * @property {string} name
 * @property {number} quantity
 * @property {number} price
 * @property {boolean} limited
 * @property {boolean} curio
 */

const ARMS = { weapon: ["simpleM", "simpleR", "martialM", "martialR"], equipment: ["light", "medium", "heavy", "shield"] };
const NEVER = ["legendary", "artifact"];

/**
 * @param {number} low
 * @param {number} high
 * @param {() => number} random
 */
export function randomInt(low, high, random) {
  return low + Math.floor(random() * (high - low + 1));
}

/**
 * @param {[number, number]} dice
 * @param {() => number} random
 */
export function rollDice([count, faces], random) {
  let total = 0;
  for (let i = 0; i < count; i++) total += randomInt(1, faces, random);
  return total;
}

// A real base weapon or armor, not an attack or a homebrew stand-in.
/** @param {ItemFacts} facts */
export function isStandardArms(facts) {
  return Boolean(facts.baseItem) && (ARMS[facts.type] ?? []).includes(facts.subtype ?? "");
}

// Items a shop of this tier may ever roll: for sale, not above the tier's rarity, and not filler.
/**
 * @param {Candidate} candidate
 * @param {string} maxRarity
 */
export function rollable(candidate, maxRarity) {
  const { facts, value } = candidate;
  if (!value.forSale || value.copper <= 0) return false;
  if (NEVER.includes(facts.rarity ?? "")) return false;
  if (rarityRank(facts.rarity) > rarityRank(maxRarity)) return false;
  return value.source !== "floor" || isStandardArms(facts);
}

// Picks up to count items, each weighted by its rarity, none twice.
/**
 * @template {{ facts: ItemFacts }} T
 * @param {T[]} candidates
 * @param {Record<string, number>} weights
 * @param {number} count
 * @param {() => number} random
 * @returns {T[]}
 */
export function weightedPick(candidates, weights, count, random) {
  return candidates
    .map((candidate) => ({ candidate, weight: weights[candidate.facts.rarity || "mundane"] ?? 0 }))
    .filter((entry) => entry.weight > 0)
    .map((entry) => ({ ...entry, key: Math.pow(random(), 1 / entry.weight) }))
    .sort((a, b) => b.key - a.key)
    .slice(0, count)
    .map((entry) => entry.candidate);
}

/**
 * @param {ItemFacts} facts
 * @param {string} tier
 * @param {Tables["stock"]} stock
 * @param {() => number} random
 */
export function stackSize(facts, tier, stock, random) {
  if (rarityRank(facts.rarity) >= rarityRank("uncommon")) return 1;
  if (facts.type === "consumable") return rollDice(/** @type {[number, number]} */ (stock.consumableDice[tier] ?? [1, 4]), random);
  if (isStandardArms(facts)) return rollDice(/** @type {[number, number]} */ (stock.armsDice), random);
  return 1;
}

// A new shelf for a shop: the archetype's stock, one or two curios from outside it, and the purse.
/**
 * @param {Candidate[]} candidates
 * @param {{ archetype: Archetype, tier: string, tables: Tables, random: () => number, value: (candidate: Candidate) => BaseValue }} options
 * @returns {{ picks: Pick[], purse: number }}
 */
export function rollShelf(candidates, { archetype, tier, tables, random, value }) {
  const tierTable = tables.tiers[tier] ?? tables.tiers.modest;
  const weights = tables.stock.weights[tier] ?? tables.stock.weights.modest;
  const eligible = candidates.filter((candidate) => rollable(candidate, tierTable.maxRarity));
  const inArchetype = eligible.filter((candidate) => matchesAny(candidate.facts, archetype.stocks));
  const outside = eligible.filter((candidate) => !matchesAny(candidate.facts, archetype.stocks));

  const size = randomInt(tierTable.shelf[0], tierTable.shelf[1], random);
  const curioCount = Math.min(outside.length, randomInt(tables.stock.curios[0], tables.stock.curios[1], random));
  const main = weightedPick(inArchetype, weights, Math.max(0, size - curioCount), random);
  const curios = weightedPick(outside, weights, curioCount, random);

  const pick = (/** @type {Candidate} */ candidate, /** @type {boolean} */ curio) => {
    const base = value(candidate);
    return {
      uuid: candidate.uuid,
      name: candidate.name,
      quantity: stackSize(candidate.facts, tier, tables.stock, random),
      price: shelfPrice(base.copper, tables.pricing, { random, tier }),
      limited: rarityRank(candidate.facts.rarity) >= rarityRank("uncommon"),
      curio,
    };
  };
  const purseGp = randomInt(Math.ceil(tierTable.purse[0] / COPPER.gp), Math.floor(tierTable.purse[1] / COPPER.gp), random);
  return { picks: [...main.map((c) => pick(c, false)), ...curios.map((c) => pick(c, true))], purse: purseGp * COPPER.gp };
}
