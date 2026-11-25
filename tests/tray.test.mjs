import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { addCoins, clampCoins, emptyOffer, isEmpty, noCoins, setLine, stageAmount } from "../scripts/engine/tray.mjs";

describe("staging", () => {
  it("stages 1 per click", () => {
    assert.equal(stageAmount(20), 1);
  });

  it("stages half the stack with Shift, rounding up", () => {
    assert.equal(stageAmount(20, { half: true }), 10);
    assert.equal(stageAmount(3, { half: true }), 2);
    assert.equal(stageAmount(1, { half: true }), 1);
  });

  it("stages the whole stack with Ctrl or Cmd", () => {
    assert.equal(stageAmount(20, { all: true }), 20);
  });

  it("stages nothing when none are left", () => {
    assert.equal(stageAmount(0, { all: true }), 0);
  });
});

describe("tray lines", () => {
  it("keeps a quantity between 1 and what is there", () => {
    const lines = new Map();
    assert.equal(setLine(lines, "a", 5, 3), 3);
    assert.equal(lines.get("a"), 3);
  });

  it("drops a line at 0", () => {
    const lines = new Map([["a", 2]]);
    setLine(lines, "a", 0, 3);
    assert.equal(lines.has("a"), false);
  });
});

describe("coins in a tray", () => {
  it("keeps counts whole and within what the holder has", () => {
    assert.deepEqual(clampCoins({ gp: 9, sp: -2, cp: 2.7 }, { pp: 0, gp: 5, ep: 0, sp: 3, cp: 9 }), { pp: 0, gp: 5, ep: 0, sp: 0, cp: 2 });
  });

  it("has no top when the holder's coins are unknown", () => {
    assert.equal(clampCoins({ gp: 900 }, null).gp, 900);
  });

  it("adds and takes away coin by coin", () => {
    assert.deepEqual(addCoins({ ...noCoins(), gp: 5, sp: 2 }, { ...noCoins(), gp: 1 }, -1), { ...noCoins(), gp: 4, sp: 2 });
  });

  it("knows an empty offer", () => {
    const offer = emptyOffer();
    assert.equal(isEmpty(offer), true);
    offer.coinsTake.cp = 1;
    assert.equal(isEmpty(offer), false);
  });
});
