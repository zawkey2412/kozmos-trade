// Archetype editor: the GM changes archetypes and adds their own.
import { MODULE_ID } from "../constants.mjs";
import { cleanArchetype } from "../engine/fit.mjs";
import { servicesFromGold, servicesToGold } from "../engine/services.mjs";
import { ARCHETYPE_ID, archetypeLabel, baseArchetypes, getArchetypes, isBuiltIn, saveArchetypes } from "../services/archetypes.mjs";
import { HandlebarsApplication } from "./base.mjs";

/** @import { Archetype } from "../engine/fit.mjs"; */

/**
 * @typedef {object} Draft
 * @property {string} label
 * @property {boolean} fence
 * @property {string[]} skills
 * @property {string} tools
 * @property {string} stocks
 * @property {string} favored
 * @property {string} reactions
 * @property {string} services
 */

export default class ArchetypeEditor extends HandlebarsApplication {
  static DEFAULT_OPTIONS = {
    id: "kt-archetype-editor",
    tag: "form",
    classes: ["kozmos-trade", "kt-archetype-editor"],
    window: { title: "KT.Archetypes.Title", icon: "fa-solid fa-shop", resizable: true, contentClasses: ["standard-form"] },
    position: { width: 780, height: 680 },
    form: { handler: ArchetypeEditor.#onSubmit, closeOnSubmit: false },
    actions: { select: ArchetypeEditor.#onSelect, create: ArchetypeEditor.#onCreate, remove: ArchetypeEditor.#onRemove },
  };

  static PARTS = {
    editor: { template: `modules/${MODULE_ID}/templates/archetype-editor.hbs`, scrollable: [".kt-archetype-list", ".kt-archetype-form"] },
    footer: { template: "templates/generic/form-footer.hbs" },
  };

  constructor(options = {}) {
    super(options);
    /** @type {Record<string, Draft>} */
    this.drafts = Object.fromEntries(Object.entries(getArchetypes()).map(([id, archetype]) => [id, toDraft(archetype)]));
    this.selected = Object.keys(this.drafts)[0];
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const skills = /** @type {any} */ (CONFIG).DND5E.skills;
    const draft = this.drafts[this.selected];
    return Object.assign(context, {
      archetypes: Object.entries(this.drafts).map(([id, d]) => ({ id, label: d.label || archetypeLabel(id), active: id === this.selected, custom: !isBuiltIn(id) })),
      selected: draft ? { id: this.selected, ...draft, placeholder: archetypeLabel(this.selected), custom: !isBuiltIn(this.selected) } : null,
      skillOptions: Object.fromEntries(Object.entries(skills).map(([key, skill]) => [key, skill.label])),
      buttons: [{ type: "submit", icon: "fa-solid fa-floppy-disk", label: "KT.Configure.Save" }],
    });
  }

  // Keeps what the GM typed for the archetype on screen.
  #capture() {
    if (!this.selected || !this.drafts[this.selected] || !this.element) return;
    // Form data has no static shape.
    const data = /** @type {any} */ (new foundry.applications.ux.FormDataExtended(this.element)).object;
    this.drafts[this.selected] = {
      label: String(data.label ?? ""),
      fence: Boolean(data.fence),
      skills: Array.isArray(data.skills) ? data.skills : data.skills ? [data.skills] : [],
      tools: String(data.tools ?? ""),
      stocks: String(data.stocks ?? "[]"),
      favored: String(data.favored ?? "[]"),
      reactions: String(data.reactions ?? ""),
      services: String(data.services ?? ""),
    };
  }

  /** @this {ArchetypeEditor} */
  static async #onSubmit() {
    this.#capture();
    /** @type {Record<string, Archetype>} */
    const archetypes = {};
    for (const [id, draft] of Object.entries(this.drafts)) {
      try {
        archetypes[id] = fromDraft(draft);
      } catch (error) {
        this.selected = id;
        this.render();
        return ui.notifications.error(game.i18n.localize("KT.Archetypes.Invalid", { name: draft.label || archetypeLabel(id), error: error.message }));
      }
    }
    await saveArchetypes(archetypes);
    ui.notifications.info("KT.Archetypes.Saved", { localize: true });
    this.close();
  }

