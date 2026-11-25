import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TABLES } from "../scripts/data/tables.mjs";
import { baseValue, buyPrice, roundToStep, sellBasis, sellPrice, sellRate, shelfPrice } from "../scripts/engine/pricing.mjs";

const tables = TABLES.pricing;
const GP = 100;
const fixed = (value) => () => value;

describe("base value waterfall", () => {
  it("uses an explicit price first, in its own coin", () => {
    const value = baseValue({ type: "weapon", price: { value: 2, denomination: "sp" }, rarity: "rare" }, tables);
    assert.deepEqual(value, { copper: 20, source: "price", forSale: true });
  });

  it("skips a price of 0", () => {
    const value = baseValue({ type: "weapon", price: { value: 0, denomination: "gp" }, rarity: "rare" }, tables);
    assert.equal(value.source, "rarity");
  });

  it("uses the 2024 rarity baseline", () => {
    assert.equal(baseValue({ type: "equipment", rarity: "common" }, tables).copper, 100 * GP);
    assert.equal(baseValue({ type: "equipment", rarity: "uncommon" }, tables).copper, 400 * GP);
    assert.equal(baseValue({ type: "equipment", rarity: "rare" }, tables).copper, 4_000 * GP);
    assert.equal(baseValue({ type: "equipment", rarity: "veryRare" }, tables).copper, 40_000 * GP);
    assert.equal(baseValue({ type: "equipment", rarity: "legendary" }, tables).copper, 200_000 * GP);
  });

  it("rolls inside the 2014 range in whole gold pieces", () => {
    const item = { type: "equipment", rarity: "common" };
    assert.equal(baseValue(item, tables, { rules: "legacy", random: fixed(0) }).copper, 50 * GP);
    assert.equal(baseValue(item, tables, { rules: "legacy", random: fixed(0.9999) }).copper, 100 * GP);
    assert.equal(baseValue({ type: "equipment", rarity: "rare" }, tables, { rules: "legacy", random: fixed(0) }).copper, 501 * GP);
  });

  it("takes the middle of the 2014 range without a random source", () => {
    assert.equal(baseValue({ type: "equipment", rarity: "common" }, tables, { rules: "legacy" }).copper, 75 * GP);
  });

  it("halves consumables, but not spell scrolls", () => {
    assert.equal(baseValue({ type: "consumable", rarity: "common" }, tables).copper, 50 * GP);
    assert.equal(baseValue({ type: "consumable", rarity: "common", scroll: true, spellLevel: 1 }, tables).copper, 100 * GP);
  });

  it("prices a spell scroll with no rarity by its level", () => {
    const value = baseValue({ type: "consumable", scroll: true, spellLevel: 0 }, tables);
    assert.deepEqual(value, { copper: 30 * GP, source: "metadata", forSale: true });
    assert.equal(baseValue({ type: "consumable", scroll: true, spellLevel: 3 }, tables).copper, 300 * GP);
    assert.equal(baseValue({ type: "consumable", scroll: true, spellLevel: 5 }, tables).copper, 3_000 * GP);
  });

  it("falls to the type floor for scroll levels with no price yet", () => {
    assert.equal(baseValue({ type: "consumable", scroll: true, spellLevel: 7 }, tables).source, "floor");
  });

  it("reads a magical bonus as a rarity", () => {
    assert.equal(baseValue({ type: "weapon", magicalBonus: 1 }, tables).copper, 400 * GP);
    assert.equal(baseValue({ type: "weapon", magicalBonus: 2 }, tables).copper, 4_000 * GP);
    assert.equal(baseValue({ type: "weapon", magicalBonus: 3 }, tables).copper, 40_000 * GP);
    assert.equal(baseValue({ type: "consumable", magicalBonus: 1 }, tables).copper, 200 * GP);
  });

  it("counts required attunement or the magical property as uncommon", () => {
    assert.equal(baseValue({ type: "equipment", attunement: true }, tables).copper, 400 * GP);
    assert.equal(baseValue({ type: "equipment", magical: true }, tables).copper, 400 * GP);
  });

  it("ends at the type floor", () => {
    const floor = (type) => baseValue({ type }, tables);
    assert.deepEqual(floor("weapon"), { copper: 15 * GP, source: "floor", forSale: true });
    assert.equal(floor("equipment").copper, 25 * GP);
    assert.equal(floor("tool").copper, 20 * GP);
    assert.equal(floor("consumable").copper, 10 * GP);
    assert.equal(floor("container").copper, 5 * GP);
    assert.equal(floor("loot").copper, 5 * GP);
    assert.equal(floor("feat").copper, 0);
  });

  it("never sells an artifact, even with a price", () => {
    const value = baseValue({ type: "equipment", rarity: "artifact", price: { value: 10, denomination: "gp" } }, tables);
    assert.equal(value.forSale, false);
  });
});

