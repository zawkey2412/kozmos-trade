// Receipts, the merchant's ledger, and reverting a trade.
// Documents are typed any here because their schema fields have no generated types.
import { MODULE_ID } from "../constants.mjs";
import { coinLabels, locale, purse } from "../adapter/dnd5e.mjs";
import { cleanFlags, itemFlags, MerchantFlags, merchantFlags } from "../data/flags.mjs";
import { COPPER, coinsToCopper, formatCopper } from "../engine/money.mjs";
import { addCoins } from "../engine/tray.mjs";
import { TradeError, warn } from "./errors.mjs";
import { broadcast, MESSAGES, onRequest, request } from "./socket.mjs";
import { applyTrade } from "./trade.mjs";

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
  const plan = reversePlan(merchant, customer, entry);
  await applyTrade({ merchant, customer, ...plan });
  entry.reverted = true;
  await writeLedger(merchant, ledger);
  const message = entry.messageId ? game.messages.get(entry.messageId) : null;
  if (message) await message.update({ content: await receiptContent(merchant.name, entry) });
  broadcast(MESSAGES.TRADE_DONE, { merchant: merchant.uuid, customer: customer.uuid });
  return true;
}

// The reverse of a ledger entry, when both actors still hold what changed hands.
/**
 * @param {any} merchant
 * @param {any} customer
 * @param {LedgerEntry} entry
 */
export function reversePlan(merchant, customer, entry) {
  const back = (/** @type {any} */ actor, /** @type {any} */ target, /** @type {LedgerLine[]} */ lines, /** @type {boolean} */ withShelf) =>
    lines.map((line) => {
      const item = actor.items.get(line.id);
      const held = Number(item?.system?.quantity) || 0;
      if (!item || held < line.quantity) throw new TradeError("KT.Error.RevertMoved", { name: line.name });
      const mergeInto = line.from && target.items.get(line.from) ? line.from : undefined;
      return { item, quantity: line.quantity, unit: line.unit, held, mergeInto, ...(withShelf && line.shelf ? { restoreFlags: line.shelf } : {}) };
    });
  const give = back(customer, merchant, entry.received, true);
  const take = back(merchant, customer, entry.given, false);
  const customerAfter = addCoins(addCoins(purse(customer), entry.coinsGive), entry.paid, -1);
  const merchantAfter = addCoins(addCoins(purse(merchant), entry.coinsGive, -1), entry.paid);
  const short = Object.keys(COPPER).some((coin) => customerAfter[coin] < 0 || merchantAfter[coin] < 0);
  if (short) throw new TradeError("KT.Error.RevertCoins");
  return { give, take, coins: { customerAfter, merchantAfter } };
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
  return foundry.applications.handlebars.renderTemplate(TEMPLATE, {
    merchant: merchantName,
    customer: entry.customerName,
    gives: [...items(entry.given), ...coins(entry.coinsGive)],
    gets: [...items(entry.received), ...coins(entry.paid)],
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
