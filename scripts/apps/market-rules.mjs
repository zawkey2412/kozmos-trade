// Market rules: the GM adds and removes temporary price changes for the world or the current scene.
import { MODULE_ID } from "../constants.mjs";
import { clock } from "../adapter/dnd5e.mjs";
import { MARKET_CATEGORIES, percentOf } from "../engine/market.mjs";
import { daysSince } from "../engine/visits.mjs";
import { warn } from "../services/errors.mjs";
import { addMarketRule, removeMarketRule, sceneRules, worldRules } from "../services/market-rules.mjs";
import { feature } from "../settings.mjs";
import { HandlebarsApplication } from "./base.mjs";

/** @import { MarketRule } from "../engine/market.mjs"; */

export default class MarketRules extends HandlebarsApplication {
  static DEFAULT_OPTIONS = {
    id: "kt-market-rules",
    tag: "form",
    classes: ["kozmos-trade", "kt-market-rules"],
    window: { title: "KT.Market.Rules.Title", icon: "fa-solid fa-chart-line", contentClasses: ["standard-form"] },
    position: { width: 600 },
    form: { handler: MarketRules.#onSubmit, closeOnSubmit: false },
    actions: { remove: MarketRules.#onRemove },
  };

  static PARTS = {
    rules: { template: `modules/${MODULE_ID}/templates/market-rules.hbs`, scrollable: [".kt-rule-list"] },
    footer: { template: "templates/generic/form-footer.hbs" },
  };

  static open() {
    const existing = foundry.applications.instances.get(MarketRules.DEFAULT_OPTIONS.id);
    if (existing) return existing.render({ force: true });
    return new MarketRules().render({ force: true });
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const scene = /** @type {any} */ (canvas)?.scene ?? null;
    const now = clock();
    /**
     * @param {MarketRule} rule
     * @param {string} where
     */
    const row = (rule, where) => {
      const percent = percentOf(rule.multiplier);
      return {
        id: rule.id,
        name: rule.name,
        where,
        change: `${percent > 0 ? "+" : ""}${percent}%`,
        categories: marketCategoryLabel(rule.categories),
        ends: endsLabel(rule.until, now),
        ended: rule.until !== null && now.now >= rule.until,
      };
    };
    return Object.assign(context, {
      off: !feature("market"),
      rows: [
        ...worldRules().map((rule) => row(rule, game.i18n.localize("KT.Market.Rules.World"))),
        ...(scene ? sceneRules(scene).map((rule) => row(rule, scene.name)) : []),
      ],
      scopes: { world: "KT.Market.Rules.World", ...(scene ? { scene: game.i18n.localize("KT.Market.Rules.ThisScene", { name: scene.name }) } : {}) },
      categories: Object.fromEntries(MARKET_CATEGORIES.map((id) => [id, `KT.Category.${id}`])),
      buttons: [{ type: "submit", icon: "fa-solid fa-plus", label: "KT.Market.Rules.Add" }],
    });
  }

  /**
   * @this {MarketRules}
   * @param {SubmitEvent} event
   * @param {HTMLFormElement} form
   * @param {any} formData
   */
  static async #onSubmit(event, form, formData) {
    // Form data has no static shape.
    const data = /** @type {any} */ (formData.object);
    const scene = data.scope === "scene" ? /** @type {any} */ (canvas)?.scene ?? null : null;
    try {
      await addMarketRule({ name: data.name, categories: data.categories, percent: data.percent, days: data.days }, { scene });
      this.render();
    } catch (error) {
      warn(error);
    }
  }

  /**
   * @this {MarketRules}
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static async #onRemove(event, target) {
    await removeMarketRule(target.dataset.rule).catch((error) => warn(error));
    this.render();
  }
}

// The categories a rule covers, in words.
/** @param {string[]} categories */
export function marketCategoryLabel(categories) {
  if (!categories.length) return game.i18n.localize("KT.Market.Rules.AllGoods");
  return categories.map((id) => game.i18n.localize(`KT.Category.${id}`)).join(", ");
}

/**
 * @param {number | null} until
 * @param {{ now: number, day: number, week: number }} now
 */
function endsLabel(until, now) {
  if (until === null) return game.i18n.localize("KT.Market.Rules.NoEnd");
  if (now.now >= until) return game.i18n.localize("KT.Market.Rules.Ended");
  const days = daysSince(now.now, { ...now, now: until });
  if (days === 0) return game.i18n.localize("KT.Market.Rules.EndsToday");
  return game.i18n.localize("KT.Market.Rules.EndsIn", { days: new Intl.NumberFormat(game.i18n.lang).format(days) });
}

export function registerMarketRulesMenu() {
  game.settings.registerMenu(MODULE_ID, "marketRules", {
    name: "KT.Market.Rules.Title",
    label: "KT.Market.Rules.Open",
    hint: "KT.Market.Rules.Hint",
    icon: "fa-solid fa-chart-line",
    type: /** @type {any} */ (MarketRules),
    restricted: true,
  });
}
