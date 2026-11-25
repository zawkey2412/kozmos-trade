import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { arrange, categoriesOf, rarityRank } from "../scripts/engine/catalog.mjs";
import { linesTotal, settle } from "../scripts/engine/quote.mjs";

const base = { giveItems: 0, takeItems: 0, coinsGive: 0, coinsTake: 0, sweetenStep: 0.05 };

describe("the balance", () => {
  it("is short when the customer offers less", () => {
    const result = settle({ ...base, takeItems: 730, coinsGive: 700 });
    assert.equal(result.state, "short");
    assert.equal(result.net, -30);
  });

  it("returns change from the coins put up, 7 gp 3 sp paid with 8 gp", () => {
    const result = settle({ ...base, takeItems: 730, coinsGive: 800 });
    assert.deepEqual(result, { customerGives: 800, merchantGives: 730, net: 70, change: 70, overpay: 0, state: "even" });
  });

  it("counts kept change as sweetening once it reaches 5%", () => {
    assert.equal(settle({ ...base, takeItems: 1000, coinsGive: 1040, keepChange: true }).state, "even");
    assert.equal(settle({ ...base, takeItems: 1000, coinsGive: 1050, keepChange: true }).state, "generous");
  });

  it("never returns change for goods, only for coins", () => {
    const result = settle({ ...base, takeItems: 1000, giveItems: 1100, coinsGive: 20 });
    assert.equal(result.change, 20);
    assert.equal(result.overpay, 100);
    assert.equal(result.state, "generous");
  });

  it("weighs coins asked from the merchant on its side", () => {
    const result = settle({ ...base, giveItems: 500, coinsTake: 500 });
    assert.equal(result.net, 0);
    assert.equal(result.state, "even");
  });

  it("is even with nothing on the scale", () => {
    assert.equal(settle(base).state, "even");
  });

  it("adds lines by quantity", () => {
    assert.equal(linesTotal([{ unit: 50, quantity: 3 }, { unit: 10, quantity: 1 }]), 160);
  });
});

describe("item lists", () => {
  const items = [
    { name: "Longsword", type: "weapon", subtype: "martialM", price: 1500 },
    { name: "Shield", type: "equipment", subtype: "shield", price: 1000 },
    { name: "Potion of Healing", type: "consumable", subtype: "potion", rarity: "common", magical: true, price: 5000 },
    { name: "Ruby", type: "loot", subtype: "gem", price: 50000 },
    { name: "Rope", type: "loot", subtype: "gear", price: 100 },
    { name: "Ring of Protection", type: "equipment", subtype: "ring", rarity: "rare", magical: true, price: 400000 },
  ];

  it("sorts items into the category chips", () => {
    assert.deepEqual([...categoriesOf(items[0])], ["weapons"]);
    assert.deepEqual([...categoriesOf(items[1])], ["armor"]);
    assert.deepEqual([...categoriesOf(items[2])], ["consumables", "magic"]);
    assert.deepEqual([...categoriesOf(items[3])], ["loot"]);
    assert.deepEqual([...categoriesOf(items[4])], ["gear"]);
    assert.deepEqual([...categoriesOf(items[5])], ["gear", "magic"]);
  });

  it("filters by a chip", () => {
    assert.deepEqual(arrange(items, { category: "magic" }).map((i) => i.name), ["Potion of Healing", "Ring of Protection"]);
  });

  it("sorts by name, price and rarity", () => {
    assert.equal(arrange(items, { sort: "name", locale: "en" })[0].name, "Longsword");
    assert.equal(arrange(items, { sort: "price" })[0].name, "Ring of Protection");
    assert.equal(arrange(items, { sort: "rarity" })[0].name, "Ring of Protection");
    assert.equal(rarityRank("veryRare") > rarityRank("rare"), true);
  });

  it("puts what the customer can afford first", () => {
    assert.deepEqual(arrange(items, { sort: "affordable", budget: 2000 }).slice(0, 3).map((i) => i.name), ["Longsword", "Shield", "Rope"]);
  });
});
