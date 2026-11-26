import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { daysSince, lastVisit } from "../scripts/engine/visits.mjs";

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
