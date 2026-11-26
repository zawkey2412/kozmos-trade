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
    // Wanted board rates, rolled in steps.
    wanted: {
      category: [0.75, 1],
      namedRange: [1.25, 1.5],
      step: 0.05,
    },
  },
  // maxMundane caps the base value of items with no rarity. null is no cap.
  tiers: {
    poor: { shelf: [10, 12], maxRarity: "uncommon", maxMundane: /** @type {number | null} */ (100 * GP), purse: [50 * GP, 150 * GP] },
    modest: { shelf: [12, 14], maxRarity: "rare", maxMundane: /** @type {number | null} */ (1_000 * GP), purse: [300 * GP, 1_000 * GP] },
    wealthy: { shelf: [14, 16], maxRarity: "veryRare", maxMundane: /** @type {number | null} */ (null), purse: [2_000 * GP, 10_000 * GP] },
  },
  stock: {
    // Chance weight for each rarity by tier. Missing or 0 never rolls.
    weights: {
      poor: { mundane: 1, common: 0.5, uncommon: 0.12 },
      modest: { mundane: 1, common: 0.7, uncommon: 0.35, rare: 0.08 },
      wealthy: { mundane: 0.8, common: 0.7, uncommon: 0.5, rare: 0.2, veryRare: 0.05 },
    },
    // Stack size dice for consumables and ammunition by tier, and for mundane weapons and armor.
    consumableDice: { poor: [1, 4], modest: [1, 6], wealthy: [2, 6] },
    armsDice: [1, 2],
    curios: [1, 2],
    // Items kept under the counter for friendly customers, each restock.
    underCounter: 1,
    // Wanted board: how many categories, or the chance of one named item instead.
    wanted: {
      categories: [1, 2],
      namedChance: 0.35,
    },
  },
  access: {
    // Grid squares between the customer's and the merchant's tokens.
    proximity: 2,
  },
  market: {
    // Smallest and largest price change a market rule may make, in percent.
    minPercent: -90,
    maxPercent: 500,
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
  appraisal: {
    skills: ["inv", "arc", "nat"],
    dc: 12,
    magicalDc: 15,
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
      // Least overpay, in copper, for each point, so tiny trades cannot farm attitude.
      minPerPoint: 2 * GP,
    },
    dailyGainCap: 10,
    decay: {
      enabled: false,
      perWeek: 1,
    },
  },
};
