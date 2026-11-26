// Appraising unpriced loot on the active GM: one roll per item a day, settled from the customer's own roll message.
// Documents are typed any here because their schema fields have no generated types.
import { MODULE_ID } from "../constants.mjs";
import { itemFacts, rulesVersion, skillLabel } from "../adapter/dnd5e.mjs";
import { merchantFlags } from "../data/flags.mjs";
import { appraisalDC, appraisalKey, appraisalState } from "../engine/appraisal.mjs";
import { baseValue, sellBasis } from "../engine/pricing.mjs";
import { feature, getTables } from "../settings.mjs";
import { TradeError } from "./errors.mjs";
import { postCheckCard } from "./haggle.mjs";
import { expectRoll, registerRollKind } from "./rolls.mjs";
import { appraisalView, checkVisit, currentDay, resolvePair, sessionAt } from "./session.mjs";
import { MESSAGES, onRequest } from "./socket.mjs";

/** @import { ExpectedRoll } from "./rolls.mjs"; */

export const APPRAISE_ROLL = "appraise";

export function registerAppraisalHandlers() {
  onRequest(MESSAGES.APPRAISE_START, startAppraisal, { queueKey: (payload) => payload?.merchant });
  registerRollKind(APPRAISE_ROLL, settleAppraisal);
}

// Whether the merchant only offers scrap for this item.
/** @param {any} item */
export function offersScrap(item) {
  const tables = getTables().pricing;
  const facts = itemFacts(item);
  return sellBasis(facts, baseValue(facts, tables, { rules: rulesVersion() }), tables).scrap;
}

/**
 * @param {{ merchant: string, customer: string, itemId: string, skill: string }} payload
 * @param {any} sender
 */
async function startAppraisal({ merchant: merchantUuid, customer: customerUuid, itemId, skill }, sender) {
  const { merchant, customer } = await resolvePair(merchantUuid, customerUuid, sender);
  if (sessionAt(merchant.uuid)?.customer !== customer.uuid) throw new TradeError("KT.Error.NotInSession");
  checkVisit(merchant, customer, sender);
  if (!feature("appraisal")) throw new TradeError("KT.Appraise.Off");
  const item = customer.items.get(itemId);
  if (!item || !offersScrap(item)) throw new TradeError("KT.Appraise.NotScrap");
  const record = merchantFlags(merchant).appraisals[appraisalKey(customer.id, item.id)];
  const state = appraisalState(record, currentDay());
  if (state) throw new TradeError(state === "appraised" ? "KT.Appraise.Done" : "KT.Appraise.Tomorrow", { name: item.name });
  const tables = getTables().appraisal;
  if (!tables.skills.includes(skill)) throw new TradeError("KT.Appraise.BadSkill");
  const dc = appraisalDC(itemFacts(item), tables);
  const nonce = expectRoll({ kind: APPRAISE_ROLL, merchant: merchant.uuid, customer: customer.uuid, userId: sender.id, data: { itemId: item.id, skill, dc } });
  return { nonce, dc, skill };
}

/**
 * @param {ExpectedRoll} entry
 * @param {number} total
 */
async function settleAppraisal(entry, total) {
  const { itemId, skill, dc } = /** @type {{ itemId: string, skill: string, dc: number }} */ (entry.data);
  const merchant = /** @type {any} */ (await foundry.utils.fromUuid(entry.merchant));
  const customer = /** @type {any} */ (await foundry.utils.fromUuid(entry.customer));
  const item = customer.items.get(itemId);
  const success = total >= dc;
  await merchant.update({ [`flags.${MODULE_ID}.appraisals.${appraisalKey(customer.id, itemId)}`]: { day: currentDay(), success } });
  const lines = [
    game.i18n.localize("KT.Appraise.Card.Ask", { customer: foundry.utils.escapeHTML(customer.name), item: foundry.utils.escapeHTML(item?.name ?? ""), check: skillLabel(skill) }),
    game.i18n.localize("KT.Haggle.Card.Dc", { dc, total }),
    game.i18n.localize(success ? "KT.Appraise.Card.Success" : "KT.Appraise.Card.Failure"),
  ];
  await postCheckCard(merchant, lines, success, "appraiseResult");
  return { success, dc, total, appraisal: appraisalView(merchant, customer) };
}
