// Messages between clients: requests the active GM answers, and broadcasts from a GM.
import { REQUEST_TIMEOUT, SOCKET } from "../constants.mjs";
import { KeyedQueue } from "./queue.mjs";
import { TradeError } from "./errors.mjs";
import { isAnsweringWindow, onSession, startSessions } from "./sessions.mjs";

/** @import User from "@client/documents/user.mjs"; */

/**
 * @typedef {object} RequestHandler
 * @property {(payload: any, sender: User) => any} handle
 * @property {((payload: any) => string | null) | undefined} queueKey
 */

/** @typedef {(payload: any, sender: User) => void} BroadcastHandler */

export const MESSAGES = Object.freeze({
  PING: "ping",
  SESSION_OPEN: "session.open",
  SESSION_CLOSE: "session.close",
  PURSE_CHECK: "purse.check",
});

/** @type {Map<string, RequestHandler>} */
const requests = new Map();

/** @type {Map<string, BroadcastHandler>} */
const broadcasts = new Map();

/** @type {Map<string, { resolve: (value: any) => void, reject: (error: Error) => void, timer: number }>} */
const pending = new Map();

const queue = new KeyedQueue();

export function listen() {
  onRequest(MESSAGES.PING, () => game.user.id);
  game.socket.on(SOCKET, receive);
  if (game.user.isGM) startSessions(toOwnWindows);
}

// Answered by the active GM, one at a time per queue key.
/**
 * @param {string} type
 * @param {(payload: any, sender: User) => any} handle
 * @param {{ queueKey?: (payload: any) => string | null }} [options]
 */
export function onRequest(type, handle, { queueKey } = {}) {
  requests.set(type, { handle, queueKey });
}

/**
 * @param {string} type
 * @param {BroadcastHandler} handle
 */
export function onBroadcast(type, handle) {
  broadcasts.set(type, handle);
}

/**
 * @param {string} type
 * @param {any} [payload]
 * @returns {Promise<any>}
 */
export function request(type, payload = null) {
  const gm = game.users.activeGM;
  if (!gm) return Promise.reject(new TradeError("KT.Error.NoGM"));
  if (gm.isSelf) return answerLocally(type, payload);

  const id = foundry.utils.randomID();
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      pending.delete(id);
      reject(new TradeError("KT.Error.NoAnswer"));
    }, REQUEST_TIMEOUT);
    pending.set(id, { resolve, reject, timer });
    emit({ kind: "request", type, id, payload }, [gm.id]);
  });
}

export async function gmReachable() {
  try {
    await request(MESSAGES.PING);
    return true;
  } catch {
    return false;
  }
}

// GM only.
/**
 * @param {string} type
 * @param {any} [payload]
 * @param {{ users?: string[] }} [options]
 */
export function broadcast(type, payload = null, { users } = {}) {
  if (!game.user.isGM) throw new Error("Only a GM can broadcast");
  const message = { kind: "broadcast", type, payload };
  emit(message, users);
  if (!users || users.includes(game.user.id)) broadcasts.get(type)?.(payload, game.user);
}

/**
 * @param {any} message
 * @param {string} senderId
 */
function receive(message, senderId) {
  const sender = game.users.get(senderId);
  if (!sender) return;
  if (message?.kind === "session" && sender.isSelf) return onSession(message, toOwnWindows);
  if (typeof message?.type !== "string") return;
  if (message.kind === "request") answer(message, sender);
  else if (message.kind === "reply") settle(message, sender);
  else if (message.kind === "broadcast" && sender.isGM) broadcasts.get(message.type)?.(message.payload, sender);
}

/**
 * @param {{ type: string, id: string, payload: any }} message
 * @param {User} sender
 */
async function answer({ type, id, payload }, sender) {
  if (!game.users.activeGM?.isSelf) return;
  if (!(await isAnsweringWindow())) return;
  try {
    const result = await process(type, payload, sender);
    emit({ kind: "reply", type, id, ok: true, result }, [sender.id]);
  } catch (error) {
    emit({ kind: "reply", type, id, ok: false, error: error.message, data: error.data ?? null }, [sender.id]);
  }
}

/**
 * @param {{ id: string, ok: boolean, result?: any, error?: string, data?: object }} message
 * @param {User} sender
 */
function settle({ id, ok, result, error, data }, sender) {
  const entry = pending.get(id);
  if (!entry || !sender.isGM) return;
  pending.delete(id);
  window.clearTimeout(entry.timer);
  if (ok) entry.resolve(result);
  else entry.reject(new TradeError(error, data ?? undefined));
}

/**
 * @param {string} type
 * @param {any} payload
 */
function answerLocally(type, payload) {
  return process(type, payload, game.user);
}

/**
 * @param {string} type
 * @param {any} payload
 * @param {User} sender
 */
async function process(type, payload, sender) {
  const handler = requests.get(type);
  if (!handler) throw new Error(`No handler for "${type}"`);
  const key = handler.queueKey?.(payload);
  if (!key) return handler.handle(payload, sender);
  return queue.run(key, () => handler.handle(payload, sender));
}

/** @param {object} message */
function toOwnWindows(message) {
  emit(message, [game.user.id]);
}

/**
 * @param {object} message
 * @param {string[]} [users]
 */
function emit(message, users) {
  const options = users ? { recipients: users } : {};
  game.socket.emit(SOCKET, message, options);
}
