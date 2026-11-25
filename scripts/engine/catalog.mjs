// Categories, rarity order and sorting for item lists.

export const CATEGORIES = Object.freeze(["weapons", "armor", "consumables", "gear", "magic", "loot"]);
export const SORTS = Object.freeze(["name", "price", "rarity", "affordable"]);

const ARMOR = ["light", "medium", "heavy", "shield"];
const RARITY_ORDER = ["", "common", "uncommon", "rare", "veryRare", "legendary", "artifact"];

/**
 * @typedef {object} CatalogItem
 * @property {string} name
 * @property {string} type
 * @property {string} [subtype]
 * @property {string} [rarity]
 * @property {boolean} [magical]
 * @property {number | null} [price]
 */

/** @param {CatalogItem} item */
export function categoriesOf(item) {
  const found = new Set();
  if (item.type === "weapon") found.add("weapons");
  else if (item.type === "equipment" && ARMOR.includes(item.subtype ?? "")) found.add("armor");
  else if (item.type === "consumable") found.add("consumables");
  else if (item.type === "loot" && item.subtype !== "gear") found.add("loot");
  else found.add("gear");
  if (item.magical) found.add("magic");
  return found;
}

/** @param {string | undefined} rarity */
export function rarityRank(rarity) {
  return Math.max(0, RARITY_ORDER.indexOf(rarity ?? ""));
}

// A filtered and sorted copy of the list.
/**
 * @template {CatalogItem} T
 * @param {T[]} items
 * @param {{ category?: string | null, sort?: string, budget?: number, locale?: string }} options
 * @returns {T[]}
 */
export function arrange(items, { category = null, sort = "name", budget = Infinity, locale } = {}) {
  const byName = (a, b) => a.name.localeCompare(b.name, locale);
  const list = category ? items.filter((item) => categoriesOf(item).has(category)) : [...items];
  const compare = {
    name: byName,
    price: (a, b) => (b.price ?? 0) - (a.price ?? 0) || byName(a, b),
    rarity: (a, b) => rarityRank(b.rarity) - rarityRank(a.rarity) || byName(a, b),
    affordable: (a, b) => Number((a.price ?? 0) > budget) - Number((b.price ?? 0) > budget) || (b.price ?? 0) - (a.price ?? 0),
  }[sort] ?? byName;
  return list.sort(compare);
}
