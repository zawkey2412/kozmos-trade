// Trade sessions: who is at which merchant, the access checks, and the shelf a customer sees.
// Documents are typed any here because their system data has no generated types.
import { MODULE_ID, SETTINGS } from "../constants.mjs";
import { clock, combatStats, itemDescription, passiveScore, purse, tokensOf } from "../adapter/dnd5e.mjs";
import { merchantFlags } from "../data/flags.mjs";
import { accessProblem, squaresBetween } from "../engine/access.mjs";
import { attitudeAdjustment, attitudeBand } from "../engine/attitude.mjs";
import { attitudeTables, attitudeValue } from "./attitude.mjs";
import { appraisalKey, appraisalState } from "../engine/appraisal.mjs";
import { haggleDC, isLocked } from "../engine/haggle.mjs";
import { coinsToCopper, COPPER, payFrom } from "../engine/money.mjs";
import { cleanPlayerOffer } from "../engine/player-trade.mjs";
import { noCoins } from "../engine/tray.mjs";
import { feature, getTables } from "../settings.mjs";
import { servicesOf } from "./archetypes.mjs";
import { TradeError } from "./errors.mjs";
import { marketRulesFor } from "./market-rules.mjs";
import { sellLine, sellQuote } from "./offer.mjs";
import { shelf } from "./shop.mjs";
import { broadcast, MESSAGES, onRequest } from "./socket.mjs";
import { metByParty, recordVisit } from "./visits.mjs";

/** @import { PriceContext } from "./offer.mjs"; */
/** @import { MarketRule } from "../engine/market.mjs"; */

/**
 * @typedef {object} PoolEntry
 * @property {string} userId
 * @property {string} actor
 * @property {string} name
 * @property {[string, number][]} give
 * @property {Record<string, number>} coins
 */

/**
 * @typedef {object} Session
 * @property {string} customer
 * @property {string} customerName
 * @property {string} userId
 * @property {{ id: string, from?: string, price: number, quantity: number, day: number }[]} sold
 * @property {{ discount: number }} haggle
 * @property {boolean} shown
 * @property {boolean} remote
 * @property {PoolEntry[]} pool
 */

/**
 * @typedef {object} PoolView
 * @property {string} actor
 * @property {string} name
 * @property {{ id: string, name: string, img: string, quantity: number, unit: number }[]} lines
 * @property {Record<string, number>} coins
 */

/**
 * @typedef {object} WantedView
 * @property {string} category
 * @property {string} uuid
 * @property {string} name
 * @property {number} multiplier
 * @property {string | null} img
 */

/**
 * @typedef {object} HaggleView
 * @property {boolean} on
 * @property {boolean} locked
 * @property {number} discount
 * @property {Record<string, number> | null} dcs
 * @property {boolean} opposed
 * @property {number[]} asks
 * @property {number} limitedMaxAsk
 */

/**
 * @typedef {object} ShelfItem
 * @property {string} id
 * @property {string} name
 * @property {string} img
 * @property {number} quantity
 * @property {number} price
 * @property {string} type
 * @property {string} subtype
 * @property {string} rarity
 * @property {boolean} identified
 * @property {boolean} limited
 * @property {boolean} underCounter
 * @property {boolean} magical
 * @property {string} description
 * @property {{ damage: string | null, ac: number | null }} stats
 */

/**
 * @typedef {object} Snapshot
 * @property {{ uuid: string, name: string, img: string, archetype: string, tier: string, executionMode: string, purse: number | null }} merchant
 * @property {string} customer
 * @property {boolean} remote
 * @property {{ on: boolean, band: string, adjustment: number }} attitude
 * @property {HaggleView} haggle
 * @property {{ on: boolean, items: Record<string, "appraised" | "failed"> }} appraisal
 * @property {WantedView[]} wanted
 * @property {ShelfItem[]} shelf
 * @property {{ id: string, price: number, quantity: number }[]} buyback
 * @property {PoolView[]} pool
 * @property {ServiceView[]} services
 * @property {MarketRule[]} market
 */

/**
 * @typedef {object} ServiceView
 * @property {string} id
 * @property {string} kind
 * @property {string} label
 * @property {number} price
 * @property {string} icon
 * @property {string} hint
 */

/** @type {Map<string, Session>} */
const sessions = new Map();

