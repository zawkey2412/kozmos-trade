// Visits on the merchant: who in the party has stood at the counter, and when.
// Documents are typed any here because their schema fields have no generated types.
import { MODULE_ID } from "../constants.mjs";
import { merchantFlags } from "../data/flags.mjs";
import { lastVisit } from "../engine/visits.mjs";

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
  await merchant.update({ [`flags.${MODULE_ID}.visits.${customer.id}`]: { last: game.time.worldTime } });
}
