// GM controls: the scales button on NPC token HUDs and actor sheet headers, and an item's true value.
import ConfigureShop from "../apps/configure-shop.mjs";
import { openTrade, pickCustomer } from "../services/open-trade.mjs";
import { showShop } from "../services/show.mjs";
import { canBeShop, isShop, setTrueValue } from "../services/shop.mjs";
import { itemFlags } from "../data/flags.mjs";
import { COPPER } from "../engine/money.mjs";

const ICON = "fa-solid fa-scale-balanced";

export function registerGmControls() {
  Hooks.on("renderTokenHUD", addHudButton);
  Hooks.on("getHeaderControlsActorSheetV2", addHeaderControl);
  Hooks.on("getHeaderControlsDocumentSheetV2", addTrueValueControl);
  Hooks.on("getActorContextOptions", addShowOption);
}

// "Show to players" on shops in the Actors sidebar.
/**
 * @param {any} directory
 * @param {object[]} options
 */
function addShowOption(directory, options) {
  const actorOf = (/** @type {HTMLElement} */ li) => game.actors.get(/** @type {HTMLElement} */ (li.closest("[data-entry-id]")).dataset.entryId);
  options.push({
    label: "KT.Show.Control",
    icon: "fa-solid fa-eye",
    visible: (/** @type {HTMLElement} */ li) => game.user.isGM && isShop(actorOf(li)),
    onClick: (/** @type {Event} */ event, /** @type {HTMLElement} */ li) => showShop(actorOf(li)),
  });
}

// The barter window for a shop that is set up, Configure Shop for anything else.
/** @param {any} actor */
export async function openShopFor(actor) {
  if (!isShop(actor)) return ConfigureShop.open(actor);
  let customer;
  try {
    customer = await pickCustomer();
  } catch {
    return ConfigureShop.open(actor);
  }
  if (customer) return openTrade(customer, actor);
}

/**
 * @param {any} hud
 * @param {HTMLElement} element
 */
function addHudButton(hud, element) {
  const actor = hud.document?.actor;
  if (!game.user.isGM || !canBeShop(actor)) return;
  const column = element.querySelector(".col.left");
  if (!column || column.querySelector(".kt-hud-shop")) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "control-icon kt-hud-shop";
  button.dataset.tooltip = "";
  button.setAttribute("aria-label", game.i18n.localize("KT.Shop.Control"));
  button.innerHTML = `<i class="${ICON}" inert></i>`;
  button.addEventListener("click", (event) => {
    event.preventDefault();
    openShopFor(actor);
  });
  column.append(button);
}

/**
 * @param {any} sheet
 * @param {object[]} controls
 */
function addTrueValueControl(sheet, controls) {
  const item = sheet.document;
  if (!game.user.isGM || item?.documentName !== "Item") return;
  controls.push({ icon: "fa-solid fa-magnifying-glass-dollar", label: "KT.TrueValue.Control", action: "kozmosTradeTrueValue", onClick: () => askTrueValue(item) });
}

// What an appraised merchant pays on, in gold. Empty clears it.
/** @param {any} item */
async function askTrueValue(item) {
  const current = itemFlags(item).trueValue;
  // Core's JSDoc marks every number input option as required.
  const input = foundry.applications.fields.createNumberInput(/** @type {any} */ ({ name: "value", value: current === null ? undefined : current / COPPER.gp, min: 0, step: 0.01 }));
  const group = foundry.applications.fields.createFormGroup({ label: game.i18n.localize("KT.TrueValue.Label"), input, units: game.i18n.localize("DND5E.CurrencyAbbrGP") });
  const data = /** @type {any} */ (await foundry.applications.api.DialogV2.input(/** @type {any} */ ({
    window: { title: game.i18n.localize("KT.TrueValue.Title", { name: item.name }), icon: "fa-solid fa-magnifying-glass-dollar" },
    content: `<p class="hint">${game.i18n.localize("KT.TrueValue.Hint")}</p>${group.outerHTML}`,
    rejectClose: false,
  })));
  if (data) await setTrueValue(item, Number.isFinite(data.value) ? data.value : null);
}

/**
 * @param {any} sheet
 * @param {object[]} controls
 */
function addHeaderControl(sheet, controls) {
  const actor = sheet.document;
  if (!game.user.isGM || !canBeShop(actor)) return;
  controls.push({ icon: ICON, label: "KT.Shop.Control", action: "kozmosTradeShop", onClick: () => openShopFor(actor) });
}
