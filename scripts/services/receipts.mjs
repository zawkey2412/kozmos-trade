// Receipts, the merchant's ledger, and reverting a trade.
// Documents are typed any here because their schema fields have no generated types.
import { MODULE_ID } from "../constants.mjs";
import { coinLabels, locale, purse } from "../adapter/dnd5e.mjs";
import { cleanFlags, itemFlags, MerchantFlags, merchantFlags } from "../data/flags.mjs";
import { COPPER, coinsToCopper, formatCopper } from "../engine/money.mjs";
import { addCoins } from "../engine/tray.mjs";
import { TradeError, warn } from "./errors.mjs";
import { broadcast, MESSAGES, onRequest, request } from "./socket.mjs";
import { moveAll } from "./trade.mjs";

/** @import { PreparedTrade, TradeLine, TradeRecord } from "./trade.mjs"; */

/**
 * @typedef {object} LedgerLine
 * @property {string} id
 * @property {string} name
 * @property {string} img
 * @property {number} quantity
 * @property {number} unit
 * @property {string} [from]
 * @property {object} [shelf]
 */

/**
 * @typedef {object} LedgerEntry
 * @property {string} id
 * @property {number} worldTime
 * @property {number} realTime
 * @property {string} customer
 * @property {string} customerName
 * @property {string} userId
 * @property {LedgerLine[]} given
 * @property {LedgerLine[]} received
 * @property {Record<string, number>} coinsGive
 * @property {Record<string, number>} paid
 * @property {number} change
 * @property {number} attitudeAdjustment
 * @property {boolean} reverted
 * @property {string | null} messageId
 * @property {{ actor: string, name: string, given: LedgerLine[], coinsGive: Record<string, number> }[]} [pool]
 * @property {string} [recipient]
 * @property {string} [recipientName]
 * @property {{ id: string, label: string, unit: number, target: string | null }[]} [services]
 */

const LEDGER_SIZE = 50;
const TEMPLATE = `modules/${MODULE_ID}/templates/chat/receipt.hbs`;

export function registerReceiptHandlers() {
  onRequest(MESSAGES.TRADE_REVERT, revert, { queueKey: (payload) => payload?.merchant });
}

export function registerReceiptCards() {
  Hooks.on("renderChatMessageHTML", (message, html) => {
    const receipt = message?.flags?.[MODULE_ID]?.receipt;
    if (!receipt) return;
    const button = html.querySelector("[data-kt-action='revert']");
    if (!button) return;
    if (!game.user.isGM) return button.remove();
    button.addEventListener("click", () => revertEntry(receipt.merchant, receipt.entry));
  });
}

// Asks the GM to revert a ledger entry, after a confirmation.
/**
 * @param {string} merchant
 * @param {string} entry
 */
export async function revertEntry(merchant, entry) {
  const ok = await foundry.applications.api.DialogV2.confirm(/** @type {any} */ ({
    window: { title: "KT.Receipt.RevertTitle" },
    content: `<p>${game.i18n.localize("KT.Receipt.RevertBody")}</p>`,
    rejectClose: false,
  }));
  if (!ok) return false;
  try {
    await request(MESSAGES.TRADE_REVERT, { merchant, entry });
    ui.notifications.info("KT.Receipt.Reverted", { localize: true });
    return true;
  } catch (error) {
    warn(error);
    return false;
  }
}

// Writes the ledger entry and posts the receipt card for a finished trade.
/**
 * @param {PreparedTrade} trade
 * @param {TradeRecord} record
 * @param {any} sender
 * @returns {Promise<LedgerEntry>}
 */
