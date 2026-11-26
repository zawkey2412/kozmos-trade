import "./foundry.mjs";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { reversePlan } from "../scripts/services/receipts.mjs";

const coins = (values) => ({ pp: 0, gp: 0, ep: 0, sp: 0, cp: 0, ...values });
const actor = (currency, items) => ({ system: { currency }, items: new Map(Object.entries(items).map(([id, quantity]) => [id, { id, name: id, system: { quantity } }])) });
const entry = {
  given: [{ id: "daggerOnMerchant", name: "Dagger", quantity: 1, unit: 100 }],
  received: [{ id: "potionOnCustomer", name: "Potion", quantity: 2, unit: 5000, shelf: { listedPrice: 4800, pinned: false, limited: false, curio: false } }],
  coinsGive: coins({ gp: 100 }),
  paid: coins({ gp: 1 }),
};

describe("reverting a trade", () => {
  it("sends both sides back and reverses the coins", () => {
    const merchant = actor(coins({ gp: 400 }), { daggerOnMerchant: 1 });
    const customer = actor(coins({ gp: 5 }), { potionOnCustomer: 2 });
    const plan = reversePlan(merchant, customer, entry);
    assert.deepEqual(plan.give.map((l) => [l.item.id, l.quantity, l.restoreFlags?.listedPrice]), [["potionOnCustomer", 2, 4800]]);
    assert.deepEqual(plan.take.map((l) => [l.item.id, l.quantity]), [["daggerOnMerchant", 1]]);
    assert.deepEqual(plan.coins.customerAfter, coins({ gp: 104 }));
    assert.deepEqual(plan.coins.merchantAfter, coins({ gp: 301 }));
  });

  it("puts items back into the stack they came from when it is still there", () => {
    const withFrom = {
      ...entry,
      given: [{ ...entry.given[0], from: "daggerStack" }],
      received: [{ ...entry.received[0], from: "potionStack" }],
    };
    const merchant = actor(coins({ gp: 400 }), { daggerOnMerchant: 1, potionStack: 1 });
    const customer = actor(coins({ gp: 5 }), { potionOnCustomer: 2 });
    const plan = reversePlan(merchant, customer, withFrom);
    assert.equal(plan.give[0].mergeInto, "potionStack");
    assert.equal(plan.take[0].mergeInto, undefined);
  });

  it("refuses when an item has moved on", () => {
    const merchant = actor(coins({ gp: 400 }), {});
    const customer = actor(coins({ gp: 5 }), { potionOnCustomer: 2 });
    assert.throws(() => reversePlan(merchant, customer, entry), /KT.Error.RevertMoved/);
  });

  it("refuses when fewer are left than were traded", () => {
    const merchant = actor(coins({ gp: 400 }), { daggerOnMerchant: 1 });
    const customer = actor(coins({ gp: 5 }), { potionOnCustomer: 1 });
    assert.throws(() => reversePlan(merchant, customer, entry), /KT.Error.RevertMoved/);
  });

  it("returns joined items and coins to who put them up, and takes purchases back from who got them", () => {
    const merchant = actor(coins({ gp: 400 }), { daggerOnMerchant: 1, ringOnMerchant: 1 });
    const customer = actor(coins({ gp: 5 }), {});
    const bram = actor(coins(), { potionOnCustomer: 2 });
    const pooled = {
      ...entry,
      recipient: "Actor.bram",
      pool: [{ actor: "Actor.bram", name: "Bram", given: [{ id: "ringOnMerchant", name: "Ring", quantity: 1, unit: 1000 }], coinsGive: coins({ gp: 10 }) }],
    };
    const plan = reversePlan(merchant, customer, pooled, new Map([["Actor.bram", bram]]));
    const moves = plan.moves.map((move) => [move.from, move.to, move.lines.map((l) => l.item.id)]);
    assert.deepEqual(moves, [
      [bram, merchant, ["potionOnCustomer"]],
      [merchant, customer, ["daggerOnMerchant"]],
      [merchant, bram, ["ringOnMerchant"]],
    ]);
    const after = new Map(plan.currency);
    assert.deepEqual(after.get(customer), coins({ gp: 105 }));
    assert.deepEqual(after.get(bram), coins({ gp: 9 }));
    assert.deepEqual(after.get(merchant), coins({ gp: 291 }));
  });

  it("refuses a pooled trade when a joined character is gone", () => {
    const merchant = actor(coins({ gp: 400 }), { daggerOnMerchant: 1 });
    const customer = actor(coins({ gp: 5 }), { potionOnCustomer: 2 });
    const pooled = { ...entry, pool: [{ actor: "Actor.gone", name: "Gone", given: [], coinsGive: coins() }] };
    assert.throws(() => reversePlan(merchant, customer, pooled), /KT.Error.Missing/);
  });

  it("refuses when the coins have been spent", () => {
    const merchant = actor(coins({ gp: 50 }), { daggerOnMerchant: 1 });
    const customer = actor(coins({ gp: 5 }), { potionOnCustomer: 2 });
    assert.throws(() => reversePlan(merchant, customer, entry), /KT.Error.RevertCoins/);
  });
});
