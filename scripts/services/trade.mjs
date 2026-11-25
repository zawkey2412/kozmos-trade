// Trades on the active GM: everything is checked again, then items and coins move, and any failure is undone.
// Documents are typed any here because their schema fields have no generated types.
import { MODULE_ID } from "../constants.mjs";
import { holdingFacts, itemFacts, purse } from "../adapter/dnd5e.mjs";
import { merchantFlags } from "../data/flags.mjs";
import { attitudeAdjustment } from "../engine/attitude.mjs";
import { COPPER, coinsToCopper } from "../engine/money.mjs";
import { settle } from "../engine/quote.mjs";
import { tradeable } from "../engine/shelf.mjs";
import { planCoins } from "../engine/trade.mjs";
import { feature, getTables } from "../settings.mjs";
import { TradeError } from "./errors.mjs";
import { buyQuote, sellQuote } from "./offer.mjs";
import { checkAccess, resolvePair, sessionAt } from "./session.mjs";
import { shelf } from "./shop.mjs";
import { broadcast, MESSAGES, onRequest } from "./socket.mjs";

/** @import { PriceContext } from "./offer.mjs"; */
/** @import { Settlement } from "../engine/quote.mjs"; */
/** @import { CoinPlan } from "../engine/trade.mjs"; */

/**
 * @typedef {object} TradeRequest
 * @property {string} merchant
 * @property {string} customer
 * @property {[string, number][]} give
 * @property {[string, number][]} take
 * @property {Record<string, number>} coinsGive
 * @property {Record<string, number>} coinsTake
 * @property {boolean} keepChange
 */

/**
 * @typedef {object} TradeLine
 * @property {any} item
 * @property {number} quantity
 * @property {number} unit
 * @property {number} held
 */

/**
 * @typedef {object} PreparedTrade
 * @property {any} merchant
 * @property {any} customer
 * @property {TradeLine[]} give
 * @property {TradeLine[]} take
 * @property {Record<string, number>} coinsGive
 * @property {Record<string, number>} coinsTake
 * @property {Settlement} result
 * @property {CoinPlan} coins
 * @property {PriceContext} context
 */

/**
 * @typedef {object} TradeRecord
 * @property {string[]} merchantCreated
 * @property {string[]} customerCreated
 */

export function registerTradeHandlers() {
  onRequest(MESSAGES.TRADE_REQUEST, instantTrade, { queueKey: (payload) => payload?.merchant });
}

// A trade the customer accepts on their own, where the shop allows it.
/**
 * @param {TradeRequest} payload
 * @param {any} sender
 */
async function instantTrade(payload, sender) {
  const merchant = /** @type {any} */ (await foundry.utils.fromUuid(payload?.merchant));
  if (!sender.isGM && merchant && merchantFlags(merchant).executionMode === "approval") throw new TradeError("KT.Error.NeedsApproval");
  return runTrade(payload, sender);
}

/**
 * @param {any} merchant
 * @param {any} customer
 * @returns {PriceContext}
 */
export function priceContextFor(merchant, customer) {
  const flags = merchantFlags(merchant);
  const value = feature("attitude") ? (flags.attitude[customer.id]?.value ?? 0) : 0;
  return { archetype: flags.archetype, attitudeAdjustment: attitudeAdjustment(value, getTables().attitude), haggle: 0, market: 1 };
}

/**
 * @param {TradeRequest} payload
 * @param {any} sender
 * @param {{ requireBalance?: boolean }} [options]
 */
export async function runTrade(payload, sender, { requireBalance = true } = {}) {
  const trade = await prepareTrade(payload, sender, { requireBalance });
  if (Hooks.call("kozmosTrade.preTrade", trade) === false) throw new TradeError("KT.Error.Cancelled");
  const record = await applyTrade(trade);
  Hooks.callAll("kozmosTrade.trade", trade, record);
  broadcast(MESSAGES.TRADE_DONE, { merchant: trade.merchant.uuid, customer: trade.customer.uuid });
  return { paid: trade.coins.paid, change: trade.result.change };
}

