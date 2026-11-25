// Haggling on the active GM: the ask is checked first, then the result comes from the customer's own roll message.
// Documents are typed any here because their schema fields have no generated types.
import { MODULE_ID } from "../constants.mjs";
import { clock, hasTool, passiveScore, skillBonus, skillLabel, toolLabel } from "../adapter/dnd5e.mjs";
import { merchantFlags } from "../data/flags.mjs";
import { haggleDC, haggleResult, lockUntil } from "../engine/haggle.mjs";
import { feature, getTables } from "../settings.mjs";
import { getArchetypes } from "./archetypes.mjs";
import { attitudeValue, recordAttitude } from "./attitude.mjs";
import { TradeError } from "./errors.mjs";
import { checkAccess, haggleView, resolvePair, sessionAt } from "./session.mjs";
import { isAnsweringWindow } from "./sessions.mjs";
import { MESSAGES, onRequest } from "./socket.mjs";

/** @import { PendingHaggle } from "./session.mjs"; */

// Skills anyone can haggle with. The archetype's own skills and tools come on top.
export const HAGGLE_SKILLS = Object.freeze(["per", "dec", "itm"]);
const ROLL_WAIT = 3000;

export function registerHaggleHandlers() {
  const queueKey = (/** @type {any} */ payload) => payload?.merchant;
  onRequest(MESSAGES.HAGGLE_START, startHaggle, { queueKey });
  onRequest(MESSAGES.HAGGLE_ROLL, finishHaggle, { queueKey });
  Hooks.on("createChatMessage", (message) => onRollMessage(message));
}

// The checks a customer may haggle with, and which give advantage.
/**
 * @param {any} customer
 * @param {string} archetypeId
 */
export function haggleChoices(customer, archetypeId) {
  const archetype = getArchetypes()[archetypeId];
  const specialty = new Set(archetype?.skills ?? []);
  const skills = [...new Set([...HAGGLE_SKILLS, ...specialty])].map((skill) => ({ value: `skill:${skill}`, label: skillLabel(skill), specialty: specialty.has(skill) }));
  const tools = (archetype?.tools ?? []).filter((tool) => hasTool(customer, tool)).map((tool) => ({ value: `tool:${tool}`, label: toolLabel(tool), specialty: true }));
  return [...skills, ...tools];
}

/**
 * @param {{ merchant: string, customer: string, ask: number, check: string, helped?: boolean }} payload
 * @param {any} sender
 */
async function startHaggle({ merchant: merchantUuid, customer: customerUuid, ask, check, helped }, sender) {
  const { merchant, customer } = await resolvePair(merchantUuid, customerUuid, sender);
  const session = sessionAt(merchant.uuid);
  if (session?.customer !== customer.uuid) throw new TradeError("KT.Error.NotInSession");
  if (!sender.isGM) checkAccess(merchant, customer);
  if (!feature("haggle")) throw new TradeError("KT.Haggle.Off");
  const view = haggleView(merchant, customer);
  if (view.locked) throw new TradeError("KT.Haggle.Locked", { name: merchant.name });
  if (view.discount) throw new TradeError("KT.Haggle.Already");
  const tables = getTables();
  const chosenAsk = tables.haggle.asks.find((value) => Math.abs(value - Number(ask)) < 1e-9);
  if (chosenAsk === undefined) throw new TradeError("KT.Haggle.BadAsk");
  const choice = haggleChoices(customer, merchantFlags(merchant).archetype).find((c) => c.value === check);
  if (!choice) throw new TradeError("KT.Haggle.BadCheck");
  const [kind, key] = check.split(":");
  /** @type {PendingHaggle} */
  const pending = {
    nonce: foundry.utils.randomID(),
    ask: chosenAsk,
    skill: kind === "skill" ? key : null,
    tool: kind === "tool" ? key : null,
    helped: Boolean(helped),
    userId: sender.id,
  };
  session.haggle.pending = pending;
  return { nonce: pending.nonce, advantage: choice.specialty || pending.helped, skill: pending.skill, tool: pending.tool };
}

// The window's own report of its roll. The roll message may already have settled it.
/**
 * @param {{ merchant: string, customer: string, nonce: string, messageId: string }} payload
 * @param {any} sender
 */
