// Visits on the merchant: who in the party has stood at the counter, when, and what they traded.
// Documents are typed any here because their schema fields have no generated types.
import { MODULE_ID } from "../constants.mjs";
import { clock } from "../adapter/dnd5e.mjs";
import { merchantFlags } from "../data/flags.mjs";
import { addTraded, lastVisit, visitNote } from "../engine/visits.mjs";
import { getTables } from "../settings.mjs";

/** @import { VisitLine, VisitRecord } from "../engine/visits.mjs"; */

// Ids of every character a player owns.
export function partyIds() {
  return /** @type {any[]} */ (game.actors.contents).filter((actor) => actor.type === "character" && actor.hasPlayerOwner).map((actor) => actor.id);
}

/** @param {any} merchant */
export function partyLastVisit(merchant) {
  return lastVisit(merchantFlags(merchant).visits, partyIds());
}

/** @param {any} merchant */
export function metByParty(merchant) {
  return partyLastVisit(merchant) !== null;
}

// GM side: a player character stood at the merchant now.
/**
 * @param {any} merchant
 * @param {any} customer
 */
export async function recordVisit(merchant, customer) {
  if (!customer.hasPlayerOwner) return;
  await merchant.update({ [`flags.${MODULE_ID}.visits.${customer.id}.last`]: game.time.worldTime });
}

// The note for a character coming back, read before this visit is recorded.
/**
 * @param {any} merchant
 * @param {any} customer
 */
export function noteFor(merchant, customer) {
  return visitNote(merchantFlags(merchant).visits[customer.id], clock());
}

// GM side: what each player character sold and bought in a trade joins their visit record.
/**
 * @param {any} merchant
 * @param {{ actor: any, sold: VisitLine[], bought: VisitLine[], fresh: boolean }[]} parts
 */
export async function recordTraded(merchant, parts) {
  const visits = merchantFlags(merchant).visits;
  const max = getTables().visits.remember;
  /** @type {Record<string, VisitRecord>} */
  const changes = {};
  for (const { actor, sold, bought, fresh } of parts) {
    const record = visits[actor.id];
    if (!actor.hasPlayerOwner || !record || (!sold.length && !bought.length)) continue;
    changes[`flags.${MODULE_ID}.visits.${actor.id}`] = addTraded(record, { sold, bought, now: game.time.worldTime, max, fresh });
  }
  if (Object.keys(changes).length) await merchant.update(changes);
}
