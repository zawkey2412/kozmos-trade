import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TABLES } from "../scripts/data/tables.mjs";
import { appraisalDC, appraisalKey, appraisalState } from "../scripts/engine/appraisal.mjs";

describe("appraisal", () => {
  it("uses DC 12, or 15 for anything magical", () => {
    assert.equal(appraisalDC({}, TABLES.appraisal), 12);
    assert.equal(appraisalDC({ magical: true }, TABLES.appraisal), 15);
    assert.equal(appraisalDC({ attunement: true }, TABLES.appraisal), 15);
    assert.equal(appraisalDC({ magicalBonus: 1 }, TABLES.appraisal), 15);
    assert.equal(appraisalDC({ rarity: "common" }, TABLES.appraisal), 15);
  });

  it("keys a record by customer and item without dots", () => {
    assert.equal(appraisalKey("abc", "xyz"), "abc-xyz");
  });

  it("keeps a success and forgets a failure the next day", () => {
    assert.equal(appraisalState(undefined, 5), null);
    assert.equal(appraisalState({ day: 2, success: true }, 5), "appraised");
    assert.equal(appraisalState({ day: 5, success: false }, 5), "failed");
    assert.equal(appraisalState({ day: 4, success: false }, 5), null);
  });
});