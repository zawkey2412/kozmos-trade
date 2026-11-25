import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ARCHETYPES } from "../scripts/data/archetypes.mjs";
import { TABLES } from "../scripts/data/tables.mjs";
import { matchesFilter, sellFit } from "../scripts/engine/fit.mjs";
import { onShelf, shelfPriceOf, tradeable } from "../scripts/engine/shelf.mjs";

const loose = { quantity: 1, equipped: false, attuned: false, container: null, contents: 0 };
const sword = { type: "weapon", subtype: "martialM" };
const tables = TABLES.pricing;

describe("shelf", () => {
  it("offers loose physical items", () => {
    assert.equal(onShelf(sword, loose), true);
    assert.equal(onShelf({ type: "loot", subtype: "gem" }, loose), true);
  });

  it("keeps the merchant's equipped and natural items", () => {
    assert.equal(onShelf(sword, { ...loose, equipped: true }), false);
    assert.equal(onShelf({ type: "weapon", subtype: "natural" }, loose), false);
  });

  it("leaves out spells, features, items inside containers and full containers", () => {
    assert.equal(onShelf({ type: "spell" }, loose), false);
    assert.equal(onShelf({ type: "feat" }, loose), false);
    assert.equal(onShelf(sword, { ...loose, container: "bag" }), false);
    assert.equal(onShelf({ type: "container" }, { ...loose, contents: 2 }), false);
    assert.equal(onShelf({ type: "container" }, loose), true);
    assert.equal(onShelf(sword, { ...loose, quantity: 0 }), false);
  });

  it("lets a customer offer equipped items, but not natural weapons", () => {
    assert.equal(tradeable(sword, { ...loose, equipped: true }), true);
    assert.equal(tradeable({ type: "weapon", subtype: "natural" }, loose), false);
  });
});

describe("shelf price", () => {
  const value = (copper) => ({ copper, source: "price", forSale: true });

  it("uses the GM's price when there is one, even 0", () => {
    assert.equal(shelfPriceOf(1234, value(1500), tables), 1234);
    assert.equal(shelfPriceOf(0, value(1500), tables), 0);
  });

  it("rounds the base value otherwise", () => {
    assert.equal(shelfPriceOf(null, value(1500), tables), 1500);
    assert.equal(shelfPriceOf(null, value(4_440), tables), 4_500);
  });

  it("has no price for an item not for sale", () => {
    assert.equal(shelfPriceOf(500, { copper: 0, source: null, forSale: false }, tables), null);
  });
});

describe("archetype fit", () => {
  it("matches type, subtype, base item and magic", () => {
    assert.equal(matchesFilter(sword, { type: "weapon" }), true);
    assert.equal(matchesFilter(sword, { type: "weapon", subtypes: ["simpleM"] }), false);
    assert.equal(matchesFilter({ type: "tool", baseItem: "smith" }, { type: "tool", baseItems: ["smith"] }), true);
    assert.equal(matchesFilter({ type: "equipment", rarity: "rare" }, { magical: true }), true);
    assert.equal(matchesFilter({ type: "equipment" }, { magical: true }), false);
  });

  it("finds a blacksmith's favored trade-ins", () => {
    assert.deepEqual(sellFit(sword, ARCHETYPES.blacksmith), { fence: false, favored: true });
    assert.deepEqual(sellFit({ type: "consumable", subtype: "potion" }, ARCHETYPES.blacksmith), { fence: false, favored: false });
  });

  it("marks every item at a fence", () => {
    assert.deepEqual(sellFit({ type: "consumable", subtype: "potion" }, ARCHETYPES.fence), { fence: true, favored: false });
  });

  it("treats an unknown archetype as off-archetype", () => {
    assert.deepEqual(sellFit(sword, undefined), { fence: false, favored: false });
  });
});
