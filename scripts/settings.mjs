import { MODES, MODULE_ID, SETTINGS } from "./constants.mjs";
import { MODE_FEATURES } from "./data/modes.mjs";
import { forgetArchetypes } from "./services/archetypes.mjs";
import { TABLES } from "./data/tables.mjs";

/** @import { SettingConfig } from "@client/_types.mjs"; */
/** @import { Feature } from "./data/modes.mjs"; */

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

  register(SETTINGS.PROXIMITY, {
    name: "KT.Settings.Proximity.Name",
    hint: "KT.Settings.Proximity.Hint",
    scope: "world",
    config: true,
    type: new foundry.data.fields.BooleanField({ initial: false }),
  });

  register(SETTINGS.COMPENDIUMS, {
    name: "KT.Settings.Compendiums.Name",
    hint: "KT.Settings.Compendiums.Hint",
    scope: "world",
    config: true,
    type: new foundry.data.fields.SetField(
      new foundry.data.fields.StringField({
        choices: () => Object.fromEntries(game.packs.filter((pack) => pack.documentName === "Item").map((pack) => [pack.collection, pack.title])),
      }),
    ),
  });

  // The GM's archetypes and changes to the defaults.
  register(SETTINGS.ARCHETYPES, {
    name: "KT.Archetypes.Title",
    hint: "KT.Archetypes.Hint",
    scope: "world",
    config: false,
    type: new foundry.data.fields.ObjectField({ initial: {} }),
    onChange: () => forgetArchetypes(),
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

// Whether a feature is on in the world's complexity mode.
/** @param {Feature} name */
export function feature(name) {
  const mode = game.settings.get(MODULE_ID, SETTINGS.MODE);
  return Boolean(MODE_FEATURES[mode]?.[name]);
}

/**
 * @param {string} key
 * @param {Omit<SettingConfig, "key" | "namespace">} config
 */
function register(key, config) {
  game.settings.register(MODULE_ID, key, { ...config, key, namespace: MODULE_ID });
}
