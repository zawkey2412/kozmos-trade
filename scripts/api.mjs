// The public API at game.modules.get("kozmos-trade").api.
import { openTrade } from "./services/open-trade.mjs";

export function createApi() {
  return Object.freeze({
    openTrade,
  });
}
