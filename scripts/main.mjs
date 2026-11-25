import { registerSettings } from "./settings.mjs";

Hooks.once("init", () => {
  registerSettings();
});
