// The Open Shop chat card: anyone who clicks Trade opens the trade for their own character.
// Documents are typed any here because their schema fields have no generated types.
import { MODULE_ID } from "../constants.mjs";
import { merchantFlags } from "../data/flags.mjs";
import { archetypeLabel } from "./archetypes.mjs";
import { openTrade } from "./open-trade.mjs";
import { wantedLabels, wantedView } from "./session.mjs";

const TEMPLATE = `modules/${MODULE_ID}/templates/chat/shop.hbs`;

/** @param {any} merchant */
export async function postShopCard(merchant) {
  const flags = merchantFlags(merchant);
  const content = await foundry.applications.handlebars.renderTemplate(TEMPLATE, {
    name: merchant.name,
    archetype: archetypeLabel(flags.archetype),
    wanted: wantedLabels(wantedView(merchant)),
  });
  return ChatMessage.create(/** @type {any} */ ({
    content,
    speaker: ChatMessage.getSpeaker({ actor: merchant }),
    flags: { [MODULE_ID]: { shopCard: { merchant: merchant.uuid } } },
  }));
}

export function registerShopCards() {
  Hooks.on("renderChatMessageHTML", (message, html) => {
    const card = message?.flags?.[MODULE_ID]?.shopCard;
    if (!card) return;
    html.querySelector("[data-kt-action='browse']")?.addEventListener("click", () => openTrade(null, card.merchant));
  });
}
