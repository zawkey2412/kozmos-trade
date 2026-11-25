// @Trade[uuid]{label} in journals, map notes and chat: a link that opens the trade with that merchant.
// Documents are typed any here because their schema fields have no generated types.
import { MODULE_ID } from "../constants.mjs";
import { openTrade } from "../services/open-trade.mjs";

const ENRICHER_ID = `${MODULE_ID}.trade`;

export function registerTradeLinks() {
  /** @type {any} */ (CONFIG).TextEditor.enrichers.push({
    id: ENRICHER_ID,
    pattern: /@Trade\[([^\]]+)\](?:\{([^}]+)\})?/gi,
    enricher: tradeLink,
    onRender,
  });
}

/** @param {RegExpMatchArray} match */
function tradeLink([, uuid, label]) {
  const merchant = /** @type {any} */ (foundry.utils.fromUuidSync(uuid));
  const link = document.createElement("a");
  link.classList.add("content-link", "kt-trade-link");
  link.dataset.uuid = uuid;
  const icon = document.createElement("i");
  icon.className = merchant ? "fa-solid fa-scale-balanced" : "fa-solid fa-link-slash";
  icon.inert = true;
  link.append(icon, label ?? merchant?.name ?? uuid);
  if (!merchant) link.classList.add("broken");
  else link.dataset.tooltipText = game.i18n.localize("KT.Link.Tooltip", { name: merchant.name });
  return link;
}

/**
 * @param {HTMLElement} element
 * @param {{ signal: AbortSignal }} options
 */
function onRender(element, { signal }) {
  const link = element.querySelector("a.kt-trade-link:not(.broken)");
  link?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openTrade(null, /** @type {HTMLElement} */ (link).dataset.uuid);
  }, { signal });
}
