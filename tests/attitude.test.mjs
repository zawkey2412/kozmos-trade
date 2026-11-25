import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TABLES } from "../scripts/data/tables.mjs";
import {
  attitudeAdjustment,
  attitudeBand,
  attitudeMod,
  changeAttitude,
  currentAttitude,
  freshAttitude,
  refusesTrade,
  setAttitudeValue,
  sweetenGain,
} from "../scripts/engine/attitude.mjs";

const tables = TABLES.attitude;
const DAY = 86_400;
const WEEK = DAY * 7;
const at = (now) => ({ now, day: DAY, week: WEEK });
const start = at(DAY * 10);
const withValue = (value, clock = start) => ({ ...freshAttitude(clock), value });
const change = (state, events, clock = start, tableSet = tables) => changeAttitude(state, events, clock, tableSet);

describe("attitude bands", () => {
  it("names each band at its edges", () => {
    assert.equal(attitudeBand(-50, tables), "hostile");
    assert.equal(attitudeBand(-31, tables), "hostile");
    assert.equal(attitudeBand(-30, tables), "cold");
    assert.equal(attitudeBand(-11, tables), "cold");
    assert.equal(attitudeBand(-10, tables), "neutral");
    assert.equal(attitudeBand(10, tables), "neutral");
    assert.equal(attitudeBand(11, tables), "warm");
    assert.equal(attitudeBand(30, tables), "warm");
    assert.equal(attitudeBand(31, tables), "friendly");
    assert.equal(attitudeBand(50, tables), "friendly");
  });

  it("refuses to trade at -40 or lower", () => {
    assert.equal(refusesTrade(-39, tables), false);
    assert.equal(refusesTrade(-40, tables), true);
  });
});

describe("attitude and prices", () => {
  it("moves prices 15% at either end", () => {
    assert.equal(attitudeAdjustment(50, tables), 0.15);
    assert.equal(attitudeAdjustment(-50, tables), -0.15);
    assert.equal(attitudeAdjustment(0, tables), 0);
  });

  it("scales in between", () => {
    assert.ok(Math.abs(attitudeAdjustment(20, tables) - 0.06) < 1e-12);
  });
});

describe("attitude and the haggle DC", () => {
  it("is attitude over 10, from -5 to +5", () => {
    assert.equal(attitudeMod(30, tables), 3);
    assert.equal(attitudeMod(50, tables), 5);
    assert.equal(attitudeMod(-50, tables), -5);
    assert.equal(attitudeMod(0, tables), 0);
  });

  it("rounds half away from 0 on both sides", () => {
    assert.equal(attitudeMod(25, tables), 3);
    assert.equal(attitudeMod(-25, tables), -3);
    assert.equal(attitudeMod(14, tables), 1);
  });
});

describe("attitude events", () => {
  it("starts a new customer at 0", () => {
    assert.equal(change(undefined, []).state.value, 0);
  });

  it("applies each event's change", () => {
    assert.equal(change(withValue(0), ["fairTrade"]).change, 1);
    assert.equal(change(withValue(0), ["wanted"]).change, 5);
    assert.equal(change(withValue(0), ["haggleBigWin"]).change, 2);
    assert.equal(change(withValue(0), ["intimidate"]).change, -5);
    assert.equal(change(withValue(0), ["haggleBigLoss"]).change, -10);
    assert.equal(change(withValue(0), ["caughtStealing"]).change, -30);
  });

  it("counts a fair trade once per in-game day", () => {
    const first = change(withValue(0), ["fairTrade", "fairTrade"]);
    assert.equal(first.change, 1);
    assert.equal(change(first.state, ["fairTrade"], at(DAY * 10 + 3_600)).change, 0);
    assert.equal(change(first.state, ["fairTrade"], at(DAY * 11)).change, 1);
  });

  it("stays between -50 and +50", () => {
    assert.equal(change(withValue(45), ["wanted", "wanted"]).state.value, 50);
    assert.equal(change(withValue(-40), ["caughtStealing"]).state.value, -50);
  });
});

