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
import { coinsToCopper, payFrom } from "../engine/money.mjs";
import { feature, getTables } from "../settings.mjs";
import { TradeError } from "./errors.mjs";
import { shelf } from "./shop.mjs";
import { MESSAGES, onRequest } from "./socket.mjs";

/**
 * @typedef {object} Session
 * @property {string} customer
 * @property {string} customerName
 * @property {string} userId
 * @property {{ id: string, from?: string, price: number, quantity: number, day: number }[]} sold
 * @property {{ discount: number }} haggle
 * @property {boolean} shown
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
 * @property {{ on: boolean, band: string, adjustment: number }} attitude
 * @property {HaggleView} haggle
 * @property {{ on: boolean, items: Record<string, "appraised" | "failed"> }} appraisal
 * @property {WantedView[]} wanted
 * @property {ShelfItem[]} shelf
 * @property {{ id: string, price: number, quantity: number }[]} buyback
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
  onRequest(MESSAGES.PURSE_CHECK, checkPurse);
  Hooks.on("userConnected", (user, connected) => {
    if (!connected) for (const [merchant, session] of sessions) if (session.userId === user.id) sessions.delete(merchant);
  });
}

/** @param {string} merchant */
export function sessionAt(merchant) {
  return sessions.get(merchant) ?? null;
}

/**
 * @param {{ merchant: string, customer: string }} payload
 * @param {any} sender
 * @returns {Promise<Snapshot>}
 */
async function openSession({ merchant, customer }, sender) {
  const pair = await resolvePair(merchant, customer, sender);
  const current = sessions.get(pair.merchant.uuid);
  const sameCustomer = current?.customer === pair.customer.uuid;
  const shown = takeGrant(pair.merchant.uuid, sender.id) || Boolean(sameCustomer && current.shown && current.userId === sender.id);
  if (!sender.isGM && !shown) checkAccess(pair.merchant, pair.customer);
  if (current && !sameCustomer && game.users.get(current.userId)?.active) {
    throw new TradeError("KT.Error.Busy", { name: current.customerName });
  }
  const keepUser = sameCustomer && sender.isGM && current.userId !== sender.id && game.users.get(current.userId)?.active;
  sessions.set(pair.merchant.uuid, {
    customer: pair.customer.uuid,
    customerName: pair.customer.name,
    userId: keepUser ? current.userId : sender.id,
    sold: sameCustomer ? current.sold : [],
    haggle: sameCustomer ? current.haggle : { discount: 0 },
    shown,
  });
  return snapshot(pair.merchant, pair.customer);
}

/**
 * @param {{ merchant: string, customer: string }} payload
 * @param {any} sender
 */
function closeSession({ merchant, customer }, sender) {
  const current = sessions.get(merchant);
  if (current?.customer !== customer) return true;
  if (current.userId === sender.id || !game.users.get(current.userId)?.active) sessions.delete(merchant);
  return true;
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
  if (session?.customer === customer.uuid && session.shown) return;
  checkAccess(merchant, customer);
}

/**
 * @param {any} merchant
 * @param {any} customer
 */
export function checkAccess(merchant, customer) {
  const flags = merchantFlags(merchant);
  const tables = getTables();
  const proximity = game.settings.get(MODULE_ID, SETTINGS.PROXIMITY);
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
    haggle: haggleView(merchant, customer),
    appraisal: appraisalView(merchant, customer),
    wanted: wantedView(merchant),
    attitude: {
      on: attitudeOn,
      band,
      adjustment: attitudeAdjustment(value, tables.attitude),
    },
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
