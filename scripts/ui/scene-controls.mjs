// Trade tools in the token controls: the Shops list for everyone, and the selected merchant's shop for the GM.
import ConfigureShop from "../apps/configure-shop.mjs";
import MarketList from "../apps/market-list.mjs";
import { canBeShop } from "../services/shop.mjs";
import { openShopFor } from "./gm-controls.mjs";

export function registerSceneControls() {
  Hooks.on("getSceneControlButtons", addTradeTools);
}

/** @param {Record<string, any>} controls */
function addTradeTools(controls) {
  const tokens = controls.tokens;
  if (!tokens?.tools) return;
  const order = Object.keys(tokens.tools).length;
  tokens.tools.kozmosTradeMarket = {
    name: "kozmosTradeMarket",
    title: "KT.Market.Title",
    icon: "fa-solid fa-store",
    order,
    button: true,
    visible: true,
    onChange: () => MarketList.toggle(),
  };
  tokens.tools.kozmosTradeOpen = {
    name: "kozmosTradeOpen",
    title: "KT.Shop.OpenSelected",
    icon: "fa-solid fa-scale-balanced",
    order: order + 1,
    button: true,
    visible: game.user.isGM,
    onChange: () => withSelected((actor) => openShopFor(actor)),
  };
  tokens.tools.kozmosTradeConfigure = {
    name: "kozmosTradeConfigure",
    title: "KT.Shop.ConfigureSelected",
    icon: "fa-solid fa-sliders",
    order: order + 2,
    button: true,
    visible: game.user.isGM,
    onChange: () => withSelected((actor) => ConfigureShop.open(actor)),
  };
}

// Runs on the NPC behind the one selected token, or says what to select.
/** @param {(actor: any) => unknown} run */
function withSelected(run) {
  // The tokens layer has no generated types.
  const selected = /** @type {any[]} */ (/** @type {any} */ (canvas).tokens?.controlled ?? []);
  const actor = selected.length === 1 ? selected[0].actor : null;
  if (!actor || !canBeShop(actor)) return ui.notifications.warn("KT.Shop.SelectOne", { localize: true });
  return run(actor);
}
