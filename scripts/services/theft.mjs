// Theft on the active GM: a hidden DC, the customer's secret roll, and what the merchant does about it.
// Documents are typed any here because their schema fields have no generated types.
import { MODULE_ID, SETTINGS } from "../constants.mjs";
import { clock, coinLabels, holdingFacts, locale, passiveScore, purse, rollCheck, sizeFacts, skillBonus, skillLabel } from "../adapter/dnd5e.mjs";
import { itemFlags, merchantFlags, tokenFlags } from "../data/flags.mjs";
import { attitudeBand } from "../engine/attitude.mjs";
import { lockUntil } from "../engine/haggle.mjs";
import { formatCopper, payFrom } from "../engine/money.mjs";
import { lastCustomer, needsApproval, pocketSize, raiseSuspicion, stolenChecks, suspicionToday, theftDC, theftOutcome } from "../engine/theft.mjs";
import { addCoins } from "../engine/tray.mjs";
import { feature, getTables } from "../settings.mjs";
import { getArchetypes } from "./archetypes.mjs";
import { attitudeTables, attitudeValue, recordAttitude } from "./attitude.mjs";
import { TradeError, warn } from "./errors.mjs";
import { merchantScene } from "./market-rules.mjs";
import { addNotoriety } from "./notoriety.mjs";
import { noteContent, postNote } from "./notes.mjs";
import { buyQuote, shelfView } from "./offer.mjs";
import { expectRoll, registerRollKind, rollFlags } from "./rolls.mjs";
import { announcePool, checkVisit, currentDay, endSessionAt, poolOf, priceContextFor, resolvePair, sessionAt, theftOpen, visibleShelf } from "./session.mjs";
import { broadcast, MESSAGES, onBroadcast, onRequest, request } from "./socket.mjs";
import { addTradeCheck, moveAll } from "./trade.mjs";

/** @import { ExpectedRoll } from "./rolls.mjs"; */
/** @import { NoteView } from "./notes.mjs"; */
/** @import { PreparedTrade } from "./trade.mjs"; */
/** @import { ShelfEntry } from "./shop.mjs"; */
/** @import { TheftOutcome } from "../engine/theft.mjs"; */

/**
 * @typedef {object} TheftGo
 * @property {string} merchant
 * @property {string} customer
 * @property {string} item
 * @property {string} [nonce]
 * @property {string} [skill]
 * @property {boolean} [advantage]
 * @property {boolean} [refused]
 */

/**
 * @typedef {object} TheftCard
 * @property {"ask" | "caught"} kind
 * @property {string} merchant
 * @property {string} customer
 * @property {string} itemId
 * @property {string} item
 * @property {string} userId
 * @property {string} status
 * @property {{ icon: string, title: string, tone: string, lines: string[] }} view
 * @property {boolean} [sale]
 */

export const THEFT_ROLL = "theft";
export const DISTRACT_ROLL = "distract";

const BUTTONS = {
  ask: [
    { action: "allow", icon: "fa-solid fa-check", label: "KT.Theft.Allow" },
    { action: "refuse", icon: "fa-solid fa-xmark", label: "KT.Theft.Refuse" },
  ],
  caught: [
    { action: "double", icon: "fa-solid fa-coins", label: "KT.Theft.Punish.double" },
    { action: "attitude", icon: "fa-regular fa-face-angry", label: "KT.Theft.Punish.attitude" },
    { action: "guards", icon: "fa-solid fa-shield-halved", label: "KT.Theft.Punish.guards" },
    { action: "ban", icon: "fa-solid fa-door-closed", label: "KT.Theft.Punish.ban" },
  ],
  sale: [
    { action: "confiscate", icon: "fa-solid fa-hand-holding", label: "KT.Theft.Punish.confiscate" },
    { action: "attitude", icon: "fa-regular fa-face-angry", label: "KT.Theft.Punish.attitude" },
    { action: "guards", icon: "fa-solid fa-shield-halved", label: "KT.Theft.Punish.guards" },
    { action: "ban", icon: "fa-solid fa-door-closed", label: "KT.Theft.Punish.ban" },
  ],
};

