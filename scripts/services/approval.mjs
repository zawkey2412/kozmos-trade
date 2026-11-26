// GM Approval: proposals as whispered chat cards that a GM approves, counters or declines.
// Documents are typed any here because their schema fields have no generated types.
import { MODULE_ID } from "../constants.mjs";
import { coinLabels, locale } from "../adapter/dnd5e.mjs";
import { merchantFlags } from "../data/flags.mjs";
import { coinsToCopper, formatCopper } from "../engine/money.mjs";
import { TradeError, warn } from "./errors.mjs";
import { broadcast, MESSAGES, onRequest, request } from "./socket.mjs";
import { prepareTrade, runTrade } from "./trade.mjs";

/** @import { PreparedTrade, TradeRequest } from "./trade.mjs"; */

/**
 * @typedef {object} Proposal
 * @property {TradeRequest} payload
 * @property {string} userId
 * @property {"pending" | "approved" | "declined" | "countered" | "replaced"} status
 */

const TEMPLATE = `modules/${MODULE_ID}/templates/chat/proposal.hbs`;

/** @type {((message: any) => void) | null} */
let openCounter = null;

/** @param {(message: any) => void} open */
export function setCounterWindow(open) {
  openCounter = open;
}

export function registerApprovalHandlers() {
  onRequest(MESSAGES.TRADE_PROPOSE, propose, { queueKey: (payload) => payload?.merchant });
  onRequest(MESSAGES.PROPOSAL_ANSWER, answer, { queueKey: (payload) => payload?.merchant });
}

export function registerProposalCards() {
  Hooks.on("renderChatMessageHTML", (message, html) => {
    const proposal = proposalOf(message);
    if (!proposal) return;
    const buttons = html.querySelector(".kt-chat-buttons");
    if (!buttons) return;
    if (!game.user.isGM || proposal.status !== "pending") return buttons.remove();
    buttons.addEventListener("click", (event) => {
      const button = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (event.target).closest("[data-kt-action]"));
      if (button) onCardButton(message, button.dataset.ktAction);
    });
  });
}

/** @param {any} message */
export function proposalOf(message) {
  return /** @type {Proposal | undefined} */ (message?.flags?.[MODULE_ID]?.proposal);
}

/**
 * @param {TradeRequest} payload
 * @param {any} sender
 */
async function propose(payload, sender) {
  const trade = await prepareTrade(payload, sender, { requireBalance: false });
  for (const message of game.messages) {
    const old = proposalOf(message);
    if (old?.status === "pending" && old.payload.merchant === payload.merchant && old.payload.customer === payload.customer) {
      await setStatus(message, old, "replaced");
    }
  }
  /** @type {Proposal} */
  const proposal = { payload, userId: sender.id, status: "pending" };
  await ChatMessage.create(/** @type {any} */ ({
    content: await cardContent(trade, proposal),
    whisper: game.users.filter((user) => user.isGM).map((user) => user.id),
    speaker: ChatMessage.getSpeaker({ actor: trade.merchant }),
    flags: { [MODULE_ID]: { proposal } },
  }));
  return true;
}

/**
 * @param {{ messageId: string, merchant: string, answer: "approve" | "decline" | "counter", counter?: { take: [string, number][], coinsTake: Record<string, number> } }} payload
 * @param {any} sender
 */
async function answer({ messageId, answer: choice, counter }, sender) {
  if (!sender.isGM) throw new TradeError("KT.Error.GMOnly");
  const message = game.messages.get(messageId);
  const proposal = proposalOf(message);
  if (!proposal || proposal.status !== "pending") throw new TradeError("KT.Error.ProposalGone");
  const proposer = game.users.get(proposal.userId);
  const before = await prepareTrade(proposal.payload, game.user, { requireBalance: false }).catch(() => null);
  if (choice === "approve") await runTrade(proposal.payload, proposer, { requireBalance: false });
  const status = { approve: "approved", decline: "declined", counter: "countered" }[choice];
  if (!status) throw new TradeError("KT.Error.ProposalGone");
  await setStatus(message, proposal, /** @type {Proposal["status"]} */ (status), before);
  const { merchant, customer } = proposal.payload;
  broadcast(MESSAGES.PROPOSAL_RESULT, { merchant, customer, status, counter: counter ?? null }, { users: [proposal.userId] });
  return status;
}

/**
 * @param {any} message
 * @param {string} action
 */
async function onCardButton(message, action) {
  const proposal = proposalOf(message);
  if (!proposal) return;
  if (action === "counter") return openCounter?.(message);
  try {
    await request(MESSAGES.PROPOSAL_ANSWER, { messageId: message.id, merchant: proposal.payload.merchant, answer: action });
  } catch (error) {
    warn(error);
  }
}

/**
 * @param {any} message
 * @param {Proposal} proposal
 * @param {Proposal["status"]} status
 * @param {PreparedTrade | null} [prepared]
 */
async function setStatus(message, proposal, status, prepared = null) {
  const next = { ...proposal, status };
  let content = message.content;
  try {
    const trade = prepared ?? (await prepareTrade(proposal.payload, game.user, { requireBalance: false }));
    content = await cardContent(trade, next);
  } catch {
    content = await foundry.applications.handlebars.renderTemplate(TEMPLATE, { gone: true, status: statusLabel(status) });
  }
  await message.update({ content, [`flags.${MODULE_ID}.proposal.status`]: status });
}

/**
 * @param {PreparedTrade} trade
 * @param {Proposal} proposal
 */
async function cardContent(trade, proposal) {
  const money = { locale: locale(), labels: coinLabels() };
  const lines = (items, coins) => [
    ...items.map((line) => game.i18n.localize("KT.Proposal.Line", { quantity: line.quantity, name: line.item.name, price: formatCopper(line.unit * line.quantity, money) })),
    ...(coinsToCopper(coins) ? [formatCopper(coinsToCopper(coins), money)] : []),
  ];
  const { result } = trade;
  const pooled = trade.pool.flatMap((part) => lines(part.give, part.coins).map((line) => game.i18n.localize("KT.Receipt.From", { name: part.actor.name, line })));
  return foundry.applications.handlebars.renderTemplate(TEMPLATE, {
    customer: trade.customer.name,
    merchant: trade.merchant.name,
    mode: game.i18n.localize(`KT.ExecutionMode.${merchantFlags(trade.merchant).executionMode}`),
    gives: [...lines(trade.give, trade.coinsGive), ...pooled],
    gets: lines(trade.take, trade.coinsTake),
    recipient: trade.recipient !== trade.customer ? trade.recipient.name : null,
    balance: game.i18n.localize(`KT.Balance.${result.state}`),
    net: `${result.net < 0 ? "-" : result.net > 0 ? "+" : ""}${formatCopper(Math.abs(result.net), money)}`,
    state: result.state,
    pending: proposal.status === "pending",
    status: statusLabel(proposal.status),
  });
}

/** @param {Proposal["status"]} status */
function statusLabel(status) {
  return game.i18n.localize(`KT.Proposal.Status.${status}`);
}
