import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { planCoins } from "../scripts/engine/trade.mjs";

const coins = (values) => ({ pp: 0, gp: 0, ep: 0, sp: 0, cp: 0, ...values });
const base = { tolerance: 10, purseLimit: true };

describe("coins in a trade", () => {
  it("pays 7 sp change on 7 gp 3 sp paid with 8 gp, from the purse", () => {
    const plan = planCoins({ ...base, customerHeld: coins({ gp: 10 }), merchantHeld: coins({ sp: 9 }), coinsGive: coins({ gp: 8 }), payout: 70 });
    assert.deepEqual(plan.paid, coins({ sp: 7 }));
    assert.deepEqual(plan.customerAfter, coins({ gp: 2, sp: 7 }));
    assert.deepEqual(plan.merchantAfter, coins({ gp: 8, sp: 2 }));
  });

  it("can pay change out of the coins it was just given", () => {
    const plan = planCoins({ ...base, customerHeld: coins({ gp: 1, sp: 5 }), merchantHeld: coins(), coinsGive: coins({ gp: 1, sp: 5 }), payout: 50 });
    assert.deepEqual(plan.paid, coins({ sp: 5 }));
    assert.deepEqual(plan.merchantAfter, coins({ gp: 1 }));
  });

  it("refuses when the customer offers coins they do not have", () => {
    assert.equal(planCoins({ ...base, customerHeld: coins({ gp: 1 }), merchantHeld: coins(), coinsGive: coins({ gp: 2 }), payout: 0 }), null);
  });

  it("asks for exact coins when the purse cannot pay", () => {
    assert.equal(planCoins({ ...base, customerHeld: coins(), merchantHeld: coins({ gp: 1 }), coinsGive: coins(), payout: 500 }), null);
    assert.equal(planCoins({ ...base, customerHeld: coins(), merchantHeld: coins({ gp: 5 }), coinsGive: coins(), payout: 70 }), null);
  });

  it("rounds change up to 1 sp in the customer's favor", () => {
    const plan = planCoins({ ...base, customerHeld: coins({ gp: 1 }), merchantHeld: coins({ sp: 5 }), coinsGive: coins({ gp: 1 }), payout: 7 });
    assert.deepEqual(plan.paid, coins({ sp: 1 }));
  });

  it("makes up coins with no purse limit", () => {
    const plan = planCoins({ ...base, purseLimit: false, customerHeld: coins(), merchantHeld: coins({ gp: 1 }), coinsGive: coins(), payout: 520 });
    assert.deepEqual(plan.paid, coins({ gp: 5, sp: 2 }));
    assert.deepEqual(plan.merchantAfter, coins());
    assert.deepEqual(plan.customerAfter, coins({ gp: 5, sp: 2 }));
  });

  it("can pay change out of coins a joined character put up", () => {
    const plan = planCoins({ ...base, customerHeld: coins(), merchantHeld: coins({ sp: 5 }), coinsGive: coins(), extraGive: coins({ gp: 1 }), payout: 30 });
    assert.deepEqual(plan.paid, coins({ sp: 3 }));
    assert.deepEqual(plan.merchantAfter, coins({ gp: 1, sp: 2 }));
  });

  it("moves no coins when nothing is owed", () => {
    const plan = planCoins({ ...base, customerHeld: coins({ gp: 3 }), merchantHeld: coins({ gp: 9 }), coinsGive: coins(), payout: 0 });
    assert.deepEqual(plan.customerAfter, coins({ gp: 3 }));
    assert.deepEqual(plan.merchantAfter, coins({ gp: 9 }));
  });
});