async function finishHaggle({ merchant, customer, nonce, messageId }, sender) {
  const session = sessionAt(merchant);
  if (session?.customer !== customer) throw new TradeError("KT.Error.NotInSession");
  for (let waited = 0; waited <= ROLL_WAIT; waited += 250) {
    if (session.haggle.last?.nonce === nonce) return session.haggle.last.outcome;
    const message = game.messages.get(messageId);
    if (message) {
      const outcome = await settleHaggle(merchant, message);
      if (outcome) return outcome;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new TradeError("KT.Haggle.NoRoll");
}

/** @param {any} message */
async function onRollMessage(message) {
  const flag = message.flags?.[MODULE_ID]?.haggle;
  if (!flag?.merchant || !game.users.activeGM?.isSelf || !(await isAnsweringWindow())) return;
  await settleHaggle(flag.merchant, message).catch((error) => console.error("Kozmos Trade | Haggle failed", error));
}

// Settles the pending haggle this message rolled for, once.
/**
 * @param {string} merchantUuid
 * @param {any} message
 */
async function settleHaggle(merchantUuid, message) {
  const session = sessionAt(merchantUuid);
  const pending = session?.haggle.pending;
  const flag = message.flags?.[MODULE_ID]?.haggle;
  if (!pending || flag?.nonce !== pending.nonce) return null;
  const author = message.author ?? game.users.get(message.user);
  if (author?.id !== pending.userId && !author?.isGM) return null;
  const total = message.rolls?.[0]?.total;
  if (!Number.isFinite(total)) return null;
  session.haggle.pending = null;

  const merchant = /** @type {any} */ (await foundry.utils.fromUuid(merchantUuid));
  const customer = /** @type {any} */ (await foundry.utils.fromUuid(session.customer));
  const tables = getTables();
  let insight = passiveScore(merchant, "ins");
  let opposedRoll = null;
  if (feature("rolledInsight")) {
    const roll = await new foundry.dice.Roll("1d20 + @bonus", { bonus: skillBonus(merchant, "ins") }).evaluate();
    await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor: merchant }), flavor: game.i18n.localize("KT.Haggle.MerchantInsight") }, { messageMode: "gm" });
    insight = roll.total;
    opposedRoll = roll.total;
  }
  const dc = haggleDC({ insight, ask: pending.ask, attitude: attitudeValue(merchant, customer) }, tables);
  const result = haggleResult({ total, dc, ask: pending.ask, intimidation: pending.skill === "itm" }, tables.haggle);
  if (result.success) session.haggle.discount = result.discount;
  else {
    const { now, day } = clock();
    await merchant.update({ [`flags.${MODULE_ID}.haggleLock.${customer.id}`]: lockUntil(now, day) });
  }
  const attitudeChange = await recordAttitude(merchant, customer, result.events);
  await postResult({ merchant, customer, pending, dc, total, opposedRoll, result, attitudeChange });
  const outcome = { success: result.success, discount: result.discount, dc, total, locked: result.locked, attitudeChange, haggle: haggleView(merchant, customer) };
  session.haggle.last = { nonce: pending.nonce, outcome };
  return outcome;
}

/**
 * @param {{ merchant: any, customer: any, pending: PendingHaggle, dc: number, total: number, opposedRoll: number | null, result: { success: boolean }, attitudeChange: number }} data
 */
async function postResult({ merchant, customer, pending, dc, total, opposedRoll, result, attitudeChange }) {
  const percent = Math.round(pending.ask * 100);
  const check = pending.tool ? toolLabel(pending.tool) : skillLabel(pending.skill ?? "");
  const lines = [
    game.i18n.localize("KT.Haggle.Card.Ask", { customer: foundry.utils.escapeHTML(customer.name), percent, check }),
    game.i18n.localize(opposedRoll === null ? "KT.Haggle.Card.Dc" : "KT.Haggle.Card.Opposed", { dc, total }),
    game.i18n.localize(result.success ? "KT.Haggle.Card.Success" : "KT.Haggle.Card.Failure", { percent }),
  ];
  if (pending.helped) lines.splice(1, 0, game.i18n.localize("KT.Haggle.Card.Helped"));
  if (attitudeChange) lines.push(game.i18n.localize("KT.Haggle.Card.Attitude", { change: `${attitudeChange > 0 ? "+" : ""}${attitudeChange}` }));
  const state = result.success ? "success" : "failure";
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: merchant }),
    content: `<div class="${MODULE_ID} kt-haggle-card ${state}">${lines.map((line) => `<p>${line}</p>`).join("")}</div>`,
    flags: { [MODULE_ID]: { haggleResult: true } },
  });
}

