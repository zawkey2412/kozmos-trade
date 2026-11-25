import { createApi } from "./api.mjs";
import { MODULE_ID } from "./constants.mjs";
import { registerSessionHandlers } from "./services/session.mjs";
import { listen } from "./services/socket.mjs";
import { registerSettings } from "./settings.mjs";
import { registerGmControls } from "./ui/gm-controls.mjs";

Hooks.once("init", () => {
  registerSettings();
  registerGmControls();
  // Module has no api property in the generated types.
  /** @type {any} */ (game.modules.get(MODULE_ID)).api = createApi();
});

Hooks.once("ready", () => {
  registerSessionHandlers();
  listen();
});
