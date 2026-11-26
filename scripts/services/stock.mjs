// Generating stock on the GM's client: a shelf rolled from compendiums replaces the unpinned stock.
// Documents and CONFIG.Dice are typed any here because their fields have no generated types.
import { MODULE_ID, SETTINGS } from "../constants.mjs";
import { clock, itemFacts, itemSource, rulesVersion } from "../adapter/dnd5e.mjs";
import { DEFAULT_ARCHETYPE } from "../data/archetypes.mjs";
import { cleanFlags, ItemFlags, merchantFlags } from "../data/flags.mjs";
import { splitCopper } from "../engine/money.mjs";
import { rarityRank } from "../engine/catalog.mjs";
import { baseValue } from "../engine/pricing.mjs";
import { TRADE_TYPES } from "../engine/shelf.mjs";
import { rollShelf } from "../engine/stock.mjs";
import { rollWanted } from "../engine/wanted.mjs";
import { feature, getTables } from "../settings.mjs";
import { getArchetypes } from "./archetypes.mjs";
import { TradeError } from "./errors.mjs";
import { isAnsweringWindow } from "./sessions.mjs";
import { saveShop, shelf } from "./shop.mjs";
import { broadcast, MESSAGES } from "./socket.mjs";

/** @import { Candidate } from "../engine/stock.mjs"; */
/** @import { MerchantFlagData } from "../data/flags.mjs"; */

const INDEX_FIELDS = [
  "type",
  "system.price",
  "system.rarity",
  "system.type",
  "system.magicalBonus",
  "system.attunement",
  "system.properties",
  "system.identified",
];

// The compendiums the generator draws from, or dnd5e's own for the world's rules.
export function stockPacks() {
  const chosen = [...(game.settings.get(MODULE_ID, SETTINGS.COMPENDIUMS) ?? [])];
  const ids = chosen.length ? chosen : [rulesVersion() === "legacy" ? "dnd5e.items" : "dnd5e.equipment24"];
  return ids.map((id) => /** @type {any} */ (game.packs.get(id))).filter((pack) => pack?.documentName === "Item");
}

/**
 * @param {any} merchant
 * @param {{ archetype?: string, tier?: string }} [options]
 */
export async function generateStock(merchant, { archetype, tier } = {}) {
  if (!game.user.isGM) throw new TradeError("KT.Error.GMOnly");
  const flags = merchantFlags(merchant);
  const options = {
    archetype: archetype ?? (flags.archetype || DEFAULT_ARCHETYPE),
    tier: /** @type {MerchantFlagData["tier"]} */ (tier ?? flags.tier),
  };
  const definition = getArchetypes()[options.archetype];
  if (!definition) throw new TradeError("KT.Error.NoArchetype", { name: options.archetype });
  if (Hooks.call("kozmosTrade.preGenerateStock", merchant, options) === false) return null;

  const tables = getTables();
  const rules = rulesVersion();
  const random = /** @type {() => number} */ (/** @type {any} */ (CONFIG.Dice).randomUniform);
  const pool = await candidates(tables, rules);
  const result = rollShelf(pool, {
    archetype: definition,
    tier: options.tier,
    tables,
    random,
    value: (candidate) => baseValue(candidate.facts, tables.pricing, { rules, random }),
    underCounter: feature("attitude") ? tables.stock.underCounter : 0,
  });

  const old = shelf(merchant).filter((entry) => !entry.flags.pinned).map((entry) => entry.item.id);
  if (old.length) await merchant.deleteEmbeddedDocuments("Item", old);
  const data = [];
  for (const pick of result.picks) {
    const item = /** @type {any} */ (await foundry.utils.fromUuid(pick.uuid));
    if (!item) continue;
    const source = /** @type {any} */ (game.items.fromCompendium(item));
    const limited = pick.limited || rarityRank(itemFacts(item).rarity) >= rarityRank("uncommon");
    source.system.quantity = limited ? 1 : pick.quantity;
    source.flags = { ...(source.flags ?? {}), [MODULE_ID]: cleanFlags(ItemFlags, { listedPrice: pick.price, limited, curio: pick.curio, underCounter: pick.underCounter }) };
    data.push(source);
  }
  const created = data.length ? await merchant.createEmbeddedDocuments("Item", data) : [];
  await merchant.update({ "system.currency": { pp: 0, ep: 0, ...splitCopper(result.purse) } });
  const wanted = feature("wanted") ? rollWanted(pool, { archetype: definition, tier: options.tier, tables, random, exclude: result.picks.map((pick) => pick.uuid) }) : [];
  await saveShop(merchant, { shop: { ...options, wanted, lastRestock: game.time.worldTime } });
  const summary = { ...options, items: created.map((item) => item.id), purse: result.purse };
  Hooks.callAll("kozmosTrade.generateStock", merchant, summary);
  return summary;
}

