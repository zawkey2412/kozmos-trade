// The barter window: both inventories, both offer trays and the balance between them.
// Documents are typed any here because their schema fields have no generated types.
import { MODULE_ID } from "../constants.mjs";
import { coinLabels, combatStats, holdingFacts, itemFacts, locale, purse, rarityLabel } from "../adapter/dnd5e.mjs";
import { merchantFlags } from "../data/flags.mjs";
import { arrange, CATEGORIES, SORTS } from "../engine/catalog.mjs";
import { coinsToCopper, formatCopper } from "../engine/money.mjs";
import { tradeable } from "../engine/shelf.mjs";
import { closeTrade } from "../services/open-trade.mjs";
import { buyQuote, sellQuote } from "../services/offer.mjs";
import ConfigureShop from "./configure-shop.mjs";
import { HandlebarsApplication } from "./base.mjs";

/** @import { Snapshot, ShelfItem } from "../services/session.mjs"; */
/** @import { PriceContext } from "../services/offer.mjs"; */

const ATTITUDE_ICONS = {
  hostile: "fa-regular fa-face-angry",
  cold: "fa-regular fa-face-frown",
  neutral: "fa-regular fa-face-meh",
  warm: "fa-regular fa-face-smile",
  friendly: "fa-regular fa-face-grin-beam",
};

const template = (name) => `modules/${MODULE_ID}/templates/barter/${name}.hbs`;

export default class BarterWindow extends HandlebarsApplication {
  static DEFAULT_OPTIONS = {
    classes: ["kozmos-trade", "kt-barter"],
    window: { icon: "fa-solid fa-scale-balanced", resizable: true },
    position: { width: 1280, height: 780 },
    actions: {
      category: BarterWindow.#onCategory,
      configure: BarterWindow.#onConfigure,
    },
  };

  static PARTS = {
    header: { template: template("header") },
    customer: { template: template("customer"), scrollable: [".kt-inventory-list"] },
    give: { template: template("give"), scrollable: [".kt-tray-list"] },
    balance: { template: template("balance") },
    take: { template: template("take"), scrollable: [".kt-tray-list"] },
    merchant: { template: template("merchant"), scrollable: [".kt-inventory-list"] },
    footer: { template: template("footer") },
  };

  /** @type {Promise<void> | null} */
  static #partials = null;

  /**
   * @param {Snapshot} snapshot
   * @param {any} customer
   */
  static async show(snapshot, customer) {
    BarterWindow.#partials ??= foundry.applications.handlebars
      .loadTemplates({
        "kt-card": `modules/${MODULE_ID}/templates/components/card.hbs`,
        "kt-inventory": `modules/${MODULE_ID}/templates/components/inventory.hbs`,
      })
      .then(() => {});
    await BarterWindow.#partials;
    const id = windowId(snapshot.merchant.uuid, customer.uuid);
    const existing = /** @type {any} */ (foundry.applications.instances.get(id));
    if (existing) {
      existing.snapshot = snapshot;
      return existing.render({ force: true });
    }
    return new BarterWindow({ id, snapshot, customer }).render({ force: true });
  }

  /** @param {{ id: string, snapshot: Snapshot, customer: any }} options */
  constructor({ snapshot, customer, ...options }) {
    super(options);
    /** @type {Snapshot} */
    this.snapshot = snapshot;
    this.customer = customer;
    this.view = {
      customer: { category: null, sort: "name", search: "" },
      merchant: { category: null, sort: "name", search: "" },
    };
    /** @type {Map<string, string>} */
    this.tooltips = new Map();
  }

  get title() {
    return game.i18n.localize("KT.Barter.Title", { merchant: this.snapshot.merchant.name, customer: this.customer.name });
  }

  /** @returns {PriceContext} */
  get priceContext() {
    return {
      archetype: this.snapshot.merchant.archetype,
      attitudeAdjustment: this.snapshot.attitude.adjustment,
      haggle: 0,
      market: 1,
    };
  }

