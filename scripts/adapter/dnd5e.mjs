// Every read of dnd5e data, as plain facts for the engines.
// Documents, CONFIG.DND5E and calendar data are typed any here because their schema fields have no generated types.
import { COPPER } from "../engine/money.mjs";

/** @import { ItemFacts } from "../engine/pricing.mjs"; */
/** @import { Clock } from "../engine/attitude.mjs"; */

/**
 * @typedef {object} HoldingFacts
 * @property {number} quantity
 * @property {boolean} equipped
 * @property {boolean} attuned
 * @property {string | null} container
 * @property {number} contents
 */

// Skill keys the module rolls or reads.
export const SKILLS = Object.freeze({
  arcana: "arc",
  deception: "dec",
  history: "his",
  insight: "ins",
  intimidation: "itm",
  investigation: "inv",
  medicine: "med",
  nature: "nat",
  perception: "prc",
  performance: "prf",
  persuasion: "per",
  religion: "rel",
  sleightOfHand: "slt",
  survival: "sur",
});

/** @returns {"modern" | "legacy"} */
export function rulesVersion() {
  return game.settings.get("dnd5e", "rulesVersion") === "legacy" ? "legacy" : "modern";
}

/**
 * @param {any} item
 * @returns {ItemFacts}
 */
export function itemFacts(item) {
  const system = item.system ?? {};
  const type = item.type === "backpack" ? "container" : item.type;
  const subtype = system.type?.value ?? "";
  const scroll = type === "consumable" && subtype === "scroll";
  return {
    type,
    subtype,
    price: { value: Number(system.price?.value) || 0, denomination: system.price?.denomination || "gp" },
    rarity: system.rarity || undefined,
    scroll,
    spellLevel: scroll ? scrollLevel(item) : null,
    magicalBonus: Number(system.magicalBonus) || 0,
    attunement: system.attunement === "required",
    magical: hasProperty(system.properties, "mgc"),
    identified: system.identified !== false,
  };
}

/**
 * @param {any} item
 * @returns {HoldingFacts}
 */
export function holdingFacts(item) {
  const system = item.system ?? {};
  const contents = system.contents;
  return {
    quantity: Math.max(0, Math.floor(Number(system.quantity) || 0)),
    equipped: Boolean(system.equipped),
    attuned: Boolean(system.attuned),
    container: system.container || null,
    contents: typeof contents?.size === "number" ? contents.size : 0,
  };
}

/**
 * @param {any} actor
 * @returns {Record<string, number>}
 */
export function purse(actor) {
  const currency = actor.system?.currency ?? {};
  return Object.fromEntries(Object.keys(COPPER).map((coin) => [coin, Math.max(0, Math.floor(Number(currency[coin]) || 0))]));
}

/**
 * @param {any} actor
 * @param {string} skill
 */
export function passiveScore(actor, skill) {
  const passive = actor.system?.skills?.[skill]?.passive;
  return Number.isFinite(passive) ? passive : 10;
}

// Coin abbreviations in the reader's language.
/** @returns {Record<string, string>} */
export function coinLabels() {
  return Object.fromEntries(
    Object.entries(/** @type {any} */ (CONFIG).DND5E.currencies).map(([coin, config]) => [coin, game.i18n.localize(config.abbreviation)]),
  );
}

export function locale() {
  return game.i18n.lang;
}

/** @returns {Clock} */
export function clock() {
  const { days } = /** @type {any} */ (game.time.calendar);
  const day = days.secondsPerMinute * days.minutesPerHour * days.hoursPerDay;
  return { now: game.time.worldTime, day, week: day * Math.max(1, days.values.length) };
}

// Spell level in a scroll's name, such as "Spell Scroll (3rd Level)", "Spell Scroll, Level 1" or "Spell Scroll (Cantrip)".
/** @param {string} name */
export function levelFromName(name) {
  if (/cantrip/i.test(name)) return 0;
  const match = name.match(/\b([1-9])(?:st|nd|rd|th)\b/i) ?? name.match(/\blevel\s*([1-9])\b/i);
  return match ? Number(match[1]) : null;
}

/** @param {any} item */
function scrollLevel(item) {
  for (const activity of item.system?.activities ?? []) {
    if (activity.type !== "cast") continue;
    if (Number.isInteger(activity.spell?.level)) return activity.spell.level;
    /** @type {any} */
    const spell = activity.spell?.uuid ? foundry.utils.fromUuidSync(activity.spell.uuid, { strict: false }) : null;
    if (Number.isInteger(spell?.system?.level)) return spell.system.level;
  }
  return levelFromName(item.name ?? "");
}

/**
 * @param {Set<string> | string[] | undefined} properties
 * @param {string} key
 */
function hasProperty(properties, key) {
  if (!properties) return false;
  return properties instanceof Set ? properties.has(key) : properties.includes(key);
}
