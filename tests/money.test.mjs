import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { coinsToCopper, splitCopper, toCopper } from "../scripts/engine/money.mjs";

describe("copper conversion", () => {
  it("converts each coin to copper", () => {
    assert.equal(toCopper(1, "pp"), 1000);
    assert.equal(toCopper(7, "gp"), 700);
    assert.equal(toCopper(1, "ep"), 50);
    assert.equal(toCopper(6, "sp"), 60);
    assert.equal(toCopper(4, "cp"), 4);
  });

  it("converts part of a coin", () => {
    assert.equal(toCopper(0.5, "gp"), 50);
  });

  it("refuses a coin it does not know", () => {
    assert.throws(() => toCopper(1, "zz"));
  });

  it("totals a purse", () => {
    assert.equal(coinsToCopper({ pp: 1, gp: 7, ep: 1, sp: 3, cp: 2 }), 1782);
    assert.equal(coinsToCopper({}), 0);
  });
});

describe("coin splits", () => {
  it("reads out in gp, sp and cp", () => {
    assert.deepEqual(splitCopper(730), { gp: 7, sp: 3, cp: 0 });
    assert.deepEqual(splitCopper(360000), { gp: 3600, sp: 0, cp: 0 });
    assert.deepEqual(splitCopper(0), { gp: 0, sp: 0, cp: 0 });
  });

  it("uses the fewest of the coins allowed", () => {
    assert.deepEqual(splitCopper(1150, ["cp", "ep", "gp", "pp"]), { pp: 1, gp: 1, ep: 1, cp: 0 });
    assert.deepEqual(splitCopper(70, ["sp", "cp"]), { sp: 7, cp: 0 });
  });

  it("refuses an amount the coins allowed cannot pay", () => {
    assert.throws(() => splitCopper(15, ["gp", "sp"]));
  });

  it("refuses negative and part copper", () => {
    assert.throws(() => splitCopper(-1));
    assert.throws(() => splitCopper(1.5));
  });
});
