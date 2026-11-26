import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cleanArchetype } from "../scripts/engine/fit.mjs";
import { cleanReactions, linesFor, pickLine, situationOf } from "../scripts/engine/reactions.mjs";

const defaults = { short: { neutral: ["Not enough."], cold: ["Too little."] }, even: { neutral: ["Fair."] } };

describe("reaction lines", () => {
  it("names the situation of an offer", () => {
    assert.equal(situationOf({ state: "short" }, true), "empty");
    assert.equal(situationOf({ state: "generous" }, false), "generous");
  });

  it("prefers the archetype's lines, then the band's, then neutral", () => {
    assert.deepEqual(linesFor("short", "cold", { own: { short: { cold: ["Ha!"] } }, defaults }), ["Ha!"]);
    assert.deepEqual(linesFor("short", "cold", { defaults }), ["Too little."]);
    assert.deepEqual(linesFor("even", "warm", { defaults }), ["Fair."]);
    assert.deepEqual(linesFor("greeting", "warm", { defaults }), []);
  });

  it("picks a line, or none from an empty list", () => {
    assert.equal(pickLine(["a", "b"], () => 0.99), "b");
    assert.equal(pickLine([], () => 0.5), null);
  });

  it("checks lines from the editor", () => {
    assert.deepEqual(cleanReactions({ short: { cold: [" Hm. ", ""] } }), { short: { cold: ["Hm."] } });
    assert.throws(() => cleanReactions({ lowball: {} }), /not a situation/);
    assert.throws(() => cleanReactions({ short: { grumpy: [] } }), /not an attitude band/);
    assert.throws(() => cleanReactions({ short: { cold: "Hm." } }), /list of text/);
  });

  it("keeps reaction lines on an archetype", () => {
    assert.deepEqual(cleanArchetype({ stocks: [], reactions: { even: { warm: ["Lovely."] } } }).reactions, { even: { warm: ["Lovely."] } });
    assert.equal(cleanArchetype({ stocks: [] }).reactions, undefined);
  });
});