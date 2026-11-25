// Feature toggles: the GM starts from the complexity preset and turns single features on or off.
import { MODULE_ID, SETTINGS } from "../constants.mjs";
import { changesFrom, FEATURES, featuresFor, MODE_FEATURES } from "../data/modes.mjs";
import { HandlebarsApplication } from "./base.mjs";

export default class FeatureToggles extends HandlebarsApplication {
  static DEFAULT_OPTIONS = {
    id: "kt-feature-toggles",
    tag: "form",
    classes: ["kozmos-trade", "kt-feature-toggles"],
    window: { title: "KT.Features.Title", icon: "fa-solid fa-sliders", contentClasses: ["standard-form"] },
    position: { width: 560 },
    form: { handler: FeatureToggles.#onSubmit, closeOnSubmit: true },
    actions: { reset: FeatureToggles.#onReset },
  };

  static PARTS = {
    features: { template: `modules/${MODULE_ID}/templates/feature-toggles.hbs` },
    footer: { template: "templates/generic/form-footer.hbs" },
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const mode = game.settings.get(MODULE_ID, SETTINGS.MODE);
    const preset = MODE_FEATURES[mode] ?? MODE_FEATURES.standard;
    const current = featuresFor(mode, game.settings.get(MODULE_ID, SETTINGS.FEATURES));
    const modeLabel = game.i18n.localize(`KT.Settings.Mode.${mode.capitalize()}`);
    return Object.assign(context, {
      intro: game.i18n.localize("KT.Features.Intro", { mode: modeLabel }),
      features: FEATURES.map((name) => ({
        name,
        label: `KT.Features.${name}.Name`,
        hint: `KT.Features.${name}.Hint`,
        checked: current[name],
        changed: current[name] !== preset[name],
        preset: game.i18n.localize(preset[name] ? "KT.Features.PresetOn" : "KT.Features.PresetOff", { mode: modeLabel }),
      })),
      buttons: [
        { type: "button", action: "reset", icon: "fa-solid fa-rotate-left", label: "KT.Features.Reset" },
        { type: "submit", icon: "fa-solid fa-floppy-disk", label: "KT.Configure.Save" },
      ],
    });
  }

  /**
   * @this {FeatureToggles}
   * @param {SubmitEvent} event
   * @param {HTMLFormElement} form
   * @param {any} formData
   */
  static async #onSubmit(event, form, formData) {
    const mode = game.settings.get(MODULE_ID, SETTINGS.MODE);
    const all = foundry.utils.deepClone(game.settings.get(MODULE_ID, SETTINGS.FEATURES));
    all[mode] = changesFrom(mode, formData.object);
    await game.settings.set(MODULE_ID, SETTINGS.FEATURES, all);
  }

  /** @this {FeatureToggles} */
  static async #onReset() {
    const mode = game.settings.get(MODULE_ID, SETTINGS.MODE);
    const all = foundry.utils.deepClone(game.settings.get(MODULE_ID, SETTINGS.FEATURES));
    delete all[mode];
    await game.settings.set(MODULE_ID, SETTINGS.FEATURES, all);
    this.render();
  }
}

export function registerFeatureMenu() {
  game.settings.registerMenu(MODULE_ID, "featureToggles", {
    name: "KT.Features.Title",
    label: "KT.Features.Open",
    hint: "KT.Features.Hint",
    icon: "fa-solid fa-sliders",
    type: /** @type {any} */ (FeatureToggles),
    restricted: true,
  });
}
