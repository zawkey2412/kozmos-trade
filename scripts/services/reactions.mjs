// Reaction lines in the reader's language, with the archetype's own lines first.
import { linesFor, pickLine } from "../engine/reactions.mjs";
import { getArchetypes } from "./archetypes.mjs";

/** @import { ReactionLines } from "../engine/reactions.mjs"; */

// The default lines from the language file, or English when a language has none.
/** @returns {ReactionLines} */
function defaultLines() {
  // The translation tables have no generated types.
  const i18n = /** @type {any} */ (game.i18n);
  return foundry.utils.getProperty(i18n.translations, "KT.Reactions") ?? foundry.utils.getProperty(i18n._fallback, "KT.Reactions") ?? {};
}

/**
 * @param {string} archetypeId
 * @param {string} situation
 * @param {string} band
 */
export function reactionLine(archetypeId, situation, band) {
  const own = getArchetypes()[archetypeId]?.reactions;
  return pickLine(linesFor(situation, band, { own, defaults: defaultLines() }), Math.random);
}
