// The Shops tool in the token controls: the Shops window for everyone, and the GM's place for every shop task.
import MarketList from "../apps/market-list.mjs";

export function registerSceneControls() {
  Hooks.on("getSceneControlButtons", addMarketTool);
}

/** @param {Record<string, any>} controls */
function addMarketTool(controls) {
  const tokens = controls.tokens;
  if (!tokens?.tools) return;
  tokens.tools.kozmosTradeMarket = {
    name: "kozmosTradeMarket",
    title: game.user.isGM ? "KT.Market.ToolGM" : "KT.Market.Title",
    icon: "fa-solid fa-store",
    order: Object.keys(tokens.tools).length,
    button: true,
    visible: true,
    onChange: () => MarketList.toggle(),
  };
}
