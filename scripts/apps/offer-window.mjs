// Windows where one character puts up its own items and coins: a trade between players, and joining a trade at a merchant.
// Documents are typed any here because their schema fields have no generated types.
import { coinLabels, holdingFacts, itemFacts, locale, purse } from "../adapter/dnd5e.mjs";
import { itemFlags } from "../data/flags.mjs";
import { arrange, CATEGORIES } from "../engine/catalog.mjs";
import { COPPER } from "../engine/money.mjs";
import { tradeable } from "../engine/shelf.mjs";
import { clampCoins, noCoins, setLine, stageAmount } from "../engine/tray.mjs";
import { playCoins } from "../ui/effects.mjs";
import { HandlebarsApplication } from "./base.mjs";
import { card, rarityTag, tag } from "./cards.mjs";

const COINS = Object.keys(COPPER);
const DRAG_TYPE = "kozmos-trade-offer";
const SORTS = ["name", "rarity"];

export default class OfferWindow extends HandlebarsApplication {
  /** @type {object} */
  static DEFAULT_OPTIONS = {
    classes: ["kozmos-trade", "kt-barter", "kt-offer"],
    window: { resizable: true },
    actions: {
      category: OfferWindow.#onCategory,
      stage: OfferWindow.#onStage,
      step: OfferWindow.#onStep,
      unstage: OfferWindow.#onUnstage,
      empty: OfferWindow.#onEmpty,
    },
  };

  // Parts that redraw when the offer changes.
  static OFFER_PARTS = ["inventory", "tray", "footer"];

  /** @param {{ actor: any }} options */
  constructor({ actor, ...options }) {
    super(options);
    this.actor = actor;
    /** @type {{ items: Map<string, number>, coins: Record<string, number> }} */
    this.offer = { items: new Map(), coins: noCoins() };
    this.view = { category: null, sort: "name", search: "" };
    /** @type {Set<string>} */
    this.confirmed = new Set();
    /** @type {[string, number][]} */
    this.hooks = [];
  }

  // Called after the character's own offer changes.
  offerChanged() {}

  // A price shown on a card or tray line, when the window has one.
  /**
   * @param {string} id
   * @param {number} [quantity]
   */
  priceLabel(id, quantity = 1) {
    return "";
  }

  get offerParts() {
    return /** @type {typeof OfferWindow} */ (this.constructor).OFFER_PARTS;
  }

  // The character's inventory as cards, for the kt-inventory partial.
  inventoryContext() {
    const cards = [];
    for (const item of this.actor.items) {
      const facts = itemFacts(item);
      const holding = holdingFacts(item);
      if (!tradeable(facts, holding)) continue;
      const full = facts.type === "container" && holding.contents > 0;
      const tags = [facts.identified === false ? null : rarityTag(facts.rarity)];
      if (holding.equipped) tags.push(tag("equipped", "fa-solid fa-hand-fist"));
      if (holding.attuned) tags.push(tag("attuned", "fa-solid fa-link"));
      if (full) tags.push(tag("full", "fa-solid fa-box-open"));
      if (facts.identified === false) tags.push(tag("unidentified", "fa-solid fa-question"));
      if (itemFlags(item).stolen) tags.push(tag("stolen", "fa-solid fa-mask"));
      const staged = this.offer.items.get(item.id) ?? 0;
      cards.push({
        ...card(item.id, "customer", item.name, item.img, facts, holding.quantity, staged),
        priceLabel: this.priceLabel(item.id),
        tags: tags.filter(Boolean),
        disabled: full,
        canEmpty: full,
      });
    }
    return {
      side: "customer",
      search: this.view.search,
      chips: CATEGORIES.map((id) => ({ id, label: game.i18n.localize(`KT.Category.${id}`), active: this.view.category === id })),
      sorts: Object.fromEntries(SORTS.map((id) => [id, `KT.Sort.${id}`])),
      sort: this.view.sort,
      items: arrange(cards, { category: this.view.category, sort: this.view.sort, locale: locale() }),
      empty: game.i18n.localize("KT.Barter.EmptyCustomer"),
      wanted: [],
      tabs: null,
    };
  }

  // The character's own tray, for the kt-tray partial.
  /** @param {string} title */
  trayContext(title) {
    const held = purse(this.actor);
    const rows = [];
    for (const [id, quantity] of this.offer.items) {
      const item = this.actor.items.get(id);
      if (!item) continue;
      rows.push({ id, side: "give", name: item.name, img: item.img, quantity, max: this.available(id) ?? quantity, totalLabel: this.priceLabel(id, quantity), buyback: false });
    }
    return {
      side: "give",
      title,
      rows,
      coins: COINS.map((coin) => ({ coin, value: this.offer.coins[coin] || "", label: coinLabels()[coin] ?? coin, max: held[coin] ?? 0 })),
      keepChange: null,
      noTools: true,
    };
  }

