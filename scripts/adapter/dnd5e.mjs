// Every read of dnd5e data, as plain facts for the engines.
// Documents, CONFIG.DND5E and calendar data are typed any here because their schema fields have no generated types.
import { COPPER } from "../engine/money.mjs";

/** @import { ItemFacts } from "../engine/pricing.mjs"; */
/** @import { Clock } from "../engine/attitude.mjs"; */
/** @import { TokenBox } from "../engine/access.mjs"; */
/** @import { SizeFacts } from "../engine/theft.mjs"; */

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
    baseItem: system.type?.baseItem ?? "",
    price: { value: Number(system.price?.value) || 0, denomination: system.price?.denomination || "gp" },
    rarity: rarityKey(system.rarity) || undefined,
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

// The compendium entry an item was copied from, when known.
/** @param {any} item */
export function itemSource(item) {
  return item._stats?.compendiumSource ?? item.flags?.core?.sourceId ?? null;
}

// The full skill bonus, for a merchant's rolled Insight.
/**
 * @param {any} actor
 * @param {string} skill
 */
export function skillBonus(actor, skill) {
  const total = actor.system?.skills?.[skill]?.total;
  return Number.isFinite(total) ? total : 0;
}

/** @param {string} skill */
export function skillLabel(skill) {
  return /** @type {any} */ (CONFIG).DND5E.skills[skill]?.label ?? skill;
}

/** @param {string} tool */
export function toolLabel(tool) {
  // dnd5e's global namespace has no generated types.
  const label = /** @type {any} */ (globalThis).dnd5e?.documents?.Trait?.keyLabel?.(tool, { trait: "tool" });
  return label || tool;
}

// Whether the actor has the tool on its sheet.
/**
 * @param {any} actor
 * @param {string} tool
 */
export function hasTool(actor, tool) {
  return Boolean(actor.system?.tools?.[tool]);
}

// A skill or tool check through dnd5e, with its chat message carrying the given flags. Answers the message, or null if cancelled.
/**
 * @param {any} actor
 * @param {{ skill?: string, tool?: string, advantage?: boolean, flags?: object, event?: Event, secret?: boolean }} check
 */
export async function rollCheck(actor, { skill, tool, advantage = false, flags = {}, event, secret = false }) {
  const config = { advantage, event, ...(tool ? { tool } : { skill }) };
  const message = { data: { flags }, ...(secret ? { rollMode: "gm" } : {}) };
  const rolls = tool ? await actor.rollToolCheck(config, {}, message) : await actor.rollSkill(config, {}, message);
  return rolls?.[0]?.parent ?? null;
}

// Type, weight in pounds and weapon properties, for what fits in a pocket.
/**
 * @param {any} item
 * @returns {SizeFacts}
 */
export function sizeFacts(item) {
  const system = item.system ?? {};
  const value = Number(system.weight?.value) || 0;
  const units = system.weight?.units || "lb";
  // dnd5e's global namespace has no generated types.
  const convert = /** @type {any} */ (globalThis).dnd5e?.utils?.convertWeight;
  const pounds = units === "lb" || !convert ? value : Number(convert(value, units, { to: "lb", legacy: false })?.value) || value;
  const properties = system.properties ? [...system.properties] : [];
  return { type: item.type === "backpack" ? "container" : item.type, subtype: system.type?.value ?? "", weight: pounds, properties: item.type === "weapon" ? properties : [] };
}

// The description a customer may read: the unidentified one until the item is identified.
/** @param {any} item */
export function itemDescription(item) {
  const system = item.system ?? {};
  if (system.identified === false) return system.unidentified?.description ?? "";
  return system.description?.value ?? "";
}

// Where an actor stands: its own token when unlinked, every linked token otherwise.
/**
 * @param {any} actor
 * @returns {{ scene: string, gridSize: number, box: TokenBox }[]}
 */
export function tokensOf(actor) {
  const tokens = actor.isToken
    ? [actor.token]
    : /** @type {any[]} */ (game.scenes.contents).flatMap((scene) => scene.tokens.filter((token) => token.actorLink && token.actorId === actor.id));
  return tokens.filter(Boolean).map((token) => ({
    scene: token.parent.id,
    gridSize: token.parent.grid.size,
    box: { x: token.x, y: token.y, width: token.width, height: token.height },
  }));
}

// Weapon damage and armor class, to compare with what a character has equipped.
/**
 * @param {any} item
 * @returns {{ damage: string | null, ac: number | null }}
 */
export function combatStats(item) {
  const system = item.system ?? {};
  const armor = item.type === "equipment" && ["light", "medium", "heavy", "shield"].includes(system.type?.value);
  return {
    damage: item.type === "weapon" ? (system.damage?.base?.formula || null) : null,
    ac: armor && Number.isFinite(system.armor?.value) ? system.armor.value : null,
  };
}

/** @param {string} rarity */
export function rarityLabel(rarity) {
  return rarity ? game.i18n.localize(/** @type {any} */ (CONFIG).DND5E.itemRarity?.[rarity] ?? rarity) : "";
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

// The rarity key, also from older data written as "Very Rare".
/** @param {unknown} rarity */
export function rarityKey(rarity) {
  const plain = String(rarity ?? "").replace(/[\s_-]+/g, "").toLowerCase();
  return { common: "common", uncommon: "uncommon", rare: "rare", veryrare: "veryRare", legendary: "legendary", artifact: "artifact" }[plain] ?? "";
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