// Players a GM showed a shop to, by merchant, with when the offer runs out.
/** @type {Map<string, Map<string, number>>} */
const grants = new Map();
const GRANT_TIME = 2 * 60 * 1000;

// GM side: these players may open the shop once without the access checks.
/**
 * @param {string} merchant
 * @param {string[]} userIds
 */
export function grantShow(merchant, userIds) {
  const users = grants.get(merchant) ?? new Map();
  for (const id of userIds) users.set(id, Date.now() + GRANT_TIME);
  grants.set(merchant, users);
}

/**
 * @param {string} merchant
 * @param {string} userId
 */
function takeGrant(merchant, userId) {
  const until = grants.get(merchant)?.get(userId);
  grants.get(merchant)?.delete(userId);
  return until !== undefined && until > Date.now();
}

export function registerSessionHandlers() {
  onRequest(MESSAGES.SESSION_OPEN, openSession, { queueKey: (payload) => payload?.merchant });
  onRequest(MESSAGES.SESSION_CLOSE, closeSession, { queueKey: (payload) => payload?.merchant });
  onRequest(MESSAGES.SESSION_JOIN, joinSession, { queueKey: (payload) => payload?.merchant });
  onRequest(MESSAGES.SESSION_CONTRIBUTE, contribute, { queueKey: (payload) => payload?.merchant });
  onRequest(MESSAGES.SESSION_LEAVE, leaveSession, { queueKey: (payload) => payload?.merchant });
  onRequest(MESSAGES.PURSE_CHECK, checkPurse);
  Hooks.on("userConnected", (user, connected) => {
    if (connected) return;
    for (const [merchant, session] of [...sessions]) {
      if (session.userId === user.id) endSession(merchant);
      else if (session.pool.some((entry) => entry.userId === user.id)) {
        session.pool = session.pool.filter((entry) => entry.userId !== user.id);
        sendPool(merchant);
      }
    }
  });
}

// Drops a session, and tells anyone who joined it.
/** @param {string} merchant */
function endSession(merchant) {
  const session = sessions.get(merchant);
  if (!session) return;
  sessions.delete(merchant);
  const users = [...new Set(session.pool.map((entry) => entry.userId))];
  if (users.length) broadcast(MESSAGES.SESSION_ENDED, { merchant, name: session.customerName }, { users });
}

// Tells the session's customer and everyone who joined what the pool holds now.
/**
 * @param {string} merchant
 * @param {{ traded?: boolean }} [options]
 */
function sendPool(merchant, { traded = false } = {}) {
  const session = sessions.get(merchant);
  if (!session) return;
  const users = [...new Set([session.userId, ...session.pool.map((entry) => entry.userId)])];
  const pool = session.pool.map(({ actor, give, coins }) => ({ actor, give, coins }));
  broadcast(MESSAGES.POOL_CHANGED, { merchant, customer: session.customer, pool, traded }, { users });
}

// After a trade the joined items and coins are gone, so every contribution starts empty.
/**
 * @param {string} merchant
 * @param {string} customer
 */
export function clearPool(merchant, customer) {
  const session = sessions.get(merchant);
  if (session?.customer !== customer || !session.pool.length) return;
  for (const entry of session.pool) Object.assign(entry, { give: [], coins: noCoins() });
  sendPool(merchant, { traded: true });
}

// The characters who joined this session.
/**
 * @param {string} merchant
 * @param {string} customer
 */
export function poolOf(merchant, customer) {
  const session = sessions.get(merchant);
  return session?.customer === customer ? session.pool : [];
}

/** @param {string} merchant */
export function sessionAt(merchant) {
  return sessions.get(merchant) ?? null;
}

/**
 * @param {{ merchant: string, customer: string, remote?: boolean }} payload
 * @param {any} sender
 * @returns {Promise<Snapshot>}
 */