/**
 * @param {TradeRequest} payload
 * @param {any} sender
 * @param {{ requireBalance?: boolean }} [options]
 * @returns {Promise<PreparedTrade>}
 */
export async function prepareTrade(payload, sender, { requireBalance = true } = {}) {
  const { merchant, customer } = await resolvePair(payload.merchant, payload.customer, sender);
  if (!sender.isGM) {
    checkAccess(merchant, customer);
    if (sessionAt(merchant.uuid)?.customer !== customer.uuid) throw new TradeError("KT.Error.NotInSession");
  }
  const tables = getTables();
  const context = priceContextFor(merchant, customer);

  const give = cleanLines(payload.give).map(([id, quantity]) => {
    const item = customer.items.get(id);
    if (!item) throw new TradeError("KT.Error.ItemGone", { name: "?" });
    const facts = itemFacts(item);
    const holding = holdingFacts(item);
    const full = facts.type === "container" && holding.contents > 0;
    if (!tradeable(facts, holding) || full || quantity > holding.quantity) throw new TradeError("KT.Error.ItemGone", { name: item.name });
    const quote = sellQuote(item, context);
    if (!quote.forSale) throw new TradeError("KT.Error.NotForSale", { name: item.name });
    return { item, quantity, unit: quote.unit, held: holding.quantity };
  });

  const stock = shelf(merchant);
  const take = cleanLines(payload.take).map(([id, quantity]) => {
    const entry = stock.find((e) => e.item.id === id);
    if (!entry || entry.price === null || quantity > entry.holding.quantity) {
      throw new TradeError("KT.Error.ItemGone", { name: entry?.item.name ?? "?" });
    }
    return { item: entry.item, quantity, unit: buyQuote(entry.price, context).copper, held: entry.holding.quantity };
  });

  const coinsGive = wholeCoins(payload.coinsGive);
  const coinsTake = wholeCoins(payload.coinsTake);
  if (!give.length && !take.length && !coinsToCopper(coinsGive) && !coinsToCopper(coinsTake)) throw new TradeError("KT.Error.Empty");
  const held = purse(customer);
  if (Object.keys(COPPER).some((coin) => coinsGive[coin] > held[coin])) throw new TradeError("KT.Error.NotEnoughCoins");

  const result = settle({
    giveItems: linesValue(give),
    takeItems: linesValue(take),
    coinsGive: coinsToCopper(coinsGive),
    coinsTake: coinsToCopper(coinsTake),
    keepChange: Boolean(payload.keepChange),
    sweetenStep: tables.attitude.sweeten.step,
  });
  if (requireBalance && result.state === "short") throw new TradeError("KT.Error.Short");

  const coins = planCoins({
    customerHeld: held,
    merchantHeld: purse(merchant),
    coinsGive,
    payout: coinsToCopper(coinsTake) + result.change,
    tolerance: tables.money.changeTolerance,
    purseLimit: feature("purseLimit"),
  });
  if (!coins) throw new TradeError("KT.Error.ExactCoins", { name: merchant.name });
  return { merchant, customer, give, take, coinsGive, coinsTake, result, coins, context };
}

// Moves coins and items in steps, and undoes the finished steps if one fails.
/**
 * @param {PreparedTrade} trade
 * @returns {Promise<TradeRecord>}
 */
export async function applyTrade(trade) {
  const { merchant, customer } = trade;
  const toMerchant = trade.give.map((line) => transferData(line.item, line.quantity));
  const toCustomer = trade.take.map((line) => transferData(line.item, line.quantity));
  /** @type {(() => Promise<unknown>)[]} */
  const undo = [];
  /** @type {TradeRecord} */
  const record = { merchantCreated: [], customerCreated: [] };
  try {
    await setCurrency(customer, trade.coins.customerAfter, undo);
    await setCurrency(merchant, trade.coins.merchantAfter, undo);
    await removeLines(customer, trade.give, undo);
    await removeLines(merchant, trade.take, undo);
    record.merchantCreated = await createItems(merchant, toMerchant, undo);
    record.customerCreated = await createItems(customer, toCustomer, undo);
    return record;
  } catch (error) {
    console.error("Kozmos Trade | Trade failed, undoing", error);
    for (const step of undo.reverse()) {
      try {
        await step();
      } catch (undoError) {
        console.error("Kozmos Trade | Undo step failed", undoError);
      }
    }
    throw new TradeError("KT.Error.TradeFailed");
  }
}

