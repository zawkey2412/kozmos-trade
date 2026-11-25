import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { changesFrom, FEATURES, featuresFor, MODE_FEATURES } from "../scripts/data/modes.mjs";

describe("feature toggles", () => {
  it("follows the preset with no changes", () => {
    assert.deepEqual(featuresFor("simple"), MODE_FEATURES.simple);
    assert.deepEqual(featuresFor("crunchy", {}), MODE_FEATURES.crunchy);
  });

  it("lays the mode's own changes over its preset", () => {
    const features = featuresFor("standard", { standard: { haggle: false, theft: true }, simple: { market: true } });
    assert.equal(features.haggle, false);
    assert.equal(features.theft, true);
    assert.equal(features.market, false);
    assert.equal(features.attitude, true);
  });

  it("ignores changes that are not true or false", () => {
    assert.equal(featuresFor("standard", { standard: { haggle: "no" } }).haggle, true);
  });

  it("falls back to Standard for an unknown mode", () => {
    assert.deepEqual(featuresFor("odd"), MODE_FEATURES.standard);
  });

  it("keeps only the toggles that differ from the preset", () => {
    const chosen = { ...MODE_FEATURES.standard, haggle: false, theft: true };
    assert.deepEqual(changesFrom("standard", chosen), { haggle: false, theft: true });
    assert.deepEqual(changesFrom("standard", MODE_FEATURES.standard), {});
  });

  it("reads a missing toggle as off", () => {
    assert.equal(changesFrom("crunchy", {}).market, false);
    assert.equal(Object.keys(changesFrom("simple", {})).length, 0);
  });

  it("lists every feature of every preset", () => {
    for (const preset of Object.values(MODE_FEATURES)) assert.deepEqual(Object.keys(preset).sort(), [...FEATURES].sort());
  });
});
