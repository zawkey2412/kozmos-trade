import { createApi } from "./api.mjs";
import { registerArchetypeMenu } from "./apps/archetype-editor.mjs";
import { registerFeatureMenu } from "./apps/feature-toggles.mjs";
import BarterWindow from "./apps/barter-window.mjs";
import { MODULE_ID } from "./constants.mjs";
import { registerApprovalHandlers, registerProposalCards, setCounterWindow } from "./services/approval.mjs";
import { registerHaggleHandlers } from "./services/haggle.mjs";
import { setTradeWindow } from "./services/open-trade.mjs";
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

Hooks.once("init", () => {
  registerSettings();
  registerArchetypeMenu();
  registerFeatureMenu();
  registerGmControls();
  setTradeWindow((snapshot, customer) => BarterWindow.show(snapshot, customer));
  setCounterWindow((message) => BarterWindow.openCounter(message));
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
  registerHaggleHandlers();
  registerReceiptHandlers();
  registerAutoRestock();
  registerProximityButton();
  registerDragTrade();
  onBroadcast(MESSAGES.TRADE_DONE, ({ merchant }) => BarterWindow.refreshFor(merchant));
  onBroadcast(MESSAGES.SHOP_CHANGED, ({ merchant }) => BarterWindow.refreshFor(merchant));
  onBroadcast(MESSAGES.PROPOSAL_RESULT, (result) => BarterWindow.onProposalResult(result));
  listen();
});