  /** @param {string} id */
  available(id) {
    const item = this.actor.items.get(id);
    if (!item) return null;
    const facts = itemFacts(item);
    const holding = holdingFacts(item);
    if (!tradeable(facts, holding) || (facts.type === "container" && holding.contents > 0)) return null;
    return holding.quantity;
  }

  /**
   * @param {string} side
   * @param {string} id
   * @param {{ half?: boolean, all?: boolean }} [how]
   */
  async stage(side, id, how = {}) {
    if (side !== "customer") return;
    const available = this.available(id);
    if (available === null) return;
    const staged = this.offer.items.get(id) ?? 0;
    const amount = stageAmount(available - staged, how);
    if (!amount) return;
    if (!staged && !(await this.#confirmWorn(id))) return;
    setLine(this.offer.items, id, staged + amount, available);
    playCoins("stage");
    this.#changed();
  }

  /**
   * @param {string} id
   * @param {number} delta
   */
  step(id, delta) {
    setLine(this.offer.items, id, (this.offer.items.get(id) ?? 0) + delta, this.available(id) ?? 0);
    this.#changed();
  }

  /** @param {string} id */
  unstage(id) {
    this.offer.items.delete(id);
    this.#changed();
  }

  /**
   * @param {[string, number][]} items
   * @param {Record<string, number>} coins
   */
  loadOffer(items, coins) {
    this.offer.items = new Map(items);
    this.offer.coins = clampCoins(coins, null);
  }

  #changed() {
    this.offerChanged();
    if (this.rendered) this.render({ parts: this.offerParts });
  }

  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    const element = this.element;
    element.addEventListener("input", (event) => this.#onInput(event));
    element.addEventListener("change", (event) => this.#onChange(event));
    element.addEventListener("contextmenu", (event) => this.#onContextMenu(event));
    element.addEventListener("keydown", (event) => this.#onKeyDown(event));
    element.addEventListener("dragstart", (event) => this.#onDragStart(event));
    element.addEventListener("dragover", (event) => this.#onDragOver(event));
    element.addEventListener("drop", (event) => this.#onDrop(event));
    const refresh = (document) => {
      const actor = document.parent ?? document;
      if (actor === this.actor) this.#refreshActor();
    };
    for (const hook of ["updateActor", "createItem", "updateItem", "deleteItem"]) this.hooks.push([hook, Hooks.on(hook, refresh)]);
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    this.#applySearch();
  }

  async _onClose(options) {
    await super._onClose(options);
    for (const [hook, id] of this.hooks) Hooks.off(hook, id);
  }

  // Lines and coins kept within what the character still holds.
  #refreshActor() {
    const before = JSON.stringify([[...this.offer.items], this.offer.coins]);
    for (const [id, quantity] of this.offer.items) setLine(this.offer.items, id, quantity, this.available(id) ?? 0);
    this.offer.coins = clampCoins(this.offer.coins, purse(this.actor));
    if (JSON.stringify([[...this.offer.items], this.offer.coins]) !== before) this.offerChanged();
    if (this.rendered) this.render({ parts: this.offerParts });
  }

  /** @param {string} id */
  async #confirmWorn(id) {
    const item = this.actor.items.get(id);
    const holding = holdingFacts(item);
    if (!(holding.equipped || holding.attuned) || this.confirmed.has(id)) return true;
    const ok = await foundry.applications.api.DialogV2.confirm(/** @type {any} */ ({
      window: { title: "KT.Barter.ConfirmWorn.Title" },
      content: `<p>${game.i18n.localize("KT.Barter.ConfirmWorn.Body", { name: foundry.utils.escapeHTML(item.name) })}</p>`,
      rejectClose: false,
    }));
    if (ok) this.confirmed.add(id);
    return Boolean(ok);
  }

  #applySearch() {
    const text = this.view.search.trim().toLocaleLowerCase();
    for (const row of this.element.querySelectorAll(`.kt-inventory[data-side="customer"] .kt-card`)) {
      const name = row.querySelector(".kt-card-name")?.textContent.toLocaleLowerCase() ?? "";
      row.classList.toggle("hidden", Boolean(text) && !name.includes(text));
    }
  }

  /** @param {Event} event */
  #onInput(event) {
    const target = /** @type {HTMLInputElement} */ (event.target);
    if (!target.matches(".kt-search")) return;
    this.view.search = target.value;
    this.#applySearch();
  }

  /** @param {Event} event */
  #onChange(event) {
    const target = /** @type {HTMLInputElement} */ (event.target);
    if (target.matches(".kt-sort")) {
      this.view.sort = target.value;
      return this.render({ parts: ["inventory"] });
    }
    if (target.matches(".kt-coin") && target.dataset.side === "give") {
      const coins = { ...this.offer.coins, [target.dataset.coin]: Number(target.value) };
      this.offer.coins = clampCoins(coins, purse(this.actor));
      target.value = String(this.offer.coins[target.dataset.coin] || "");
      this.offerChanged();
      this.render({ parts: this.offerParts.filter((part) => part !== "tray") });
    }
  }

  /** @param {MouseEvent} event */
  #onContextMenu(event) {
    const line = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (event.target).closest?.(".kt-line[data-side='give']"));
    if (!line) return;
    event.preventDefault();
    this.unstage(line.dataset.itemId);
  }