describe("shelf price rounding", () => {
  it("rounds under 1 sp to the nearest 1 cp", () => {
    assert.equal(roundToStep(4.4, tables.rounding), 4);
    assert.equal(roundToStep(0.3, tables.rounding), 1);
  });

  it("rounds 1 sp to under 1 gp to the nearest 1 sp", () => {
    assert.equal(roundToStep(63, tables.rounding), 60);
  });

  it("rounds 1 to 9 gp to the nearest 1 gp", () => {
    assert.equal(roundToStep(730, tables.rounding), 700);
  });

  it("rounds 10 to 99 gp to the nearest 5 gp", () => {
    assert.equal(roundToStep(4_440, tables.rounding), 45 * GP);
  });

  it("rounds 100 to 999 gp to the nearest 25 gp", () => {
    assert.equal(roundToStep(37_300, tables.rounding), 375 * GP);
  });

  it("rounds 1,000 gp and up to the nearest 100 gp", () => {
    assert.equal(roundToStep(362_000, tables.rounding), 3_600 * GP);
  });

  it("keeps 0 at 0", () => {
    assert.equal(roundToStep(0, tables.rounding), 0);
  });
});

describe("shelf price", () => {
  it("lands on the base value at the middle of the variance", () => {
    assert.equal(shelfPrice(400 * GP, tables, { random: fixed(0.5), tier: "modest" }), 400 * GP);
  });

  it("stays within 15% either way before rounding", () => {
    assert.equal(shelfPrice(400 * GP, tables, { random: fixed(0), tier: "modest" }), 350 * GP);
    assert.equal(shelfPrice(400 * GP, tables, { random: fixed(0.9999), tier: "modest" }), 450 * GP);
  });

  it("adds 10% scarcity in poor shops", () => {
    assert.equal(shelfPrice(400 * GP, tables, { random: fixed(0.5), tier: "poor" }), 450 * GP);
    assert.equal(shelfPrice(400 * GP, tables, { random: fixed(0.5), tier: "wealthy" }), 400 * GP);
  });
});

describe("what a merchant starts from", () => {
  const priced = { copper: 400 * GP, source: "rarity", forSale: true };
  const unpriced = { copper: 5 * GP, source: "floor", forSale: true };

  it("uses the base value of a priced item", () => {
    assert.deepEqual(sellBasis({ type: "equipment" }, priced, tables), { copper: 400 * GP, scrap: false });
  });

  it("uses the type floor for an unidentified item", () => {
    assert.deepEqual(sellBasis({ type: "equipment", identified: false }, priced, tables), { copper: 25 * GP, scrap: false });
  });

  it("offers scrap for unpriced loot until it is appraised", () => {
    assert.deepEqual(sellBasis({ type: "loot" }, unpriced, tables), { copper: 5 * GP, scrap: true });
  });

  it("pays on the type floor or the GM's true value after appraisal", () => {
    assert.deepEqual(sellBasis({ type: "loot" }, unpriced, tables, { appraised: true }), { copper: 5 * GP, scrap: false });
    const appraised = sellBasis({ type: "loot" }, unpriced, tables, { appraised: true, trueValue: 30 * GP });
    assert.deepEqual(appraised, { copper: 30 * GP, scrap: false });
  });
});

describe("sell rates", () => {
  it("pays 25% for an item off the archetype", () => {
    assert.equal(sellRate({}, tables), 0.25);
  });

  it("pays 50% for a favored trade-in", () => {
    assert.equal(sellRate({ favored: true }, tables), 0.5);
  });

  it("pays a fence's 30% for anything", () => {
    assert.equal(sellRate({ fence: true, favored: true }, tables), 0.3);
  });

  it("pays the Wanted board's rate over any other", () => {
    assert.equal(sellRate({ wanted: 0.9, fence: true }, tables), 0.9);
    assert.equal(sellRate({ wanted: tables.wanted.named }, tables), 1.5);
  });

  it("pays 10% as scrap", () => {
    assert.equal(sellRate({ scrap: true, wanted: 0.9 }, tables), 0.1);
  });
});

describe("trade time prices", () => {
  it("charges the shelf price with no modifiers", () => {
    assert.deepEqual(buyPrice(400 * GP), { copper: 400 * GP, modifiers: [] });
  });

  it("charges less for good attitude, a haggle and a cheap market", () => {
    const price = buyPrice(100 * GP, { attitudeAdjustment: 0.15, haggle: 0.1, market: 1.3 });
    assert.equal(price.copper, 9_945);
    assert.deepEqual(price.modifiers, [
      { kind: "attitude", factor: 0.85 },
      { kind: "haggle", factor: 0.9 },
      { kind: "market", factor: 1.3 },
    ]);
  });

  it("pays the base value times the rate, worse with bad attitude", () => {
    const price = sellPrice(100 * GP, { rate: 0.25, attitudeAdjustment: -0.15 });
    assert.equal(price.copper, 2_125);
    assert.deepEqual(price.modifiers, [
      { kind: "rate", factor: 0.25 },
      { kind: "attitude", factor: 0.85 },
    ]);
  });

  it("pays more with good attitude", () => {
    assert.equal(sellPrice(100 * GP, { rate: 0.5, attitudeAdjustment: 0.15 }).copper, 5_750);
  });
});