  /**
   * @this {ArchetypeEditor}
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static #onSelect(event, target) {
    this.#capture();
    this.selected = target.dataset.id;
    this.render();
  }

  /** @this {ArchetypeEditor} */
  static async #onCreate() {
    this.#capture();
    const result = await foundry.applications.api.DialogV2.input(/** @type {any} */ ({
      window: { title: "KT.Archetypes.New" },
      content: `<div class="form-group"><label>${game.i18n.localize("KT.Archetypes.Name")}</label><div class="form-fields"><input type="text" name="label" required autofocus></div></div>`,
      ok: { label: "KT.Archetypes.Create", icon: "fa-solid fa-plus" },
      rejectClose: false,
    }));
    const label = String(result?.label ?? "").trim();
    if (!label) return;
    let id = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "archetype";
    if (!/^[a-z]/.test(id)) id = `a-${id}`;
    while (this.drafts[id]) id = `${id}-2`;
    if (!ARCHETYPE_ID.test(id)) return;
    this.drafts[id] = toDraft({ label, stocks: [], favored: [], fence: false, skills: [], tools: [] });
    this.selected = id;
    this.render();
  }

  /** @this {ArchetypeEditor} */
  static #onRemove() {
    const id = this.selected;
    if (isBuiltIn(id)) this.drafts[id] = toDraft(baseArchetypes()[id]);
    else {
      delete this.drafts[id];
      this.selected = Object.keys(this.drafts)[0];
    }
    this.render();
  }
}

export function registerArchetypeMenu() {
  game.settings.registerMenu(MODULE_ID, "archetypeEditor", {
    name: "KT.Archetypes.Title",
    label: "KT.Archetypes.Open",
    hint: "KT.Archetypes.Hint",
    icon: "fa-solid fa-shop",
    type: /** @type {any} */ (ArchetypeEditor),
    restricted: true,
  });
}

/**
 * @param {Archetype} archetype
 * @returns {Draft}
 */
function toDraft(archetype) {
  return {
    label: archetype.label ?? "",
    fence: Boolean(archetype.fence),
    skills: [...archetype.skills],
    tools: archetype.tools.join(", "),
    stocks: JSON.stringify(archetype.stocks, null, 2),
    favored: JSON.stringify(archetype.favored, null, 2),
    reactions: archetype.reactions ? JSON.stringify(archetype.reactions, null, 2) : "",
    services: archetype.services ? JSON.stringify(servicesToGold(archetype.services), null, 2) : "",
  };
}

/**
 * @param {Draft} draft
 * @returns {Archetype}
 */
function fromDraft(draft) {
  const parse = (/** @type {string} */ text, /** @type {string} */ name, empty = "[]") => {
    try {
      return JSON.parse(text.trim() || empty);
    } catch {
      throw new Error(game.i18n.localize("KT.Archetypes.BadJson", { field: name }));
    }
  };
  return cleanArchetype({
    label: draft.label,
    fence: draft.fence,
    skills: draft.skills,
    tools: draft.tools.split(",").map((tool) => tool.trim()).filter(Boolean),
    stocks: parse(draft.stocks, game.i18n.localize("KT.Archetypes.Stocks")),
    favored: parse(draft.favored, game.i18n.localize("KT.Archetypes.Favored")),
    reactions: parse(draft.reactions, game.i18n.localize("KT.Archetypes.Reactions"), "{}"),
    ...(draft.services.trim() ? { services: servicesFromGold(parse(draft.services, game.i18n.localize("KT.Archetypes.Services"))) } : {}),
  });
}