/** @param {TheftCard} card */
function buttonsOf(card) {
  return card.kind === "caught" && card.sale ? BUTTONS.sale : BUTTONS[card.kind];
}

export function registerTheftHandlers() {
  onRequest(MESSAGES.THEFT_START, startTheft, { queueKey: (payload) => payload?.merchant });
  onRequest(MESSAGES.THEFT_ANSWER, answerTheft, { queueKey: (payload) => payload?.merchant });
  onRequest(MESSAGES.THEFT_DISTRACT, startDistraction, { queueKey: (payload) => payload?.merchant });
  onRequest(MESSAGES.THEFT_PUNISH, punish, { queueKey: (payload) => payload?.merchant });
  onBroadcast(MESSAGES.THEFT_GO, (go) => rollTheft(go));
  registerRollKind(THEFT_ROLL, settleTheft);
  registerRollKind(DISTRACT_ROLL, settleDistraction);
  addTradeCheck(checkStolen);
}

// GM side: a merchant spots stolen goods a player tries to sell, and the sale becomes a catch.
/**
 * @param {PreparedTrade} trade
 * @param {any} sender
 */
async function checkStolen(trade, sender) {
  if (!feature("theft")) return;
  const tables = getTables().theft;
  const { merchant } = trade;
  const scene = merchantScene(merchant);
  const fence = Boolean(getArchetypes()[merchantFlags(merchant).archetype]?.fence);
  const sameScene = (/** @type {string} */ source) => {
    const shop = /** @type {any} */ (foundry.utils.fromUuidSync(source, { strict: false }));
    return Boolean(scene && shop && merchantScene(shop) === scene);
  };
  const pool = poolOf(merchant.uuid, trade.customer.uuid);
  const sellers = [
    { actor: trade.customer, lines: trade.give, userId: sender.id },
    ...trade.pool.map((part) => ({ actor: part.actor, lines: part.give, userId: pool.find((entry) => entry.actor === part.actor.uuid)?.userId ?? sender.id })),
  ];
  for (const seller of sellers) {
    const stolen = seller.lines.flatMap((line) => {
      const flag = itemFlags(line.item).stolen;
      return flag ? [{ source: flag.source, line }] : [];
    });
    if (!stolen.length) continue;
    const { own, looked } = stolenChecks(stolen, { merchant: merchant.uuid, sameScene, fence });
    let spotted = own[0]?.line ?? null;
    /** @type {{ total: number, dc: number } | null} */
    let check = null;
    if (!spotted && looked.length) {
      check = { total: await merchantRoll(merchant, tables.recognize.merchant, "KT.Theft.MerchantRecognize"), dc: passiveScore(seller.actor, tables.recognize.seller) };
      if (check.total >= check.dc) spotted = looked[0].line;
      else await whisperNote(merchant, { icon: "fa-solid fa-mask", title: game.i18n.localize("KT.Theft.Title"), tone: "success", lines: recognizeLines(seller.actor, looked[0].line.item, check, false) });
    }
    if (!spotted) continue;
    const points = await addNotoriety(merchant, seller.actor);
    const lines = [
      ...(check ? recognizeLines(seller.actor, spotted.item, check, true) : [game.i18n.localize("KT.Theft.Card.Own", { merchant: merchant.name, customer: seller.actor.name, item: spotted.item.name })]),
      game.i18n.localize("KT.Theft.Card.Notoriety", { name: seller.actor.name, points }),
      game.i18n.localize("KT.Theft.Card.caught"),
    ];
    const view = { icon: "fa-solid fa-mask", title: game.i18n.localize("KT.Theft.Title"), tone: "failure", lines };
    await postCard(merchant, { kind: "caught", sale: true, merchant: merchant.uuid, customer: seller.actor.uuid, itemId: spotted.item.id, item: spotted.item.name, userId: seller.userId, status: "pending", view });
    throw new TradeError("KT.Theft.Recognized", { merchant: merchant.name, item: spotted.item.name });
  }
}

