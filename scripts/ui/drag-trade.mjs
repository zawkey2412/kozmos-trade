// Dropping an owned item onto a merchant's token, or onto another player's character, opens a trade with it staged.
// Placeables and documents are typed any here because their schema fields have no generated types.
import { merchantFlags } from "../data/flags.mjs";
import { openTrade } from "../services/open-trade.mjs";
import { tradeWithPlayer } from "../services/player-trade.mjs";

export function registerDragTrade() {
  Hooks.on("dropCanvasData", onDrop);
}

/**
 * @param {any} board
 * @param {any} data
 */
function onDrop(board, data) {
  if (data?.type !== "Item" || !data.uuid) return;
  const item = /** @type {any} */ (foundry.utils.fromUuidSync(data.uuid));
  const owner = item?.parent;
  if (!owner || owner.documentName !== "Actor" || !owner.isOwner || merchantFlags(owner).enabled) return;
  const merchant = merchantAt(board, data.x, data.y);
  if (merchant) {
    tradeWith(owner, merchant.actor, item.id);
    return false;
  }
  const partner = game.user.isGM || owner.type !== "character" ? null : characterAt(board, data.x, data.y, owner);
  if (!partner) return;
  tradeWithPlayer(owner, partner.actor, item.id);
  return false;
}

/**
 * @param {any} board
 * @param {number} x
 * @param {number} y
 */
function tokensAt(board, x, y) {
  return board.tokens.placeables.filter((token) => token.visible && token.actor && token.bounds.contains(x, y)).reverse();
}

/**
 * @param {any} board
 * @param {number} x
 * @param {number} y
 */
function merchantAt(board, x, y) {
  return tokensAt(board, x, y).find((token) => merchantFlags(token.actor).enabled) ?? null;
}

// Another player's character, one the user does not own.
/**
 * @param {any} board
 * @param {number} x
 * @param {number} y
 * @param {any} owner
 */
function characterAt(board, x, y, owner) {
  return tokensAt(board, x, y).find((token) => token.actor.type === "character" && token.actor !== owner && !token.actor.isOwner && token.actor.hasPlayerOwner) ?? null;
}

/**
 * @param {any} customer
 * @param {any} merchant
 * @param {string} itemId
 */
async function tradeWith(customer, merchant, itemId) {
  const app = /** @type {any} */ (await openTrade(customer, merchant));
  if (app?.stage) await app.stage("customer", itemId);
}
