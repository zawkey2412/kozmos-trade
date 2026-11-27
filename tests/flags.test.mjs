import "./foundry.mjs";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cleanFlags, itemFlags, ItemFlags, merchantFlags, MerchantFlags, SceneFlags, sceneFlags, tokenFlags, characterFlags } from "../scripts/data/flags.mjs";

const withFlags = (flags) => ({ flags: { "kozmos-trade": flags } });
const attitude = { value: 12, day: 3, gained: 4, fairTradeDay: 3, since: 1000 };

describe("merchant flags", () => {
  it("reads a merchant with no flags as a closed, modest shop", () => {
    const flags = merchantFlags({});
    assert.equal(flags.enabled, false);
    assert.equal(flags.open, false);
    assert.equal(flags.tier, "modest");
    assert.equal(flags.executionMode, "instant");
    assert.deepEqual(flags.attitude, {});
    assert.deepEqual(flags.wanted, []);
    assert.equal(flags.lastRestock, null);
  });

  it("reads stored values", () => {
    const flags = merchantFlags(withFlags({ enabled: true, open: true, tier: "poor", attitude: { abc: attitude } }));
    assert.equal(flags.tier, "poor");
    assert.deepEqual(flags.attitude.abc, attitude);
  });

  it("resets a bad value to its default when reading", () => {
    assert.equal(merchantFlags(withFlags({ tier: "rich", open: true })).tier, "modest");
    assert.equal(merchantFlags(withFlags({ tier: "rich", open: true })).open, true);
  });

  it("accepts good data for writing", () => {
    const clean = cleanFlags(MerchantFlags, { enabled: true, tier: "wealthy", haggleLock: { abc: 86400 } });
    assert.equal(clean.tier, "wealthy");
    assert.deepEqual(clean.haggleLock, { abc: 86400 });
  });

  it("rejects an unknown tier or execution mode", () => {
    assert.throws(() => cleanFlags(MerchantFlags, { tier: "rich" }));
    assert.throws(() => cleanFlags(MerchantFlags, { executionMode: "auction" }));
  });

  it("rejects a Wanted entry with no multiplier above 0", () => {
    assert.throws(() => cleanFlags(MerchantFlags, { wanted: [{ category: "weapon", uuid: "", multiplier: 0 }] }));
  });

  it("keeps each character's last visit, and starts with none", () => {
    assert.deepEqual(merchantFlags({}).visits, {});
    assert.deepEqual(merchantFlags(withFlags({ visits: { abc: { last: 7200 } } })).visits, { abc: { last: 7200, tradedAt: null, sold: [], bought: [] } });
    assert.equal(merchantFlags({}).remoteTrade, false);
  });

  it("keeps attitude inside -50 to +50", () => {
    const clean = cleanFlags(MerchantFlags, { attitude: { abc: { ...attitude, value: 90 } } });
    assert.equal(clean.attitude.abc.value, 50);
  });
});

describe("item flags", () => {
  it("reads an item with no flags as unpriced and not stolen", () => {
    assert.deepEqual(itemFlags({}), {
      listedPrice: null,
      pinned: false,
      limited: false,
      curio: false,
      underCounter: false,
      trueValue: null,
      stolen: null,
    });
  });

  it("keeps a theft record", () => {
    const stolen = { source: "Scene.a.Token.b.Actor.c", time: 5000 };
    assert.deepEqual(cleanFlags(ItemFlags, { stolen }).stolen, stolen);
  });

  it("rejects a theft record with no source", () => {
    assert.throws(() => cleanFlags(ItemFlags, { stolen: { source: "", time: 5000 } }));
  });

  it("keeps prices at 0 or above", () => {
    assert.equal(cleanFlags(ItemFlags, { listedPrice: -20 }).listedPrice, 0);
  });
});

describe("scene flags", () => {
  it("reads a scene with no market rules", () => {
    assert.deepEqual(sceneFlags({}).market, []);
  });

  it("keeps a market rule and refuses one with no change", () => {
    const rule = { id: "war", name: "War", categories: ["weapons"], multiplier: 1.3, until: null };
    assert.deepEqual(cleanFlags(SceneFlags, { market: [rule] }).market, [rule]);
    assert.throws(() => cleanFlags(SceneFlags, { market: [{ ...rule, multiplier: 0 }] }));
  });
});

describe("token and character flags", () => {
  it("reads a token as no guard", () => {
    assert.equal(tokenFlags({}).guard, false);
  });

  it("reads notoriety per scene", () => {
    const notoriety = { "Scene.a": { points: 2, lastCatch: 9000 } };
    assert.deepEqual(characterFlags(withFlags({ notoriety })).notoriety, notoriety);
  });
});