/**
 * @param {any} seller
 * @param {any} item
 * @param {{ total: number, dc: number }} check
 * @param {boolean} spotted
 */
function recognizeLines(seller, item, check, spotted) {
  return [
    game.i18n.localize("KT.Theft.Card.Looks", { customer: seller.name, item: item.name }),
    game.i18n.localize("KT.Theft.Card.RecognizeRoll", { total: check.total, dc: check.dc }),
    game.i18n.localize(spotted ? "KT.Theft.Card.Recognized" : "KT.Theft.Card.NotRecognized"),
  ];
}

export function registerTheftCards() {
  Hooks.on("renderChatMessageHTML", (message, html) => {
    const card = theftCardOf(message);
    if (!card) return;
    const buttons = html.querySelector(".kt-chat-buttons");
    if (!buttons) return;
    if (!game.user.isGM || card.status !== "pending") return buttons.remove();
    buttons.addEventListener("click", async (event) => {
      const button = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (event.target).closest("[data-kt-action]"));
      if (!button) return;
      const type = card.kind === "ask" ? MESSAGES.THEFT_ANSWER : MESSAGES.THEFT_PUNISH;
      await request(type, { messageId: message.id, merchant: card.merchant, choice: button.dataset.ktAction }).catch((error) => warn(error));
    });
  });
}

/** @param {any} message */
function theftCardOf(message) {
  return /** @type {TheftCard | undefined} */ (message?.flags?.[MODULE_ID]?.theftCard);
}

// Client side: asks to pocket a shelf item, then rolls in secret.
/**
 * @param {any} customer
 * @param {string} merchant
 * @param {string} itemId
 */
export async function pocket(customer, merchant, itemId) {
  const start = await request(MESSAGES.THEFT_START, { merchant, customer: customer.uuid, itemId });
  if (start.pending) {
    ui.notifications.info(game.i18n.localize("KT.Theft.Waiting", { item: start.item }));
    return null;
  }
  return rollTheft(start);
}

// Client side: the secret Sleight of Hand roll, settled by the GM.
/** @param {TheftGo} go */
export async function rollTheft(go) {
  if (go.refused) return ui.notifications.warn(game.i18n.localize("KT.Theft.Refused", { item: go.item }));
  const customer = /** @type {any} */ (await foundry.utils.fromUuid(go.customer));
  if (!customer) return null;
  try {
    const message = await rollCheck(customer, { skill: go.skill, advantage: go.advantage, flags: rollFlags(THEFT_ROLL, go.nonce ?? "", go.merchant), secret: true });
    if (!message) return null;
    const outcome = await request(MESSAGES.ROLL_REPORT, { merchant: go.merchant, nonce: go.nonce, messageId: message.id });
    if (outcome.result === "pocketed") ui.notifications.info(game.i18n.localize("KT.Theft.Result.pocketed", { item: go.item }));
    else ui.notifications.warn(game.i18n.localize(`KT.Theft.Result.${outcome.result}`, { item: go.item }));
    return outcome;
  } catch (error) {
    warn(error);
    return null;
  }
}

// Client side: a joined character keeps the merchant busy.
/**
 * @param {any} actor
 * @param {string} merchant
 * @param {string} skill
 */
export async function distract(actor, merchant, skill) {
  try {
    const start = await request(MESSAGES.THEFT_DISTRACT, { merchant, customer: actor.uuid, skill });
    const message = await rollCheck(actor, { skill: start.skill, flags: rollFlags(DISTRACT_ROLL, start.nonce, merchant), secret: true });
    if (!message) return null;
    const outcome = await request(MESSAGES.ROLL_REPORT, { merchant, nonce: start.nonce, messageId: message.id });
    if (outcome.success) ui.notifications.info("KT.Theft.Distract.Success", { localize: true });
    else ui.notifications.warn("KT.Theft.Distract.Failure", { localize: true });
    return outcome;
  } catch (error) {
    warn(error);
    return null;
  }
}

