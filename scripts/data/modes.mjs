// Features each complexity mode turns on.
export const MODE_FEATURES = {
  simple: {
    purseLimit: false,
    attitude: false,
    haggle: false,
    rolledInsight: false,
    appraisal: false,
    theft: false,
    wanted: false,
    market: false,
  },
  standard: {
    purseLimit: true,
    attitude: true,
    haggle: true,
    rolledInsight: false,
    appraisal: true,
    theft: false,
    wanted: true,
    market: false,
  },
  crunchy: {
    purseLimit: true,
    attitude: true,
    haggle: true,
    rolledInsight: true,
    appraisal: true,
    theft: false,
    wanted: true,
    market: true,
  },
};

/** @typedef {keyof typeof MODE_FEATURES.standard} Feature */

/** @type {Feature[]} */
export const FEATURES = /** @type {Feature[]} */ (Object.keys(MODE_FEATURES.standard));

// The mode's preset with the GM's changes for that mode laid over it. Unknown modes fall back to Standard.
/**
 * @param {string} mode
 * @param {Record<string, Record<string, boolean>>} changes
 * @returns {Record<Feature, boolean>}
 */
export function featuresFor(mode, changes = {}) {
  const preset = MODE_FEATURES[mode] ?? MODE_FEATURES.standard;
  const own = changes[mode] ?? {};
  return /** @type {Record<Feature, boolean>} */ (Object.fromEntries(FEATURES.map((name) => [name, typeof own[name] === "boolean" ? own[name] : preset[name]])));
}

// Only the toggles that differ from the preset, so a later change to a preset still reaches the world.
/**
 * @param {string} mode
 * @param {Record<string, boolean>} chosen
 * @returns {Record<string, boolean>}
 */
export function changesFrom(mode, chosen) {
  const preset = MODE_FEATURES[mode] ?? MODE_FEATURES.standard;
  return Object.fromEntries(FEATURES.filter((name) => Boolean(chosen[name]) !== preset[name]).map((name) => [name, Boolean(chosen[name])]));
}
