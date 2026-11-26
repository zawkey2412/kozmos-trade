// Default archetypes: what each shop stocks, what it favors as a trade-in, its specialty checks, and the services it sells.

/** @import { Service } from "../engine/services.mjs"; */

const GP = 100;
const ARMOR = { type: "equipment", subtypes: ["light", "medium", "heavy", "shield"] };
const WEAPONS = { type: "weapon", subtypes: ["simpleM", "simpleR", "martialM", "martialR"] };
const RANGED = { type: "weapon", subtypes: ["simpleR", "martialR"] };

// Services in copper, spells priced like a spell scroll of the same level.
/** @type {Service} */
const IDENTIFY = { id: "identify", kind: "identify", price: 50 * GP, icon: "fa-solid fa-eye" };
/** @type {Service} */
const CURE_WOUNDS = { id: "cureWounds", kind: "note", price: 50 * GP, icon: "fa-solid fa-heart-pulse", heal: { modern: "2d8+3", legacy: "1d8+3" } };
/** @type {Service} */
const REMOVE_CURSE = { id: "removeCurse", kind: "note", price: 300 * GP, icon: "fa-solid fa-hand-sparkles" };
/** @type {Service} */
const REPAIR = { id: "repair", kind: "note", price: 10 * GP, icon: "fa-solid fa-hammer" };
/** @type {Service} */
const ROOM_AND_MEAL = { id: "roomAndMeal", kind: "effect", price: 1 * GP, icon: "fa-solid fa-bed", effect: { img: "icons/svg/house.svg", days: 1 } };

export const ARCHETYPES = {
  blacksmith: {
    stocks: [WEAPONS, ARMOR],
    favored: [WEAPONS, ARMOR, { type: "loot", subtypes: ["material"] }],
    skills: ["inv"],
    tools: ["smith"],
    services: [REPAIR],
  },
  arcane: {
    stocks: [{ type: "consumable", subtypes: ["scroll", "wand", "rod"] }, { type: "equipment", subtypes: ["ring", "rod", "wand", "wondrous"] }],
    favored: [{ magical: true }, { type: "consumable", subtypes: ["scroll"] }, { type: "loot", subtypes: ["gem"] }],
    skills: ["arc", "his"],
    tools: [],
    services: [IDENTIFY],
  },
  apothecary: {
    stocks: [{ type: "consumable", subtypes: ["potion", "poison"] }, { type: "tool", baseItems: ["herb", "pois", "alchemist"] }, { type: "loot", subtypes: ["material"] }],
    favored: [{ type: "consumable", subtypes: ["potion"] }, { type: "loot", subtypes: ["material"] }],
    skills: ["nat", "med"],
    tools: ["alchemist"],
  },
  general: {
    stocks: [{ type: "loot", subtypes: ["gear"] }, { type: "tool" }, { type: "consumable", subtypes: ["food", "ammo"] }, { type: "container" }],
    favored: [{ type: "loot", subtypes: ["gear", "resource"] }, { type: "tool" }],
    skills: ["sur", "ins"],
    tools: [],
    services: [ROOM_AND_MEAL],
  },
  fletcher: {
    stocks: [RANGED, { type: "consumable", subtypes: ["ammo"] }],
    favored: [RANGED, { type: "consumable", subtypes: ["ammo"] }, { type: "loot", subtypes: ["material"] }],
    skills: ["sur"],
    tools: ["woodcarver"],
  },
  temple: {
    stocks: [{ type: "consumable", subtypes: ["potion"] }, { type: "equipment", subtypes: ["trinket"] }, { type: "loot", subtypes: ["gear"] }],
    favored: [{ type: "equipment", subtypes: ["trinket", "wondrous"] }, { type: "loot", subtypes: ["art"] }],
    skills: ["rel", "ins"],
    tools: [],
    services: [IDENTIFY, CURE_WOUNDS, REMOVE_CURSE],
  },
  fence: {
    stocks: [{}],
    favored: [],
    fence: true,
    skills: ["dec", "slt"],
    tools: ["thief"],
  },
  jeweler: {
    stocks: [{ type: "loot", subtypes: ["gem", "art"] }, { type: "equipment", subtypes: ["ring", "trinket"] }],
    favored: [{ type: "loot", subtypes: ["gem", "art"] }, { type: "equipment", subtypes: ["ring"] }],
    skills: ["ins"],
    tools: ["jeweler"],
  },
};

export const DEFAULT_ARCHETYPE = "general";
