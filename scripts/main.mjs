import { listen } from "./services/socket.mjs";
import { registerSettings } from "./settings.mjs";

Hooks.once("init", () => {
  registerSettings();
});

Hooks.once("ready", () => {
  listen();
});
