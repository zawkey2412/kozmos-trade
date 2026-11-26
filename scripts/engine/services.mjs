// Services a merchant sells: what each one does, its price, and checking a service list.
import { COPPER } from "./money.mjs";

/** @typedef {"identify" | "note" | "effect"} ServiceKind */

/**
 * @typedef {object} ServiceEffect
 * @property {string} [name]
 * @property {string} [img]
 * @property {number} [days]
 * @property {{ key: string, type?: string, value: string }[]} [changes]
 * @property {string[]} [statuses]
 */

/**
 * @typedef {object} Service
 * @property {string} id
 * @property {ServiceKind} kind
 * @property {number} price
 * @property {string} [label]
 * @property {string} [icon]
 * @property {string} [note]
 * @property {string | { modern: string, legacy: string }} [heal]
 * @property {ServiceEffect} [effect]
 */

/** @type {readonly ServiceKind[]} */
export const SERVICE_KINDS = Object.freeze(["identify", "note", "effect"]);

const ID_PATTERN = /^[a-z][a-zA-Z0-9-]*$/;
const ICON_PATTERN = /^fa-(solid|regular) fa-[a-z0-9-]+$/;

// The tray key of a staged service: its id, and the item it works on.
/**
 * @param {string} id
 * @param {string | null} [target]
 */
export function serviceKey(id, target = null) {
  return target ? `${id}:${target}` : id;
}

/** @param {string} key */
export function parseServiceKey(key) {
  const [id, target = null] = String(key).split(":");
  return { id, target };
}

// The healing roll for the world's rules, if the service heals.
/**
 * @param {Service} service
 * @param {"modern" | "legacy"} rules
 */
export function healFormula(service, rules) {
  if (!service.heal) return null;
  return typeof service.heal === "string" ? service.heal : service.heal[rules] ?? null;
}

// Takes any value because services come from the archetype editor and other modules.
/**
 * @param {unknown} value
 * @returns {Service[]}
 */
export function cleanServices(value) {
  if (!Array.isArray(value)) throw new Error("Services must be a list");
  const services = value.map(cleanService);
  const ids = new Set();
  for (const service of services) {
    if (ids.has(service.id)) throw new Error(`"${service.id}" is listed twice`);
    ids.add(service.id);
  }
  return services;
}

// Prices from gold, as the archetype editor shows them, to copper.
/**
 * @param {unknown} value
 * @returns {unknown}
 */
export function servicesFromGold(value) {
  if (!Array.isArray(value)) return value;
  return value.map((service) => {
    if (!service || typeof service !== "object" || typeof service.price !== "number") return service;
    return { ...service, price: Math.round(service.price * COPPER.gp) };
  });
}

/** @param {Service[]} services */
export function servicesToGold(services) {
  return services.map((service) => ({ ...service, price: service.price / COPPER.gp }));
}

/**
 * @param {unknown} value
 * @returns {Service}
 */
function cleanService(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("A service must be an object");
  const source = /** @type {Record<string, any>} */ (value);
  for (const key of Object.keys(source)) {
    if (!["id", "kind", "price", "label", "icon", "note", "heal", "effect"].includes(key)) throw new Error(`"${key}" is not a service key`);
  }
  if (typeof source.id !== "string" || !ID_PATTERN.test(source.id)) throw new Error(`"${source.id}" is not a valid service id`);
  if (!SERVICE_KINDS.includes(source.kind)) throw new Error(`"${source.id}": kind must be ${SERVICE_KINDS.join(", ")}`);
  if (!Number.isInteger(source.price) || source.price < 0) throw new Error(`"${source.id}": price must be 0 or more`);
  /** @type {Service} */
  const clean = { id: source.id, kind: source.kind, price: source.price };
  for (const key of ["label", "note"]) {
    if (source[key] === undefined) continue;
    if (typeof source[key] !== "string") throw new Error(`"${source.id}": ${key} must be text`);
    if (source[key].trim()) clean[key] = source[key].trim();
  }
  if (source.icon !== undefined) {
    if (typeof source.icon !== "string" || !ICON_PATTERN.test(source.icon)) throw new Error(`"${source.id}": icon must look like "fa-solid fa-star"`);
    clean.icon = source.icon;
  }
  if (source.heal !== undefined) clean.heal = cleanHeal(source.id, source.heal);
  if (source.effect !== undefined) clean.effect = cleanEffect(source.id, source.effect);
  return clean;
}

/**
 * @param {string} id
 * @param {unknown} heal
 */
function cleanHeal(id, heal) {
  if (typeof heal === "string" && heal.trim()) return heal.replace(/\s+/g, "");
  const both = /** @type {Record<string, unknown>} */ (heal);
  if (heal && typeof heal === "object" && typeof both.modern === "string" && typeof both.legacy === "string") {
    return { modern: both.modern.replace(/\s+/g, ""), legacy: both.legacy.replace(/\s+/g, "") };
  }
  throw new Error(`"${id}": heal must be a roll such as "2d8+3", or { "modern": ..., "legacy": ... }`);
}

/**
 * @param {string} id
 * @param {unknown} effect
 * @returns {ServiceEffect}
 */
function cleanEffect(id, effect) {
  if (!effect || typeof effect !== "object" || Array.isArray(effect)) throw new Error(`"${id}": effect must be an object`);
  const source = /** @type {Record<string, any>} */ (effect);
  /** @type {ServiceEffect} */
  const clean = {};
  for (const [key, value] of Object.entries(source)) {
    if (key === "name" || key === "img") {
      if (typeof value !== "string") throw new Error(`"${id}": effect ${key} must be text`);
      if (value.trim()) clean[key] = value.trim();
    } else if (key === "days") {
      if (typeof value !== "number" || !(value > 0)) throw new Error(`"${id}": effect days must be above 0`);
      clean.days = value;
    } else if (key === "statuses") {
      if (!Array.isArray(value) || !value.every((status) => typeof status === "string")) throw new Error(`"${id}": effect statuses must be a list of text`);
      clean.statuses = [...value];
    } else if (key === "changes") {
      if (!Array.isArray(value)) throw new Error(`"${id}": effect changes must be a list`);
      clean.changes = value.map((change) => {
        if (!change || typeof change.key !== "string" || !change.key) throw new Error(`"${id}": each change needs a key`);
        if (change.type !== undefined && typeof change.type !== "string") throw new Error(`"${id}": a change type must be text`);
        return { key: change.key, value: String(change.value ?? ""), ...(change.type ? { type: change.type } : {}) };
      });
    } else {
      throw new Error(`"${id}": "${key}" is not an effect key`);
    }
  }
  return clean;
}
