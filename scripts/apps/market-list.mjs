// The Shops list: merchants the party has met, with a Trade button where the GM allows trading from afar.
import { MODULE_ID } from "../constants.mjs";
import { warn } from "../services/errors.mjs";
import { openTrade, pickCustomer } from "../services/open-trade.mjs";
import { MESSAGES, request } from "../services/socket.mjs";
import ConfigureShop from "./configure-shop.mjs";
import MarketRules from "./market-rules.mjs";
import { HandlebarsApplication } from "./base.mjs";

/** @import { MarketRow } from "../services/market-list.mjs"; */

export default class MarketList extends HandlebarsApplication {
  static DEFAULT_OPTIONS = {
    id: "kt-market-list",
    classes: ["kozmos-trade", "kt-market-list"],
    window: { title: "KT.Market.Title", icon: "fa-solid fa-store", resizable: true },
    position: { width: 480, height: 560 },
    actions: {
      trade: MarketList.#onTrade,
      configure: MarketList.#onConfigure,
      reload: MarketList.#onReload,
      rules: MarketList.#onRules,
    },
  };

  static PARTS = {
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
      rows: rows.map((row) => ({
        ...row,
        status: game.i18n.localize(row.open ? "KT.Market.Open" : "KT.Market.Closed"),
        visited: visitedLabel(row.days),
        canTrade: gm || (row.open && row.remote),
        note: gm ? (row.remote ? game.i18n.localize("KT.Market.RemoteOn") : null) : row.open && !row.remote ? game.i18n.localize("KT.Market.InPerson") : null,
      })),
      empty: game.i18n.localize(gm ? "KT.Market.EmptyGM" : "KT.Market.Empty"),
    });
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

  /** @this {MarketList} */
  static #onReload() {
    this.render();
  }

  /** @this {MarketList} */
  static #onRules() {
    MarketRules.open();
  }
}

/** @param {number | null} days */
export function visitedLabel(days) {
  if (days === null) return game.i18n.localize("KT.Market.NotVisited");
  if (days === 0) return game.i18n.localize("KT.Market.VisitedToday");
  if (days === 1) return game.i18n.localize("KT.Market.VisitedYesterday");
  return game.i18n.localize("KT.Market.VisitedDays", { days: new Intl.NumberFormat(game.i18n.lang).format(days) });
}