describe("sweetening", () => {
  it("gives +1 for each full 5% overpaid", () => {
    assert.equal(sweetenGain(4, 100, tables), 0);
    assert.equal(sweetenGain(5, 100, tables), 1);
    assert.equal(sweetenGain(15, 100, tables), 3);
  });

  it("gives at most +5 per trade", () => {
    assert.equal(sweetenGain(90, 100, tables), 5);
  });

  it("gives nothing for 1 cp on a large trade", () => {
    assert.equal(sweetenGain(1, 100_000, tables), 0);
    assert.equal(sweetenGain(0, 0, tables), 0);
  });

  it("counts as a gain toward the daily cap", () => {
    assert.equal(change(withValue(0), [{ gain: 5 }, "wanted", "wanted"]).change, 10);
  });
});

describe("daily gain cap", () => {
  it("allows +10 in gains per in-game day", () => {
    assert.equal(change(withValue(0), ["wanted", "wanted", "wanted"]).change, 10);
  });

  it("carries the cap across visits on the same day", () => {
    const morning = change(withValue(0), ["wanted", "wanted"]);
    assert.equal(change(morning.state, ["haggleBigWin"], at(DAY * 10 + 7_200)).change, 0);
  });

  it("opens again the next day", () => {
    const today = change(withValue(0), ["wanted", "wanted"]);
    assert.equal(change(today.state, ["wanted"], at(DAY * 11)).change, 5);
  });

  it("never limits losses", () => {
    const capped = change(withValue(0), ["wanted", "wanted"]);
    assert.equal(change(capped.state, ["haggleBigLoss", "haggleBigLoss"], start).change, -20);
  });

  it("does not count a loss against the cap", () => {
    assert.equal(change(withValue(0), ["haggleBigLoss", "wanted", "wanted", "wanted"]).change, 0);
  });
});

describe("attitude decay", () => {
  const decaying = { ...tables, decay: { enabled: true, perWeek: 1 } };

  it("is off by default", () => {
    assert.equal(change(withValue(20), [], at(DAY * 10 + WEEK * 3)).state.value, 20);
  });

  it("moves 1 point toward 0 per in-game week", () => {
    assert.equal(change(withValue(20), [], at(DAY * 10 + WEEK * 3), decaying).state.value, 17);
    assert.equal(change(withValue(-20), [], at(DAY * 10 + WEEK * 2), decaying).state.value, -18);
  });

  it("stops at 0", () => {
    assert.equal(change(withValue(2), [], at(DAY * 10 + WEEK * 5), decaying).state.value, 0);
  });

  it("waits for a full week", () => {
    assert.equal(change(withValue(20), [], at(DAY * 10 + WEEK - 1), decaying).state.value, 20);
  });

  it("keeps the part of a week already passed", () => {
    const half = change(withValue(20), [], at(DAY * 10 + WEEK * 1.5), decaying).state;
    assert.equal(change(half, [], at(DAY * 10 + WEEK * 2), decaying).state.value, 18);
  });
});

describe("attitude set by hand and read later", () => {
  const decaying = { ...tables, decay: { enabled: true, perWeek: 1 } };

  it("starts at 0 for a customer never seen", () => {
    assert.equal(currentAttitude(undefined, start, tables).value, 0);
  });

  it("decays on read when decay is on, and not when it is off", () => {
    const state = withValue(20);
    assert.equal(currentAttitude(state, at(DAY * 10 + WEEK * 3), decaying).value, 17);
    assert.equal(currentAttitude(state, at(DAY * 10 + WEEK * 3), tables).value, 20);
  });

  it("sets a whole value inside the range and keeps the daily cap", () => {
    const state = { ...withValue(5), gained: 7 };
    const next = setAttitudeValue(state, 33.6, start, tables);
    assert.equal(next.value, 34);
    assert.equal(next.gained, 7);
    assert.equal(setAttitudeValue(state, 90, start, tables).value, 50);
    assert.equal(setAttitudeValue(state, -90, start, tables).value, -50);
    assert.equal(setAttitudeValue(state, "x", start, tables).value, 0);
  });
});