/**
 * @param {{ merchant: string, customer: string, itemId: string }} payload
 * @param {any} sender
 */
async function startTheft({ merchant: merchantUuid, customer: customerUuid, itemId }, sender) {
  const { merchant, customer } = await resolvePair(merchantUuid, customerUuid, sender);
  if (sessionAt(merchant.uuid)?.customer !== customer.uuid) throw new TradeError("KT.Error.NotInSession");
  checkVisit(merchant, customer, sender);
  if (!theftOpen(merchant, customer)) throw new TradeError("KT.Theft.Off", { name: merchant.name });
  const entry = target(merchant, customer, itemId);
  const rule = /** @type {any} */ (game.settings.get(MODULE_ID, SETTINGS.THEFT_APPROVAL));
  if (!sender.isGM && needsApproval(rule, entry.facts.rarity, getTables().theft)) {
    await askApproval(merchant, customer, entry, sender.id);
    return { pending: true, item: entry.item.name };
  }
  return expectTheft(merchant, customer, entry, sender.id);
}

// A shelf item the customer can see and could carry off.
/**
 * @param {any} merchant
 * @param {any} customer
 * @param {string} itemId
 * @returns {ShelfEntry}
 */
function target(merchant, customer, itemId) {
  const entry = visibleShelf(merchant, customer).find((e) => e.item.id === itemId);
  if (!entry) throw new TradeError("KT.Error.SoldOut");
  if (pocketSize(sizeFacts(entry.item), getTables().theft) === "bulky") throw new TradeError("KT.Theft.Bulky", { item: entry.item.name });
  return entry;
}

/**
 * @param {any} merchant
 * @param {any} customer
 * @param {ShelfEntry} entry
 * @param {string} userId
 * @returns {TheftGo}
 */
function expectTheft(merchant, customer, entry, userId) {
  const session = sessionAt(merchant.uuid);
  const distracted = Boolean(session?.customer === customer.uuid && session.distraction.by);
  const skill = getTables().theft.skill;
  const nonce = expectRoll({ kind: THEFT_ROLL, merchant: merchant.uuid, customer: customer.uuid, userId, data: { itemId: entry.item.id, distracted } });
  return { merchant: merchant.uuid, customer: customer.uuid, item: entry.item.name, nonce, skill, advantage: distracted };
}

/**
 * @param {any} merchant
 * @param {any} customer
 * @param {ShelfEntry} entry
 * @param {string} userId
 */
async function askApproval(merchant, customer, entry, userId) {
  const view = {
    icon: "fa-solid fa-hand",
    title: game.i18n.localize("KT.Theft.AskTitle"),
    tone: "",
    lines: [game.i18n.localize("KT.Theft.Ask", { customer: customer.name, item: entry.item.name, merchant: merchant.name })],
  };
  /** @type {TheftCard} */
  const card = { kind: "ask", merchant: merchant.uuid, customer: customer.uuid, itemId: entry.item.id, item: entry.item.name, userId, status: "pending", view };
  await postCard(merchant, card);
}

/**
 * @param {any} merchant
 * @param {TheftCard} card
 */
async function postCard(merchant, card) {
  await ChatMessage.create(/** @type {any} */ ({
    content: await cardContent(card),
    whisper: gmIds(),
    speaker: ChatMessage.getSpeaker({ actor: merchant }),
    flags: { [MODULE_ID]: { theftCard: card } },
  }));
}

/** @param {TheftCard} card */
function cardContent(card) {
  const pending = card.status === "pending";
  const value = getTables().attitude.events.caughtStealing;
  const buttons = pending ? buttonsOf(card).map((button) => ({ ...button, label: game.i18n.localize(button.label, { value }) })) : [];
  return noteContent(/** @type {NoteView} */ ({ ...card.view, buttons, status: pending ? null : card.status }));
}

// A card for the GM's eyes only, with nothing to answer.
/**
 * @param {any} merchant
 * @param {TheftCard["view"]} view
 */
async function whisperNote(merchant, view) {
  await postNote(merchant, /** @type {NoteView} */ (view), { whisper: gmIds() });
}

