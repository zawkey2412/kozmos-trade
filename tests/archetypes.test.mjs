import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ARCHETYPES } from "../scripts/data/archetypes.mjs";
import { cleanArchetype, cleanFilter } from "../scripts/engine/fit.mjs";

describe("archetype filters", () => {
  it("keeps the keys a filter may have", () => {
    assert.deepEqual(cleanFilter({ type: "weapon", subtypes: ["martialM"], baseItems: ["smith"], magical: true }), {
      type: "weapon",
      subtypes: ["martialM"],
      baseItems: ["smith"],
      magical: true,
    });
    assert.deepEqual(cleanFilter({}), {});
  });

  it("refuses unknown keys and wrong kinds", () => {
    assert.throws(() => cleanFilter({ rarity: "rare" }), /not a filter key/);
    assert.throws(() => cleanFilter({ subtypes: "martialM" }), /list of text/);
    assert.throws(() => cleanFilter({ magical: "yes" }), /true or false/);
    assert.throws(() => cleanFilter([]), /must be an object/);
  });
});

describe("archetypes", () => {
  it("accepts every default archetype as it is", () => {
    for (const [id, archetype] of Object.entries(ARCHETYPES)) {
      assert.deepEqual(cleanArchetype(archetype), { ...archetype, fence: Boolean(archetype.fence) }, id);
    }
  });

  it("fills missing lists and keeps a label", () => {
    assert.deepEqual(cleanArchetype({ label: " Tailor " }), { label: "Tailor", stocks: [], favored: [], fence: false, skills: [], tools: [] });
  });

  it("refuses a broken filter inside", () => {
    assert.throws(() => cleanArchetype({ stocks: [{ colour: "red" }] }), /not a filter key/);
    assert.throws(() => cleanArchetype({ skills: "ins" }), /list of text/);
  });
});