export async function recordTrade(trade, record, sender) {
  const line = (/** @type {TradeLine} */ entry, /** @type {string} */ id, /** @type {boolean} */ withShelf) => ({
    id,
    from: entry.item.id,
    name: entry.item.name,
    img: entry.item.img,
    quantity: entry.quantity,
    unit: entry.unit,
    ...(withShelf ? { shelf: shelfFlagsOf(entry.item) } : {}),
  });
  /** @type {LedgerEntry} */
  const entry = {
    id: foundry.utils.randomID(),
    worldTime: game.time.worldTime,
    realTime: Date.now(),
    customer: trade.customer.uuid,
    customerName: trade.customer.name,
    userId: sender.id,
    given: trade.give.map((g, index) => line(g, record.merchantCreated[index], false)),
    received: trade.take.map((t, index) => line(t, record.customerCreated[index], true)),
    coinsGive: trade.coinsGive,
    paid: trade.coins.paid,
    change: trade.result.change,
    attitudeAdjustment: trade.context.attitudeAdjustment,
    reverted: false,
    messageId: null,
  };
  const pool = trade.pool ?? [];
  if (pool.length) {
    entry.pool = pool.map((part, index) => ({
      actor: part.actor.uuid,
      name: part.actor.name,
      given: part.give.map((g, i) => line(g, record.poolCreated?.[index]?.[i], false)),
      coinsGive: part.coins,
    }));
  }
  if (trade.recipient && trade.recipient !== trade.customer) {
    entry.recipient = trade.recipient.uuid;
    entry.recipientName = trade.recipient.name;
  }
  if (trade.services?.length) {
    entry.services = trade.services.map((s) => ({ id: s.service.id, label: s.service.label, unit: s.unit, target: s.target?.name ?? null }));
  }
  const message = /** @type {any} */ (await ChatMessage.create(/** @type {any} */ ({
    content: await receiptContent(trade.merchant.name, entry),
    speaker: ChatMessage.getSpeaker({ actor: trade.merchant }),
    flags: { [MODULE_ID]: { receipt: { merchant: trade.merchant.uuid, entry: entry.id } } },
  })));
  entry.messageId = message?.id ?? null;
  await writeLedger(trade.merchant, [entry, ...merchantFlags(trade.merchant).ledger].slice(0, LEDGER_SIZE));
  return entry;
}

/**
 * @param {{ merchant: string, entry: string }} payload
 * @param {any} sender
 */
async function revert({ merchant: merchantUuid, entry: entryId }, sender) {
  if (!sender.isGM) throw new TradeError("KT.Error.GMOnly");
  const merchant = /** @type {any} */ (await foundry.utils.fromUuid(merchantUuid));
  const ledger = merchant ? /** @type {LedgerEntry[]} */ (merchantFlags(merchant).ledger) : [];
  const entry = ledger.find((e) => e.id === entryId);
  if (!entry || entry.reverted) throw new TradeError("KT.Error.RevertGone");
  const customer = /** @type {any} */ (await foundry.utils.fromUuid(entry.customer));
  if (!customer) throw new TradeError("KT.Error.Missing");
  /** @type {Map<string, any>} */
  const others = new Map();
  for (const uuid of [entry.recipient, ...(entry.pool ?? []).map((part) => part.actor)]) {
    if (!uuid || others.has(uuid)) continue;
    const actor = await foundry.utils.fromUuid(uuid);
    if (!actor) throw new TradeError("KT.Error.Missing");
    others.set(uuid, actor);
  }
  const plan = reversePlan(merchant, customer, entry, others);
  await moveAll({ currency: plan.currency, moves: plan.moves });
  entry.reverted = true;
  await writeLedger(merchant, ledger);
  const message = entry.messageId ? game.messages.get(entry.messageId) : null;
  if (message) await message.update({ content: await receiptContent(merchant.name, entry) });
  broadcast(MESSAGES.TRADE_DONE, { merchant: merchant.uuid, customer: customer.uuid });
  return true;
}

// The reverse of a ledger entry when everyone still holds what changed hands, with joined and receiving characters in others by UUID.
/**
 * @param {any} merchant
 * @param {any} customer
 * @param {LedgerEntry} entry
 * @param {Map<string, any>} [others]
 */
