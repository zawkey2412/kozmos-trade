import { MODES, MODULE_ID, SETTINGS } from "./constants.mjs";
import { marketRuleField } from "./data/flags.mjs";
import { featuresFor } from "./data/modes.mjs";
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

  register(SETTINGS.NO_COMBAT, {
    name: "KT.Settings.NoCombat.Name",
    hint: "KT.Settings.NoCombat.Hint",
    scope: "world",
    config: true,
    type: new foundry.data.fields.BooleanField({ initial: true }),
  });

  register(SETTINGS.ATTITUDE_SCOPE, {
    name: "KT.Settings.AttitudeScope.Name",
    hint: "KT.Settings.AttitudeScope.Hint",
    scope: "world",
    config: true,
    type: new foundry.data.fields.StringField({
      required: true,
      blank: false,
      initial: "character",
      choices: { character: "KT.Settings.AttitudeScope.Character", party: "KT.Settings.AttitudeScope.Party" },
    }),
  });

  register(SETTINGS.ATTITUDE_DECAY, {
    name: "KT.Settings.AttitudeDecay.Name",
    hint: "KT.Settings.AttitudeDecay.Hint",
    scope: "world",
    config: true,
    type: new foundry.data.fields.BooleanField({ initial: false }),
  });

  register(SETTINGS.REACTIONS, {
    name: "KT.Settings.Reactions.Name",
    hint: "KT.Settings.Reactions.Hint",
    scope: "world",
    config: true,
    type: new foundry.data.fields.BooleanField({ initial: true }),
  });

  register(SETTINGS.GREETING, {
    name: "KT.Settings.Greeting.Name",
    hint: "KT.Settings.Greeting.Hint",
    scope: "world",
    config: true,
    type: new foundry.data.fields.BooleanField({ initial: false }),
  });

  register(SETTINGS.THEFT_APPROVAL, {
    name: "KT.Settings.TheftApproval.Name",
    hint: "KT.Settings.TheftApproval.Hint",
    scope: "world",
    config: true,
    type: new foundry.data.fields.StringField({
      required: true,
      blank: false,
      initial: "rare",
      choices: { none: "KT.Settings.TheftApproval.None", rare: "KT.Settings.TheftApproval.Rare", all: "KT.Settings.TheftApproval.All" },
    }),
  });

  register(SETTINGS.SOUND_VOLUME, {
    name: "KT.Settings.SoundVolume.Name",
    hint: "KT.Settings.SoundVolume.Hint",
    scope: "client",
    config: true,
    type: new foundry.data.fields.NumberField({ required: true, nullable: false, min: 0, max: 1, step: 0.05, initial: 0.5 }),
  });

  register(SETTINGS.COIN_BURST, {
    name: "KT.Settings.CoinBurst.Name",
    hint: "KT.Settings.CoinBurst.Hint",
    scope: "client",
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

  register(SETTINGS.RESTOCK_DAYS, {
    name: "KT.Settings.RestockDays.Name",
    hint: "KT.Settings.RestockDays.Hint",
    scope: "world",
    config: true,
    type: new foundry.data.fields.NumberField({ required: true, nullable: false, integer: true, min: 0, initial: 0 }),
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

  // The GM's feature toggles that differ from each mode's preset.
  register(SETTINGS.FEATURES, {
    name: "KT.Features.Title",
    hint: "KT.Features.Hint",
    scope: "world",
    config: false,
    type: new foundry.data.fields.ObjectField({ initial: {} }),
  });

  // Market rules for the whole world.
  register(SETTINGS.MARKET, {
    name: "KT.Market.Rules.Title",
    hint: "KT.Market.Rules.Hint",
    scope: "world",
    config: false,
    type: new foundry.data.fields.ArrayField(marketRuleField()),
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

// Whether a feature is on: the mode's preset, then the GM's own toggle.
/** @param {Feature} name */
export function feature(name) {
  return featuresFor(game.settings.get(MODULE_ID, SETTINGS.MODE), game.settings.get(MODULE_ID, SETTINGS.FEATURES))[name];
}

/**
 * @param {string} key
 * @param {Omit<SettingConfig, "key" | "namespace">} config
 */
function register(key, config) {
  game.settings.register(MODULE_ID, key, { ...config, key, namespace: MODULE_ID });
}
