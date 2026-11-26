import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ARCHETYPES } from "../scripts/data/archetypes.mjs";
import { TABLES } from "../scripts/data/tables.mjs";
import { namedFilled, rollWanted, wantedRate } from "../scripts/engine/wanted.mjs";

function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

const value = (copper) => ({ copper, source: "price", forSale: true });
const pool = Array.from({ length: 12 }, (_, i) => ({ uuid: `Compendium.test.Sword${i}`, name: `Sword ${i}`, facts: { type: "weapon", subtype: "martialM", baseItem: "longsword" }, value: value(1500) }));

describe("rolling a Wanted board", () => {
  it("gives one named item or one or two categories, at rates in range", () => {
    let named = 0;
    let categories = 0;
    for (let seed = 1; seed < 60; seed++) {
      const board = rollWanted(pool, { archetype: ARCHETYPES.blacksmith, tier: "modest", tables: TABLES, random: seeded(seed * 7_368_787) });
      if (board[0].uuid) {
        named++;
        assert.equal(board.length, 1);
        assert.ok(board[0].multiplier >= 1.25 && board[0].multiplier <= 1.5, `${board[0].multiplier}`);
        assert.ok(board[0].name.startsWith("Sword"));
      } else {
        categories++;
        assert.ok(board.length >= 1 && board.length <= 2);
        assert.equal(new Set(board.map((e) => e.category)).size, board.length);
        for (const entry of board) assert.ok(entry.multiplier >= 0.75 && entry.multiplier <= 1, `${entry.multiplier}`);
      }
    }
    assert.ok(named > 0 && categories > 0);
  });

  it("never names an item already on the shelf", () => {
    for (let seed = 1; seed < 40; seed++) {
      const board = rollWanted(pool.slice(0, 2), { archetype: ARCHETYPES.blacksmith, tier: "modest", tables: TABLES, random: seeded(seed), exclude: [pool[0].uuid] });
      if (board[0].uuid) assert.equal(board[0].uuid, pool[1].uuid);
    }
  });
});

describe("matching the board", () => {
  const board = [
    { category: "armor", uuid: "", name: "", multiplier: 0.8 },
    { category: "weapons", uuid: "", name: "", multiplier: 0.9 },
    { category: "", uuid: "Compendium.test.Sword3", name: "Sword 3", multiplier: 1.4 },
  ];

  it("picks the best rate an item fits", () => {
    assert.equal(wantedRate({ type: "weapon", name: "Axe" }, board), 0.9);
    assert.equal(wantedRate({ type: "weapon", name: "Sword 3", source: "Compendium.test.Sword3" }, board), 1.4);
    assert.equal(wantedRate({ type: "equipment", subtype: "heavy", name: "Plate" }, board), 0.8);
    assert.equal(wantedRate({ type: "loot", name: "Gem" }, board), null);
  });

  it("matches a named item by its source or its name", () => {
    assert.equal(wantedRate({ type: "loot", name: "Sword 3" }, board), 1.4);
    assert.deepEqual(namedFilled([{ type: "weapon", name: "x", source: "Compendium.test.Sword3" }], board), [board[2]]);
    assert.deepEqual(namedFilled([{ type: "weapon", name: "Axe" }], board), []);
  });
});