/**
 * @param {any} actor
 * @param {Record<string, number>} coins
 * @param {(() => Promise<unknown>)[]} undo
 */
async function setCurrency(actor, coins, undo) {
  const before = foundry.utils.deepClone(actor.system.currency);
  const after = { ...before, ...coins };
  if (Object.keys(COPPER).every((coin) => before[coin] === after[coin])) return;
  await actor.update({ "system.currency": after });
  undo.push(() => actor.update({ "system.currency": before }));
}

/**
 * @param {any} actor
 * @param {TradeLine[]} lines
 * @param {(() => Promise<unknown>)[]} undo
 */
async function removeLines(actor, lines, undo) {
  const whole = lines.filter((line) => line.quantity >= line.held);
  const part = lines.filter((line) => line.quantity < line.held);
  if (part.length) {
    await actor.updateEmbeddedDocuments("Item", part.map((line) => ({ _id: line.item.id, "system.quantity": line.held - line.quantity })));
    undo.push(() => actor.updateEmbeddedDocuments("Item", part.map((line) => ({ _id: line.item.id, "system.quantity": line.held }))));
  }
  if (whole.length) {
    const saved = whole.map((line) => line.item.toObject());
    await actor.deleteEmbeddedDocuments("Item", whole.map((line) => line.item.id));
    undo.push(() => actor.createEmbeddedDocuments("Item", saved, { keepId: true }));
  }
}

/**
 * @param {any} actor
 * @param {object[]} data
 * @param {(() => Promise<unknown>)[]} undo
 * @returns {Promise<string[]>}
 */
async function createItems(actor, data, undo) {
  if (!data.length) return [];
  const created = await actor.createEmbeddedDocuments("Item", data);
  const ids = created.map((item) => item.id);
  undo.push(() => actor.deleteEmbeddedDocuments("Item", ids));
  return ids;
}

// A copy of the item for its new owner: loose, not worn, and with no module flags except a theft record.
/**
 * @param {any} item
 * @param {number} quantity
 */
export function transferData(item, quantity) {
  const data = item.toObject();
  delete data._id;
  data.system.quantity = quantity;
  if ("equipped" in data.system) data.system.equipped = false;
  if ("attuned" in data.system) data.system.attuned = false;
  if ("container" in data.system) data.system.container = null;
  const stolen = data.flags?.[MODULE_ID]?.stolen;
  if (data.flags) delete data.flags[MODULE_ID];
  if (stolen) data.flags[MODULE_ID] = { stolen };
  return data;
}

// Valid lines only, one per item.
/** @param {unknown} lines */
function cleanLines(lines) {
  /** @type {Map<string, number>} */
  const merged = new Map();
  for (const line of Array.isArray(lines) ? lines : []) {
    const [id, quantity] = Array.isArray(line) ? line : [];
    if (typeof id !== "string" || !Number.isInteger(quantity) || quantity < 1) throw new TradeError("KT.Error.Empty");
    merged.set(id, (merged.get(id) ?? 0) + quantity);
  }
  return [...merged];
}

/** @param {unknown} coins */
function wholeCoins(coins) {
  const source = coins && typeof coins === "object" ? coins : {};
  return Object.fromEntries(
    Object.keys(COPPER).map((coin) => {
      const count = Number(source[coin] ?? 0);
      if (!Number.isInteger(count) || count < 0) throw new TradeError("KT.Error.Empty");
      return [coin, count];
    }),
  );
}

/** @param {TradeLine[]} lines */
function linesValue(lines) {
  return lines.reduce((total, line) => total + line.unit * line.quantity, 0);
}
