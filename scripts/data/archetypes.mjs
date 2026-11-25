// Default archetypes: what each shop stocks, what it favors as a trade-in, and its specialty checks.

const ARMOR = { type: "equipment", subtypes: ["light", "medium", "heavy", "shield"] };
const WEAPONS = { type: "weapon", subtypes: ["simpleM", "simpleR", "martialM", "martialR"] };
const RANGED = { type: "weapon", subtypes: ["simpleR", "martialR"] };

export const ARCHETYPES = {
  blacksmith: {
    stocks: [WEAPONS, ARMOR],
    favored: [WEAPONS, ARMOR, { type: "loot", subtypes: ["material"] }],
    skills: ["inv"],
    tools: ["smith"],
  },
  arcane: {
    stocks: [{ type: "consumable", subtypes: ["scroll", "wand", "rod"] }, { type: "equipment", subtypes: ["ring", "rod", "wand", "wondrous"] }],
    favored: [{ magical: true }, { type: "consumable", subtypes: ["scroll"] }, { type: "loot", subtypes: ["gem"] }],
    skills: ["arc", "his"],
    tools: [],
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
