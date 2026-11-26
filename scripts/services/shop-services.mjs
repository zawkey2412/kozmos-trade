// Services bought in a trade: checked on the GM, applied with the trade's undo, and noted in chat.
// Documents are typed any here because their schema fields have no generated types.
import { MODULE_ID } from "../constants.mjs";
import { clock, itemFacts, rulesVersion } from "../adapter/dnd5e.mjs";
import { merchantFlags } from "../data/flags.mjs";
import { healFormula, parseServiceKey } from "../engine/services.mjs";
import { servicesOf } from "./archetypes.mjs";
import { TradeError } from "./errors.mjs";
import { buyQuote } from "./offer.mjs";

/** @import { Service } from "../engine/services.mjs"; */
/** @import { PriceContext } from "./offer.mjs"; */
/** @import { ExtraStep, TradeLine } from "./trade.mjs"; */

/**
 * @typedef {object} ServiceLine
 * @property {Service & { label: string }} service
 * @property {string} key
 * @property {any} target
 * @property {number} unit
 */

const EFFECT_IMG = "icons/svg/aura.svg";

// The services in a trade request, each checked against the shop and the customer.
/**
 * @param {unknown} keys
 * @param {any} merchant
 * @param {any} customer
 * @param {TradeLine[]} give
 * @param {PriceContext} context
 * @returns {ServiceLine[]}
 */
export function serviceLines(keys, merchant, customer, give, context) {
  const offered = servicesOf(merchantFlags(merchant).archetype);
  const seen = new Set();
  const lines = [];
  for (const raw of Array.isArray(keys) ? keys : []) {
    const key = Array.isArray(raw) ? raw[0] : raw;
    if (typeof key !== "string" || seen.has(key)) throw new TradeError("KT.Error.Empty");
    seen.add(key);
    const { id, target } = parseServiceKey(key);
    const service = offered.find((s) => s.id === id);
    if (!service) throw new TradeError("KT.Error.NoService");
    let item = null;
    if (service.kind === "identify") {
      item = target ? customer.items.get(target) : null;
      if (!item || itemFacts(item).identified !== false) throw new TradeError("KT.Service.NothingToIdentify");
      if (give.some((line) => line.item.id === item.id)) throw new TradeError("KT.Service.IdentifyOffered", { name: item.name });
    }
    lines.push({ service, key, target: item, unit: buyQuote(service.price, context, false).copper });
  }
  return lines;
}

// What each service changes, run with the trade's own undo.
/**
 * @param {ServiceLine[]} lines
 * @param {any} merchant
 * @param {any} customer
 * @returns {ExtraStep[]}
 */
export function serviceSteps(lines, merchant, customer) {
  /** @type {ExtraStep[]} */
  const steps = [];
  for (const line of lines) {
    if (line.service.kind === "identify") {
      const item = line.target;
      steps.push({ apply: () => item.update({ "system.identified": true }), undo: () => item.update({ "system.identified": false }) });
    } else if (line.service.kind === "effect") {
      /** @type {string[]} */
      let created = [];
      steps.push({
        apply: async () => {
          const effects = await customer.createEmbeddedDocuments("ActiveEffect", [effectData(line.service, merchant)]);
          created = effects.map((effect) => effect.id);
        },
        undo: () => customer.deleteEmbeddedDocuments("ActiveEffect", created),
      });
    }
  }
  return steps;
}

// A chat note from the merchant for each service, with a healing roll where the service heals.
/**
 * @param {ServiceLine[]} lines
 * @param {any} merchant
 * @param {any} customer
 */
export async function postServiceNotes(lines, merchant, customer) {
  for (const line of lines) {
    const { service } = line;
    const escape = foundry.utils.escapeHTML;
    const text = [game.i18n.localize(`KT.Service.Card.${service.kind}`, { merchant: escape(merchant.name), customer: escape(customer.name), service: escape(service.label), item: escape(line.target?.name ?? "") })];
    const own = service.note ?? (game.i18n.has(`KT.Service.${service.id}.Note`) ? game.i18n.localize(`KT.Service.${service.id}.Note`) : "");
    if (own) text.push(escape(own));
    const heal = healFormula(service, rulesVersion());
    if (heal) text.push(`[[/heal ${heal}]]`);
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: merchant }),
      content: `<div class="${MODULE_ID} kt-check-card success kt-service-card">${text.map((p) => `<p>${p}</p>`).join("")}</div>`,
      flags: { [MODULE_ID]: { service: service.id } },
    });
    Hooks.callAll("kozmosTrade.service", merchant, customer, service, line.target);
  }
}

/**
 * @param {Service & { label: string }} service
 * @param {any} merchant
 */
function effectData(service, merchant) {
  const effect = service.effect ?? {};
  const changes = (effect.changes ?? []).map((change) => ({ key: change.key, type: change.type ?? "add", value: change.value }));
  return {
    name: effect.name ?? service.label,
    img: effect.img ?? EFFECT_IMG,
    origin: merchant.uuid,
    ...(effect.days ? { duration: { value: Math.round(effect.days * clock().day), units: "seconds" } } : {}),
    ...(changes.length ? { system: { changes } } : {}),
    ...(effect.statuses?.length ? { statuses: effect.statuses } : {}),
    flags: { [MODULE_ID]: { service: service.id } },
  };
}
