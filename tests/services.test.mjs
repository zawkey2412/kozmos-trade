import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ARCHETYPES } from "../scripts/data/archetypes.mjs";
import { cleanArchetype } from "../scripts/engine/fit.mjs";
import { cleanServices, healFormula, parseServiceKey, serviceKey, servicesFromGold, servicesToGold } from "../scripts/engine/services.mjs";

describe("service lists", () => {
  it("keeps a valid service as it is", () => {
    const services = cleanServices([{ id: "identify", kind: "identify", price: 5000, icon: "fa-solid fa-eye" }]);
    assert.deepEqual(services, [{ id: "identify", kind: "identify", price: 5000, icon: "fa-solid fa-eye" }]);
  });

  it("refuses unknown kinds, bad prices, bad ids and repeats", () => {
    assert.throws(() => cleanServices([{ id: "x", kind: "teleport", price: 1 }]), /kind/);
    assert.throws(() => cleanServices([{ id: "x", kind: "note", price: -1 }]), /price/);
    assert.throws(() => cleanServices([{ id: "x", kind: "note", price: 1.5 }]), /price/);
    assert.throws(() => cleanServices([{ id: "Bad Id", kind: "note", price: 1 }]), /id/);
    assert.throws(() => cleanServices([{ id: "x", kind: "note", price: 1 }, { id: "x", kind: "note", price: 2 }]), /twice/);
    assert.throws(() => cleanServices([{ id: "x", kind: "note", price: 1, cost: 2 }]), /not a service key/);
  });

  it("checks an effect's parts", () => {
    const [service] = cleanServices([{ id: "rest", kind: "effect", price: 100, effect: { name: "Rested", days: 1, changes: [{ key: "system.attributes.hp.temp", value: 5 }] } }]);
    assert.deepEqual(service.effect, { name: "Rested", days: 1, changes: [{ key: "system.attributes.hp.temp", value: "5" }] });
    assert.throws(() => cleanServices([{ id: "rest", kind: "effect", price: 1, effect: { days: 0 } }]), /days/);
    assert.throws(() => cleanServices([{ id: "rest", kind: "effect", price: 1, effect: { colour: "red" } }]), /not an effect key/);
  });

  it("picks the healing roll for the world's rules", () => {
    const [both] = cleanServices([{ id: "cure", kind: "note", price: 1, heal: { modern: "2d8 + 3", legacy: "1d8 + 3" } }]);
    assert.equal(healFormula(both, "modern"), "2d8+3");
    assert.equal(healFormula(both, "legacy"), "1d8+3");
    const [one] = cleanServices([{ id: "cure", kind: "note", price: 1, heal: "1d4" }]);
    assert.equal(healFormula(one, "legacy"), "1d4");
  });

  it("shows prices in gold in the editor and stores copper", () => {
    const stored = cleanServices(servicesFromGold([{ id: "room", kind: "note", price: 0.8 }]));
    assert.equal(stored[0].price, 80);
    assert.equal(servicesToGold(stored)[0].price, 0.8);
  });
});

describe("service keys", () => {
  it("carries the item an Identify works on", () => {
    assert.equal(serviceKey("identify", "abc"), "identify:abc");
    assert.deepEqual(parseServiceKey("identify:abc"), { id: "identify", target: "abc" });
    assert.deepEqual(parseServiceKey("repair"), { id: "repair", target: null });
  });
});

describe("default services", () => {
  it("are valid on every archetype that has them", () => {
    for (const archetype of Object.values(ARCHETYPES)) assert.doesNotThrow(() => cleanArchetype(archetype));
    assert.deepEqual(cleanArchetype(ARCHETYPES.temple).services.map((s) => s.id), ["identify", "cureWounds", "removeCurse"]);
    assert.equal(cleanArchetype(ARCHETYPES.fletcher).services, undefined);
  });

  it("keeps an empty list, so a GM can take every service away", () => {
    assert.deepEqual(cleanArchetype({ ...ARCHETYPES.temple, services: [] }).services, []);
  });
});