  get money() {
    return { locale: locale(), labels: coinLabels() };
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const budget = coinsToCopper(purse(this.customer));
    return Object.assign(context, {
      gm: game.user.isGM,
      header: this.#header(budget),
      customerColumn: this.#column("customer", this.#customerCards(), budget),
      merchantColumn: this.#column("merchant", this.#merchantCards(budget), budget),
    });
  }

  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    this.element.addEventListener("input", (event) => this.#onInput(event));
    this.element.addEventListener("change", (event) => this.#onChange(event));
    this.element.addEventListener("pointerover", (event) => this.#onHover(event));
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    for (const side of ["customer", "merchant"]) this.#applySearch(side);
  }

  async _onClose(options) {
    await super._onClose(options);
    closeTrade(this.customer, { uuid: this.snapshot.merchant.uuid });
  }

  /** @param {number} budget */
  #header(budget) {
    const { merchant, attitude } = this.snapshot;
    const actor = game.user.isGM ? /** @type {any} */ (foundry.utils.fromUuidSync(merchant.uuid)) : null;
    return {
      customer: { name: this.customer.name, img: this.customer.img, coins: formatCopper(budget, this.money) },
      merchant: {
        name: merchant.name,
        img: merchant.img,
        archetype: game.i18n.localize(`KT.Archetype.${merchant.archetype}`),
        purse: merchant.purse,
        exactPurse: actor ? formatCopper(coinsToCopper(purse(actor)), this.money) : null,
      },
      attitude: attitude.on
        ? { label: game.i18n.localize(`KT.Attitude.${attitude.band}`), icon: ATTITUDE_ICONS[attitude.band], band: attitude.band }
        : null,
      mode: game.i18n.localize(`KT.ExecutionMode.${merchant.executionMode}`),
    };
  }

  /**
   * @param {"customer" | "merchant"} side
   * @param {any[]} cards
   * @param {number} budget
   */
  #column(side, cards, budget) {
    const view = this.view[side];
    return {
      side,
      search: view.search,
      chips: CATEGORIES.map((id) => ({ id, label: game.i18n.localize(`KT.Category.${id}`), active: view.category === id })),
      sorts: Object.fromEntries(SORTS.map((id) => [id, `KT.Sort.${id}`])),
      sort: view.sort,
      items: arrange(cards, { category: view.category, sort: view.sort, budget, locale: locale() }),
      empty: game.i18n.localize(side === "customer" ? "KT.Barter.EmptyCustomer" : "KT.Barter.EmptyShelf"),
    };
  }

