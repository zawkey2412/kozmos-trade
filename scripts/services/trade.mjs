// Trades on the active GM: everything is checked again, then items and coins move, and any failure is undone.
// Documents are typed any here because their schema fields have no generated types.
import { MODULE_ID } from "../constants.mjs";
import { holdingFacts, itemFacts, itemSource, purse } from "../adapter/dnd5e.mjs";
import { namedFilled } from "../engine/wanted.mjs";
import { merchantFlags } from "../data/flags.mjs";
import { attitudeAdjustment, sweetenGain } from "../engine/attitude.mjs";
import { COPPER, coinsToCopper } from "../engine/money.mjs";
import { settle } from "../engine/quote.mjs";
import { tradeable } from "../engine/shelf.mjs";
import { planCoins } from "../engine/trade.mjs";
import { feature, getTables } from "../settings.mjs";
import { TradeError } from "./errors.mjs";
import { buyQuote, sellQuote } from "./offer.mjs";
import { attitudeTables, attitudeValue, recordAttitude } from "./attitude.mjs";
import { appraisedIds, checkVisit, haggleDiscount, resolvePair, sessionAt, soldToday, updateSold, useHaggle, visibleShelf } from "./session.mjs";
import { recordTrade } from "./receipts.mjs";
import { shelf } from "./shop.mjs";
import { broadcast, MESSAGES, onRequest } from "./socket.mjs";

/** @import { PriceContext } from "./offer.mjs"; */
/** @import { Settlement } from "../engine/quote.mjs"; */
/** @import { CoinPlan } from "../engine/trade.mjs"; */
/** @import { AttitudeEvent } from "../engine/attitude.mjs"; */

/**
 * @typedef {object} TradeRequest
 * @property {string} merchant
 * @property {string} customer
 * @property {[string, number][]} give
 * @property {[string, number][]} take
 * @property {[string, number][]} [buyback]
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
 * @property {object} [restoreFlags]
 * @property {string} [mergeInto]
 */

/**
 * @typedef {object} PreparedTrade
 * @property {any} merchant
 * @property {any} customer
 * @property {TradeLine[]} give
 * @property {TradeLine[]} take
 * @property {[string, number][]} boughtBack
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

/**
 * @typedef {object} Move
 * @property {any} from
 * @property {any} to
 * @property {TradeLine[]} lines
 */