/**
 * @param {any} message
 * @param {TheftCard} card
 * @param {string} status
 */
async function closeCard(message, card, status) {
  const next = { ...card, status };
  await message.update({ content: await cardContent(next), [`flags.${MODULE_ID}.theftCard.status`]: status });
}

/**
 * @param {{ messageId: string, choice: string }} payload
 * @param {any} sender
 */
async function answerTheft({ messageId, choice }, sender) {
  if (!sender.isGM) throw new TradeError("KT.Error.GMOnly");
  const message = game.messages.get(messageId);
  const card = theftCardOf(message);
  if (!card || card.kind !== "ask" || card.status !== "pending") throw new TradeError("KT.Theft.Answered");
  const allowed = choice === "allow";
  await closeCard(message, card, game.i18n.localize(allowed ? "KT.Theft.Allowed" : "KT.Theft.RefusedStatus"));
  if (!allowed) {
    broadcast(MESSAGES.THEFT_GO, { merchant: card.merchant, customer: card.customer, item: card.item, refused: true }, { users: [card.userId] });
    return "refused";
  }
  const merchant = /** @type {any} */ (await foundry.utils.fromUuid(card.merchant));
  const customer = /** @type {any} */ (await foundry.utils.fromUuid(card.customer));
  if (!merchant || !customer) throw new TradeError("KT.Error.Missing");
  const go = expectTheft(merchant, customer, target(merchant, customer, card.itemId), card.userId);
  broadcast(MESSAGES.THEFT_GO, go, { users: [card.userId] });
  return "allowed";
}

/**
 * @param {ExpectedRoll} entry
 * @param {number} total
 */
async function settleTheft(entry, total) {
  const { itemId, distracted } = /** @type {{ itemId: string, distracted: boolean }} */ (entry.data);
  const merchant = /** @type {any} */ (await foundry.utils.fromUuid(entry.merchant));
  const customer = /** @type {any} */ (await foundry.utils.fromUuid(entry.customer));
  const session = sessionAt(entry.merchant);
  if (session?.customer === entry.customer) session.distraction = { by: null, tried: [] };
  const found = visibleShelf(merchant, customer).find((e) => e.item.id === itemId);
  if (!found) {
    announcePool(entry.merchant);
    throw new TradeError("KT.Error.SoldOut");
  }
  const tables = getTables();
  const flags = merchantFlags(merchant);
  const today = currentDay();
  const suspicion = suspicionToday(flags.suspicion, flags.suspicionDay, today);
  let perception = passiveScore(merchant, "prc");
  const opposed = feature("rolledInsight");
  if (opposed) perception = await merchantRoll(merchant, "prc", "KT.Theft.MerchantPerception");
  const { dc, factors } = theftDC(
    {
      perception,
      size: pocketSize(sizeFacts(found.item), tables.theft),
      limited: found.flags.limited,
      pinned: found.flags.pinned,
      suspicion,
      friendly: feature("attitude") && attitudeBand(attitudeValue(merchant, customer), attitudeTables()) === "friendly",
      guarded: guarded(merchant),
    },
    tables.theft,
  );
  const outcome = theftOutcome(total, dc, tables.theft);
  if (outcome === "clean" || outcome === "taken") await pocketItem(merchant, customer, found);
  if (outcome === "taken") {
    const record = { actor: customer.id, name: customer.name, item: found.item.name, time: game.time.worldTime };
    await merchant.update({ [`flags.${MODULE_ID}.thefts`]: [...flags.thefts, record] });
  }
  let raised = suspicion;
  if (outcome === "fumble") {
    const next = raiseSuspicion(flags.suspicion, flags.suspicionDay, today, tables.theft);
    raised = next.suspicion;
    await merchant.update({ [`flags.${MODULE_ID}.suspicion`]: next.suspicion, [`flags.${MODULE_ID}.suspicionDay`]: next.day });
  }
  const notoriety = outcome === "caught" ? await addNotoriety(merchant, customer) : 0;
  await reportAttempt({ merchant, customer, item: found.item, entry, dc, perception, opposed, factors, total, outcome, distracted, suspicion: raised, notoriety });
  Hooks.callAll("kozmosTrade.theft", merchant, customer, { item: found.item.name, outcome, dc, total, distracted, opposed });
  if (outcome === "clean" || outcome === "taken") broadcast(MESSAGES.TRADE_DONE, { merchant: merchant.uuid, customer: customer.uuid });
  announcePool(entry.merchant);
  return { result: outcome === "clean" || outcome === "taken" ? "pocketed" : outcome };
}