export function reversePlan(merchant, customer, entry, others = new Map()) {
  if (entry.services?.length) throw new TradeError("KT.Error.RevertService");
  const back =(/** @type {any} */ actor, /** @type {any} */ target, /** @type {LedgerLine[]} */ lines, /** @type {boolean} */ withShelf) =>
    lines.map((line) => {
      const item = actor.items.get(line.id);
      const held = Number(item?.system?.quantity) || 0;
      if (!item || held < line.quantity) throw new TradeError("KT.Error.RevertMoved", { name: line.name });
      const mergeInto = line.from && target.items.get(line.from) ? line.from : undefined;
      return { item, quantity: line.quantity, unit: line.unit, held, mergeInto, ...(withShelf && line.shelf ? { restoreFlags: line.shelf } : {}) };
    });
  const recipient = entry.recipient ? others.get(entry.recipient) : customer;
  if (!recipient) throw new TradeError("KT.Error.Missing");
  const give = back(recipient, merchant, entry.received, true);
  const take = back(merchant, customer, entry.given, false);
  const returns = (entry.pool ?? []).map((part) => {
    const actor = others.get(part.actor);
    if (!actor) throw new TradeError("KT.Error.Missing");
    return { actor, lines: back(merchant, actor, part.given, false), coins: part.coinsGive };
  });

  /** @type {Map<any, Record<string, number>>} */
  const after = new Map();
  const shift = (/** @type {any} */ actor, /** @type {Record<string, number>} */ coins, /** @type {1 | -1} */ sign) => after.set(actor, addCoins(after.get(actor) ?? purse(actor), coins, sign));
  shift(customer, entry.coinsGive, 1);
  shift(merchant, entry.coinsGive, -1);
  for (const part of returns) {
    shift(part.actor, part.coins, 1);
    shift(merchant, part.coins, -1);
  }
  shift(recipient, entry.paid, -1);
  shift(merchant, entry.paid, 1);
  const short = [...after.values()].some((coins) => Object.keys(COPPER).some((coin) => coins[coin] < 0));
  if (short) throw new TradeError("KT.Error.RevertCoins");

  return {
    give,
    take,
    coins: { customerAfter: after.get(customer), merchantAfter: after.get(merchant) },
    currency: [...after],
    moves: [
      { from: recipient, to: merchant, lines: give },
      { from: merchant, to: customer, lines: take },
      ...returns.map((part) => ({ from: merchant, to: part.actor, lines: part.lines })),
    ],
  };
}

/**
 * @param {any} merchant
 * @returns {LedgerEntry[]}
 */
export function ledgerOf(merchant) {
  return /** @type {LedgerEntry[]} */ (merchantFlags(merchant).ledger);
}

/**
 * @param {string} merchantName
 * @param {LedgerEntry} entry
 */
export async function receiptContent(merchantName, entry) {
  const money = { locale: locale(), labels: coinLabels() };
  const items = (/** @type {LedgerLine[]} */ lines) => lines.map((l) => game.i18n.localize("KT.Proposal.Line", { quantity: l.quantity, name: l.name, price: formatCopper(l.unit * l.quantity, money) }));
  const coins = (/** @type {Record<string, number>} */ c) => (coinsToCopper(c) ? [formatCopper(coinsToCopper(c), money)] : []);
  const adjustment = entry.attitudeAdjustment;
  const pooled = (entry.pool ?? []).flatMap((part) => [...items(part.given), ...coins(part.coinsGive)].map((line) => game.i18n.localize("KT.Receipt.From", { name: part.name, line })));
  const services = (entry.services ?? []).map((s) => game.i18n.localize("KT.Receipt.Service", { name: s.target ? `${s.label} (${s.target})` : s.label, price: formatCopper(s.unit, money) }));
  return foundry.applications.handlebars.renderTemplate(TEMPLATE, {
    merchant: merchantName,
    customer: entry.customerName,
    gives: [...items(entry.given), ...coins(entry.coinsGive), ...pooled],
    gets: [...items(entry.received), ...services, ...coins(entry.paid)],
    recipient: entry.recipientName ?? null,
    change: entry.change ? formatCopper(entry.change, money) : null,
    modifiers: adjustment ? [game.i18n.localize("KT.Receipt.Attitude", { value: `${adjustment > 0 ? "+" : "-"}${Math.round(Math.abs(adjustment) * 100)}%` })] : [],
    reverted: entry.reverted,
  });
}

/** @param {any} item */
function shelfFlagsOf(item) {
  const { listedPrice, pinned, limited, curio } = itemFlags(item);
  return { listedPrice, pinned, limited, curio };
}

/**
 * @param {any} merchant
 * @param {LedgerEntry[]} ledger
 */
async function writeLedger(merchant, ledger) {
  const flags = /** @type {any} */ (cleanFlags(MerchantFlags, { ...merchantFlags(merchant), ledger }));
  await merchant.update({ [`flags.${MODULE_ID}.ledger`]: flags.ledger });
}