  /** @param {KeyboardEvent} event */
  #onKeyDown(event) {
    const target = /** @type {HTMLElement} */ (event.target);
    const cardRow = /** @type {HTMLElement | null} */ (target.closest?.(".kt-card"));
    if (cardRow && target === cardRow && ["Enter", " "].includes(event.key)) {
      event.preventDefault();
      return this.stage(cardRow.dataset.side, cardRow.dataset.itemId, { half: event.shiftKey, all: event.ctrlKey || event.metaKey });
    }
    const line = /** @type {HTMLElement | null} */ (target.closest?.(".kt-line[data-side='give']"));
    if (!line || target !== line) return;
    if (["Delete", "Backspace"].includes(event.key)) this.unstage(line.dataset.itemId);
    else if (["+", "="].includes(event.key)) this.step(line.dataset.itemId, 1);
    else if (event.key === "-") this.step(line.dataset.itemId, -1);
    else return;
    event.preventDefault();
  }

  /** @param {DragEvent} event */
  #onDragStart(event) {
    const row = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (event.target).closest?.(".kt-card[data-side='customer'], .kt-line[data-side='give']"));
    if (!row) return;
    const from = row.classList.contains("kt-line") ? "tray" : "inventory";
    event.dataTransfer.setData("text/plain", JSON.stringify({ type: DRAG_TYPE, from, id: row.dataset.itemId }));
  }

  /** @param {DragEvent} event */
  #onDragOver(event) {
    if (/** @type {HTMLElement} */ (event.target).closest?.(".kt-tray[data-side='give'], .kt-inventory[data-side='customer']")) event.preventDefault();
  }

  /** @param {DragEvent} event */
  async #onDrop(event) {
    const zone = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (event.target).closest?.(".kt-tray[data-side='give'], .kt-inventory[data-side='customer']"));
    if (!zone) return;
    event.preventDefault();
    // Drag data has no static shape.
    const data = /** @type {any} */ (foundry.applications.ux.TextEditor.implementation.getDragEventData(event));
    const toTray = zone.matches(".kt-tray");
    if (data?.type === DRAG_TYPE) {
      if (data.from === "inventory" && toTray) return this.stage("customer", data.id);
      if (data.from === "tray" && !toTray) return this.unstage(data.id);
      return;
    }
    if (data?.type === "Item" && toTray) {
      const item = /** @type {any} */ (await foundry.utils.fromUuid(data.uuid));
      if (item?.parent === this.actor) return this.stage("customer", item.id);
    }
  }

  /**
   * @this {OfferWindow}
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static #onCategory(event, target) {
    this.view.category = this.view.category === target.dataset.category ? null : target.dataset.category;
    this.render({ parts: ["inventory"] });
  }

  /**
   * @this {OfferWindow}
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static #onStage(event, target) {
    if (/** @type {HTMLElement} */ (event.target).closest("[data-action='empty']")) return;
    this.stage(target.dataset.side, target.dataset.itemId, { half: event.shiftKey, all: event.ctrlKey || event.metaKey });
  }

  /**
   * @this {OfferWindow}
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static #onStep(event, target) {
    const line = /** @type {HTMLElement} */ (target.closest(".kt-line"));
    this.step(line.dataset.itemId, Number(target.dataset.delta));
  }

  /**
   * @this {OfferWindow}
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static #onUnstage(event, target) {
    const line = /** @type {HTMLElement} */ (target.closest(".kt-line"));
    this.unstage(line.dataset.itemId);
  }

  /**
   * @this {OfferWindow}
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static async #onEmpty(event, target) {
    event.stopPropagation();
    const id = /** @type {HTMLElement} */ (target.closest(".kt-card")).dataset.itemId;
    const contents = this.actor.items.filter((item) => item.system?.container === id);
    await this.actor.updateEmbeddedDocuments("Item", contents.map((item) => ({ _id: item.id, "system.container": null })));
  }
}
