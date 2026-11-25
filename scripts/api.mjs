// The public API at game.modules.get("kozmos-trade").api.
import { registerArchetype } from "./services/archetypes.mjs";
import { openTrade } from "./services/open-trade.mjs";

export function createApi() {
  return Object.freeze({
    openTrade,
    registerArchetype,
  });
}
