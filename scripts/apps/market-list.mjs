// The Shops window: for players, merchants the party has met. For the GM, every shop and the selected NPC token, in one place.
import { MODULE_ID } from "../constants.mjs";
import { merchantFlags } from "../data/flags.mjs";
import { warn } from "../services/errors.mjs";
import { identityOf } from "../services/identity.mjs";
import { openTrade, pickCustomer } from "../services/open-trade.mjs";
import { archetypeLabel } from "../services/archetypes.mjs";
import { canBeShop, isShop, saveShop } from "../services/shop.mjs";
import { MESSAGES, request } from "../services/socket.mjs";
import ConfigureShop from "./configure-shop.mjs";
import MarketRules from "./market-rules.mjs";
import { HandlebarsApplication } from "./base.mjs";

/** @import { MarketRow } from "../services/market-list.mjs"; */

const KIND_ICONS = { unique: "fa-user", generic: "fa-users" };

export default class MarketList extends HandlebarsApplication {
  static DEFAULT_OPTIONS = {
    id: "kt-market-list",
    classes: ["kozmos-trade", "kt-market-list"],
    window: { title: "KT.Market.Title", icon: "fa-solid fa-store", resizable: true },
    position: { width: 540, height: 640 },
    actions: {
      trade: MarketList.#onTrade,
      configure: MarketList.#onConfigure,
      find: MarketList.#onFind,
      toggleOpen: MarketList.#onToggleOpen,
      tradeSelected: MarketList.#onTradeSelected,
      configureSelected: MarketList.#onConfigureSelected,
      reload: MarketList.#onReload,
      rules: MarketList.#onRules,
    },
  };

  static PARTS = {
    selected: { template: `modules/${MODULE_ID}/templates/market-selected.hbs` },
    list: { template: `modules/${MODULE_ID}/templates/market-list.hbs`, scrollable: [".kt-market-rows"] },
  };

  static toggle() {
    const existing = foundry.applications.instances.get(MarketList.DEFAULT_OPTIONS.id);
    if (existing) return existing.close();
    return new MarketList().render({ force: true });
  }

  // Open lists ask the GM again.
  static refreshAll() {
    const existing = /** @type {any} */ (foundry.applications.instances.get(MarketList.DEFAULT_OPTIONS.id));
    if (existing?.rendered) existing.render();
  }

  constructor(options = {}) {
    super(options);
    this.search = "";
    /** @type {number | null} */
    this.selectionHook = null;
    this.redrawSelected = foundry.utils.debounce(() => this.rendered && this.render({ parts: ["selected"] }), 100);
  }

