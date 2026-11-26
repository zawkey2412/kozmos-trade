import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { acceptOffer, bothAccepted, changeOffer, cleanPlayerOffer, emptyPlayerOffer, offerIsEmpty, resetAccepts, sideIndex, startPlayerTrade } from "../scripts/engine/player-trade.mjs";

const coins = (values) => ({ pp: 0, gp: 0, ep: 0, sp: 0, cp: 0, ...values });
const start = () => startPlayerTrade("t1", { actor: "Actor.aria", userId: "u1" }, { actor: "Actor.bram", userId: "u2" });

describe("player trade offers", () => {
  it("starts with nothing on either side and nobody accepted", () => {
    const trade = start();
    assert.equal(trade.version, 0);
    assert.ok(trade.sides.every((side) => offerIsEmpty(side.offer) && !side.accepted));
    assert.equal(sideIndex(trade, "Actor.bram"), 1);
    assert.equal(sideIndex(trade, "Actor.someone"), -1);
  });

  it("merges lines for the same item and keeps whole coins", () => {
    const offer = cleanPlayerOffer({ items: [["b", 1], ["a", 2], ["b", 3]], coins: { gp: 5 } });
    assert.deepEqual(offer, { items: [["a", 2], ["b", 4]], coins: coins({ gp: 5 }) });
  });

  it("refuses broken amounts", () => {
    assert.equal(cleanPlayerOffer({ items: [["a", 0]] }), null);
    assert.equal(cleanPlayerOffer({ items: [["a", 1.5]] }), null);
    assert.equal(cleanPlayerOffer({ items: [], coins: { gp: -1 } }), null);
    assert.deepEqual(cleanPlayerOffer(null), emptyPlayerOffer());
  });
});

describe("accepting a player trade", () => {
  it("goes through only when both sides accept", () => {
    let trade = changeOffer(start(), 0, cleanPlayerOffer({ items: [["sword", 1]] }));
    trade = acceptOffer(trade, 0, trade.version);
    assert.equal(bothAccepted(trade), false);
    trade = acceptOffer(trade, 1, trade.version);
    assert.equal(bothAccepted(trade), true);
  });

  it("resets both Accepts when either side changes its offer", () => {
    let trade = changeOffer(start(), 0, cleanPlayerOffer({ items: [["sword", 1]] }));
    trade = acceptOffer(acceptOffer(trade, 0, trade.version), 1, trade.version);
    const changed = changeOffer(trade, 1, cleanPlayerOffer({ coins: { gp: 2 } }));
    assert.ok(changed.sides.every((side) => !side.accepted));
    assert.equal(changed.version, trade.version + 1);
  });

  it("keeps both Accepts when an offer comes in unchanged", () => {
    let trade = changeOffer(start(), 0, cleanPlayerOffer({ items: [["sword", 1]] }));
    trade = acceptOffer(trade, 1, trade.version);
    assert.equal(changeOffer(trade, 0, cleanPlayerOffer({ items: [["sword", 1]] })), trade);
  });

  it("refuses an Accept for an offer that has changed since", () => {
    const trade = changeOffer(start(), 0, cleanPlayerOffer({ items: [["sword", 1]] }));
    assert.equal(acceptOffer(trade, 1, trade.version - 1), null);
  });

  it("can reset both Accepts after a failed trade", () => {
    let trade = changeOffer(start(), 0, cleanPlayerOffer({ items: [["sword", 1]] }));
    trade = acceptOffer(acceptOffer(trade, 0, trade.version), 1, trade.version);
    const reset = resetAccepts(trade);
    assert.equal(bothAccepted(reset), false);
    assert.equal(acceptOffer(reset, 0, trade.version), null);
  });
});
