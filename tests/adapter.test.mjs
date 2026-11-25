import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { clock, coinLabels, holdingFacts, itemFacts, levelFromName, passiveScore, purse, rulesVersion } from "../scripts/adapter/dnd5e.mjs";

const item = (type, system = {}, name = "Thing") => ({ type, name, system });
const cast = (spell) => [{ type: "cast", spell }];

afterEach(() => {
  delete globalThis.game;
  delete globalThis.CONFIG;
  delete globalThis.foundry;
});

describe("item facts", () => {
  it("reads price, rarity and subtype", () => {
    const facts = itemFacts(item("weapon", { type: { value: "martialM" }, price: { value: 15, denomination: "gp" }, rarity: "" }));
    assert.equal(facts.type, "weapon");
    assert.equal(facts.subtype, "martialM");
    assert.deepEqual(facts.price, { value: 15, denomination: "gp" });
    assert.equal(facts.rarity, undefined);
    assert.equal(facts.scroll, false);
    assert.equal(facts.spellLevel, null);
  });

  it("reads a scroll's level from its Cast activity", () => {
    const scroll = item("consumable", { type: { value: "scroll" }, activities: cast({ level: 3 }) });
    assert.equal(itemFacts(scroll).scroll, true);
    assert.equal(itemFacts(scroll).spellLevel, 3);
  });

  it("falls back to the linked spell's level", () => {
    globalThis.foundry = { utils: { fromUuidSync: () => ({ system: { level: 2 } }) } };
    const scroll = item("consumable", { type: { value: "scroll" }, activities: cast({ level: null, uuid: "Item.x" }) });
    assert.equal(itemFacts(scroll).spellLevel, 2);
  });

  it("falls back to the scroll's name", () => {
    const scroll = item("consumable", { type: { value: "scroll" }, activities: [] }, "Spell Scroll (4th Level)");
    assert.equal(itemFacts(scroll).spellLevel, 4);
  });

  it("reads the magical bonus, attunement and magical property", () => {
    const facts = itemFacts(item("weapon", { magicalBonus: 2, attunement: "required", properties: new Set(["mgc", "fin"]) }));
    assert.equal(facts.magicalBonus, 2);
    assert.equal(facts.attunement, true);
    assert.equal(facts.magical, true);
  });

  it("does not count optional attunement", () => {
    assert.equal(itemFacts(item("equipment", { attunement: "optional" })).attunement, false);
  });

  it("reads properties stored as a list", () => {
    assert.equal(itemFacts(item("equipment", { properties: ["mgc"] })).magical, true);
  });

  it("reads unidentified items", () => {
    assert.equal(itemFacts(item("equipment", { identified: false })).identified, false);
    assert.equal(itemFacts(item("equipment", {})).identified, true);
  });

  it("treats the old backpack type as a container", () => {
    assert.equal(itemFacts(item("backpack")).type, "container");
  });

  it("copes with an item that has no system data", () => {
    assert.deepEqual(itemFacts({ type: "loot", name: "Bone" }).price, { value: 0, denomination: "gp" });
  });
});

describe("scroll names", () => {
  it("reads cantrips and levels", () => {
    assert.equal(levelFromName("Spell Scroll (Cantrip)"), 0);
    assert.equal(levelFromName("Spell Scroll: 1st Level"), 1);
    assert.equal(levelFromName("Spell Scroll (9th level)"), 9);
    assert.equal(levelFromName("Spell Scroll, Level 1"), 1);
  });

  it("finds nothing in other names", () => {
    assert.equal(levelFromName("Spell Scroll: Fireball"), null);
  });
});

describe("holding facts", () => {
  it("reads quantity, equipped, attuned and container", () => {
    const facts = holdingFacts(item("weapon", { quantity: 3, equipped: true, attuned: true, container: "box1" }));
    assert.deepEqual(facts, { quantity: 3, equipped: true, attuned: true, container: "box1", contents: 0 });
  });

  it("counts a container's contents", () => {
    assert.equal(holdingFacts(item("container", { contents: new Map([["a", {}], ["b", {}]]) })).contents, 2);
  });
});

describe("actor facts", () => {
  it("reads the purse in whole coins of 0 or more", () => {
    assert.deepEqual(purse({ system: { currency: { gp: 12, sp: -3, cp: 4.7 } } }), { pp: 0, gp: 12, ep: 0, sp: 0, cp: 4 });
  });

  it("reads passive scores, or 10 without one", () => {
    const actor = { system: { skills: { ins: { passive: 14 } } } };
    assert.equal(passiveScore(actor, "ins"), 14);
    assert.equal(passiveScore(actor, "prc"), 10);
  });
});

describe("world facts", () => {
  it("reads the rules version", () => {
    globalThis.game = { settings: { get: () => "legacy" } };
    assert.equal(rulesVersion(), "legacy");
    globalThis.game = { settings: { get: () => "modern" } };
    assert.equal(rulesVersion(), "modern");
  });

  it("builds the clock from the calendar", () => {
    const days = { secondsPerMinute: 60, minutesPerHour: 60, hoursPerDay: 24, values: new Array(7) };
    globalThis.game = { time: { worldTime: 500, calendar: { days } } };
    assert.deepEqual(clock(), { now: 500, day: 86_400, week: 604_800 });
  });

  it("reads coin labels in the reader's language", () => {
    globalThis.CONFIG = { DND5E: { currencies: { gp: { abbreviation: "DND5E.CurrencyAbbrGP" } } } };
    globalThis.game = { i18n: { localize: (key) => (key === "DND5E.CurrencyAbbrGP" ? "GM" : key) } };
    assert.deepEqual(coinLabels(), { gp: "GM" });
  });
});
