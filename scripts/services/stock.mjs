// Generating stock on the GM's client: a shelf rolled from compendiums replaces the unpinned stock.
// Documents and CONFIG.Dice are typed any here because their fields have no generated types.
import { MODULE_ID, SETTINGS } from "../constants.mjs";
import { itemFacts, rulesVersion } from "../adapter/dnd5e.mjs";
import { DEFAULT_ARCHETYPE } from "../data/archetypes.mjs";
import { cleanFlags, ItemFlags, merchantFlags } from "../data/flags.mjs";
import { splitCopper } from "../engine/money.mjs";
import { rarityRank } from "../engine/catalog.mjs";
import { baseValue } from "../engine/pricing.mjs";
import { TRADE_TYPES } from "../engine/shelf.mjs";
import { rollShelf } from "../engine/stock.mjs";
import { getTables } from "../settings.mjs";
import { getArchetypes } from "./archetypes.mjs";
import { TradeError } from "./errors.mjs";
import { saveShop, shelf } from "./shop.mjs";

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
    source.flags = { ...(source.flags ?? {}), [MODULE_ID]: cleanFlags(ItemFlags, { listedPrice: pick.price, limited, curio: pick.curio }) };
    data.push(source);
  }
  const created = data.length ? await merchant.createEmbeddedDocuments("Item", data) : [];
  await merchant.update({ "system.currency": { pp: 0, ep: 0, ...splitCopper(result.purse) } });
  await saveShop(merchant, { shop: { ...options, lastRestock: game.time.worldTime } });
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
