import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ARCHETYPES } from "../scripts/data/archetypes.mjs";
import { TABLES } from "../scripts/data/tables.mjs";
import { rollable, rollDice, rollShelf, stackSize, weightedPick } from "../scripts/engine/stock.mjs";

// The same numbers every run.
function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

const value = (copper, source = "price") => ({ copper, source, forSale: true });
const candidate = (name, facts, copper = 1000, source = "price") => ({ uuid: `Compendium.test.${name}`, name, facts, value: value(copper, source) });
const pool = [
  candidate("Longsword", { type: "weapon", subtype: "martialM", baseItem: "longsword" }, 1500),
  candidate("Dagger", { type: "weapon", subtype: "simpleM" }, 200),
  candidate("Plate", { type: "equipment", subtype: "heavy" }, 150000),
  candidate("Shield", { type: "equipment", subtype: "shield" }, 1000),
  candidate("Chain Mail", { type: "equipment", subtype: "heavy" }, 7500),
  candidate("Longsword +1", { type: "weapon", subtype: "martialM", rarity: "uncommon", magicalBonus: 1 }, 40000),
  candidate("Flame Tongue", { type: "weapon", subtype: "martialM", rarity: "rare" }, 400000),
  candidate("Vorpal Sword", { type: "weapon", subtype: "martialM", rarity: "legendary" }, 20000000),
  candidate("Potion", { type: "consumable", subtype: "potion", rarity: "common" }, 5000),
  candidate("Rope", { type: "loot", subtype: "gear" }, 100),
  candidate("Odd Junk", { type: "loot", subtype: "junk" }, 500, "floor"),
  candidate("Battleaxe", { type: "weapon", subtype: "martialM", baseItem: "battleaxe" }, 1500, "floor"),
  candidate("Unarmed Strike", { type: "weapon", subtype: "simpleM" }, 1500, "floor"),
];

describe("what may roll", () => {
  it("keeps legendary items and artifacts off every shelf", () => {
    assert.equal(rollable(pool[7], "veryRare"), false);
  });

  it("stops at the tier's highest rarity", () => {
    assert.equal(rollable(pool[5], "uncommon"), true);
    assert.equal(rollable(pool[6], "uncommon"), false);
  });

  it("caps the price of mundane items, but not of magic items", () => {
    assert.equal(rollable(pool[2], "uncommon", TABLES.tiers.poor.maxMundane), false);
    assert.equal(rollable(pool[4], "uncommon", TABLES.tiers.poor.maxMundane), true);
    assert.equal(rollable(pool[5], "uncommon", TABLES.tiers.poor.maxMundane), true);
    assert.equal(rollable(pool[2], "veryRare", TABLES.tiers.wealthy.maxMundane), true);
  });

  it("skips filler, but not standard weapons and armor", () => {
    assert.equal(rollable(pool[10], "rare"), false);
    assert.equal(rollable(pool[11], "rare"), true);
    assert.equal(rollable(pool[12], "rare"), false);
  });
});

describe("weighted picks", () => {
  it("picks the count asked, each item once, and never a weight of 0", () => {
    const picks = weightedPick(pool, { mundane: 1, common: 1, uncommon: 0 }, 5, seeded(1));
    assert.equal(picks.length, 5);
    assert.equal(new Set(picks.map((p) => p.name)).size, 5);
    assert.ok(picks.every((p) => p.facts.rarity !== "uncommon"));
  });

  it("returns what there is when asked for more", () => {
    assert.equal(weightedPick(pool.slice(0, 3), { mundane: 1 }, 10, seeded(2)).length, 3);
  });
});

describe("stack sizes", () => {
  it("keeps uncommon and rarer items single", () => {
    assert.equal(stackSize(pool[5].facts, "wealthy", TABLES.stock, seeded(3)), 1);
  });

  it("rolls consumables by tier and arms on 1d2", () => {
    const random = seeded(4);
    for (let i = 0; i < 50; i++) {
      const potion = stackSize({ type: "consumable", subtype: "ammo" }, "wealthy", TABLES.stock, random);
      assert.ok(potion >= 2 && potion <= 12);
      const sword = stackSize(pool[0].facts, "modest", TABLES.stock, random);
      assert.ok(sword >= 1 && sword <= 2);
    }
    assert.equal(stackSize(pool[9].facts, "modest", TABLES.stock, random), 1);
  });

  it("rolls dice in range", () => {
    const random = seeded(5);
    for (let i = 0; i < 100; i++) {
      const roll = rollDice([2, 6], random);
      assert.ok(roll >= 2 && roll <= 12);
    }
  });
});

describe("a whole shelf", () => {
  const roll = (seed, tier = "modest") =>
    rollShelf(pool, { archetype: ARCHETYPES.blacksmith, tier, tables: TABLES, random: seeded(seed), value: (c) => c.value });

  it("is the same for the same seed", () => {
    assert.deepEqual(roll(7), roll(7));
  });

  it("stays inside the tier's purse range", () => {
    for (let seed = 1; seed < 30; seed++) {
      const { purse } = roll(seed, "poor");
      assert.ok(purse >= 5000 && purse <= 15000, `purse ${purse}`);
    }
  });

  it("marks curios from outside the archetype and Limited Stock for uncommon items", () => {
    const { picks } = roll(11, "wealthy");
    const names = picks.map((p) => p.name);
    for (const curio of picks.filter((p) => p.curio)) assert.ok(["Potion", "Rope"].includes(curio.name), curio.name);
    for (const pick of picks) assert.equal(pick.limited, ["Longsword +1", "Flame Tongue"].includes(pick.name), pick.name);
    assert.ok(!names.includes("Vorpal Sword"));
    assert.ok(!names.includes("Odd Junk"));
    assert.equal(new Set(names).size, names.length);
  });

  it("keeps expensive mundane goods off poor shelves", () => {
    for (let seed = 1; seed < 30; seed++) assert.ok(!roll(seed, "poor").picks.some((p) => p.name === "Plate"), `seed ${seed}`);
  });

  it("adds items under the counter from the archetype, apart from the shelf", () => {
    const swords = Array.from({ length: 20 }, (_, i) => candidate(`Sword ${i}`, { type: "weapon", subtype: "martialM", baseItem: "longsword" }, 1500));
    const { picks } = rollShelf([...pool, ...swords], { archetype: ARCHETYPES.blacksmith, tier: "modest", tables: TABLES, random: seeded(21), value: (c) => c.value, underCounter: 1 });
    const hidden = picks.filter((p) => p.underCounter);
    assert.equal(hidden.length, 1);
    assert.ok(!hidden[0].curio);
    assert.equal(new Set(picks.map((p) => p.name)).size, picks.length);
    assert.ok(roll(21).picks.every((p) => !p.underCounter));
  });

  it("prices every pick on a shelf step", () => {
    for (const pick of roll(13).picks) assert.ok(Number.isInteger(pick.price) && pick.price > 0, `${pick.name} ${pick.price}`);
  });
});