// Moves one of the item to the thief, marked as stolen.
/**
 * @param {any} merchant
 * @param {any} customer
 * @param {ShelfEntry} entry
 */
async function pocketItem(merchant, customer, entry) {
  const stolen = { source: merchant.uuid, time: game.time.worldTime };
  const line = { item: entry.item, quantity: 1, unit: 0, held: entry.holding.quantity, stolen };
  await moveAll({ currency: [], moves: [{ from: merchant, to: customer, lines: [line] }] });
}

// Whether a guard token stands in the merchant's scene.
/** @param {any} merchant */
function guarded(merchant) {
  const scene = merchantScene(merchant);
  const own = (/** @type {any} */ token) => (merchant.isToken ? token === merchant.token : token.actorLink && token.actorId === merchant.id);
  return Boolean(scene?.tokens.some((token) => tokenFlags(token).guard && !own(token)));
}

// The merchant's d20 plus a skill, whispered to the GM.
/**
 * @param {any} merchant
 * @param {string} skill
 * @param {string} flavor
 */
async function merchantRoll(merchant, skill, flavor) {
  const roll = await new foundry.dice.Roll("1d20 + @bonus", { bonus: skillBonus(merchant, skill) }).evaluate();
  await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor: merchant }), flavor: game.i18n.localize(flavor) }, { messageMode: "gm" });
  return roll.total;
}

// The whispered card for every attempt: the roll, the DC and its reasons, and the outcome.
/**
 * @param {{ merchant: any, customer: any, item: any, entry: ExpectedRoll, dc: number, perception: number, opposed: boolean, factors: { kind: string, value: number }[], total: number, outcome: TheftOutcome, distracted: boolean, suspicion: number, notoriety: number }} attempt
 */
async function reportAttempt({ merchant, customer, item, entry, dc, perception, opposed, factors, total, outcome, distracted, suspicion, notoriety }) {
  const reasons = [
    game.i18n.localize(opposed ? "KT.Theft.Factor.rolled" : "KT.Theft.Factor.passive", { value: perception }),
    ...factors.map((factor) => game.i18n.localize(`KT.Theft.Factor.${factor.kind}`, { value: `${factor.value > 0 ? "+" : ""}${factor.value}` })),
  ].join(", ");
  const lines = [
    game.i18n.localize("KT.Theft.Card.Try", { customer: customer.name, item: item.name }),
    ...(distracted ? [game.i18n.localize("KT.Theft.Card.Distracted")] : []),
    game.i18n.localize("KT.Theft.Card.Roll", { dc, reasons, total }),
    game.i18n.localize(`KT.Theft.Card.${outcome}`, { suspicion }),
    ...(notoriety ? [game.i18n.localize("KT.Theft.Card.Notoriety", { name: customer.name, points: notoriety })] : []),
  ];
  const view = { icon: "fa-solid fa-hand", title: game.i18n.localize("KT.Theft.Title"), tone: outcome === "clean" || outcome === "taken" ? "success" : "failure", lines };
  if (outcome !== "caught") return whisperNote(merchant, view);
  /** @type {TheftCard} */
  const card = { kind: "caught", merchant: merchant.uuid, customer: customer.uuid, itemId: item.id, item: item.name, userId: entry.userId, status: "pending", view };
  await postCard(merchant, card);
}

/**
 * @param {{ merchant: string, customer: string, skill: string }} payload
 * @param {any} sender
 */
