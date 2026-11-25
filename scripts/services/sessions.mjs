// Picks one window to answer requests when the same GM has the game open more than once.
import { SESSIONS } from "../constants.mjs";

/**
 * @typedef {object} Session
 * @property {string} id
 * @property {number} since
 */

/** @type {Session} */
let self;

/** @type {Map<string, Session & { seen: number }>} */
const others = new Map();

/** @type {Promise<void>} */
let settled = Promise.resolve();

/** @param {(message: object) => void} send */
export function startSessions(send) {
  self = { id: foundry.utils.randomID(), since: Date.now() };
  settled = new Promise((resolve) => window.setTimeout(resolve, SESSIONS.settle));
  send({ kind: "session", ...self, ask: true });
  window.setInterval(() => send({ kind: "session", ...self, ask: false }), SESSIONS.heartbeat);
}

/**
 * @param {{ id: string, since: number, ask?: boolean }} message
 * @param {(message: object) => void} send
 */
export function onSession({ id, since, ask }, send) {
  if (!self || id === self.id) return;
  others.set(id, { id, since, seen: Date.now() });
  if (ask) send({ kind: "session", ...self, ask: false });
}

export async function isAnsweringWindow() {
  if (!self) return true;
  await settled;
  const now = Date.now();
  const live = [...others.values()].filter((session) => now - session.seen < SESSIONS.expiry);
  return firstSession([self, ...live]).id === self.id;
}

// The oldest session, then the lowest id.
/** @param {Session[]} sessions */
export function firstSession(sessions) {
  return sessions.reduce((first, session) => {
    if (session.since !== first.since) return session.since < first.since ? session : first;
    return session.id < first.id ? session : first;
  });
}