// A change made after the items move, with its undo.
/**
 * @typedef {object} ExtraStep
 * @property {() => Promise<unknown>} apply
 * @property {() => Promise<unknown>} undo
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
  return {
    archetype: flags.archetype,
    attitudeAdjustment: attitudeAdjustment(attitudeValue(merchant, customer), getTables().attitude),
    haggle: haggleDiscount(merchant.uuid, customer.uuid),
    market: 1,
    appraised: appraisedIds(merchant, customer),
    wanted: feature("wanted") ? flags.wanted : [],
  };
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
  const entry = await recordTrade(trade, record, sender).catch((error) => {
    console.error("Kozmos Trade | Receipt failed", error);
    return null;
  });
  const sold = trade.give.map((line, index) => ({ id: record.merchantCreated[index], from: line.item.id, price: line.unit, quantity: line.quantity }));
  updateSold(trade.merchant.uuid, trade.customer.uuid, sold, trade.boughtBack);
  if (trade.take.length) useHaggle(trade.merchant.uuid, trade.customer.uuid);
  const delivered = await deliverWanted(trade).catch((error) => {
    console.error("Kozmos Trade | Wanted board failed", error);
    return 0;
  });
  const events = [...tradeEvents(trade.result), ...Array.from({ length: delivered }, () => /** @type {AttitudeEvent} */ ("wanted"))];
  await recordAttitude(trade.merchant, trade.customer, events).catch((error) => console.error("Kozmos Trade | Attitude failed", error));
  Hooks.callAll("kozmosTrade.trade", trade, record);
  broadcast(MESSAGES.TRADE_DONE, { merchant: trade.merchant.uuid, customer: trade.customer.uuid });
  return { paid: trade.coins.paid, change: trade.result.change, receipt: entry?.id ?? null };
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
    checkVisit(merchant, customer, sender);
    if (sessionAt(merchant.uuid)?.customer !== customer.uuid) throw new TradeError("KT.Error.NotInSession");
  }
  const tables = getTables();
  const context = priceContextFor(merchant, customer);

  const give = cleanLines(payload.give).map(([id, quantity]) => {
    const item = customer.items.get(id);
    if (!item) throw new TradeError("KT.Error.SoldOut");
    const facts = itemFacts(item);
    const holding = holdingFacts(item);
    const full = facts.type === "container" && holding.contents > 0;
    if (!tradeable(facts, holding) || full || quantity > holding.quantity) throw new TradeError("KT.Error.ItemGone", { name: item.name });
    const quote = sellQuote(item, context);
    if (!quote.forSale) throw new TradeError("KT.Error.NotForSale", { name: item.name });
    return { item, quantity, unit: quote.unit, held: holding.quantity };
  });

  const stock = shelf(merchant);
  const visible = visibleShelf(merchant, customer);
  /** @type {TradeLine[]} */
  const take = cleanLines(payload.take).map(([id, quantity]) => {
    const entry = visible.find((e) => e.item.id === id);
    if (!entry || entry.price === null) throw new TradeError("KT.Error.SoldOut");
    if (quantity > entry.holding.quantity) throw new TradeError("KT.Error.ItemGone", { name: entry.item.name });
    return { item: entry.item, quantity, unit: buyQuote(entry.price, context, entry.flags.limited).copper, held: entry.holding.quantity };
  });

  const sold = soldToday(merchant.uuid, customer.uuid);
  const boughtBack = cleanLines(payload.buyback ?? []);
  for (const [id, quantity] of boughtBack) {
    const record = sold.find((e) => e.id === id);
    const entry = stock.find((e) => e.item.id === id);
    if (!record || !entry || quantity > record.quantity) throw new TradeError("KT.Error.SoldOut");
    const mergeInto = record.from && customer.items.get(record.from) ? record.from : undefined;
    take.push({ item: entry.item, quantity, unit: record.price, held: entry.holding.quantity, mergeInto });
  }
  for (const line of take) {
    const total = take.filter((other) => other.item.id === line.item.id).reduce((sum, other) => sum + other.quantity, 0);
    if (total > line.held) throw new TradeError("KT.Error.ItemGone", { name: line.item.name });
  }

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
    sweetenMin: tables.attitude.sweeten.minPerPoint,
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
  return { merchant, customer, give, take, boughtBack, coinsGive, coinsTake, result, coins, context };
}

// Swaps both sides of a merchant trade.
/**
 * @param {Pick<PreparedTrade, "merchant" | "customer" | "give" | "take"> & { coins: Pick<CoinPlan, "customerAfter" | "merchantAfter"> }} trade
 * @returns {Promise<TradeRecord>}
 */
export async function applyTrade(trade) {
  const { merchant, customer } = trade;
  const [merchantCreated, customerCreated] = await moveAll({
    currency: [
      [customer, trade.coins.customerAfter],
      [merchant, trade.coins.merchantAfter],
    ],
    moves: [
      { from: customer, to: merchant, lines: trade.give },
      { from: merchant, to: customer, lines: trade.take },
    ],
  });
  return { merchantCreated, customerCreated };
}

// Moves coins and items between any actors, and undoes the finished steps if one fails.
/**
 * @param {{ currency: [any, Record<string, number>][], moves: Move[], steps?: ExtraStep[] }} plan
 * @returns {Promise<string[][]>}
 */
