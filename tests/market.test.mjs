import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { activeRules, marketCategoriesOf, marketFactor, newRule, percentOf, ruleApplies } from "../scripts/engine/market.mjs";

const DAY = 86_400;
const limits = { minPercent: -90, maxPercent: 500 };
const war = { id: "war", name: "War", categories: ["weapons", "armor"], multiplier: 1.3, until: 10 * DAY };
const festival = { id: "fest", name: "Festival", categories: ["food"], multiplier: 0.8, until: null };
const sword = { type: "weapon", subtype: "martialM" };
const plate = { type: "equipment", subtype: "heavy" };
const rations = { type: "consumable", subtype: "food" };
const rope = { type: "loot", subtype: "gear" };

describe("which items a market rule covers", () => {
  it("matches by catalog category, and food by its subtype", () => {
    assert.ok(ruleApplies(war, sword));
    assert.ok(ruleApplies(war, plate));
    assert.ok(!ruleApplies(war, rope));
    assert.ok(ruleApplies(festival, rations));
    assert.ok(marketCategoriesOf(rations).has("consumables"));
  });

  it("covers every item when it names no category", () => {
    assert.ok(ruleApplies({ ...war, categories: [] }, rope));
  });
});

describe("market prices", () => {
  it("multiplies every rule that covers the item", () => {
    assert.equal(marketFactor(sword, [war]), 1.3);
    assert.equal(marketFactor(rope, [war]), 1);
    const plague = { id: "p", name: "Plague", categories: [], multiplier: 1.5, until: null };
    assert.ok(Math.abs(marketFactor(sword, [war, plague]) - 1.95) < 1e-9);
  });

  it("leaves services and unknown items alone", () => {
    assert.equal(marketFactor(null, [war]), 1);
  });

  it("drops a rule once its end date passes", () => {
    assert.deepEqual(activeRules([war, festival], 9 * DAY), [war, festival]);
    assert.deepEqual(activeRules([war, festival], 10 * DAY), [festival]);
  });
});

describe("making a market rule", () => {
  const context = { id: "r1", now: 2 * DAY, day: DAY, limits };

  it("turns a percent and days into a multiplier and an end date", () => {
    const rule = newRule({ name: " War ", categories: ["weapons", "armor", "weapons"], percent: 30, days: 7 }, context);
    assert.deepEqual(rule, { id: "r1", name: "War", categories: ["weapons", "armor"], multiplier: 1.3, until: 9 * DAY });
    assert.equal(percentOf(rule.multiplier), 30);
  });

  it("has no end date when no days are given", () => {
    assert.equal(newRule({ name: "Festival", categories: "food", percent: -20, days: "" }, context).until, null);
  });

  it("refuses a rule with no name, no change, a change out of range, or bad days", () => {
    assert.throws(() => newRule({ name: "", categories: [], percent: 10, days: 1 }, context), /NoName/);
    assert.throws(() => newRule({ name: "x", categories: [], percent: 0, days: 1 }, context), /BadPercent/);
    assert.throws(() => newRule({ name: "x", categories: [], percent: -100, days: 1 }, context), /BadPercent/);
    assert.throws(() => newRule({ name: "x", categories: ["spells"], percent: 10, days: 1 }, context), /BadCategory/);
    assert.throws(() => newRule({ name: "x", categories: [], percent: 10, days: -2 }, context), /BadDays/);
  });
});
