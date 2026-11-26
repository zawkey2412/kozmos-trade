// The public API at game.modules.get("kozmos-trade").api.
import MarketList from "./apps/market-list.mjs";
import { registerArchetype } from "./services/archetypes.mjs";
import { PARTY_KEY, setAttitude } from "./services/attitude.mjs";
import { addMarketRule, removeMarketRule } from "./services/market-rules.mjs";
import { openTrade } from "./services/open-trade.mjs";
import { getPrice } from "./services/price.mjs";
import { tradeWithPlayer } from "./services/player-trade.mjs";
import { setTrueValue } from "./services/shop.mjs";
import { generateStock, restock } from "./services/stock.mjs";

export function createApi() {
  return Object.freeze({
    openTrade,
    openMarket: () => MarketList.toggle(),
    openPlayerTrade: apiOpenPlayerTrade,
    registerArchetype,
    generateStock,
    restock,
    getPrice,
    setAttitude: apiSetAttitude,
    setTrueValue: apiSetTrueValue,
    addMarketRule: apiAddMarketRule,
    removeMarketRule,
  });
}

// Takes { name, categories, percent, days } and a scene, its UUID, or nothing for the whole world.
/**
 * @param {{ name: string, categories?: string[], percent: number, days?: number | null }} rule
 * @param {{ scene?: any | string | null }} [options]
 */
async function apiAddMarketRule(rule, { scene = null } = {}) {
  const target = typeof scene === "string" ? await foundry.utils.fromUuid(scene) : scene;
  return addMarketRule({ name: rule.name, categories: rule.categories ?? [], percent: rule.percent, days: rule.days ?? null }, { scene: target });
}

// Takes two characters or their UUIDs: the user's own first.
/**
 * @param {any | string} from
 * @param {any | string} to
 */
async function apiOpenPlayerTrade(from, to) {
  const first = typeof from === "string" ? await foundry.utils.fromUuid(from) : from;
  const second = typeof to === "string" ? await foundry.utils.fromUuid(to) : to;
  return tradeWithPlayer(first, second);
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