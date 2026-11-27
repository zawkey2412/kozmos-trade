import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { addTraded, daysSince, lastVisit, visitNote } from "../scripts/engine/visits.mjs";

const DAY = 86_400;
const clock = (now) => ({ now, day: DAY, week: DAY * 7 });

describe("party visits", () => {
  it("takes the latest visit of anyone in the party", () => {
    const visits = { aria: { last: 100 }, bram: { last: 900 }, stranger: { last: 5000 } };
    assert.equal(lastVisit(visits, ["aria", "bram"]), 900);
  });

  it("knows when nobody in the party has been there", () => {
    assert.equal(lastVisit({ stranger: { last: 5000 } }, ["aria"]), null);
    assert.equal(lastVisit({}, []), null);
  });
});

describe("days since a visit", () => {
  it("counts in-game days, not 24 hour spans", () => {
    assert.equal(daysSince(DAY - 10, clock(DAY + 10)), 1);
    assert.equal(daysSince(DAY + 10, clock(DAY + 500)), 0);
    assert.equal(daysSince(0, clock(DAY * 5)), 5);
  });

  it("never goes below 0 when world time moved back", () => {
    assert.equal(daysSince(DAY * 3, clock(DAY)), 0);
  });
});

describe("what a visit remembers", () => {
  const dagger = { name: "Dagger", quantity: 2 };
  const potion = { name: "Potion of Healing", quantity: 1 };

  it("starts the lists on the first trade of a visit", () => {
    const record = { last: 100, tradedAt: 50, sold: [{ name: "Old Boot", quantity: 1 }], bought: [] };
    assert.deepEqual(addTraded(record, { sold: [dagger], bought: [potion], now: 120, max: 10, fresh: true }), {
      last: 100,
      tradedAt: 120,
      sold: [dagger],
      bought: [potion],
    });
  });

  it("adds later trades of the same visit, summing the same item", () => {
    const record = { last: 100, tradedAt: 120, sold: [dagger], bought: [] };
    const next = addTraded(record, { sold: [{ name: "Dagger", quantity: 1 }], bought: [potion], now: 130, max: 10, fresh: false });
    assert.deepEqual(next.sold, [{ name: "Dagger", quantity: 3 }]);
    assert.deepEqual(next.bought, [potion]);
  });

  it("keeps no more items than the limit", () => {
    const many = Array.from({ length: 5 }, (_, index) => ({ name: `Gem ${index}`, quantity: 1 }));
    assert.equal(addTraded({ last: 0 }, { sold: many, bought: [], now: 1, max: 3, fresh: true }).sold.length, 3);
  });
});

describe("the Last visited note", () => {
  it("is empty for a first visit", () => {
    assert.equal(visitNote(undefined, clock(DAY)), null);
  });

  it("gives the days since the visit and the last trade's items", () => {
    const record = { last: DAY * 2, tradedAt: DAY, sold: [{ name: "Dagger", quantity: 2 }], bought: [] };
    assert.deepEqual(visitNote(record, clock(DAY * 5)), { days: 3, tradedDays: 4, sold: [{ name: "Dagger", quantity: 2 }], bought: [] });
  });

  it("names no trade when the character never traded here", () => {
    assert.deepEqual(visitNote({ last: DAY, tradedAt: null, sold: [], bought: [] }, clock(DAY * 2)), { days: 1, tradedDays: null, sold: [], bought: [] });
  });
});
