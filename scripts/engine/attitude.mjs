// Attitude: bands, price adjustment, events, the daily gain cap and decay.

/** @typedef {typeof import("../data/tables.mjs").TABLES.attitude} AttitudeTables */
/** @typedef {"fairTrade" | "wanted" | "haggleBigWin" | "intimidate" | "haggleBigLoss" | "caughtStealing" | "theftNoticed"} AttitudeEvent */

/**
 * @typedef {object} Clock
 * @property {number} now
 * @property {number} day
 * @property {number} week
 */

/**
 * @typedef {object} AttitudeState
 * @property {number} value
 * @property {number} day
 * @property {number} gained
 * @property {number | null} fairTradeDay
 * @property {number} since
 */

/**
 * @param {Clock} clock
 * @returns {AttitudeState}
 */
export function freshAttitude(clock) {
  return { value: 0, day: dayOf(clock), gained: 0, fairTradeDay: null, since: clock.now };
}

/**
 * @param {number} value
 * @param {AttitudeTables} tables
 */
export function attitudeBand(value, tables) {
  return (tables.bands.find((band) => value <= band.max) ?? tables.bands.at(-1)).id;
}

/**
 * @param {number} value
 * @param {AttitudeTables} tables
 */
export function refusesTrade(value, tables) {
  return value <= tables.refuseAt;
}

// Share prices move by, better for the customer above 0.
/**
 * @param {number} value
 * @param {AttitudeTables} tables
 */
export function attitudeAdjustment(value, tables) {
  return (value / tables.max) * tables.swing;
}

// Points off the haggle DC, from -5 to +5, rounded half away from 0.
/**
 * @param {number} value
 * @param {AttitudeTables} tables
 */
export function attitudeMod(value, tables) {
  const mod = value / tables.dcDivisor;
  return Math.sign(mod) * Math.round(Math.abs(mod));
}

// Attitude gain for overpaying, in whole steps of the trade's value, and never more than the overpay pays for.
/**
 * @param {number} overpay
 * @param {number} tradeValue
 * @param {AttitudeTables} tables
 */
export function sweetenGain(overpay, tradeValue, tables) {
  if (overpay <= 0 || tradeValue <= 0) return 0;
  const steps = Math.floor(overpay / tradeValue / tables.sweeten.step + 1e-9);
  const paidFor = Math.floor(overpay / (tables.sweeten.minPerPoint || 1));
  return Math.min(steps * tables.sweeten.perStep, paidFor, tables.sweeten.maxPerTrade);
}

// Attitude after decay and a list of events.
/**
 * @param {AttitudeState | undefined} state
 * @param {(AttitudeEvent | { gain: number })[]} events
 * @param {Clock} clock
 * @param {AttitudeTables} tables
 */
export function changeAttitude(state, events, clock, tables) {
  const next = decayed(state ?? freshAttitude(clock), clock, tables);
  const today = dayOf(clock);
  if (next.day !== today) Object.assign(next, { day: today, gained: 0 });

  const before = next.value;
  for (const event of events) {
    let change = typeof event === "string" ? tables.events[event] : event.gain;
    if (event === "fairTrade") {
      if (next.fairTradeDay === today) change = 0;
      next.fairTradeDay = today;
    }
    if (change > 0) change = Math.min(change, tables.dailyGainCap - next.gained);
    const value = clamp(next.value + change, tables.min, tables.max);
    if (value > next.value) next.gained += value - next.value;
    next.value = value;
  }
  return { state: next, change: next.value - before };
}

// The stored state as it stands now, after any decay since it was written.
/**
 * @param {AttitudeState | undefined} state
 * @param {Clock} clock
 * @param {AttitudeTables} tables
 */
export function currentAttitude(state, clock, tables) {
  return decayed(state ?? freshAttitude(clock), clock, tables);
}

// A value the GM sets by hand. It leaves the daily gain cap and fair trade day alone.
/**
 * @param {AttitudeState | undefined} state
 * @param {number} value
 * @param {Clock} clock
 * @param {AttitudeTables} tables
 */
export function setAttitudeValue(state, value, clock, tables) {
  const next = currentAttitude(state, clock, tables);
  next.value = clamp(Math.round(Number(value) || 0), tables.min, tables.max);
  return next;
}

/**
 * @param {AttitudeState} state
 * @param {Clock} clock
 * @param {AttitudeTables} tables
 */
function decayed(state, clock, tables) {
  const next = { ...state };
  const weeks = Math.floor((clock.now - state.since) / clock.week);
  if (weeks <= 0) return next;
  next.since = state.since + weeks * clock.week;
  if (!tables.decay.enabled) return next;
  const fall = Math.min(Math.abs(state.value), weeks * tables.decay.perWeek);
  next.value = state.value - Math.sign(state.value) * fall;
  return next;
}

/** @param {Clock} clock */
function dayOf(clock) {
  return Math.floor(clock.now / clock.day);
}

/**
 * @param {number} value
 * @param {number} low
 * @param {number} high
 */
function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}
