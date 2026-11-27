// Features: the GM picks a complexity preset, turns single features on or off, and sets each feature's own rules.
import { MODES, MODULE_ID, SETTINGS } from "../constants.mjs";
import { changesFrom, FEATURES, featuresFor, MODE_FEATURES } from "../data/modes.mjs";
import { HandlebarsApplication } from "./base.mjs";
import { loadPartials } from "./cards.mjs";

/** @import { Feature } from "../data/modes.mjs"; */

/**
 * @typedef {object} RuleField
 * @property {string} key
 * @property {string} label
 * @property {string} hint
 * @property {Record<string, string>} [choices]
 */

// Settings that belong to one feature, shown under it while it is on.
/** @type {Partial<Record<Feature, RuleField[]>>} */
const FEATURE_RULES = {
  attitude: [
    { key: SETTINGS.ATTITUDE_SCOPE, label: "KT.Settings.AttitudeScope.Name", hint: "KT.Settings.AttitudeScope.Hint", choices: { character: "KT.Settings.AttitudeScope.Character", party: "KT.Settings.AttitudeScope.Party" } },
    { key: SETTINGS.ATTITUDE_DECAY, label: "KT.Settings.AttitudeDecay.Name", hint: "KT.Settings.AttitudeDecay.Hint" },
  ],
  theft: [
    { key: SETTINGS.THEFT_APPROVAL, label: "KT.Settings.TheftApproval.Name", hint: "KT.Settings.TheftApproval.Hint", choices: { none: "KT.Settings.TheftApproval.None", rare: "KT.Settings.TheftApproval.Rare", all: "KT.Settings.TheftApproval.All" } },
  ],
};

// Rules for every trade, whatever the preset.
/** @type {RuleField[]} */
const TRADING_RULES = [
  { key: SETTINGS.PROXIMITY, label: "KT.Settings.Proximity.Name", hint: "KT.Settings.Proximity.Hint" },
  { key: SETTINGS.NO_COMBAT, label: "KT.Settings.NoCombat.Name", hint: "KT.Settings.NoCombat.Hint" },
  { key: SETTINGS.REACTIONS, label: "KT.Settings.Reactions.Name", hint: "KT.Settings.Reactions.Hint" },
  { key: SETTINGS.GREETING, label: "KT.Settings.Greeting.Name", hint: "KT.Settings.Greeting.Hint" },
];

const RULE_KEYS = [...Object.values(FEATURE_RULES).flat(), ...TRADING_RULES].map((field) => field.key);

