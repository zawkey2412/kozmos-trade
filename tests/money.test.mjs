import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TABLES } from "../scripts/data/tables.mjs";
import { coinsToCopper, formatCopper, payFrom, splitCopper, toCopper } from "../scripts/engine/money.mjs";

const tolerance = TABLES.money.changeTolerance;

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

describe("change-making", () => {
  it("returns 7 sp when 7 gp 3 sp is paid with 8 gp", () => {
    const change = coinsToCopper({ gp: 8 }) - coinsToCopper({ gp: 7, sp: 3 });
    assert.deepEqual(payFrom({ gp: 20, sp: 9, cp: 30 }, change, { maxOver: tolerance }), { sp: 7 });
  });

  it("gives the largest coins the purse holds", () => {
    assert.deepEqual(payFrom({ pp: 2, gp: 9, sp: 9, cp: 9 }, 1234, { maxOver: tolerance }), { pp: 1, gp: 2, sp: 3, cp: 4 });
  });

  it("falls back to smaller coins when the larger ones run out", () => {
    assert.deepEqual(payFrom({ gp: 1, sp: 20 }, 250, { maxOver: tolerance }), { gp: 1, sp: 15 });
  });

  it("owes nothing when there is no change", () => {
    assert.deepEqual(payFrom({ gp: 5 }, 0, { maxOver: tolerance }), {});
    assert.deepEqual(payFrom({}, 0, { maxOver: tolerance }), {});
  });

  it("rounds up to 1 sp in the customer's favor when exact change is impossible", () => {
    assert.deepEqual(payFrom({ gp: 3, sp: 4 }, 7, { maxOver: tolerance }), { sp: 1 });
    assert.deepEqual(payFrom({ gp: 3, sp: 9 }, 73, { maxOver: tolerance }), { sp: 8 });
  });

  it("asks for exact coins when it would overpay by more than 1 sp", () => {
    assert.equal(payFrom({ gp: 5 }, 70, { maxOver: tolerance }), null);
    assert.equal(payFrom({ sp: 2 }, 15, { maxOver: 0 }), null);
  });

  it("asks for exact coins when the purse is too small", () => {
    assert.equal(payFrom({ sp: 5 }, 70, { maxOver: tolerance }), null);
    assert.equal(payFrom({}, 1, { maxOver: tolerance }), null);
  });

  it("ignores empty and negative coin counts", () => {
    assert.deepEqual(payFrom({ pp: 0, gp: -2, sp: 7 }, 70, { maxOver: tolerance }), { sp: 7 });
  });
});

describe("auto-balance", () => {
  it("fills the shortfall exactly when the customer's coins allow it", () => {
    assert.deepEqual(payFrom({ gp: 10, sp: 10, cp: 10 }, 730), { gp: 7, sp: 3 });
  });

  it("overpays as little as possible when they do not", () => {
    assert.deepEqual(payFrom({ gp: 10 }, 730), { gp: 8 });
    assert.deepEqual(payFrom({ pp: 1, gp: 1 }, 150), { pp: 1 });
  });

  it("picks the fewest coins among equal totals", () => {
    assert.deepEqual(payFrom({ gp: 1, ep: 2 }, 60), { gp: 1 });
  });

  it("finds nothing when the customer cannot cover it", () => {
    assert.equal(payFrom({ gp: 7, sp: 2 }, 730), null);
  });
});

describe("coin display", () => {
  it("shows only the coins in use", () => {
    assert.equal(formatCopper(730, { locale: "en-US" }), "7 gp 3 sp");
    assert.equal(formatCopper(4, { locale: "en-US" }), "4 cp");
  });

  it("shows nothing as 0 gp", () => {
    assert.equal(formatCopper(0, { locale: "en-US" }), "0 gp");
  });

  it("groups digits by the reader's locale", () => {
    assert.equal(formatCopper(360000, { locale: "en-US" }), "3,600 gp");
    assert.equal(formatCopper(360000, { locale: "de-DE" }), "3.600 gp");
  });

  it("uses the coin labels it is given", () => {
    assert.equal(formatCopper(730, { locale: "de-DE", labels: { gp: "GM", sp: "SM", cp: "KM" } }), "7 GM 3 SM");
  });
});
