// Merchant reaction lines: which situation the trade is in, and a line for it by attitude band.

/** @type {readonly string[]} */
export const SITUATIONS = Object.freeze(["greeting", "empty", "short", "even", "generous"]);
/** @type {readonly string[]} */
export const BANDS = Object.freeze(["hostile", "cold", "neutral", "warm", "friendly"]);

/** @typedef {Record<string, Record<string, string[]>>} ReactionLines */

// The situation an offer is in.
/**
 * @param {{ state: "short" | "even" | "generous" }} result
 * @param {boolean} empty
 */
export function situationOf(result, empty) {
  return empty ? "empty" : result.state;
}

// The archetype's own lines first, then the defaults for the band, then the neutral defaults.
/**
 * @param {string} situation
 * @param {string} band
 * @param {{ own?: ReactionLines, defaults: ReactionLines }} lines
 * @returns {string[]}
 */
export function linesFor(situation, band, { own, defaults }) {
  const candidates = [own?.[situation]?.[band], defaults[situation]?.[band], defaults[situation]?.neutral];
  return candidates.find((list) => Array.isArray(list) && list.length) ?? [];
}

/**
 * @param {string[]} lines
 * @param {() => number} random
 */
export function pickLine(lines, random) {
  return lines.length ? lines[Math.floor(random() * lines.length)] : null;
}

// Takes any value because it comes from the archetype editor and other modules.
/**
 * @param {unknown} value
 * @returns {ReactionLines}
 */
export function cleanReactions(value) {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Reaction lines must be an object of situations");
  /** @type {ReactionLines} */
  const clean = {};
  for (const [situation, bands] of Object.entries(value)) {
    if (!SITUATIONS.includes(situation)) throw new Error(`"${situation}" is not a situation. Use ${SITUATIONS.join(", ")}`);
    if (!bands || typeof bands !== "object" || Array.isArray(bands)) throw new Error(`"${situation}" must be an object of attitude bands`);
    clean[situation] = {};
    for (const [band, lines] of Object.entries(bands)) {
      if (!BANDS.includes(band)) throw new Error(`"${band}" is not an attitude band. Use ${BANDS.join(", ")}`);
      if (!Array.isArray(lines) || !lines.every((line) => typeof line === "string")) throw new Error(`"${situation}.${band}" must be a list of text`);
      clean[situation][band] = lines.map((line) => line.trim()).filter(Boolean);
    }
  }
  return clean;
}