async function startDistraction({ merchant: merchantUuid, customer: customerUuid, skill }, sender) {
  const { merchant, customer } = await resolvePair(merchantUuid, customerUuid, sender);
  const session = sessionAt(merchant.uuid);
  if (!session?.pool.some((entry) => entry.actor === customer.uuid && entry.userId === sender.id)) throw new TradeError("KT.Error.NotJoined");
  const lead = /** @type {any} */ (foundry.utils.fromUuidSync(session.customer));
  if (!lead || !theftOpen(merchant, lead)) throw new TradeError("KT.Theft.Off", { name: merchant.name });
  if (!getTables().theft.distractSkills.includes(skill)) throw new TradeError("KT.Theft.Distract.BadSkill");
  if (session.distraction.by) throw new TradeError("KT.Theft.Distract.Already");
  if (session.distraction.tried.includes(customer.uuid)) throw new TradeError("KT.Theft.Distract.Tried");
  const nonce = expectRoll({ kind: DISTRACT_ROLL, merchant: merchant.uuid, customer: customer.uuid, userId: sender.id, data: { skill } });
  return { nonce, skill };
}

/**
 * @param {ExpectedRoll} entry
 * @param {number} total
 */
async function settleDistraction(entry, total) {
  const { skill } = /** @type {{ skill: string }} */ (entry.data);
  const merchant = /** @type {any} */ (await foundry.utils.fromUuid(entry.merchant));
  const actor = /** @type {any} */ (await foundry.utils.fromUuid(entry.customer));
  const opposed = feature("rolledInsight");
  const insight = opposed ? await merchantRoll(merchant, "ins", "KT.Theft.MerchantInsight") : passiveScore(merchant, "ins");
  const success = total >= insight;
  const session = sessionAt(entry.merchant);
  if (session?.pool.some((e) => e.actor === entry.customer)) {
    session.distraction.tried.push(entry.customer);
    if (success) session.distraction.by = entry.customer;
  }
  const lines = [
    game.i18n.localize("KT.Theft.Card.Distract", { name: actor?.name ?? "", check: skillLabel(skill) }),
    game.i18n.localize("KT.Theft.Card.DistractRoll", { dc: insight, total }),
    game.i18n.localize(success ? "KT.Theft.Card.DistractWorks" : "KT.Theft.Card.DistractFails"),
  ];
  await whisperNote(merchant, { icon: "fa-solid fa-masks-theater", title: game.i18n.localize("KT.Theft.Title"), tone: success ? "success" : "failure", lines });
  announcePool(entry.merchant);
  return { success };
}

// The GM's choice for a thief caught in the act.
/**
 * @param {{ messageId: string, choice: string }} payload
 * @param {any} sender
 */
async function punish({ messageId, choice }, sender) {
  if (!sender.isGM) throw new TradeError("KT.Error.GMOnly");
  const message = game.messages.get(messageId);
  const card = theftCardOf(message);
  if (!card || card.kind !== "caught" || card.status !== "pending") throw new TradeError("KT.Theft.Answered");
  if (!buttonsOf(card).some((button) => button.action === choice)) throw new TradeError("KT.Theft.Answered");
  const merchant = /** @type {any} */ (await foundry.utils.fromUuid(card.merchant));
  const customer = /** @type {any} */ (await foundry.utils.fromUuid(card.customer));
  if (!merchant || !customer) throw new TradeError("KT.Error.Missing");
  let price = "";
  if (choice === "double") price = await payDouble(merchant, customer, card.itemId);
  if (choice === "confiscate") await confiscate(merchant, customer, card.itemId);
  if (choice === "attitude") await recordAttitude(merchant, customer, ["caughtStealing"]);
  if (choice === "attitude" || choice === "ban") await ban(merchant, customer);
  const value = getTables().attitude.events.caughtStealing;
  const line = game.i18n.localize(`KT.Theft.Done.${choice}`, { merchant: merchant.name, customer: customer.name, item: card.item, price, value });
  await closeCard(message, card, line);
  await postNote(merchant, { icon: "fa-solid fa-hand", title: game.i18n.localize("KT.Theft.Title"), tone: "failure", lines: [line] }, { whisper: [...new Set([...gmIds(), card.userId])] });
  broadcast(MESSAGES.SHOP_CHANGED, { merchant: merchant.uuid });
  return choice;
}