export async function moveAll({ currency, moves, steps = [] }) {
  const data = moves.map((move) => move.lines.map((line) => transferData(line.item, line.quantity, line.restoreFlags)));
  /** @type {Map<any, TradeLine[]>} */
  const leaving = new Map();
  for (const move of moves) leaving.set(move.from, [...(leaving.get(move.from) ?? []), ...move.lines]);
  /** @type {(() => Promise<unknown>)[]} */
  const undo = [];
  try {
    for (const [actor, coins] of currency) await setCurrency(actor, coins, undo);
    for (const [actor, lines] of leaving) await removeLines(actor, lines, undo);
    /** @type {string[][]} */
    const created = [];
    for (const [index, move] of moves.entries()) created.push(await deliver(move.to, move.lines, data[index], undo));
    for (const step of steps) {
      await step.apply();
      undo.push(step.undo);
    }
    return created;
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
  /** @type {Map<string, TradeLine>} */
  const byItem = new Map();
  for (const line of lines) {
    const known = byItem.get(line.item.id);
    byItem.set(line.item.id, known ? { ...known, quantity: known.quantity + line.quantity } : { ...line });
  }
  const grouped = [...byItem.values()];
  const whole = grouped.filter((line) => line.quantity >= line.held);
  const part = grouped.filter((line) => line.quantity < line.held);
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

// Adds lines to their target stacks or creates new items, and returns the receiving item ids in line order.
/**
 * @param {any} actor
 * @param {TradeLine[]} lines
 * @param {object[]} data
 * @param {(() => Promise<unknown>)[]} undo
 * @returns {Promise<string[]>}
 */
async function deliver(actor, lines, data, undo) {
  const ids = lines.map((line) => (line.mergeInto && actor.items.get(line.mergeInto) ? line.mergeInto : null));
  const merges = lines.filter((line, index) => ids[index]);
  if (merges.length) {
    const before = merges.map((line) => ({ _id: line.mergeInto, "system.quantity": actor.items.get(line.mergeInto).system.quantity }));
    await actor.updateEmbeddedDocuments("Item", before.map((b, i) => ({ _id: b._id, "system.quantity": b["system.quantity"] + merges[i].quantity })));
    undo.push(() => actor.updateEmbeddedDocuments("Item", before));
  }
  const fresh = data.filter((_, index) => !ids[index]);
  if (fresh.length) {
    const created = await actor.createEmbeddedDocuments("Item", fresh);
    const createdIds = created.map((item) => item.id);
    undo.push(() => actor.deleteEmbeddedDocuments("Item", createdIds));
    let next = 0;
    for (let index = 0; index < ids.length; index++) if (!ids[index]) ids[index] = createdIds[next++];
  }
  return ids;
}

// A copy of the item for its new owner: loose, not worn, and with no module flags except a theft record.
/**
 * @param {any} item
 * @param {number} quantity
 * @param {object} [restoreFlags]
 */
export function transferData(item, quantity, restoreFlags) {
  const data = item.toObject();
  delete data._id;
  data.system.quantity = quantity;
  if ("equipped" in data.system) data.system.equipped = false;
  if ("attuned" in data.system) data.system.attuned = false;
  if ("container" in data.system) data.system.container = null;
  const stolen = data.flags?.[MODULE_ID]?.stolen;
  if (data.flags) delete data.flags[MODULE_ID];
  if (stolen || restoreFlags) data.flags[MODULE_ID] = { ...(restoreFlags ?? {}), ...(stolen ? { stolen } : {}) };
  return data;
}

// Named Wanted items in the trade come off the board. Answers how many.
/** @param {PreparedTrade} trade */
async function deliverWanted(trade) {
  if (!feature("wanted")) return 0;
  const board = merchantFlags(trade.merchant).wanted;
  const given = trade.give.map((line) => ({ ...itemFacts(line.item), name: line.item.name, source: itemSource(line.item) }));
  const filled = namedFilled(given, board);
  if (!filled.length) return 0;
  await trade.merchant.update({ [`flags.${MODULE_ID}.wanted`]: board.filter((entry) => !filled.includes(entry)) });
  return filled.length;
}

// A balanced trade pleases the merchant once a day, and overpaying pleases it more.
/**
 * @param {Settlement} result
 * @returns {(AttitudeEvent | { gain: number })[]}
 */
export function tradeEvents(result) {
  if (result.state === "short") return [];
  const gain = sweetenGain(result.overpay, result.merchantGives, attitudeTables());
  return gain ? ["fairTrade", { gain }] : ["fairTrade"];
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
