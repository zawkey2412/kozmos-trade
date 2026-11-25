// Dropping an owned item onto a merchant's token opens the trade with that item staged.
// Placeables and documents are typed any here because their schema fields have no generated types.
import { merchantFlags } from "../data/flags.mjs";
import { openTrade } from "../services/open-trade.mjs";

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
  if (!merchant) return;
  tradeWith(owner, merchant.actor, item.id);
  return false;
}

/**
 * @param {any} board
 * @param {number} x
 * @param {number} y
 */
function merchantAt(board, x, y) {
  const under = board.tokens.placeables.filter((token) => token.visible && token.actor && token.bounds.contains(x, y));
  return under.reverse().find((token) => merchantFlags(token.actor).enabled) ?? null;
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
