export const MODULE_ID = "kozmos-trade";

export const SOCKET = `module.${MODULE_ID}`;

// Milliseconds a client waits for the GM to answer.
export const REQUEST_TIMEOUT = 10_000;

// Milliseconds for the GM's windows to find each other.
export const SESSIONS = Object.freeze({
  heartbeat: 5_000,
  expiry: 12_000,
  settle: 1_500,
});

export const SETTINGS = Object.freeze({
  MODE: "mode",
  TABLES: "tables",
});

export const MODES = Object.freeze({
  SIMPLE: "simple",
  STANDARD: "standard",
  CRUNCHY: "crunchy",
});
