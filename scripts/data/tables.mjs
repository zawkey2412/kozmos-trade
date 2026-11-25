// Default values for every number a GM can change.

const GP = 100;

export const TABLES = {
  money: {
    // Most copper a merchant overpays when it cannot make exact change.
    changeTolerance: 10,
  },
  pricing: {
    rarity: {
      modern: {
        common: 100 * GP,
        uncommon: 400 * GP,
        rare: 4_000 * GP,
        veryRare: 40_000 * GP,
        legendary: 200_000 * GP,
      },
      legacy: {
        common: [50 * GP, 100 * GP],
        uncommon: [101 * GP, 500 * GP],
        rare: [501 * GP, 5_000 * GP],
        veryRare: [5_001 * GP, 50_000 * GP],
        legendary: [50_001 * GP, 200_000 * GP],
      },
    },
    notForSale: ["artifact"],
    consumableFactor: 0.5,
    scrolls: {
      0: 30 * GP,
      1: 50 * GP,
      2: 200 * GP,
      3: 300 * GP,
      4: 2_000 * GP,
      5: 3_000 * GP,
    },
    magicalBonus: {
      1: "uncommon",
      2: "rare",
      3: "veryRare",
    },
    // Rarity of magic items with no rarity, bonus or scroll level.
    magicRarity: "uncommon",
    typeFloor: {
      weapon: 15 * GP,
      equipment: 25 * GP,
      tool: 20 * GP,
      consumable: 10 * GP,
      container: 5 * GP,
      loot: 5 * GP,
    },
    variance: 0.15,
    scarcity: {
      poor: 0.1,
      modest: 0,
      wealthy: 0,
    },
    // Shelf price steps, smallest band first.
    rounding: [
      { below: 10, step: 1 },
      { below: 100, step: 10 },
      { below: 10 * GP, step: GP },
      { below: 100 * GP, step: 5 * GP },
      { below: 1_000 * GP, step: 25 * GP },
      { step: 100 * GP },
    ],
    rates: {
      offArchetype: 0.25,
      favored: 0.5,
      fence: 0.3,
      scrap: 0.1,
    },
    wanted: {
      category: [0.75, 1],
      named: 1.5,
    },
  },
};
