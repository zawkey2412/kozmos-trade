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
  visits: {
    // Different items the Last visited note keeps for each list.
    remember: 10,
  },
  access: {
    // Grid squares between the customer's and the merchant's tokens.
    proximity: 2,
    // Seconds a player has to answer another player's trade invite.
    inviteSeconds: 60,
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
  theft: {
    skill: "slt",
    distractSkills: ["dec", "prf"],
    // Margins that make a clean take or a catch.
    clean: 5,
    caught: 5,
    // Pocketable items: by subtype, or by weight in pounds above 0.
    small: {
      dc: -2,
      subtypes: { consumable: ["potion", "scroll"], equipment: ["ring", "trinket"], loot: ["gem"] },
      maxWeight: 1,
    },
    // Items that cannot be stolen: by subtype, weapon property or weight in pounds.
    bulky: {
      subtypes: { equipment: ["light", "medium", "heavy", "shield"] },
      properties: ["hvy"],
      minWeight: 20,
    },
    limited: 5,
    perSuspicion: 2,
    maxSuspicion: 3,
    friendly: -2,
    guard: 3,
    // Highest rarity a customer may try for without GM approval, when the cap is on.
    approvalAbove: "uncommon",
    // What a caught thief pays for the item, as a share of its price.
    fine: 2,
    // Attitude change per notoriety point at every merchant in the scene, and points lost each in-game week.
    notoriety: { perPoint: -10, fadePerWeek: 1 },
    // Skill a merchant rolls to spot stolen goods, against the seller's passive skill.
    recognize: { merchant: "ins", seller: "dec" },
  },
  effects: {
    sounds: {
      stage: "modules/kozmos-trade/sounds/coin.wav",
      trade: "modules/kozmos-trade/sounds/coins.wav",
    },
    // Coin burst over the merchant's token: coin radius in pixels, particles, their life in milliseconds, speed in pixels a second, and size.
    burst: {
      radius: 8,
      count: 36,
      lifetime: [600, 1100],
      speed: [140, 320],
      scale: [0.12, 0.3],
    },
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
      theftNoticed: -10,
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
