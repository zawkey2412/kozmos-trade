// Attitude on the merchant: who it belongs to, its value now, and changes written by the GM.
// Documents are typed any here because their schema fields have no generated types.
import { MODULE_ID, SETTINGS } from "../constants.mjs";
import { clock } from "../adapter/dnd5e.mjs";
import { merchantFlags } from "../data/flags.mjs";
import { attitudeBand, changeAttitude, currentAttitude, setAttitudeValue } from "../engine/attitude.mjs";
import { feature, getTables } from "../settings.mjs";
import { TradeError } from "./errors.mjs";
import { broadcast, MESSAGES } from "./socket.mjs";

/** @import { AttitudeEvent, AttitudeState } from "../engine/attitude.mjs"; */

export const PARTY_KEY = "party";

export const ATTITUDE_ICONS = Object.freeze({
  hostile: "fa-regular fa-face-angry",
  cold: "fa-regular fa-face-frown",
  neutral: "fa-regular fa-face-meh",
  warm: "fa-regular fa-face-smile",
  friendly: "fa-regular fa-face-grin-beam",
});

// Attitude tables with the world's decay setting.
export function attitudeTables() {
  const tables = getTables().attitude;
  return { ...tables, decay: { ...tables.decay, enabled: Boolean(game.settings.get(MODULE_ID, SETTINGS.ATTITUDE_DECAY)) } };
}

// One score per character, or one for the whole party.
/** @param {any} customer */
export function attitudeKey(customer) {
  return game.settings.get(MODULE_ID, SETTINGS.ATTITUDE_SCOPE) === "party" ? PARTY_KEY : customer.id;
}

/**
 * @param {any} merchant
 * @param {string} key
 * @returns {AttitudeState}
 */
export function attitudeStateOf(merchant, key) {
  return currentAttitude(merchantFlags(merchant).attitude[key], clock(), attitudeTables());
}

// The value prices and access use: 0 when attitude is off.
/**
 * @param {any} merchant
 * @param {any} customer
 */
export function attitudeValue(merchant, customer) {
  if (!feature("attitude")) return 0;
  return attitudeStateOf(merchant, attitudeKey(customer)).value;
}

/**
 * @param {any} merchant
 * @param {any} customer
 */
export function attitudeBandOf(merchant, customer) {
  return attitudeBand(attitudeValue(merchant, customer), attitudeTables());
}

// Applies events for a customer and saves the result. Answers the change in points.
/**
 * @param {any} merchant
 * @param {any} customer
 * @param {(AttitudeEvent | { gain: number })[]} events
 */
export async function recordAttitude(merchant, customer, events) {
  if (!feature("attitude") || !events.length) return 0;
  const key = attitudeKey(customer);
  const { state, change } = changeAttitude(merchantFlags(merchant).attitude[key], events, clock(), attitudeTables());
  await merchant.update({ [`flags.${MODULE_ID}.attitude.${key}`]: state });
  return change;
}

// Who the GM can set attitude for: the party, or every player character and anyone the merchant already knows.
/** @param {any} merchant */
export function attitudeRows(merchant) {
  const tables = attitudeTables();
  /** @param {string} key @param {string} name */
  const row = (key, name) => {
    const value = attitudeStateOf(merchant, key).value;
    const band = attitudeBand(value, tables);
    return { key, name, value, band, icon: ATTITUDE_ICONS[band], label: game.i18n.localize(`KT.Attitude.${band}`) };
  };
  if (game.settings.get(MODULE_ID, SETTINGS.ATTITUDE_SCOPE) === "party") return [row(PARTY_KEY, game.i18n.localize("KT.Attitude.Party"))];
  const actors = /** @type {any[]} */ (game.actors.contents);
  const known = new Set(Object.keys(merchantFlags(merchant).attitude));
  return actors
    .filter((actor) => known.has(actor.id) || (actor.type === "character" && actor.hasPlayerOwner))
    .sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang))
    .map((actor) => row(actor.id, actor.name));
}

// The GM sets a value by hand, for an actor, an actor id or the party key.
/**
 * @param {any} merchant
 * @param {any | string} customer
 * @param {number} value
 */
export async function setAttitude(merchant, customer, value) {
  if (!game.user.isGM) throw new TradeError("KT.Error.GMOnly");
  if (!merchantFlags(merchant).enabled) throw new TradeError("KT.Error.NotShop", { name: merchant.name });
  const key = typeof customer === "string" ? customer : attitudeKey(customer);
  const state = setAttitudeValue(merchantFlags(merchant).attitude[key], value, clock(), attitudeTables());
  await merchant.update({ [`flags.${MODULE_ID}.attitude.${key}`]: state });
  broadcast(MESSAGES.SHOP_CHANGED, { merchant: merchant.uuid });
  return state.value;
}