async function openSession({ merchant, customer, remote: fromAfar }, sender) {
  const pair = await resolvePair(merchant, customer, sender);
  const current = sessions.get(pair.merchant.uuid);
  const sameCustomer = current?.customer === pair.customer.uuid;
  const ownVisit = Boolean(sameCustomer && current.userId === sender.id);
  const shown = takeGrant(pair.merchant.uuid, sender.id) || Boolean(ownVisit && current.shown);
  const remote = (Boolean(fromAfar) && remoteAllowed(pair.merchant, sender)) || Boolean(ownVisit && current.remote);
  if (!sender.isGM && !shown) checkAccess(pair.merchant, pair.customer, { distance: !remote });
  if (current && !sameCustomer && game.users.get(current.userId)?.active) {
    const joined = current.pool.some((entry) => entry.actor === pair.customer.uuid);
    throw new TradeError(joined ? "KT.Error.AlreadyJoined" : "KT.Error.Busy", { name: current.customerName, join: !sender.isGM && !joined });
  }
  if (current && !sameCustomer) endSession(pair.merchant.uuid);
  const keepUser = sameCustomer && sender.isGM && current.userId !== sender.id && game.users.get(current.userId)?.active;
  sessions.set(pair.merchant.uuid, {
    customer: pair.customer.uuid,
    customerName: pair.customer.name,
    userId: keepUser ? current.userId : sender.id,
    sold: sameCustomer ? current.sold : [],
    haggle: sameCustomer ? current.haggle : { discount: 0 },
    shown,
    remote,
    pool: sameCustomer ? current.pool : [],
  });
  if (!sameCustomer) await recordVisit(pair.merchant, pair.customer).catch((error) => console.error("Kozmos Trade | Visit failed", error));
  return snapshot(pair.merchant, pair.customer);
}

// A trade from the Shops list: only where the GM allows it, and only once the party has met the merchant.
/**
 * @param {any} merchant
 * @param {any} sender
 */
function remoteAllowed(merchant, sender) {
  if (sender.isGM) return true;
  if (!merchantFlags(merchant).remoteTrade) throw new TradeError("KT.Error.NoRemote", { name: merchant.name });
  if (!metByParty(merchant)) throw new TradeError("KT.Error.NotMet", { name: merchant.name });
  return true;
}

/**
 * @param {{ merchant: string, customer: string }} payload
 * @param {any} sender
 */
function closeSession({ merchant, customer }, sender) {
  const current = sessions.get(merchant);
  if (current?.customer !== customer) return true;
  if (current.userId === sender.id || !game.users.get(current.userId)?.active) endSession(merchant);
  return true;
}

// Another player adds their own character's items and coins to the customer's side of a trade.
/**
 * @param {{ merchant: string, customer: string }} payload
 * @param {any} sender
 */
async function joinSession({ merchant, customer }, sender) {
  if (sender.isGM) throw new TradeError("KT.Error.JoinGM");
  const pair = await resolvePair(merchant, customer, sender);
  const session = sessions.get(pair.merchant.uuid);
  if (!session || !game.users.get(session.userId)?.active) throw new TradeError("KT.Error.NothingToJoin", { name: pair.merchant.name });
  if (session.customer === pair.customer.uuid) throw new TradeError("KT.Error.AlreadyJoined", { name: session.customerName });
  if (!session.shown) checkAccess(pair.merchant, pair.customer, { distance: !session.remote });
  session.pool = session.pool.filter((entry) => entry.actor !== pair.customer.uuid);
  session.pool.push({ userId: sender.id, actor: pair.customer.uuid, name: pair.customer.name, give: [], coins: noCoins() });
  sendPool(pair.merchant.uuid);
  await recordVisit(pair.merchant, pair.customer).catch((error) => console.error("Kozmos Trade | Visit failed", error));
  const lead = /** @type {any} */ (foundry.utils.fromUuidSync(session.customer));
  return {
    merchant: { uuid: pair.merchant.uuid, name: pair.merchant.name, img: pair.merchant.img },
    lead: { uuid: session.customer, name: session.customerName, img: lead?.img ?? "" },
  };
}

// A joined character's items and coins, checked against what it holds. Answers the unit price of each item.
/**
 * @param {{ merchant: string, customer: string, give: [string, number][], coins: Record<string, number> }} payload
 * @param {any} sender
 */
async function contribute({ merchant, customer, give, coins }, sender) {
  const session = sessions.get(merchant);
  const entry = session?.pool.find((e) => e.actor === customer && e.userId === sender.id);
  if (!entry) throw new TradeError("KT.Error.NotJoined");
  const offer = cleanPlayerOffer({ items: give, coins });
  if (!offer) throw new TradeError("KT.Error.Empty");
  const shop = /** @type {any} */ (await foundry.utils.fromUuid(merchant));
  const actor = /** @type {any} */ (await foundry.utils.fromUuid(customer));
  const lead = /** @type {any} */ (await foundry.utils.fromUuid(session.customer));
  if (!shop || !actor || !lead) throw new TradeError("KT.Error.Missing");
  const held = purse(actor);
  if (Object.keys(COPPER).some((coin) => offer.coins[coin] > held[coin])) throw new TradeError("KT.Error.NotEnoughCoins");
  const context = priceContextFor(shop, lead, actor);
  const prices = Object.fromEntries(offer.items.map(([id, quantity]) => [id, sellLine(actor, id, quantity, context).unit]));
  entry.give = offer.items;
  entry.coins = offer.coins;
  sendPool(merchant);
  return { prices };
}