  _configureRenderParts(options) {
    const parts = super._configureRenderParts(options);
    if (!game.user.isGM) delete parts.selected;
    return parts;
  }

  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    if (game.user.isGM) this.selectionHook = Hooks.on("controlToken", () => this.redrawSelected());
    this.element.addEventListener("input", (event) => {
      const target = /** @type {HTMLInputElement} */ (event.target);
      if (!target.matches(".kt-market-search")) return;
      this.search = target.value;
      this.#applySearch();
    });
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    this.#applySearch();
  }

  async _onClose(options) {
    await super._onClose(options);
    if (this.selectionHook !== null) Hooks.off("controlToken", this.selectionHook);
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    /** @type {MarketRow[]} */
    let rows = [];
    let problem = null;
    try {
      rows = await request(MESSAGES.MARKET_LIST);
    } catch (error) {
      problem = error;
    }
    if (problem) warn(problem);
    const gm = game.user.isGM;
    return Object.assign(context, {
      gm,
      search: this.search,
      ...(gm ? this.#selectedContext() : {}),
      rows: rows.map((row) => ({
        ...row,
        status: game.i18n.localize(row.open ? "KT.Market.Open" : "KT.Market.Closed"),
        visited: visitedLabel(row.days),
        kindIcon: KIND_ICONS[row.kind],
        kindLabel: game.i18n.localize(`KT.Market.Kind.${row.kind}`),
        canTrade: gm || (row.open && row.remote),
        note: gm ? (row.remote ? game.i18n.localize("KT.Market.RemoteOn") : null) : row.open && !row.remote ? game.i18n.localize("KT.Market.InPerson") : null,
      })),
      empty: game.i18n.localize(gm ? "KT.Market.EmptyGM" : "KT.Market.Empty"),
    });
  }

  // The one selected NPC token, or a hint about what to select.
  #selectedContext() {
    const actor = selectedActor();
    if (!actor) {
      const count = selectedTokens().length;
      return { selected: null, selectedHint: game.i18n.localize(count > 1 ? "KT.Market.Selected.Many" : count ? "KT.Market.Selected.NotNpc" : "KT.Market.Selected.None") };
    }
    const shop = isShop(actor);
    const flags = merchantFlags(actor);
    const status = shop
      ? game.i18n.localize("KT.Market.Selected.Shop", { archetype: archetypeLabel(flags.archetype), state: game.i18n.localize(flags.open ? "KT.Market.Open" : "KT.Market.Closed"), kind: game.i18n.localize(`KT.Market.Kind.${identityOf(actor)}`) })
      : game.i18n.localize("KT.Market.Selected.NotShop");
    return { selected: { name: actor.name, img: actor.img, shop, status } };
  }

  #applySearch() {
    const text = this.search.trim().toLocaleLowerCase();
    let shown = 0;
    for (const row of this.element.querySelectorAll(".kt-market-row")) {
      const match = !text || (/** @type {HTMLElement} */ (row).dataset.name ?? "").toLocaleLowerCase().includes(text);
      row.classList.toggle("hidden", !match);
      if (match) shown++;
    }
    this.element.querySelector(".kt-market-nomatch")?.classList.toggle("hidden", shown > 0);
  }

  /**
   * @this {MarketList}
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static async #onTrade(event, target) {
    const uuid = /** @type {HTMLElement} */ (target.closest("[data-uuid]")).dataset.uuid;
    if (!game.user.isGM) return openTrade(null, uuid, { remote: true });
    try {
      const customer = await pickCustomer();
      if (customer) await openTrade(customer, uuid, { remote: true });
    } catch (error) {
      warn(error);
    }
  }

  /**
   * @this {MarketList}
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static async #onConfigure(event, target) {
    const uuid = /** @type {HTMLElement} */ (target.closest("[data-uuid]")).dataset.uuid;
    const actor = await foundry.utils.fromUuid(uuid);
    if (actor) ConfigureShop.open(actor);
  }

  // Shows the merchant's token on the map, switching scene if needed, and selects it.
  /**
   * @this {MarketList}
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static async #onFind(event, target) {
    const scene = /** @type {any} */ (game.scenes.get(target.dataset.scene));
    if (!scene) return;
    if (!scene.isView) await scene.view();
    // The tokens layer has no generated types.
    const token = /** @type {any} */ (canvas).tokens?.get(target.dataset.token);
    if (!token) return;
    token.control({ releaseOthers: true });
    await /** @type {any} */ (canvas).animatePan({ x: token.center.x, y: token.center.y });
  }

  // Opens or closes a shop straight from its row.
  /**
   * @this {MarketList}
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static async #onToggleOpen(event, target) {
    const uuid = /** @type {HTMLElement} */ (target.closest("[data-uuid]")).dataset.uuid;
    const actor = /** @type {any} */ (await foundry.utils.fromUuid(uuid));
    if (!actor) return;
    await saveShop(actor, { shop: { open: !merchantFlags(actor).open } }).catch((error) => warn(error));
  }

  /** @this {MarketList} */
  static async #onTradeSelected() {
    const actor = selectedActor();
    if (!actor) return;
    try {
      const customer = await pickCustomer();
      if (customer) await openTrade(customer, actor);
    } catch (error) {
      warn(error);
    }
  }

  /** @this {MarketList} */
  static #onConfigureSelected() {
    const actor = selectedActor();
    if (actor) ConfigureShop.open(actor);
  }

  /** @this {MarketList} */
  static #onReload() {
    this.render();
  }

  /** @this {MarketList} */
  static #onRules() {
    MarketRules.open();
  }
}

function selectedTokens() {
  // The tokens layer has no generated types.
  return /** @type {any[]} */ (/** @type {any} */ (canvas).tokens?.controlled ?? []);
}

// The NPC behind the one selected token.
function selectedActor() {
  const tokens = selectedTokens();
  const actor = tokens.length === 1 ? tokens[0].actor : null;
  return actor && canBeShop(actor) ? actor : null;
}

/** @param {number | null} days */
export function visitedLabel(days) {
  if (days === null) return game.i18n.localize("KT.Market.NotVisited");
  if (days === 0) return game.i18n.localize("KT.Market.VisitedToday");
  if (days === 1) return game.i18n.localize("KT.Market.VisitedYesterday");
  return game.i18n.localize("KT.Market.VisitedDays", { days: new Intl.NumberFormat(game.i18n.lang).format(days) });
}
