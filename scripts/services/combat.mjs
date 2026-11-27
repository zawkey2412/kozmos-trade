// Combat: whether a character or merchant is fighting, and whether that stops a new trade.
// Documents are typed any here because their schema fields have no generated types.
import { MODULE_ID, SETTINGS } from "../constants.mjs";

// Whether an actor is a combatant in a combat that has started.
/** @param {any} actor */
export function inCombat(actor) {
  if (!actor) return false;
  return /** @type {any[]} */ (game.combats.contents).some((combat) => combat.started && combat.combatants.some((/** @type {any} */ combatant) => combatant.actor?.uuid === actor.uuid));
}

// Whether the No trading during combat setting stops these actors from starting a trade.
/** @param {...any} actors */
export function combatBlocks(...actors) {
  return Boolean(game.settings.get(MODULE_ID, SETTINGS.NO_COMBAT)) && actors.some(inCombat);
}