/**
 * @param {{ merchant: string, customer: string }} payload
 * @param {any} sender
 */
function leaveSession({ merchant, customer }, sender) {
  const session = sessions.get(merchant);
  if (!session) return true;
  const before = session.pool.length;
  session.pool = session.pool.filter((entry) => !(entry.actor === customer && entry.userId === sender.id));
  if (session.pool.length !== before) sendPool(merchant);
  return true;
}

// Prices for a customer at this merchant. Appraisals are read for the owner of the items, who may have joined the trade.
/**
 * @param {any} merchant
 * @param {any} customer
 * @param {any} [owner]
 * @returns {PriceContext}
 */
export function priceContextFor(merchant, customer, owner = customer) {
  const flags = merchantFlags(merchant);
  return {
    merchant: merchant.uuid,
    customer: customer.uuid,
    archetype: flags.archetype,
    attitudeAdjustment: attitudeAdjustment(attitudeValue(merchant, customer), getTables().attitude),
    haggle: haggleDiscount(merchant.uuid, customer.uuid),
    market: marketRulesFor(merchant),
    appraised: appraisedIds(merchant, owner),
    wanted: feature("wanted") ? flags.wanted : [],
  };
}

// What each joined character puts up, priced for the session's customer.
/**
 * @param {any} merchant
 * @param {any} customer
 * @returns {PoolView[]}
 */
function poolView(merchant, customer) {
  return poolOf(merchant.uuid, customer.uuid).map((entry) => {
    const actor = /** @type {any} */ (foundry.utils.fromUuidSync(entry.actor));
    const context = actor ? priceContextFor(merchant, customer, actor) : null;
    const lines = entry.give.flatMap(([id, quantity]) => {
      const item = actor?.items.get(id);
      if (!item || !context) return [];
      const quote = sellQuote(item, context);
      return [{ id, name: item.name, img: item.img, quantity, unit: quote.forSale ? quote.unit : 0 }];
    });
    return { actor: entry.actor, name: entry.name, lines, coins: entry.coins };
  });
}

// Whether the merchant can pay an amount in coins.
/**
 * @param {{ merchant: string, amount: number }} payload
 */
async function checkPurse({ merchant, amount }) {
  const actor = /** @type {any} */ (await foundry.utils.fromUuid(merchant));
  if (!actor || !Number.isInteger(amount) || amount < 0) return false;
  if (!feature("purseLimit")) return true;
  return payFrom(purse(actor), amount, { maxOver: getTables().money.changeTolerance }) !== null;
}

// The haggle discount won this visit, for the session's own customer only.
/**
 * @param {string} merchant
 * @param {string} customer
 */
export function haggleDiscount(merchant, customer) {
  const session = sessions.get(merchant);
  return session?.customer === customer ? session.haggle.discount : 0;
}

// A completed purchase uses the discount up.
/**
 * @param {string} merchant
 * @param {string} customer
 */
export function useHaggle(merchant, customer) {
  const session = sessions.get(merchant);
  if (session?.customer === customer) session.haggle.discount = 0;
}

// Haggle state the window needs: whether it is on, the lock, the discount and the DC of each ask.
/**
 * @param {any} merchant
 * @param {any} customer
 * @returns {HaggleView}
 */
export function haggleView(merchant, customer) {
  const tables = getTables();
  const base = { asks: [...tables.haggle.asks], limitedMaxAsk: tables.haggle.limitedMaxAsk };
  if (!feature("haggle")) return { ...base, on: false, locked: false, discount: 0, dcs: null, opposed: false };
  const opposed = feature("rolledInsight");
  const attitude = attitudeValue(merchant, customer);
  const insight = passiveScore(merchant, "ins");
  return {
    ...base,
    on: true,
    locked: isLocked(merchantFlags(merchant).haggleLock[customer.id], game.time.worldTime),
    discount: haggleDiscount(merchant.uuid, customer.uuid),
    dcs: opposed ? null : Object.fromEntries(tables.haggle.asks.map((ask) => [String(ask), haggleDC({ insight, ask, attitude }, tables)])),
    opposed,
  };
}