// The thief buys the item at twice what it costs them. Answers the amount paid.
/**
 * @param {any} merchant
 * @param {any} customer
 * @param {string} itemId
 */
async function payDouble(merchant, customer, itemId) {
  const entry = visibleShelf(merchant, customer).find((e) => e.item.id === itemId);
  if (!entry || entry.price === null) throw new TradeError("KT.Error.SoldOut");
  const unit = buyQuote(entry.price, priceContextFor(merchant, customer), entry.flags.limited, shelfView(entry)).copper;
  const price = unit * getTables().theft.fine;
  const money = { locale: locale(), labels: coinLabels() };
  const coins = payFrom(purse(customer), price);
  if (!coins) throw new TradeError("KT.Theft.CannotPay", { name: customer.name, price: formatCopper(price, money) });
  await moveAll({
    currency: [
      [customer, addCoins(purse(customer), coins, -1)],
      [merchant, addCoins(purse(merchant), coins)],
    ],
    moves: [{ from: merchant, to: customer, lines: [{ item: entry.item, quantity: 1, unit: price, held: entry.holding.quantity }] }],
  });
  broadcast(MESSAGES.TRADE_DONE, { merchant: merchant.uuid, customer: customer.uuid });
  return formatCopper(price, money);
}

// Gives the recognized item to the merchant for nothing.
/**
 * @param {any} merchant
 * @param {any} seller
 * @param {string} itemId
 */
async function confiscate(merchant, seller, itemId) {
  const item = seller.items.get(itemId);
  if (!item) throw new TradeError("KT.Error.SoldOut");
  const held = holdingFacts(item).quantity;
  const home = itemFlags(item).stolen?.source === merchant.uuid;
  await moveAll({ currency: [], moves: [{ from: seller, to: merchant, lines: [{ item, quantity: held, unit: 0, held, ...(home ? { stolen: null } : {}) }] }] });
  broadcast(MESSAGES.TRADE_DONE, { merchant: merchant.uuid, customer: seller.uuid });
}

// Bans the customer until the next in-game day.
/**
 * @param {any} merchant
 * @param {any} customer
 */
async function ban(merchant, customer) {
  const { now, day } = clock();
  await merchant.update({ [`flags.${MODULE_ID}.banned.${customer.id}`]: lockUntil(now, day) });
  if (sessionAt(merchant.uuid)?.customer === customer.uuid) endSessionAt(merchant.uuid);
}

// GM side, at a restock: the merchant notices what went missing and blames its last customer.
/** @param {any} merchant */
export async function noticeThefts(merchant) {
  const flags = merchantFlags(merchant);
  if (!flags.thefts.length) return;
  const last = lastCustomer(flags.visits);
  const blamed = flags.thefts.filter((theft) => theft.actor === last);
  const grudges = { ...flags.grudges };
  if (last && blamed.length) grudges[last] = (grudges[last] ?? 0) + blamed.length;
  await merchant.update({ [`flags.${MODULE_ID}.thefts`]: [], [`flags.${MODULE_ID}.grudges`]: grudges });
  const items = flags.thefts.map((theft) => theft.item).join(", ");
  const lines = [game.i18n.localize("KT.Theft.Card.Noticed", { merchant: merchant.name, items })];
  if (blamed.length) lines.push(game.i18n.localize("KT.Theft.Card.Blamed", { name: blamed[0].name, value: getTables().attitude.events.theftNoticed * blamed.length }));
  await whisperNote(merchant, { icon: "fa-solid fa-magnifying-glass", title: game.i18n.localize("KT.Theft.Title"), tone: "failure", lines });
}

function gmIds() {
  return game.users.filter((user) => user.isGM).map((user) => user.id);
}
