import { MODES, MODULE_ID, SETTINGS } from "./constants.mjs";
import { TABLES } from "./data/tables.mjs";

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

  // The GM's changes to the default tables.
  register(SETTINGS.TABLES, {
    name: "KT.Settings.Tables.Name",
    hint: "KT.Settings.Tables.Hint",
    scope: "world",
    config: false,
    type: new foundry.data.fields.ObjectField({ initial: {} }),
  });
}

// Default tables with the GM's changes laid over them.
/** @returns {typeof TABLES} */
export function getTables() {
  const changes = game.settings.get(MODULE_ID, SETTINGS.TABLES);
  return /** @type {typeof TABLES} */ (foundry.utils.mergeObject(TABLES, changes, { inplace: false }));
}

/**
 * @param {string} key
 * @param {Omit<SettingConfig, "key" | "namespace">} config
 */
function register(key, config) {
  game.settings.register(MODULE_ID, key, { ...config, key, namespace: MODULE_ID });
}
