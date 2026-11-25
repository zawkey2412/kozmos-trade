import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TABLES } from "../scripts/data/tables.mjs";
import { allowedAsks, haggleDC, haggleResult, isLocked, lockUntil } from "../scripts/engine/haggle.mjs";

const DAY = 86_400;
const ASKS = [0.05, 0.1, 0.15, 0.2, 0.25];
const dcRow = (insight, attitude) => ASKS.map((ask) => haggleDC({ insight, ask, attitude }, TABLES));

describe("haggle asks", () => {
  it("offers 5% to 25%", () => {
    assert.deepEqual(allowedAsks({}, TABLES.haggle), ASKS);
  });

  it("caps Limited Stock at 10%", () => {
    assert.deepEqual(allowedAsks({ limited: true }, TABLES.haggle), [0.05, 0.1]);
  });
});

describe("haggle DC", () => {
  it("matches the commoner row", () => {
    assert.deepEqual(dcRow(10, 0), [12, 14, 16, 18, 20]);
  });

  it("matches the noble row", () => {
    assert.deepEqual(dcRow(14, 0), [16, 18, 20, 22, 24]);
  });

  it("matches the warm commoner row", () => {
    assert.deepEqual(dcRow(10, 30), [9, 11, 13, 15, 17]);
  });

  it("rises for a cold merchant", () => {
    assert.equal(haggleDC({ insight: 10, ask: 0.05, attitude: -30 }, TABLES), 15);
  });

  it("takes a rolled Insight the same way", () => {
    assert.equal(haggleDC({ insight: 17, ask: 0.1 }, TABLES), 21);
  });
});

describe("haggle results", () => {
  it("gives the asked discount on a success", () => {
    assert.deepEqual(haggleResult({ total: 14, dc: 14, ask: 0.1 }, TABLES.haggle), {
      success: true,
      discount: 0.1,
      locked: false,
      events: [],
    });
  });

  it("warms the merchant on a success by 10 or more", () => {
    assert.deepEqual(haggleResult({ total: 24, dc: 14, ask: 0.1 }, TABLES.haggle).events, ["haggleBigWin"]);
  });

  it("cools the merchant after intimidation, even on a success", () => {
    assert.deepEqual(haggleResult({ total: 15, dc: 14, ask: 0.1, intimidation: true }, TABLES.haggle).events, ["intimidate"]);
  });

  it("locks haggling on a failure, with no discount", () => {
    assert.deepEqual(haggleResult({ total: 13, dc: 14, ask: 0.1 }, TABLES.haggle), {
      success: false,
      discount: 0,
      locked: true,
      events: [],
    });
  });

  it("also cools the merchant on a failure by 5 or more", () => {
    assert.deepEqual(haggleResult({ total: 9, dc: 14, ask: 0.1 }, TABLES.haggle).events, ["haggleBigLoss"]);
  });

  it("does not punish intimidation that fails", () => {
    assert.deepEqual(haggleResult({ total: 12, dc: 14, ask: 0.1, intimidation: true }, TABLES.haggle).events, []);
  });
});

describe("haggle locks", () => {
  it("lasts until the start of the next in-game day", () => {
    assert.equal(lockUntil(DAY * 3 + 500, DAY), DAY * 4);
    assert.equal(lockUntil(DAY * 3, DAY), DAY * 4);
  });

  it("holds until that time and no longer", () => {
    const until = lockUntil(DAY * 3 + 500, DAY);
    assert.equal(isLocked(until, DAY * 3 + 600), true);
    assert.equal(isLocked(until, DAY * 4), false);
    assert.equal(isLocked(undefined, DAY), false);
  });
});
