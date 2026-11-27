import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TABLES } from "../scripts/data/tables.mjs";
import { addCatch, lastCustomer, needsApproval, notorietyNow, notorietyPenalty, pocketSize, raiseSuspicion, stolenChecks, suspicionToday, theftDC, theftOutcome } from "../scripts/engine/theft.mjs";

const T = TABLES.theft;
const item = (type, subtype, weight = 2, properties = []) => ({ type, subtype, weight, properties });

describe("what fits in a pocket", () => {
  it("counts rings, potions, scrolls and gems as small", () => {
    assert.equal(pocketSize(item("equipment", "ring", 0), T), "small");
    assert.equal(pocketSize(item("consumable", "potion", 0.5), T), "small");
    assert.equal(pocketSize(item("consumable", "scroll", 0), T), "small");
    assert.equal(pocketSize(item("loot", "gem", 0), T), "small");
  });

  it("counts anything of a pound or less as small", () => {
    assert.equal(pocketSize(item("weapon", "simpleM", 1), T), "small");
  });

  it("does not count an item with no weight as small by weight alone", () => {
    assert.equal(pocketSize(item("loot", "material", 0), T), "normal");
  });

  it("refuses armor, shields, heavy weapons and anything of 20 pounds or more", () => {
    assert.equal(pocketSize(item("equipment", "light", 10), T), "bulky");
    assert.equal(pocketSize(item("equipment", "shield", 6), T), "bulky");
    assert.equal(pocketSize(item("weapon", "martialM", 6, ["hvy", "rch", "two"]), T), "bulky");
    assert.equal(pocketSize(item("container", "", 25), T), "bulky");
  });

  it("leaves a longsword as a normal item", () => {
    assert.equal(pocketSize(item("weapon", "martialM", 3, ["ver"]), T), "normal");
  });
});

describe("theft DC", () => {
  it("starts from the merchant's Perception", () => {
    assert.deepEqual(theftDC({ perception: 12, size: "normal" }, T), { dc: 12, factors: [] });
  });

  it("drops by 2 for a small item", () => {
    assert.equal(theftDC({ perception: 12, size: "small" }, T).dc, 10);
  });

  it("rises by 5 for Limited Stock or a pinned item, once", () => {
    assert.equal(theftDC({ perception: 12, size: "normal", limited: true }, T).dc, 17);
    assert.equal(theftDC({ perception: 12, size: "normal", pinned: true }, T).dc, 17);
    assert.equal(theftDC({ perception: 12, size: "normal", limited: true, pinned: true }, T).dc, 17);
  });

  it("rises by 2 per Suspicion level, up to 3", () => {
    assert.equal(theftDC({ perception: 12, size: "normal", suspicion: 2 }, T).dc, 16);
    assert.equal(theftDC({ perception: 12, size: "normal", suspicion: 5 }, T).dc, 18);
  });

  it("drops by 2 at a friendly merchant and rises by 3 with a guard nearby", () => {
    assert.equal(theftDC({ perception: 12, size: "normal", friendly: true }, T).dc, 10);
    assert.equal(theftDC({ perception: 12, size: "normal", guarded: true }, T).dc, 15);
  });

  it("lists every factor it used", () => {
    const { dc, factors } = theftDC({ perception: 10, size: "small", limited: true, suspicion: 1, friendly: true, guarded: true }, T);
    assert.equal(dc, 16);
    assert.deepEqual(factors.map((factor) => factor.kind), ["small", "limited", "suspicion", "friendly", "guard"]);
  });
});

describe("theft outcomes", () => {
  it("is clean when the roll beats the DC by 5 or more", () => {
    assert.equal(theftOutcome(20, 15, T), "clean");
  });

  it("is taken but noticed later when the roll only meets the DC", () => {
    assert.equal(theftOutcome(15, 15, T), "taken");
    assert.equal(theftOutcome(19, 15, T), "taken");
  });

  it("is a fumble when the roll misses by 1 to 4", () => {
    assert.equal(theftOutcome(14, 15, T), "fumble");
    assert.equal(theftOutcome(11, 15, T), "fumble");
  });

  it("is a catch when the roll misses by 5 or more", () => {
    assert.equal(theftOutcome(10, 15, T), "caught");
  });
});

