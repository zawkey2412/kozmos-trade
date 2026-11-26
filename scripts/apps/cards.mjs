// Item card and tag data shared by the trade windows.
import { MODULE_ID } from "../constants.mjs";
import { rarityLabel } from "../adapter/dnd5e.mjs";

/** @type {Promise<void> | null} */
let partials = null;

// The card, inventory and tray partials, loaded once.
export function loadTradePartials() {
  partials ??= foundry.applications.handlebars
    .loadTemplates({
      "kt-card": `modules/${MODULE_ID}/templates/components/card.hbs`,
      "kt-inventory": `modules/${MODULE_ID}/templates/components/inventory.hbs`,
      "kt-tray": `modules/${MODULE_ID}/templates/components/tray.hbs`,
    })
    .then(() => {});
  return partials;
}

/**
 * @param {string} id
 * @param {string} side
 * @param {string} name
 * @param {string} img
 * @param {{ type: string, subtype?: string, rarity?: string, magical?: boolean }} facts
 * @param {number} quantity
 * @param {number} staged
 */
export function card(id, side, name, img, facts, quantity, staged) {
  return {
    id,
    side,
    name,
    img,
    type: facts.type,
    subtype: facts.subtype ?? "",
    rarity: facts.rarity ?? "",
    magical: Boolean(facts.magical || facts.rarity),
    quantity,
    available: quantity - staged,
    staged: staged > 0,
    tooltip: `<h4>${foundry.utils.escapeHTML(name)}</h4>`,
    disabled: false,
    dim: false,
  };
}

/**
 * @param {string} key
 * @param {string} icon
 */
export function tag(key, icon) {
  return { key, icon, label: game.i18n.localize(`KT.Tag.${key}`) };
}

/** @param {string | undefined} rarity */
export function rarityTag(rarity) {
  return rarity ? { key: `rarity rarity-${rarity}`, icon: null, label: rarityLabel(rarity) } : null;
}
