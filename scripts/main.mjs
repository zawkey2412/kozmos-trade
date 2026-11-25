import { createApi } from "./api.mjs";
import BarterWindow from "./apps/barter-window.mjs";
import { MODULE_ID } from "./constants.mjs";
import { registerApprovalHandlers, registerProposalCards, setCounterWindow } from "./services/approval.mjs";
import { setTradeWindow } from "./services/open-trade.mjs";
import { registerReceiptCards, registerReceiptHandlers } from "./services/receipts.mjs";
import { registerShopCards } from "./services/shop-card.mjs";
import { registerSessionHandlers } from "./services/session.mjs";
import { listen, MESSAGES, onBroadcast } from "./services/socket.mjs";
import { registerTradeHandlers } from "./services/trade.mjs";
import { registerSettings } from "./settings.mjs";
import { registerGmControls } from "./ui/gm-controls.mjs";

Hooks.once("init", () => {
  registerSettings();
  registerGmControls();
  setTradeWindow((snapshot, customer) => BarterWindow.show(snapshot, customer));
  setCounterWindow((message) => BarterWindow.openCounter(message));
  registerProposalCards();
  registerReceiptCards();
  registerShopCards();
  // Module has no api property in the generated types.
  /** @type {any} */ (game.modules.get(MODULE_ID)).api = createApi();
});

Hooks.once("ready", () => {
  registerSessionHandlers();
  registerTradeHandlers();
  registerApprovalHandlers();
  registerReceiptHandlers();
  onBroadcast(MESSAGES.TRADE_DONE, ({ merchant }) => BarterWindow.refreshFor(merchant));
  onBroadcast(MESSAGES.SHOP_CHANGED, ({ merchant }) => BarterWindow.refreshFor(merchant));
  onBroadcast(MESSAGES.PROPOSAL_RESULT, (result) => BarterWindow.onProposalResult(result));
  listen();
});