/**
 * @param {ReturnType<typeof getTables>} tables
 * @param {"modern" | "legacy"} rules
 * @returns {Promise<Candidate[]>}
 */
export async function candidates(tables, rules) {
  const list = [];
  for (const pack of stockPacks()) {
    const index = await pack.getIndex({ fields: INDEX_FIELDS });
    for (const entry of index) {
      const facts = itemFacts(entry);
      if (!TRADE_TYPES.includes(facts.type)) continue;
      list.push({
        uuid: entry.uuid ?? `Compendium.${pack.collection}.Item.${entry._id}`,
        name: entry.name,
        facts,
        value: baseValue(facts, tables.pricing, { rules }),
      });
    }
  }
  return list;
}

// A new Wanted board only, keeping the shelf.
/** @param {any} merchant */
export async function rerollWanted(merchant) {
  if (!game.user.isGM) throw new TradeError("KT.Error.GMOnly");
  const flags = merchantFlags(merchant);
  const definition = getArchetypes()[flags.archetype || DEFAULT_ARCHETYPE];
  if (!definition) throw new TradeError("KT.Error.NoArchetype", { name: flags.archetype });
  const tables = getTables();
  const random = /** @type {() => number} */ (/** @type {any} */ (CONFIG.Dice).randomUniform);
  const pool = await candidates(tables, rulesVersion());
  const wanted = rollWanted(pool, { archetype: definition, tier: flags.tier, tables, random, exclude: shelf(merchant).map((entry) => itemSource(entry.item)).filter(Boolean) });
  await saveShop(merchant, { shop: { wanted } });
  return wanted;
}

// A new shelf with the shop's own archetype and wealth.
/** @param {any} merchant */
export function restock(merchant) {
  return generateStock(merchant);
}

// Every shop in the world: world actors and the actors of unlinked tokens.
export function allShops() {
  const shops = /** @type {any[]} */ (game.actors.contents).filter((actor) => merchantFlags(actor).enabled);
  for (const scene of /** @type {any[]} */ (game.scenes.contents)) {
    for (const token of scene.tokens) {
      if (!token.actorLink && token.actor && merchantFlags(token.actor).enabled) shops.push(token.actor);
    }
  }
  return shops;
}

// Restocks shops whose last restock is at least the set number of in-game days ago.
export async function autoRestock() {
  const days = Number(game.settings.get(MODULE_ID, SETTINGS.RESTOCK_DAYS)) || 0;
  if (!days || !game.users.activeGM?.isSelf || !(await isAnsweringWindow())) return [];
  const { now, day } = clock();
  const restocked = [];
  for (const shop of allShops()) {
    const last = merchantFlags(shop).lastRestock;
    if (last === null || now - last < days * day) continue;
    await restock(shop).catch((error) => console.error(`Kozmos Trade | Restock of ${shop.name} failed`, error));
    restocked.push(shop.name);
  }
  return restocked;
}

export function registerAutoRestock() {
  const check = foundry.utils.debounce(() => autoRestock(), 1000);
  Hooks.on("updateWorldTime", () => check());
}

// Items, every item in an Item folder, or the items a roll table can give, added to the shelf.
/**
 * @param {any} merchant
 * @param {{ type?: string, uuid?: string }} data
 */
export async function importStock(merchant, data) {
  if (!game.user.isGM) throw new TradeError("KT.Error.GMOnly");
  const source = /** @type {any} */ (data?.uuid ? await foundry.utils.fromUuid(data.uuid) : null);
  /** @type {any[]} */
  let items = [];
  if (data?.type === "Item" && source) items = [source];
  else if (data?.type === "Folder" && source?.type === "Item") {
    const folders = [source, ...(source.getSubfolders?.(true) ?? [])];
    for (const folder of folders) for (const entry of folder.contents) items.push(entry.uuid ? await foundry.utils.fromUuid(entry.uuid) : entry);
  } else if (data?.type === "RollTable" && source) {
    for (const result of source.results) if (result.documentUuid) items.push(await foundry.utils.fromUuid(result.documentUuid));
  }
  const copies = items
    .filter((item) => item && item.parent !== merchant && TRADE_TYPES.includes(itemFacts(item).type))
    .map((item) => {
      const copy = item.pack ? game.items.fromCompendium(item) : item.toObject();
      delete copy._id;
      if (copy.flags) delete copy.flags[MODULE_ID];
      if ("equipped" in copy.system) copy.system.equipped = false;
      if ("container" in copy.system) copy.system.container = null;
      return copy;
    });
  if (!copies.length) return 0;
  await merchant.createEmbeddedDocuments("Item", copies);
  broadcast(MESSAGES.SHOP_CHANGED, { merchant: merchant.uuid });
  return copies.length;
}