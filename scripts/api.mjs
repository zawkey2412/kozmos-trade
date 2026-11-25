// The public API at game.modules.get("kozmos-trade").api.
import { registerArchetype } from "./services/archetypes.mjs";
import { PARTY_KEY, setAttitude } from "./services/attitude.mjs";
import { openTrade } from "./services/open-trade.mjs";
import { setTrueValue } from "./services/shop.mjs";
import { generateStock, restock } from "./services/stock.mjs";

export function createApi() {
  return Object.freeze({
    openTrade,
    registerArchetype,
    generateStock,
    restock,
    setAttitude: apiSetAttitude,
    setTrueValue: apiSetTrueValue,
  });
}

// Takes an item or its UUID, and gold or null.
/**
 * @param {any | string} item
 * @param {number | null} gold
 */
async function apiSetTrueValue(item, gold) {
  return setTrueValue(typeof item === "string" ? await foundry.utils.fromUuid(item) : item, gold);
}

// Takes documents or UUIDs, and "party" for the shared score.
/**
 * @param {any | string} merchant
 * @param {any | string} customer
 * @param {number} value
 */
async function apiSetAttitude(merchant, customer, value) {
  const shop = typeof merchant === "string" ? await foundry.utils.fromUuid(merchant) : merchant;
  const who = customer === PARTY_KEY ? PARTY_KEY : typeof customer === "string" ? await foundry.utils.fromUuid(customer) : customer;
  return setAttitude(shop, who, value);
}