describe("Suspicion", () => {
  it("counts only on the day it was raised", () => {
    assert.equal(suspicionToday(2, 7, 7), 2);
    assert.equal(suspicionToday(2, 6, 7), 0);
  });

  it("rises by 1 a fumble, up to 3", () => {
    assert.deepEqual(raiseSuspicion(0, null, 7, T), { suspicion: 1, day: 7 });
    assert.deepEqual(raiseSuspicion(3, 7, 7, T), { suspicion: 3, day: 7 });
  });

  it("starts again from 0 on a new day", () => {
    assert.deepEqual(raiseSuspicion(3, 6, 7, T), { suspicion: 1, day: 7 });
  });
});

describe("GM approval", () => {
  it("is never needed when the setting is off", () => {
    assert.equal(needsApproval("none", "legendary", T), false);
  });

  it("is needed above uncommon when the cap is on", () => {
    assert.equal(needsApproval("rare", "uncommon", T), false);
    assert.equal(needsApproval("rare", undefined, T), false);
    assert.equal(needsApproval("rare", "rare", T), true);
    assert.equal(needsApproval("rare", "veryRare", T), true);
  });

  it("is needed for every theft when the GM asks for that", () => {
    assert.equal(needsApproval("all", undefined, T), true);
  });
});

describe("notoriety", () => {
  const WEEK = 7 * 86_400;

  it("is 0 for a character never caught in the scene", () => {
    assert.equal(notorietyNow(undefined, WEEK, WEEK, T), 0);
  });

  it("adds 1 for each catch", () => {
    const first = addCatch(undefined, 100, WEEK, T);
    assert.deepEqual(first, { points: 1, lastCatch: 100 });
    assert.deepEqual(addCatch(first, 200, WEEK, T), { points: 2, lastCatch: 200 });
  });

  it("fades by 1 for each full in-game week since the last catch", () => {
    const record = { points: 3, lastCatch: 0 };
    assert.equal(notorietyNow(record, WEEK - 1, WEEK, T), 3);
    assert.equal(notorietyNow(record, WEEK, WEEK, T), 2);
    assert.equal(notorietyNow(record, 5 * WEEK, WEEK, T), 0);
  });

  it("starts a new catch from what is left after fading", () => {
    assert.deepEqual(addCatch({ points: 3, lastCatch: 0 }, 2 * WEEK, WEEK, T), { points: 2, lastCatch: 2 * WEEK });
  });

  it("makes every merchant in the scene 10 points colder per point", () => {
    assert.equal(notorietyPenalty(2, T), -20);
  });
});

describe("spotting stolen goods", () => {
  const shop = { merchant: "Actor.smith", sameScene: (source) => source === "Actor.baker", fence: false };

  it("knows its own stolen goods at once", () => {
    const { own, looked } = stolenChecks([{ source: "Actor.smith" }], shop);
    assert.equal(own.length, 1);
    assert.equal(looked.length, 0);
  });

  it("looks closely at goods stolen from a merchant in the same scene", () => {
    assert.equal(stolenChecks([{ source: "Actor.baker" }], shop).looked.length, 1);
  });

  it("ignores goods stolen in another scene", () => {
    const { own, looked } = stolenChecks([{ source: "Actor.faraway" }], shop);
    assert.equal(own.length + looked.length, 0);
  });

  it("never looks closely when it is a fence, but still knows its own goods", () => {
    const fence = { ...shop, fence: true };
    assert.equal(stolenChecks([{ source: "Actor.baker" }], fence).looked.length, 0);
    assert.equal(stolenChecks([{ source: "Actor.smith" }], fence).own.length, 1);
  });
});

describe("the last customer", () => {
  it("is whoever visited most recently", () => {
    assert.equal(lastCustomer({ a: { last: 100 }, b: { last: 300 }, c: { last: 200 } }), "b");
  });

  it("is nobody when nobody has visited", () => {
    assert.equal(lastCustomer({}), null);
  });
});