// The Wanted board, with each named item's picture.
/**
 * @param {any} merchant
 * @returns {WantedView[]}
 */
export function wantedView(merchant) {
  if (!feature("wanted")) return [];
  return merchantFlags(merchant).wanted.map((entry) => {
    const source = entry.uuid ? /** @type {any} */ (foundry.utils.fromUuidSync(entry.uuid, { strict: false })) : null;
    return { ...entry, name: entry.name || source?.name || "", img: source?.img ?? null };
  });
}

// The board's entries as short labels with the share of value paid.
/** @param {WantedView[]} board */
export function wantedLabels(board) {
  return board.map((entry) => ({
    label: entry.category ? game.i18n.localize(`KT.Category.${entry.category}`) : entry.name,
    img: entry.category ? null : entry.img,
    rate: `${Math.round(entry.multiplier * 100)}%`,
  }));
}

// What this merchant made of the customer's unpriced items: appraised for good, or failed today.
/**
 * @param {any} merchant
 * @param {any} customer
 */
export function appraisalView(merchant, customer) {
  const on = feature("appraisal");
  /** @type {Record<string, "appraised" | "failed">} */
  const items = {};
  if (on) {
    const records = merchantFlags(merchant).appraisals;
    const today = currentDay();
    for (const item of customer.items) {
      const state = appraisalState(records[appraisalKey(customer.id, item.id)], today);
      if (state) items[item.id] = state;
    }
  }
  return { on, items };
}

// Ids of the customer's items this merchant pays full rate for after an appraisal.
/**
 * @param {any} merchant
 * @param {any} customer
 */
export function appraisedIds(merchant, customer) {
  const { items } = appraisalView(merchant, customer);
  return Object.keys(items).filter((id) => items[id] === "appraised");
}

export function currentDay() {
  const now = clock();
  return Math.floor(now.now / now.day);
}

// Items this customer sold to the merchant earlier today, while the visit lasts.
/**
 * @param {string} merchant
 * @param {string} customer
 */
export function soldToday(merchant, customer) {
  const session = sessions.get(merchant);
  if (session?.customer !== customer) return [];
  const today = currentDay();
  return session.sold.filter((entry) => entry.day === today && entry.quantity > 0);
}

/**
 * @param {string} merchant
 * @param {string} customer
 * @param {{ id: string, from?: string, price: number, quantity: number }[]} sold
 * @param {[string, number][]} boughtBack
 */
export function updateSold(merchant, customer, sold, boughtBack) {
  const session = sessions.get(merchant);
  if (session?.customer !== customer) return;
  for (const [id, quantity] of boughtBack) {
    const entry = session.sold.find((e) => e.id === id && e.quantity > 0);
    if (entry) entry.quantity -= quantity;
  }
  const day = currentDay();
  for (const entry of sold) session.sold.push({ ...entry, day });
}

// Both actors of a session, checked against the sender.
/**
 * @param {string} merchantUuid
 * @param {string} customerUuid
 * @param {any} sender
 */
export async function resolvePair(merchantUuid, customerUuid, sender) {
  const merchant = /** @type {any} */ (await foundry.utils.fromUuid(merchantUuid));
  const customer = /** @type {any} */ (await foundry.utils.fromUuid(customerUuid));
  if (!merchant || !customer) throw new TradeError("KT.Error.Missing");
  if (!merchantFlags(merchant).enabled) throw new TradeError("KT.Error.NotShop", { name: merchant.name });
  if (!sender.isGM && !customer.testUserPermission(sender, "OWNER")) throw new TradeError("KT.Error.NotYours");
  return { merchant, customer };
}

// The checks for a request inside a visit: none for a GM or a shop a GM showed.
/**
 * @param {any} merchant
 * @param {any} customer
 * @param {any} sender
 */
export function checkVisit(merchant, customer, sender) {
  if (sender.isGM) return;
  const session = sessions.get(merchant.uuid);
  const own = session?.customer === customer.uuid;
  if (own && session.shown) return;
  checkAccess(merchant, customer, { distance: !(own && session.remote) });
}

/**
 * @param {any} merchant
 * @param {any} customer
 * @param {{ distance?: boolean }} [options]
 */
