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
import { expectRoll, registerRollKind } from "./rolls.mjs";
import { checkAccess, haggleView, resolvePair, sessionAt } from "./session.mjs";
import { MESSAGES, onRequest } from "./socket.mjs";

/** @import { ExpectedRoll } from "./rolls.mjs"; */

/**
 * @typedef {object} HaggleAsk
 * @property {number} ask
 * @property {string | null} skill
 * @property {string | null} tool
 * @property {boolean} helped
 */

// Skills anyone can haggle with. The archetype's own skills and tools come on top.
export const HAGGLE_SKILLS = Object.freeze(["per", "dec", "itm"]);
export const HAGGLE_ROLL = "haggle";

export function registerHaggleHandlers() {
  onRequest(MESSAGES.HAGGLE_START, startHaggle, { queueKey: (payload) => payload?.merchant });
  registerRollKind(HAGGLE_ROLL, settleHaggle);
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
  if (sessionAt(merchant.uuid)?.customer !== customer.uuid) throw new TradeError("KT.Error.NotInSession");
  if (!sender.isGM) checkAccess(merchant, customer);
  if (!feature("haggle")) throw new TradeError("KT.Haggle.Off");
  const view = haggleView(merchant, customer);
  if (view.locked) throw new TradeError("KT.Haggle.Locked", { name: merchant.name });
  if (view.discount) throw new TradeError("KT.Haggle.Already");
  const chosenAsk = getTables().haggle.asks.find((value) => Math.abs(value - Number(ask)) < 1e-9);
  if (chosenAsk === undefined) throw new TradeError("KT.Haggle.BadAsk");
  const choice = haggleChoices(customer, merchantFlags(merchant).archetype).find((c) => c.value === check);
  if (!choice) throw new TradeError("KT.Haggle.BadCheck");
  const [kind, key] = check.split(":");
  /** @type {HaggleAsk} */
  const data = { ask: chosenAsk, skill: kind === "skill" ? key : null, tool: kind === "tool" ? key : null, helped: Boolean(helped) };
  const nonce = expectRoll({ kind: HAGGLE_ROLL, merchant: merchant.uuid, customer: customer.uuid, userId: sender.id, data });
  return { nonce, advantage: choice.specialty || data.helped, skill: data.skill, tool: data.tool };
}

/**
 * @param {ExpectedRoll} entry
 * @param {number} total
 */
async function settleHaggle(entry, total) {
  const data = /** @type {HaggleAsk} */ (entry.data);
  const session = sessionAt(entry.merchant);
  const merchant = /** @type {any} */ (await foundry.utils.fromUuid(entry.merchant));
  const customer = /** @type {any} */ (await foundry.utils.fromUuid(entry.customer));
  const tables = getTables();
  let insight = passiveScore(merchant, "ins");
  let opposed = false;
  if (feature("rolledInsight")) {
    const roll = await new foundry.dice.Roll("1d20 + @bonus", { bonus: skillBonus(merchant, "ins") }).evaluate();
    await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor: merchant }), flavor: game.i18n.localize("KT.Haggle.MerchantInsight") }, { messageMode: "gm" });
    insight = roll.total;
    opposed = true;
  }
  const dc = haggleDC({ insight, ask: data.ask, attitude: attitudeValue(merchant, customer) }, tables);
  const result = haggleResult({ total, dc, ask: data.ask, intimidation: data.skill === "itm" }, tables.haggle);
  if (result.success && session?.customer === entry.customer) session.haggle.discount = result.discount;
  if (!result.success) {
    const { now, day } = clock();
    await merchant.update({ [`flags.${MODULE_ID}.haggleLock.${customer.id}`]: lockUntil(now, day) });
  }
  const attitudeChange = await recordAttitude(merchant, customer, result.events);
  await postResult({ merchant, customer, data, dc, total, opposed, success: result.success, attitudeChange });
  return { success: result.success, discount: result.discount, dc, total, locked: result.locked, attitudeChange, haggle: haggleView(merchant, customer) };
}

/**
 * @param {{ merchant: any, customer: any, data: HaggleAsk, dc: number, total: number, opposed: boolean, success: boolean, attitudeChange: number }} result
 */
async function postResult({ merchant, customer, data, dc, total, opposed, success, attitudeChange }) {
  const percent = Math.round(data.ask * 100);
  const check = data.tool ? toolLabel(data.tool) : skillLabel(data.skill ?? "");
  const lines = [
    game.i18n.localize("KT.Haggle.Card.Ask", { customer: foundry.utils.escapeHTML(customer.name), percent, check }),
    ...(data.helped ? [game.i18n.localize("KT.Haggle.Card.Helped")] : []),
    game.i18n.localize(opposed ? "KT.Haggle.Card.Opposed" : "KT.Haggle.Card.Dc", { dc, total }),
    game.i18n.localize(success ? "KT.Haggle.Card.Success" : "KT.Haggle.Card.Failure", { percent }),
    ...(attitudeChange ? [game.i18n.localize("KT.Haggle.Card.Attitude", { change: `${attitudeChange > 0 ? "+" : ""}${attitudeChange}` })] : []),
  ];
  await postCheckCard(merchant, lines, success, "haggleResult");
}

// A public result card from the merchant, edged by the outcome.
/**
 * @param {any} merchant
 * @param {string[]} lines
 * @param {boolean} success
 * @param {string} flag
 */
export function postCheckCard(merchant, lines, success, flag) {
  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: merchant }),
    content: `<div class="${MODULE_ID} kt-check-card ${success ? "success" : "failure"}">${lines.map((line) => `<p>${line}</p>`).join("")}</div>`,
    flags: { [MODULE_ID]: { [flag]: true } },
  });
}
