// The Shops list: merchants the party has met, and which of them trade from afar.
// Documents are typed any here because their schema fields have no generated types.
import { clock } from "../adapter/dnd5e.mjs";
import { merchantFlags } from "../data/flags.mjs";
import { daysSince } from "../engine/visits.mjs";
import { archetypeLabel } from "./archetypes.mjs";
import { MESSAGES, onRequest } from "./socket.mjs";
import { allShops } from "./stock.mjs";
import { partyLastVisit } from "./visits.mjs";

/**
 * @typedef {object} MarketRow
 * @property {string} uuid
 * @property {string} name
 * @property {string} img
 * @property {string} archetype
 * @property {string} scene
 * @property {boolean} open
 * @property {boolean} remote
 * @property {number | null} days
 */

export function registerMarketListHandlers() {
  onRequest(MESSAGES.MARKET_LIST, listMarket);
}

// Every shop for a GM. For players, only shops someone in the party has visited.
/**
 * @param {unknown} payload
 * @param {any} sender
 * @returns {MarketRow[]}
 */
function listMarket(payload, sender) {
  const now = clock();
  const rows = [];
  for (const shop of allShops()) {
    const last = partyLastVisit(shop);
    if (last === null && !sender.isGM) continue;
    const flags = merchantFlags(shop);
    rows.push({
      uuid: shop.uuid,
      name: shop.name,
      img: shop.img,
      archetype: archetypeLabel(flags.archetype),
      scene: sceneOf(shop),
      open: flags.open,
      remote: flags.remoteTrade,
      days: last === null ? null : daysSince(last, now),
    });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang));
}

// The scene a merchant stands in: its own for a token, otherwise the first scene with its token.
/** @param {any} actor */
function sceneOf(actor) {
  if (actor.isToken) return actor.token?.parent?.name ?? "";
  const scene = /** @type {any[]} */ (game.scenes.contents).find((s) => s.tokens.some((token) => token.actorLink && token.actorId === actor.id));
  return scene?.name ?? "";
}
