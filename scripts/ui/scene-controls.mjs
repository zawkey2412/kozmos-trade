// The Shops tool in the token controls.
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
    title: "KT.Market.Title",
    icon: "fa-solid fa-store",
    order: Object.keys(tokens.tools).length,
    button: true,
    visible: true,
    onChange: () => MarketList.toggle(),
  };
}
