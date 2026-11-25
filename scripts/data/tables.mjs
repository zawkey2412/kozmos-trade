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
      6: 20_000 * GP,
      7: 25_000 * GP,
      8: 30_000 * GP,
      9: 100_000 * GP,
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
  haggle: {
    asks: [0.05, 0.1, 0.15, 0.2, 0.25],
    limitedMaxAsk: 0.1,
    // DC added for each 5% asked.
    dcPerStep: 2,
    askStep: 0.05,
    bigWin: 10,
    bigLoss: 5,
  },
  attitude: {
    min: -50,
    max: 50,
    // Price change at full attitude, both ways.
    swing: 0.15,
    // Attitude points per point of haggle DC.
    dcDivisor: 10,
    // Highest value in each band, lowest band first.
    bands: [
      { id: "hostile", max: -31 },
      { id: "cold", max: -11 },
      { id: "neutral", max: 10 },
      { id: "warm", max: 30 },
      { id: "friendly", max: 50 },
    ],
    refuseAt: -40,
    events: {
      fairTrade: 1,
      wanted: 5,
      haggleBigWin: 2,
      intimidate: -5,
      haggleBigLoss: -10,
      caughtStealing: -30,
    },
    sweeten: {
      step: 0.05,
      perStep: 1,
      maxPerTrade: 5,
    },
    dailyGainCap: 10,
    decay: {
      enabled: false,
      perWeek: 1,
    },
  },
};
