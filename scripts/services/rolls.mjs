// Checks a customer rolls and the active GM settles: each gets a one-time code, and the roll message carrying it settles it once.
// Chat messages are typed any here because their schema fields have no generated types.
import { MODULE_ID } from "../constants.mjs";
import { TradeError } from "./errors.mjs";
import { isAnsweringWindow } from "./sessions.mjs";
import { MESSAGES, onRequest, queued } from "./socket.mjs";

/**
 * @typedef {object} ExpectedRoll
 * @property {string} kind
 * @property {string} nonce
 * @property {string} merchant
 * @property {string} customer
 * @property {string} userId
 * @property {object} data
 * @property {number} since
 */

/** @typedef {(entry: ExpectedRoll, total: number, message: any) => Promise<object>} SettleRoll */

const WAIT = 3000;
const KEEP = 10 * 60 * 1000;

/** @type {Map<string, ExpectedRoll>} */
const expected = new Map();
/** @type {Map<string, { outcome: object, since: number }>} */
const settled = new Map();
/** @type {Map<string, SettleRoll>} */
const kinds = new Map();

export function registerRollHandlers() {
  onRequest(MESSAGES.ROLL_REPORT, reportRoll, { queueKey: (payload) => payload?.merchant });
  Hooks.on("createChatMessage", (message) => onRollMessage(message));
}

/**
 * @param {string} kind
 * @param {SettleRoll} settle
 */
export function registerRollKind(kind, settle) {
  kinds.set(kind, settle);
}

// GM side: a code for one roll of this kind.
/** @param {Omit<ExpectedRoll, "nonce" | "since">} entry */
export function expectRoll(entry) {
  const now = Date.now();
  for (const [nonce, old] of expected) if (now - old.since > KEEP) expected.delete(nonce);
  for (const [nonce, old] of settled) if (now - old.since > KEEP) settled.delete(nonce);
  const nonce = foundry.utils.randomID();
  expected.set(nonce, { ...entry, nonce, since: now });
  return nonce;
}

// The flags a roll message carries so the GM can settle it.
/**
 * @param {string} kind
 * @param {string} nonce
 * @param {string} merchant
 */
export function rollFlags(kind, nonce, merchant) {
  return { [MODULE_ID]: { roll: { kind, nonce, merchant } } };
}

// The window's own report of its roll. The roll message may already have settled it.
/**
 * @param {{ merchant: string, nonce: string, messageId: string }} payload
 */
async function reportRoll({ nonce, messageId }) {
  for (let waited = 0; waited <= WAIT; waited += 250) {
    const done = settled.get(nonce);
    if (done) return done.outcome;
    const message = game.messages.get(messageId);
    if (message) {
      const outcome = await settleFrom(message);
      if (outcome) return outcome;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new TradeError("KT.Error.NoRoll");
}

/** @param {any} message */
async function onRollMessage(message) {
  const flag = message.flags?.[MODULE_ID]?.roll;
  if (!flag || !game.users.activeGM?.isSelf || !(await isAnsweringWindow())) return;
  await queued(String(flag.merchant), () => settleFrom(message)).catch((error) => console.error("Kozmos Trade | Roll failed", error));
}

/** @param {any} message */
async function settleFrom(message) {
  const flag = message.flags?.[MODULE_ID]?.roll;
  const entry = flag ? expected.get(flag.nonce) : null;
  if (!entry || entry.kind !== flag.kind || entry.merchant !== flag.merchant) return null;
  const author = message.author ?? game.users.get(message.user);
  if (author?.id !== entry.userId && !author?.isGM) return null;
  const total = message.rolls?.[0]?.total;
  if (!Number.isFinite(total)) return null;
  expected.delete(entry.nonce);
  const settle = kinds.get(entry.kind);
  if (!settle) return null;
  const outcome = await settle(entry, total, message);
  settled.set(entry.nonce, { outcome, since: Date.now() });
  return outcome;
}
