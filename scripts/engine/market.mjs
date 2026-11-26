// Market rules: temporary price changes for item categories, in one scene or the whole world.
import { CATEGORIES, categoriesOf } from "./catalog.mjs";

/**
 * @typedef {object} MarketRule
 * @property {string} id
 * @property {string} name
 * @property {string[]} categories
 * @property {number} multiplier
 * @property {number | null} until
 */

/**
 * @typedef {object} MarketItem
 * @property {string} type
 * @property {string} [subtype]
 * @property {string} [rarity]
 * @property {boolean} [magical]
 */

// Catalog categories, plus food for rules such as a festival.
/** @type {readonly string[]} */
export const MARKET_CATEGORIES = Object.freeze([...CATEGORIES, "food"]);

/** @param {MarketItem} item */
export function marketCategoriesOf(item) {
  const found = categoriesOf({ name: "", ...item });
  if (item.type === "consumable" && item.subtype === "food") found.add("food");
  return found;
}

// Rules whose end date has not come yet, and rules with none.
/**
 * @param {MarketRule[]} rules
 * @param {number} now
 */
export function activeRules(rules, now) {
  return rules.filter((rule) => rule.until === null || now < rule.until);
}

// A rule with no categories covers every item.
/**
 * @param {MarketRule} rule
 * @param {MarketItem} item
 */
export function ruleApplies(rule, item) {
  if (!rule.categories.length) return true;
  const found = marketCategoriesOf(item);
  return rule.categories.some((category) => found.has(category));
}

// Every rule that covers the item, multiplied together.
/**
 * @param {MarketItem | null | undefined} item
 * @param {MarketRule[]} rules
 */
export function marketFactor(item, rules) {
  if (!item) return 1;
  return rules.filter((rule) => ruleApplies(rule, item)).reduce((factor, rule) => factor * rule.multiplier, 1);
}

// A new rule from what the GM typed: a percent change and a length in days, or no end date.
/**
 * @param {{ name: unknown, categories: unknown, percent: unknown, days: unknown }} input
 * @param {{ id: string, now: number, day: number, limits: { minPercent: number, maxPercent: number } }} context
 * @returns {MarketRule}
 */
export function newRule({ name, categories, percent, days }, { id, now, day, limits }) {
  const label = String(name ?? "").trim();
  if (!label) throw new Error("KT.Market.Rules.NoName");
  const change = Number(percent);
  if (!Number.isFinite(change) || change === 0 || change < limits.minPercent || change > limits.maxPercent) throw new Error("KT.Market.Rules.BadPercent");
  const list = (Array.isArray(categories) ? categories : categories ? [categories] : []).map(String);
  if (list.some((category) => !MARKET_CATEGORIES.includes(category))) throw new Error("KT.Market.Rules.BadCategory");
  const length = days === null || days === undefined || days === "" ? null : Number(days);
  if (length !== null && !(Number.isFinite(length) && length > 0)) throw new Error("KT.Market.Rules.BadDays");
  return {
    id,
    name: label,
    categories: [...new Set(list)],
    multiplier: Math.round((1 + change / 100) * 10_000) / 10_000,
    until: length === null ? null : Math.round(now + length * day),
  };
}

// The change a multiplier makes, as a whole percent.
/** @param {number} multiplier */
export function percentOf(multiplier) {
  return Math.round((multiplier - 1) * 100);
}
