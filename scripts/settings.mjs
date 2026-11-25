import { MODES, MODULE_ID, SETTINGS } from "./constants.mjs";

/** @import { SettingConfig } from "@client/_types.mjs"; */

export function registerSettings() {
  register(SETTINGS.MODE, {
    name: "KT.Settings.Mode.Name",
    hint: "KT.Settings.Mode.Hint",
    scope: "world",
    config: true,
    type: new foundry.data.fields.StringField({
      required: true,
      blank: false,
      initial: MODES.STANDARD,
      choices: {
        [MODES.SIMPLE]: "KT.Settings.Mode.Simple",
        [MODES.STANDARD]: "KT.Settings.Mode.Standard",
        [MODES.CRUNCHY]: "KT.Settings.Mode.Crunchy",
      },
    }),
  });
}

/**
 * @param {string} key
 * @param {Omit<SettingConfig, "key" | "namespace">} config
 */
function register(key, config) {
  game.settings.register(MODULE_ID, key, { ...config, key, namespace: MODULE_ID });
}
