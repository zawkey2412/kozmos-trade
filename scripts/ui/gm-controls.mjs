// The scales button for GMs on NPC token HUDs and actor sheet headers.
import ConfigureShop from "../apps/configure-shop.mjs";
import { openTrade, pickCustomer } from "../services/open-trade.mjs";
import { canBeShop, isShop } from "../services/shop.mjs";

const ICON = "fa-solid fa-scale-balanced";

export function registerGmControls() {
  Hooks.on("renderTokenHUD", addHudButton);
  Hooks.on("getHeaderControlsActorSheetV2", addHeaderControl);
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
function addHeaderControl(sheet, controls) {
  const actor = sheet.document;
  if (!game.user.isGM || !canBeShop(actor)) return;
  controls.push({ icon: ICON, label: "KT.Shop.Control", action: "kozmosTradeShop", onClick: () => openShopFor(actor) });
}
