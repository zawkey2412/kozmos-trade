import { listen } from "./services/socket.mjs";
import { registerSettings } from "./settings.mjs";
import { registerGmControls } from "./ui/gm-controls.mjs";

Hooks.once("init", () => {
  registerSettings();
  registerGmControls();
});

Hooks.once("ready", () => {
  listen();
});
