import { createApi } from "./api.mjs";
import { registerArchetypeMenu } from "./apps/archetype-editor.mjs";
import { registerFeatureMenu } from "./apps/feature-toggles.mjs";
import BarterWindow from "./apps/barter-window.mjs";
import JoinWindow from "./apps/join-window.mjs";
import MarketList from "./apps/market-list.mjs";
import PlayerTradeWindow from "./apps/player-trade.mjs";
import { MODULE_ID } from "./constants.mjs";
import { registerApprovalHandlers, registerProposalCards, setCounterWindow } from "./services/approval.mjs";
import { registerAppraisalHandlers } from "./services/appraisal.mjs";
import { registerHaggleHandlers } from "./services/haggle.mjs";
import { registerMarketListHandlers } from "./services/market-list.mjs";
import { registerPlayerTradeHandlers, setPlayerTradeWindow } from "./services/player-trade.mjs";
import { registerRollHandlers } from "./services/rolls.mjs";
import { setJoinWindow, setTradeWindow } from "./services/open-trade.mjs";
import { registerShowHandlers } from "./services/show.mjs";
import { registerReceiptCards, registerReceiptHandlers } from "./services/receipts.mjs";
import { registerShopCards } from "./services/shop-card.mjs";
import { registerAutoRestock } from "./services/stock.mjs";
import { registerSessionHandlers } from "./services/session.mjs";
import { listen, MESSAGES, onBroadcast } from "./services/socket.mjs";
import { registerTradeHandlers } from "./services/trade.mjs";
import { registerSettings } from "./settings.mjs";
import { registerGmControls } from "./ui/gm-controls.mjs";
import { registerDragTrade } from "./ui/drag-trade.mjs";
import { registerTradeLinks } from "./ui/enricher.mjs";
import { registerProximityButton } from "./ui/proximity.mjs";
import { registerSceneControls } from "./ui/scene-controls.mjs";

Hooks.once("init", () => {
  registerSettings();
  registerArchetypeMenu();
  registerFeatureMenu();
  registerGmControls();
  registerSceneControls();
  setTradeWindow((snapshot, customer) => BarterWindow.show(snapshot, customer));
  setJoinWindow((view, customer) => JoinWindow.show(view, customer));
  setCounterWindow((message) => BarterWindow.openCounter(message));
  setPlayerTradeWindow({ sync: (view) => PlayerTradeWindow.sync(view), ended: (id, reason, name) => PlayerTradeWindow.ended(id, reason, name) });
  registerProposalCards();
  registerReceiptCards();
  registerShopCards();
  registerTradeLinks();
  // Module has no api property in the generated types.
  /** @type {any} */ (game.modules.get(MODULE_ID)).api = createApi();
});

Hooks.once("ready", () => {
  registerSessionHandlers();
  registerTradeHandlers();
  registerApprovalHandlers();
  registerRollHandlers();
  registerHaggleHandlers();
  registerAppraisalHandlers();
  registerShowHandlers();
  registerReceiptHandlers();
  registerMarketListHandlers();
  registerPlayerTradeHandlers();
  registerAutoRestock();
  registerProximityButton();
  registerDragTrade();
  onBroadcast(MESSAGES.TRADE_DONE, ({ merchant }) => BarterWindow.refreshFor(merchant));
  onBroadcast(MESSAGES.SHOP_CHANGED, ({ merchant }) => {
    BarterWindow.refreshFor(merchant);
    MarketList.refreshAll();
  });
  onBroadcast(MESSAGES.PROPOSAL_RESULT, (result) => BarterWindow.onProposalResult(result));
  onBroadcast(MESSAGES.POOL_CHANGED, (change) => {
    BarterWindow.onPool(change);
    JoinWindow.onPool(change);
  });
  onBroadcast(MESSAGES.SESSION_ENDED, (payload) => JoinWindow.ended(payload));
  listen();
});
