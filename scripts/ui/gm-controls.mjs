// GM controls: the shop button on NPC token HUDs, sheet headers and the Actors sidebar menu, the guard toggle, and an item's true value.
import ConfigureShop from "../apps/configure-shop.mjs";
import { openTrade, pickCustomer } from "../services/open-trade.mjs";
import { showShop } from "../services/show.mjs";
import { canBeShop, isShop, setTrueValue } from "../services/shop.mjs";
import { MODULE_ID } from "../constants.mjs";
import { itemFlags, tokenFlags } from "../data/flags.mjs";
import { COPPER } from "../engine/money.mjs";
import { feature } from "../settings.mjs";

const ICON = "fa-solid fa-scale-balanced";

export function registerGmControls() {
  Hooks.on("renderTokenHUD", addHudButton);
  Hooks.on("renderTokenHUD", addGuardButton);
  Hooks.on("getHeaderControlsActorSheetV2", addHeaderControl);
  Hooks.on("getHeaderControlsDocumentSheetV2", addTrueValueControl);
  Hooks.on("getActorContextOptions", addShowOption);
}

// Shop entries in the Actors sidebar's right-click menu.
/**
 * @param {any} directory
 * @param {object[]} options
 */
function addShowOption(directory, options) {
  const actorOf = (/** @type {HTMLElement} */ li) => game.actors.get(/** @type {HTMLElement} */ (li.closest("[data-entry-id]")).dataset.entryId);
  const gmAnd = (/** @type {(actor: any) => boolean} */ test) => (/** @type {HTMLElement} */ li) => game.user.isGM && test(actorOf(li));
  options.push(
    {
      label: "KT.Shop.SetUp",
      icon: "fa-solid fa-store",
      visible: gmAnd((actor) => canBeShop(actor) && !isShop(actor)),
      onClick: (/** @type {Event} */ event, /** @type {HTMLElement} */ li) => ConfigureShop.open(actorOf(li)),
    },
    {
      label: "KT.Shop.Configure",
      icon: "fa-solid fa-sliders",
      visible: gmAnd(isShop),
      onClick: (/** @type {Event} */ event, /** @type {HTMLElement} */ li) => ConfigureShop.open(actorOf(li)),
    },
    {
      label: "KT.Show.Control",
      icon: "fa-solid fa-eye",
      visible: gmAnd(isShop),
      onClick: (/** @type {Event} */ event, /** @type {HTMLElement} */ li) => showShop(actorOf(li)),
    },
    {
      label: "KT.Configure.Remove",
      icon: "fa-solid fa-store-slash",
      visible: gmAnd(isShop),
      onClick: (/** @type {Event} */ event, /** @type {HTMLElement} */ li) => ConfigureShop.confirmRemove(actorOf(li)),
    },
  );
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
  const shop = isShop(actor);
  const button = document.createElement("button");
  button.type = "button";
  button.className = `control-icon kt-hud-shop${shop ? " active" : ""}`;
  button.dataset.tooltipHtml = shop
    ? `<strong>${game.i18n.localize("KT.Shop.Trade")}</strong><br>${game.i18n.localize("KT.Shop.RightClick")}`
    : game.i18n.localize("KT.Shop.SetUp");
  button.setAttribute("aria-label", game.i18n.localize(shop ? "KT.Shop.Trade" : "KT.Shop.SetUp"));
  button.innerHTML = `<i class="${shop ? ICON : "fa-solid fa-store"}" inert></i>`;
  button.addEventListener("click", (event) => {
    event.preventDefault();
    openShopFor(actor);
  });
  button.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    ConfigureShop.open(actor);
  });
  column.append(button);
}

// Guard toggle on any token's HUD.
/**
 * @param {any} hud
 * @param {HTMLElement} element
 */
function addGuardButton(hud, element) {
  const token = hud.document;
  if (!game.user.isGM || !token || !feature("theft") || isShop(token.actor)) return;
  const column = element.querySelector(".col.right");
  if (!column || column.querySelector(".kt-hud-guard")) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "control-icon kt-hud-guard";
  button.innerHTML = `<i class="fa-solid fa-shield-halved" inert></i>`;
  const show = (/** @type {boolean} */ on) => {
    button.classList.toggle("active", on);
    button.setAttribute("aria-pressed", String(on));
    button.setAttribute("aria-label", game.i18n.localize(on ? "KT.Theft.GuardOn" : "KT.Theft.GuardOff"));
    button.dataset.tooltipHtml = `<strong>${game.i18n.localize(on ? "KT.Theft.GuardOn" : "KT.Theft.GuardOff")}</strong><br>${game.i18n.localize("KT.Theft.GuardHint")}`;
  };
  show(tokenFlags(token).guard);
  button.addEventListener("click", async (event) => {
    event.preventDefault();
    const next = !tokenFlags(token).guard;
    await token.update({ [`flags.${MODULE_ID}.guard`]: next });
    show(next);
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
  if (!isShop(actor)) {
    controls.push({ icon: "fa-solid fa-store", label: "KT.Shop.SetUp", action: "kozmosTradeShop", onClick: () => ConfigureShop.open(actor) });
    return;
  }
  controls.push(
    { icon: ICON, label: "KT.Shop.Trade", action: "kozmosTradeShop", onClick: () => openShopFor(actor) },
    { icon: "fa-solid fa-sliders", label: "KT.Shop.Configure", action: "kozmosTradeConfigure", onClick: () => ConfigureShop.open(actor) },
  );
}
