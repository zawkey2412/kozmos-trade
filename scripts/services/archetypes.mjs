// Archetypes: the defaults, ones other modules register, and the GM's own changes.
import { MODULE_ID, SETTINGS } from "../constants.mjs";
import { ARCHETYPES } from "../data/archetypes.mjs";
import { cleanArchetype } from "../engine/fit.mjs";

/** @import { Archetype } from "../engine/fit.mjs"; */

const ID_PATTERN = /^[a-z][a-zA-Z0-9-]*$/;

/** @type {Map<string, Archetype>} */
const registered = new Map();

/** @type {Record<string, Archetype> | null} */
let cache = null;

export function forgetArchetypes() {
  cache = null;
}

/**
 * @param {string} id
 * @param {object} config
 */
export function registerArchetype(id, config) {
  if (typeof id !== "string" || !ID_PATTERN.test(id)) throw new Error(`"${id}" is not a valid archetype id`);
  registered.set(id, cleanArchetype(config));
  forgetArchetypes();
}

// Archetypes before the GM's changes.
/** @returns {Record<string, Archetype>} */
export function baseArchetypes() {
  return { ...structuredClone(ARCHETYPES), ...structuredClone(Object.fromEntries(registered)) };
}

/** @returns {Record<string, Archetype>} */
export function getArchetypes() {
  if (cache) return cache;
  const all = baseArchetypes();
  const changes = game.settings.get(MODULE_ID, SETTINGS.ARCHETYPES) ?? {};
  for (const [id, change] of Object.entries(changes)) {
    try {
      all[id] = cleanArchetype(change);
    } catch (error) {
      console.warn(`Kozmos Trade | Archetype "${id}" was skipped`, error);
    }
  }
  return all;
}

/** @param {string} id */
export function isBuiltIn(id) {
  return id in ARCHETYPES || registered.has(id);
}

/** @param {string} id */
export function archetypeLabel(id) {
  const archetype = getArchetypes()[id];
  if (archetype?.label) return archetype.label;
  const key = `KT.Archetype.${id}`;
  return game.i18n.has(key) ? game.i18n.localize(key) : id;
}

// Stores only what differs from the defaults and registered archetypes.
/** @param {Record<string, Archetype>} archetypes */
export async function saveArchetypes(archetypes) {
  const base = baseArchetypes();
  /** @type {Record<string, Archetype>} */
  const changes = {};
  for (const [id, archetype] of Object.entries(archetypes)) {
    if (!ID_PATTERN.test(id)) throw new Error(`"${id}" is not a valid archetype id`);
    const clean = cleanArchetype(archetype);
    if (base[id] && JSON.stringify(cleanArchetype(base[id])) === JSON.stringify(clean)) continue;
    changes[id] = clean;
  }
  await game.settings.set(MODULE_ID, SETTINGS.ARCHETYPES, changes);
}

export const ARCHETYPE_ID = ID_PATTERN;
