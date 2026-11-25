// Shop setup on a merchant actor.
import { MODULE_ID } from "../constants.mjs";
import { holdingFacts, itemFacts, rulesVersion } from "../adapter/dnd5e.mjs";
import { DEFAULT_ARCHETYPE } from "../data/archetypes.mjs";
import { cleanFlags, ItemFlags, itemFlags, MerchantFlags, merchantFlags } from "../data/flags.mjs";
import { baseValue } from "../engine/pricing.mjs";
import { onShelf, shelfPriceOf } from "../engine/shelf.mjs";
import { COPPER } from "../engine/money.mjs";
import { getTables } from "../settings.mjs";
import { TradeError } from "./errors.mjs";
import { broadcast, MESSAGES } from "./socket.mjs";

/** @import { BaseValue, ItemFacts } from "../engine/pricing.mjs"; */
/** @import { HoldingFacts } from "../adapter/dnd5e.mjs"; */
/** @import { ItemFlagData, MerchantFlagData } from "../data/flags.mjs"; */

/**
 * @typedef {object} ShelfEntry
 * @property {any} item
 * @property {ItemFacts} facts
 * @property {HoldingFacts} holding
 * @property {ItemFlagData} flags
 * @property {BaseValue} value
 * @property {number | null} price
 */

/** @param {any} actor */
export function canBeShop(actor) {
  return actor?.type === "npc";
}

/** @param {any} actor */
export function isShop(actor) {
  return canBeShop(actor) && merchantFlags(actor).enabled;
}

/**
 * @param {any} actor
 * @returns {ShelfEntry[]}
 */
export function shelf(actor) {
  const tables = getTables().pricing;
  const rules = rulesVersion();
  const entries = [];
  for (const item of actor.items) {
    const facts = itemFacts(item);
    const holding = holdingFacts(item);
    if (!onShelf(facts, holding)) continue;
    const flags = itemFlags(item);
    const value = baseValue(facts, tables, { rules });
    entries.push({ item, facts, holding, flags, value, price: shelfPriceOf(flags.listedPrice, value, tables) });
  }
  return entries.sort((a, b) => a.item.name.localeCompare(b.item.name, game.i18n.lang));
}

// Shop settings and per-item prices and pins, checked and written in one go.
/**
 * @param {any} actor
 * @param {{ shop: Partial<MerchantFlagData>, items?: Record<string, Partial<ItemFlagData>> }} changes
 */
export async function saveShop(actor, { shop, items = {} }) {
  const current = merchantFlags(actor);
  const archetype = shop.archetype ?? (current.archetype || DEFAULT_ARCHETYPE);
  const flags = cleanFlags(MerchantFlags, { ...current, ...shop, archetype, enabled: shop.enabled ?? true });
  await actor.update({ [`flags.${MODULE_ID}`]: flags });

  const updates = [];
  for (const [id, change] of Object.entries(items)) {
    const item = actor.items.get(id);
    if (!item) continue;
    const before = itemFlags(item);
    const after = cleanFlags(ItemFlags, { ...before, ...change });
    if (JSON.stringify(after) === JSON.stringify(before)) continue;
    updates.push({ _id: id, [`flags.${MODULE_ID}`]: after });
  }
  if (updates.length) await actor.updateEmbeddedDocuments("Item", updates);
  broadcast(MESSAGES.SHOP_CHANGED, { merchant: actor.uuid });
}

// A GM-set value an appraised merchant pays on, in gold, or null to clear it.
/**
 * @param {any} item
 * @param {number | null} gold
 */
export async function setTrueValue(item, gold) {
  if (!game.user.isGM) throw new TradeError("KT.Error.GMOnly");
  const copper = gold === null || !Number.isFinite(Number(gold)) || Number(gold) < 0 ? null : Math.round(Number(gold) * COPPER.gp);
  await item.update({ [`flags.${MODULE_ID}.trueValue`]: copper });
  return copper;
}

/** @param {any} actor */
export async function removeShop(actor) {
  await saveShop(actor, { shop: { enabled: false, open: false } });
}
