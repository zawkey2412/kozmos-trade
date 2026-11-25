// Trade sessions: who is at which merchant, the access checks, and the shelf a customer sees.
// Documents are typed any here because their system data has no generated types.
import { MODULE_ID, SETTINGS } from "../constants.mjs";
import { clock, combatStats, itemDescription, purse, tokensOf } from "../adapter/dnd5e.mjs";
import { merchantFlags } from "../data/flags.mjs";
import { accessProblem, squaresBetween } from "../engine/access.mjs";
import { attitudeAdjustment, attitudeBand } from "../engine/attitude.mjs";
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
 * @property {boolean} magical
 * @property {string} description
 * @property {{ damage: string | null, ac: number | null }} stats
 */

/**
 * @typedef {object} Snapshot
 * @property {{ uuid: string, name: string, img: string, archetype: string, tier: string, executionMode: string, purse: number | null }} merchant
 * @property {string} customer
 * @property {{ on: boolean, band: string, adjustment: number }} attitude
 * @property {ShelfItem[]} shelf
 * @property {{ id: string, price: number, quantity: number }[]} buyback
 */

/** @type {Map<string, Session>} */
const sessions = new Map();

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
  if (!sender.isGM) checkAccess(pair.merchant, pair.customer);
  const current = sessions.get(pair.merchant.uuid);
  const sameCustomer = current?.customer === pair.customer.uuid;
  if (current && !sameCustomer && game.users.get(current.userId)?.active) {
    throw new TradeError("KT.Error.Busy", { name: current.customerName });
  }
  const keepUser = sameCustomer && sender.isGM && current.userId !== sender.id && game.users.get(current.userId)?.active;
  sessions.set(pair.merchant.uuid, {
    customer: pair.customer.uuid,
    customerName: pair.customer.name,
    userId: keepUser ? current.userId : sender.id,
    sold: sameCustomer ? current.sold : [],
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
    attitude: feature("attitude") ? (flags.attitude[customer.id]?.value ?? 0) : null,
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
  const attitudeValue = attitudeOn ? (flags.attitude[customer.id]?.value ?? 0) : 0;
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
    attitude: {
      on: attitudeOn,
      band: attitudeBand(attitudeValue, tables.attitude),
      adjustment: attitudeAdjustment(attitudeValue, tables.attitude),
    },
    buyback: soldToday(merchant.uuid, customer.uuid).flatMap((entry) => {
      const item = merchant.items.get(entry.id);
      const held = Number(item?.system?.quantity) || 0;
      return held > 0 ? [{ id: entry.id, price: entry.price, quantity: Math.min(entry.quantity, held) }] : [];
    }),
    shelf: shelf(merchant)
      .filter((entry) => entry.price !== null)
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
        magical: Boolean(facts.magical || facts.rarity || facts.magicalBonus),
        description: itemDescription(item),
        stats: combatStats(item),
      })),
  };
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