  #customerCards() {
    const context = this.priceContext;
    const cards = [];
    for (const item of this.customer.items) {
      const facts = itemFacts(item);
      const holding = holdingFacts(item);
      if (!tradeable(facts, holding)) continue;
      const quote = sellQuote(item, context);
      const full = facts.type === "container" && holding.contents > 0;
      const tags = [];
      if (holding.equipped) tags.push(tag("equipped", "fa-solid fa-hand-fist"));
      if (holding.attuned) tags.push(tag("attuned", "fa-solid fa-link"));
      if (full) tags.push(tag("full", "fa-solid fa-box-open"));
      if (facts.identified === false) tags.push(tag("unidentified", "fa-solid fa-question"));
      if (quote.scrap) tags.push(tag("scrap", "fa-solid fa-recycle"));
      if (quote.favored) tags.push(tag("favored", "fa-solid fa-thumbs-up"));
      cards.push({
        ...card(item.id, "customer", item.name, item.img, facts, holding.quantity),
        price: quote.unit,
        priceLabel: quote.forSale ? formatCopper(quote.unit, this.money) : game.i18n.localize("KT.Configure.NotForSale"),
        tags: [rarityTag(facts.rarity), ...tags].filter(Boolean),
        disabled: !quote.forSale || full,
      });
    }
    return cards;
  }

  /** @param {number} budget */
  #merchantCards(budget) {
    const context = this.priceContext;
    const actor = game.user.isGM ? /** @type {any} */ (foundry.utils.fromUuidSync(this.snapshot.merchant.uuid)) : null;
    return this.snapshot.shelf.map((entry) => {
      const unit = buyQuote(entry.price, context).copper;
      const tags = [rarityTag(entry.rarity)];
      if (entry.limited) tags.push(tag("limited", "fa-solid fa-hourglass-half"));
      if (actor?.items.get(entry.id)?.flags?.[MODULE_ID]?.pinned) tags.push(tag("pinned", "fa-solid fa-thumbtack"));
      if (!entry.identified) tags.push(tag("unidentified", "fa-solid fa-question"));
      return {
        ...card(entry.id, "merchant", entry.name, entry.img, entry, entry.quantity),
        price: unit,
        priceLabel: formatCopper(unit, this.money),
        tags: tags.filter(Boolean),
        dim: unit > budget,
      };
    });
  }

  /** @param {string} side */
  #applySearch(side) {
    const text = this.view[side].search.trim().toLocaleLowerCase();
    for (const row of this.element.querySelectorAll(`.kt-inventory[data-side="${side}"] .kt-card`)) {
      const name = row.querySelector(".kt-card-name")?.textContent.toLocaleLowerCase() ?? "";
      row.classList.toggle("hidden", Boolean(text) && !name.includes(text));
    }
  }

  /** @param {Event} event */
  #onInput(event) {
    const target = /** @type {HTMLInputElement} */ (event.target);
    if (!target.matches(".kt-search")) return;
    this.view[target.dataset.side].search = target.value;
    this.#applySearch(target.dataset.side);
  }

  /** @param {Event} event */
  #onChange(event) {
    const target = /** @type {HTMLSelectElement} */ (event.target);
    if (!target.matches(".kt-sort")) return;
    this.view[target.dataset.side].sort = target.value;
    this.render({ parts: [target.dataset.side] });
  }

  /** @param {PointerEvent} event */
  async #onHover(event) {
    const row = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (event.target).closest?.(".kt-card"));
    if (!row || row === this.hovered) return;
    this.hovered = row;
    const html = await this.#tooltip(row.dataset.side, row.dataset.itemId);
    if (this.hovered === row && row.matches(":hover")) game.tooltip.activate(row, { html, cssClass: "kt-tooltip", direction: "LEFT" });
  }

  /**
   * @param {string} side
   * @param {string} id
   */
  async #tooltip(side, id) {
    const key = `${side}.${id}`;
    if (this.tooltips.has(key)) return this.tooltips.get(key);
    const entry = side === "merchant" ? this.snapshot.shelf.find((e) => e.id === id) : null;
    const item = side === "customer" ? this.customer.items.get(id) : null;
    const name = foundry.utils.escapeHTML(entry?.name ?? item?.name ?? "");
    const stats = entry?.stats ?? (item ? combatStats(item) : { damage: null, ac: null });
    const description = entry?.description ?? (item ? item.system?.description?.value ?? "" : "");
    const enriched = await foundry.applications.ux.TextEditor.implementation.enrichHTML(description, { secrets: false });
    const compare = side === "merchant" ? this.#compare(stats) : "";
    const html = `<h4>${name}</h4>${compare}<div class="kt-tooltip-description">${enriched}</div>`;
    this.tooltips.set(key, html);
    return html;
  }

  // The customer's equipped weapon damage or armor class next to the item's own.
  /** @param {{ damage: string | null, ac: number | null }} stats */
  #compare(stats) {
    const equipped = this.customer.items.filter((item) => item.system?.equipped);
    if (stats.damage) {
      const own = equipped.map((item) => combatStats(item).damage).find(Boolean);
      return `<p class="kt-tooltip-compare">${game.i18n.localize("KT.Barter.Damage", { value: stats.damage, own: own ?? "-" })}</p>`;
    }
    if (stats.ac !== null) {
      const own = equipped.map((item) => combatStats(item).ac).find((ac) => ac !== null);
      return `<p class="kt-tooltip-compare">${game.i18n.localize("KT.Barter.ArmorClass", { value: stats.ac, own: own ?? "-" })}</p>`;
    }
    return "";
  }

  /**
   * @this {BarterWindow}
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static #onCategory(event, target) {
    const view = this.view[target.dataset.side];
    view.category = view.category === target.dataset.category ? null : target.dataset.category;
    this.render({ parts: [target.dataset.side] });
  }

  /** @this {BarterWindow} */
  static #onConfigure() {
    const actor = foundry.utils.fromUuidSync(this.snapshot.merchant.uuid);
    if (actor) ConfigureShop.open(actor);
  }
}

/**
 * @param {string} merchant
 * @param {string} customer
 */
export function windowId(merchant, customer) {
  return `kt-barter-${merchant}-${customer}`.replace(/[^A-Za-z0-9-]/g, "-");
}

/**
 * @param {string} id
 * @param {string} side
 * @param {string} name
 * @param {string} img
 * @param {{ type: string, subtype?: string, rarity?: string, magical?: boolean }} facts
 * @param {number} quantity
 */
function card(id, side, name, img, facts, quantity) {
  return {
    id,
    side,
    name,
    img,
    type: facts.type,
    subtype: facts.subtype ?? "",
    rarity: facts.rarity ?? "",
    magical: Boolean(facts.magical || facts.rarity),
    quantity,
    available: quantity,
    disabled: false,
    dim: false,
  };
}

/**
 * @param {string} key
 * @param {string} icon
 */
function tag(key, icon) {
  return { key, icon, label: game.i18n.localize(`KT.Tag.${key}`) };
}

/** @param {string | undefined} rarity */
function rarityTag(rarity) {
  return rarity ? { key: `rarity rarity-${rarity}`, icon: null, label: rarityLabel(rarity) } : null;
}