export default class FeatureToggles extends HandlebarsApplication {
  static DEFAULT_OPTIONS = {
    id: "kt-feature-toggles",
    tag: "form",
    classes: ["kozmos-trade", "kt-feature-toggles"],
    window: { title: "KT.Features.Title", icon: "fa-solid fa-sliders", contentClasses: ["standard-form"], resizable: true },
    position: { width: 600, height: 720 },
    form: { handler: FeatureToggles.#onSubmit, closeOnSubmit: true },
    actions: { reset: FeatureToggles.#onReset },
  };

  static PARTS = {
    features: { template: `modules/${MODULE_ID}/templates/feature-toggles.hbs`, scrollable: [""] },
    footer: { template: "templates/generic/form-footer.hbs" },
  };

  constructor(options = {}) {
    super(options);
    /** @type {string} */
    this.mode = game.settings.get(MODULE_ID, SETTINGS.MODE);
    // Unsaved toggles for each preset, and unsaved rules.
    /** @type {Record<string, Record<string, boolean>>} */
    this.draft = {};
    /** @type {Record<string, unknown>} */
    this.rules = {};
  }

  async _preFirstRender(context, options) {
    await super._preFirstRender(context, options);
    await loadPartials();
  }

  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    this.element.addEventListener("change", (event) => {
      const target = /** @type {HTMLInputElement} */ (event.target);
      if (target.name === "mode") {
        this.#keepDraft();
        this.mode = target.value;
        this.render({ parts: ["features"] });
      } else if (target.name?.startsWith("features.")) this.#showRules();
    });
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    this.#showRules();
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const preset = MODE_FEATURES[this.mode] ?? MODE_FEATURES.standard;
    const saved = featuresFor(this.mode, game.settings.get(MODULE_ID, SETTINGS.FEATURES));
    const current = { ...saved, ...(this.draft[this.mode] ?? {}) };
    const modeLabel = game.i18n.localize(`KT.Settings.Mode.${this.mode.capitalize()}`);
    return Object.assign(context, {
      mode: this.mode,
      modes: Object.fromEntries(Object.values(MODES).map((id) => [id, `KT.Settings.Mode.${id.capitalize()}`])),
      intro: game.i18n.localize("KT.Features.Intro", { mode: modeLabel }),
      features: FEATURES.map((name) => ({
        name,
        label: `KT.Features.${name}.Name`,
        hint: `KT.Features.${name}.Hint`,
        checked: current[name],
        changed: current[name] !== preset[name],
        preset: game.i18n.localize(preset[name] ? "KT.Features.PresetOn" : "KT.Features.PresetOff", { mode: modeLabel }),
        rules: (FEATURE_RULES[name] ?? []).map((field) => this.#ruleContext(field)),
      })),
      trading: TRADING_RULES.map((field) => this.#ruleContext(field)),
      buttons: [
        { type: "button", action: "reset", icon: "fa-solid fa-rotate-left", label: "KT.Features.Reset" },
        { type: "submit", icon: "fa-solid fa-floppy-disk", label: "KT.Configure.Save" },
      ],
    });
  }

  /** @param {RuleField} field */
  #ruleContext(field) {
    const value = field.key in this.rules ? this.rules[field.key] : game.settings.get(MODULE_ID, field.key);
    return { name: `rules.${field.key}`, id: `${this.id}-${field.key}`, label: field.label, hint: field.hint, choices: field.choices ?? null, value };
  }

  // The form as it is now, kept while the GM switches presets.
  #keepDraft() {
    // Form data has no static shape.
    const data = /** @type {any} */ (foundry.utils.expandObject(/** @type {any} */ (new foundry.applications.ux.FormDataExtended(this.element)).object));
    this.draft[this.mode] = { ...(data.features ?? {}) };
    Object.assign(this.rules, data.rules ?? {});
  }

  // A feature's own rules show only while it is on.
  #showRules() {
    for (const group of this.element.querySelectorAll("[data-rules-for]")) {
      const box = /** @type {HTMLInputElement | null} */ (this.element.querySelector(`input[name="features.${/** @type {HTMLElement} */ (group).dataset.rulesFor}"]`));
      group.classList.toggle("hidden", !box?.checked);
    }
  }

  /**
   * @this {FeatureToggles}
   * @param {SubmitEvent} event
   * @param {HTMLFormElement} form
   * @param {any} formData
   */
  static async #onSubmit(event, form, formData) {
    this.#keepDraft();
    const all = foundry.utils.deepClone(game.settings.get(MODULE_ID, SETTINGS.FEATURES));
    for (const [mode, chosen] of Object.entries(this.draft)) all[mode] = changesFrom(mode, chosen);
    await game.settings.set(MODULE_ID, SETTINGS.FEATURES, all);
    await game.settings.set(MODULE_ID, SETTINGS.MODE, this.mode);
    for (const key of RULE_KEYS) {
      if (key in this.rules && this.rules[key] !== game.settings.get(MODULE_ID, key)) await game.settings.set(MODULE_ID, key, this.rules[key]);
    }
  }

  /** @this {FeatureToggles} */
  static async #onReset() {
    const all = foundry.utils.deepClone(game.settings.get(MODULE_ID, SETTINGS.FEATURES));
    delete all[this.mode];
    delete this.draft[this.mode];
    await game.settings.set(MODULE_ID, SETTINGS.FEATURES, all);
    this.render({ parts: ["features"] });
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