export function checkAccess(merchant, customer, { distance = true } = {}) {
  const flags = merchantFlags(merchant);
  const tables = getTables();
  const proximity = distance && game.settings.get(MODULE_ID, SETTINGS.PROXIMITY);
  const problem = accessProblem({
    enabled: flags.enabled,
    open: flags.open,
    now: game.time.worldTime,
    bannedUntil: flags.banned[customer.id],
    attitude: feature("attitude") ? attitudeValue(merchant, customer) : null,
    refuseAt: tables.attitude.refuseAt,
    squares: proximity ? nearest(merchant, customer) : null,
    maxSquares: proximity ? tables.access.proximity : null,
  });
  if (problem) throw new TradeError(problem, { name: merchant.name });
}

// What the customer may see of the merchant and its shelf. No exact purse, pins, true values or Suspicion.
/**
 * @param {any} merchant
 * @param {any} customer
 * @returns {Snapshot}
 */
export function snapshot(merchant, customer) {
  const flags = merchantFlags(merchant);
  const tables = getTables();
  const attitudeOn = feature("attitude");
  const value = attitudeValue(merchant, customer);
  const band = attitudeBand(value, attitudeTables());
  const purseTop = tables.tiers[flags.tier]?.purse[1] ?? 1;
  const session = sessions.get(merchant.uuid);
  return {
    merchant: {
      uuid: merchant.uuid,
      name: merchant.name,
      img: merchant.img,
      archetype: flags.archetype,
      tier: flags.tier,
      executionMode: flags.executionMode,
      purse: feature("purseLimit") ? Math.min(1, coinsToCopper(purse(merchant)) / purseTop) : null,
    },
    customer: customer.uuid,
    remote: Boolean(session?.customer === customer.uuid && session.remote),
    haggle: haggleView(merchant, customer),
    appraisal: appraisalView(merchant, customer),
    wanted: wantedView(merchant),
    attitude: {
      on: attitudeOn,
      band,
      adjustment: attitudeAdjustment(value, tables.attitude),
    },
    pool: poolView(merchant, customer),
    market: marketRulesFor(merchant),
    services: servicesOf(flags.archetype).map((service) => ({
      id: service.id,
      kind: service.kind,
      label: service.label,
      price: service.price,
      icon: service.icon ?? "fa-solid fa-hand-holding-heart",
      hint: service.note ?? game.i18n.localize(game.i18n.has(`KT.Service.${service.id}.Hint`) ? `KT.Service.${service.id}.Hint` : `KT.Service.Kind.${service.kind}`),
    })),
    buyback: soldToday(merchant.uuid, customer.uuid).flatMap((entry) => {
      const item = merchant.items.get(entry.id);
      const held = Number(item?.system?.quantity) || 0;
      return held > 0 ? [{ id: entry.id, price: entry.price, quantity: Math.min(entry.quantity, held) }] : [];
    }),
    shelf: visibleShelf(merchant, customer)
      .map(({ item, facts, holding, flags: itemFlagData, price }) => ({
        id: item.id,
        name: item.name,
        img: item.img,
        quantity: holding.quantity,
        price,
        type: facts.type,
        subtype: facts.subtype ?? "",
        rarity: facts.identified === false ? "" : (facts.rarity ?? ""),
        identified: facts.identified !== false,
        limited: itemFlagData.limited,
        underCounter: itemFlagData.underCounter,
        magical: Boolean(facts.magical || facts.rarity || facts.magicalBonus),
        description: itemDescription(item),
        stats: combatStats(item),
      })),
  };
}

// Priced shelf entries this customer may see. Items under the counter only show to friendly customers.
/**
 * @param {any} merchant
 * @param {any} customer
 */
export function visibleShelf(merchant, customer) {
  const friendly = attitudeBand(attitudeValue(merchant, customer), attitudeTables()) === "friendly";
  return shelf(merchant).filter((entry) => entry.price !== null && (friendly || !entry.flags.underCounter));
}

/**
 * @param {any} merchant
 * @param {any} customer
 */
function nearest(merchant, customer) {
  let best = null;
  for (const a of tokensOf(merchant)) {
    for (const b of tokensOf(customer)) {
      if (a.scene !== b.scene) continue;
      const squares = squaresBetween(a.box, b.box, a.gridSize);
      if (best === null || squares < best) best = squares;
    }
  }
  return best;
}
