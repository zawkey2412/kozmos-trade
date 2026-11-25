// The barter window: both inventories, both offer trays and the balance between them.
// Documents are typed any here because their schema fields have no generated types.
import { MODULE_ID } from "../constants.mjs";
import { coinLabels, combatStats, holdingFacts, itemFacts, locale, purse, rarityLabel } from "../adapter/dnd5e.mjs";
import { arrange, CATEGORIES, SORTS } from "../engine/catalog.mjs";
import { COPPER, coinsToCopper, formatCopper, payFrom, splitCopper } from "../engine/money.mjs";
import { tradeable } from "../engine/shelf.mjs";
import { settle } from "../engine/quote.mjs";
import { addCoins, clampCoins, emptyOffer, isEmpty, setLine, stageAmount } from "../engine/tray.mjs";
import { proposalOf } from "../services/approval.mjs";
import { TradeError, warn } from "../services/errors.mjs";
import { closeTrade } from "../services/open-trade.mjs";
import { buyQuote, sellQuote } from "../services/offer.mjs";
import { ledgerOf, revertEntry } from "../services/receipts.mjs";
import { snapshot as shelfSnapshot } from "../services/session.mjs";
import { saveShop } from "../services/shop.mjs";
import { MESSAGES, request } from "../services/socket.mjs";
import { getTables } from "../settings.mjs";
import ConfigureShop from "./configure-shop.mjs";
import { HandlebarsApplication } from "./base.mjs";

/** @import { Snapshot } from "../services/session.mjs"; */
/** @import { PriceContext } from "../services/offer.mjs"; */
/** @import { Offer } from "../engine/tray.mjs"; */
/** @import { Settlement } from "../engine/quote.mjs"; */

const ATTITUDE_ICONS = {
  hostile: "fa-regular fa-face-angry",
  cold: "fa-regular fa-face-frown",
  neutral: "fa-regular fa-face-meh",
  warm: "fa-regular fa-face-smile",
  friendly: "fa-regular fa-face-grin-beam",
};

const COINS = Object.keys(COPPER);
const DRAG_TYPE = "kozmos-trade";
const OFFER_PARTS = ["customer", "give", "balance", "take", "merchant", "footer"];

const template = (name) => `modules/${MODULE_ID}/templates/barter/${name}.hbs`;

export default class BarterWindow extends HandlebarsApplication {
  static DEFAULT_OPTIONS = {
    classes: ["kozmos-trade", "kt-barter"],
    window: { icon: "fa-solid fa-scale-balanced", resizable: true },
    position: { width: 1280, height: 780 },
    actions: {
      category: BarterWindow.#onCategory,
      configure: BarterWindow.#onConfigure,
      stage: BarterWindow.#onStage,
      step: BarterWindow.#onStep,
      unstage: BarterWindow.#onUnstage,
      autoBalance: BarterWindow.#onAutoBalance,
      empty: BarterWindow.#onEmpty,
      accept: BarterWindow.#onAccept,
      toggleMode: BarterWindow.#onToggleMode,
      revertLast: BarterWindow.#onRevertLast,
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
    await BarterWindow.#loadPartials();
    const id = windowId(snapshot.merchant.uuid, customer.uuid);
    const existing = /** @type {any} */ (foundry.applications.instances.get(id));
    if (existing) {
      existing.updateSnapshot(snapshot);
      return existing.render({ force: true });
    }
    return new BarterWindow({ id, snapshot, customer }).render({ force: true });
  }

  static #loadPartials() {
    BarterWindow.#partials ??= foundry.applications.handlebars
      .loadTemplates({
        "kt-card": `modules/${MODULE_ID}/templates/components/card.hbs`,
        "kt-inventory": `modules/${MODULE_ID}/templates/components/inventory.hbs`,
        "kt-tray": `modules/${MODULE_ID}/templates/components/tray.hbs`,
      })
      .then(() => {});
    return BarterWindow.#partials;
  }

  // The GM's copy of a proposal, where only the merchant's side can change.
  /** @param {any} message */
  static async openCounter(message) {
    const proposal = proposalOf(message);
    if (!proposal) return;
    const { payload } = proposal;
    const merchant = /** @type {any} */ (await foundry.utils.fromUuid(payload.merchant));
    const customer = /** @type {any} */ (await foundry.utils.fromUuid(payload.customer));
    if (!merchant || !customer) return warn(new TradeError("KT.Error.Missing"));
    await BarterWindow.#loadPartials();
    const id = `${windowId(payload.merchant, payload.customer)}-counter`;
    foundry.applications.instances.get(id)?.close();
    const app = new BarterWindow({ id, snapshot: shelfSnapshot(merchant, customer), customer, counter: { messageId: message.id } });
    app.offer.give = new Map(payload.give);
    app.offer.take = new Map(payload.take);
    app.offer.coinsGive = clampCoins(payload.coinsGive, null);
    app.offer.coinsTake = clampCoins(payload.coinsTake, null);
    app.offer.keepChange = Boolean(payload.keepChange);
    return app.render({ force: true });
  }

  // A GM's answer to this client's proposal.
  /** @param {{ merchant: string, customer: string, status: string, counter: { take: [string, number][], coinsTake: Record<string, number> } | null }} result */
  static onProposalResult({ merchant, customer, status, counter }) {
    const app = /** @type {any} */ (foundry.applications.instances.get(windowId(merchant, customer)));
    if (status === "approved") ui.notifications.info("KT.Proposal.Result.approved", { localize: true });
    else if (status === "declined") ui.notifications.warn("KT.Proposal.Result.declined", { localize: true });
    else if (status === "countered") ui.notifications.info("KT.Proposal.Result.countered", { localize: true });
    if (!app) return;
    app.pending = false;
    if (status === "approved") app.offer = emptyOffer();
    if (status === "countered" && counter) {
      app.offer.take = new Map(counter.take);
      app.offer.coinsTake = clampCoins(counter.coinsTake, null);
    }
    app.refresh();
  }

  /** @param {{ id: string, snapshot: Snapshot, customer: any, counter?: { messageId: string } }} options */
  constructor({ snapshot, customer, counter, ...options }) {
    super(options);
    /** @type {Snapshot} */
    this.snapshot = snapshot;
    this.customer = customer;
    this.counter = counter ?? null;
    this.pending = false;
    /** @type {Offer} */
    this.offer = emptyOffer();
    this.view = {
      customer: { category: null, sort: "name", search: "" },
      merchant: { category: null, sort: "name", search: "" },
    };
    /** @type {Map<string, string>} */
    this.tooltips = new Map();
    /** @type {Set<string>} */
    this.confirmed = new Set();
    /** @type {[string, number][]} */
    this.hooks = [];
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

  /** @param {Snapshot} snapshot */
  updateSnapshot(snapshot) {
    this.snapshot = snapshot;
    this.tooltips.clear();
    for (const [id, quantity] of this.offer.take) {
      const entry = snapshot.shelf.find((e) => e.id === id);
      setLine(this.offer.take, id, quantity, entry?.quantity ?? 0);
    }
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const held = purse(this.customer);
    const budget = coinsToCopper(held);
    const customerCards = this.#customerCards();
    const merchantCards = this.#merchantCards(budget);
    const result = this.#settlement();
    this.#checkPurse(result);
    return Object.assign(context, {
      balance: this.#balance(result),
      footer: this.#footer(result),
      gm: game.user.isGM,
      header: this.#header(budget),
      customerColumn: this.#column("customer", customerCards, budget),
      merchantColumn: this.#column("merchant", merchantCards, budget),
      giveTray: this.#tray("give", customerCards, this.offer.coinsGive, held),
      takeTray: this.#tray("take", merchantCards, this.offer.coinsTake, null),
    });
  }

  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    const element = this.element;
    element.addEventListener("input", (event) => this.#onInput(event));
    element.addEventListener("change", (event) => this.#onChange(event));
    element.addEventListener("pointerover", (event) => this.#onHover(event));
    element.addEventListener("contextmenu", (event) => this.#onContextMenu(event));
    element.addEventListener("keydown", (event) => this.#onKeyDown(event));
    element.addEventListener("dragstart", (event) => this.#onDragStart(event));
    element.addEventListener("dragover", (event) => this.#onDragOver(event));
    element.addEventListener("drop", (event) => this.#onDrop(event));
    const refresh = (document) => {
      const actor = document.parent ?? document;
      if (actor === this.customer) this.#refreshCustomer();
    };
    for (const hook of ["updateActor", "createItem", "updateItem", "deleteItem"]) this.hooks.push([hook, Hooks.on(hook, refresh)]);
    this.hooks.push(["userConnected", Hooks.on("userConnected", () => this.rendered && this.render({ parts: ["footer"] }))]);
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    for (const side of ["customer", "merchant"]) this.#applySearch(side);
  }

  async _onClose(options) {
    await super._onClose(options);
    for (const [hook, id] of this.hooks) Hooks.off(hook, id);
    if (!this.counter) closeTrade(this.customer, { uuid: this.snapshot.merchant.uuid });
  }

  /** @param {string[]} [parts] */
  refresh(parts = OFFER_PARTS) {
    return this.render({ parts });
  }

  // Every open window at this merchant asks for a fresh shelf.
  /** @param {string} merchant */
  static refreshFor(merchant) {
    for (const app of foundry.applications.instances.values()) {
      if (app instanceof BarterWindow && app.snapshot.merchant.uuid === merchant) app.refreshSnapshot();
    }
  }

  async refreshSnapshot() {
    try {
      const snapshot = await request(MESSAGES.SESSION_OPEN, { merchant: this.snapshot.merchant.uuid, customer: this.customer.uuid });
      this.updateSnapshot(snapshot);
      this.purseCheck = null;
      if (this.rendered) this.render({ parts: ["header", ...OFFER_PARTS] });
    } catch (error) {
      warn(error);
    }
  }

  #payload() {
    return {
      merchant: this.snapshot.merchant.uuid,
      customer: this.customer.uuid,
      give: [...this.offer.give],
      take: [...this.offer.take],
      coinsGive: this.offer.coinsGive,
      coinsTake: this.offer.coinsTake,
      keepChange: this.offer.keepChange,
    };
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
      modeIcon: merchant.executionMode === "approval" ? "fa-solid fa-user-check" : "fa-solid fa-bolt",
      counter: Boolean(this.counter),
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

  /**
   * @param {"give" | "take"} side
   * @param {any[]} cards
   * @param {Record<string, number>} coins
   * @param {Record<string, number> | null} held
   */
  #tray(side, cards, coins, held) {
    const lines = side === "give" ? this.offer.give : this.offer.take;
    const rows = [];
    let total = 0;
    for (const [id, quantity] of lines) {
      const card = cards.find((c) => c.id === id);
      if (!card) continue;
      const lineTotal = card.price * quantity;
      total += lineTotal;
      rows.push({ id, side, name: card.name, img: card.img, quantity, max: card.quantity, unitLabel: card.priceLabel, totalLabel: formatCopper(lineTotal, this.money) });
    }
    total += coinsToCopper(coins);
    return {
      side,
      title: game.i18n.localize(side === "give" ? "KT.Barter.YouOffer" : "KT.Barter.YouGet"),
      rows,
      coins: COINS.map((coin) => ({ coin, name: `coins.${side}.${coin}`, value: coins[coin] || "", label: coinLabels()[coin] ?? coin, max: held?.[coin] ?? null })),
      total: formatCopper(total, this.money),
      keepChange: side === "give" ? { checked: this.offer.keepChange } : null,
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
      const staged = this.offer.give.get(item.id) ?? 0;
      cards.push({
        ...card(item.id, "customer", item.name, item.img, facts, holding.quantity, staged),
        price: quote.unit,
        priceLabel: quote.forSale ? formatCopper(quote.unit, this.money) : game.i18n.localize("KT.Configure.NotForSale"),
        tags: [rarityTag(facts.rarity), ...tags].filter(Boolean),
        disabled: !quote.forSale || full,
        canEmpty: full,
        warn: holding.equipped || holding.attuned,
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
      const staged = this.offer.take.get(entry.id) ?? 0;
      return {
        ...card(entry.id, "merchant", entry.name, entry.img, entry, entry.quantity, staged),
        price: unit,
        priceLabel: formatCopper(unit, this.money),
        tags: tags.filter(Boolean),
        dim: unit > budget,
      };
    });
  }

  // Stage an item from either inventory into its tray.
  /**
   * @param {"customer" | "merchant"} side
   * @param {string} id
   * @param {{ half?: boolean, all?: boolean, amount?: number }} [how]
   */
  async stage(side, id, how = {}) {
    if (this.counter && side === "customer") return;
    const lines = side === "customer" ? this.offer.give : this.offer.take;
    const available = this.#available(side, id);
    if (available === null) return;
    const staged = lines.get(id) ?? 0;
    const amount = how.amount ?? stageAmount(available - staged, how);
    if (!amount) return;
    if (side === "customer" && !staged && !(await this.#confirmWorn(id))) return;
    setLine(lines, id, staged + amount, available);
    this.pending = false;
    this.refresh();
  }

  /**
   * @param {"give" | "take"} tray
   * @param {string} id
   * @param {number} delta
   */
  step(tray, id, delta) {
    if (this.counter && tray === "give") return;
    this.pending = false;
    const lines = tray === "give" ? this.offer.give : this.offer.take;
    const max = this.#available(tray === "give" ? "customer" : "merchant", id) ?? 0;
    setLine(lines, id, (lines.get(id) ?? 0) + delta, max);
    this.refresh();
  }

  /**
   * @param {"give" | "take"} tray
   * @param {string} id
   */
  unstage(tray, id) {
    if (this.counter && tray === "give") return;
    this.pending = false;
    (tray === "give" ? this.offer.give : this.offer.take).delete(id);
    this.refresh();
  }

  // Coins that fill the gap: from the customer's own coins, or asked of the merchant.
  /** @param {"give" | "take"} tray */
  autoBalance(tray) {
    if (this.counter && tray === "give") return;
    this.pending = false;
    const values = this.#trayValues();
    const gap = tray === "give" ? values.merchant - values.customer : values.customer - values.merchant;
    if (gap <= 0) return;
    if (tray === "give") {
      const left = addCoins(purse(this.customer), this.offer.coinsGive, -1);
      const coins = payFrom(left, gap);
      if (!coins) return ui.notifications.warn("KT.Barter.CannotCover", { localize: true });
      this.offer.coinsGive = addCoins(this.offer.coinsGive, coins);
    } else {
      this.offer.coinsTake = addCoins(this.offer.coinsTake, splitCopper(gap));
    }
    this.refresh(["give", "balance", "take", "footer"]);
  }

  // Copper each side has put up so far, in goods and in coins.
  #trayValues() {
    const context = this.priceContext;
    let customerItems = 0;
    for (const [id, quantity] of this.offer.give) {
      const item = this.customer.items.get(id);
      if (item) customerItems += sellQuote(item, context).unit * quantity;
    }
    let merchantItems = 0;
    for (const [id, quantity] of this.offer.take) {
      const entry = this.snapshot.shelf.find((e) => e.id === id);
      if (entry) merchantItems += buyQuote(entry.price, context).copper * quantity;
    }
    const coinsGive = coinsToCopper(this.offer.coinsGive);
    const coinsTake = coinsToCopper(this.offer.coinsTake);
    return { customerItems, merchantItems, coinsGive, coinsTake, customer: customerItems + coinsGive, merchant: merchantItems + coinsTake };
  }

  #settlement() {
    const values = this.#trayValues();
    return settle({
      giveItems: values.customerItems,
      takeItems: values.merchantItems,
      coinsGive: values.coinsGive,
      coinsTake: values.coinsTake,
      keepChange: this.offer.keepChange,
      sweetenStep: getTables().attitude.sweeten.step,
    });
  }

  // The scale's state, readout, modifiers and purse warning.
  /** @param {Settlement} result */
  #balance(result) {
    const shown = result.net < 0 ? result.net : result.overpay;
    const sign = shown < 0 ? "-" : shown > 0 ? "+" : "";
    const modifiers = [];
    const { attitude } = this.snapshot;
    if (attitude.on && attitude.adjustment) {
      modifiers.push({
        label: game.i18n.localize("KT.Balance.Attitude", { band: game.i18n.localize(`KT.Attitude.${attitude.band}`) }),
        value: `${attitude.adjustment > 0 ? "+" : "-"}${Math.round(Math.abs(attitude.adjustment) * 100)}%`,
        tone: attitude.adjustment > 0 ? "good" : "bad",
      });
    }
    const needed = this.#coinsNeeded(result);
    return {
      state: result.state,
      icon: { short: "fa-scale-unbalanced-flip", even: "fa-scale-balanced", generous: "fa-scale-unbalanced" }[result.state],
      word: game.i18n.localize(`KT.Balance.${result.state}`),
      readout: `${sign}${formatCopper(Math.abs(shown), this.money)}`,
      customer: formatCopper(result.customerGives, this.money),
      merchant: formatCopper(result.merchantGives, this.money),
      change: result.change ? formatCopper(result.change, this.money) : null,
      modifiers,
      cannotCover: needed > 0 && this.purseCheck?.amount === needed && !this.purseCheck.covers,
    };
  }

  /** @param {Settlement} result */
  #coinsNeeded(result) {
    return coinsToCopper(this.offer.coinsTake) + result.change;
  }

  // Asks the GM whether the merchant can pay, once the offer stops changing.
  /** @param {Settlement} result */
  #checkPurse(result) {
    const amount = this.#coinsNeeded(result);
    if (this.snapshot.merchant.purse === null || amount <= 0 || this.purseCheck?.amount === amount) return;
    window.clearTimeout(this.purseTimer);
    this.purseTimer = window.setTimeout(async () => {
      const covers = await request(MESSAGES.PURSE_CHECK, { merchant: this.snapshot.merchant.uuid, amount }).catch(() => true);
      this.purseCheck = { amount, covers };
      if (this.rendered) this.render({ parts: ["balance", "footer"] });
    }, 300);
  }

  /** @param {Settlement} result */
  #footer(result) {
    const approval = this.snapshot.merchant.executionMode === "approval" && !game.user.isGM;
    let reason = null;
    if (this.busy) reason = "KT.Footer.Working";
    else if (!game.users.activeGM) reason = "KT.Error.NoGM";
    else if (this.pending) reason = "KT.Footer.Pending";
    else if (isEmpty(this.offer)) reason = "KT.Footer.Empty";
    else if (!approval && !this.counter && result.state === "short") reason = "KT.Footer.Short";
    else if (this.#balance(result).cannotCover) reason = "KT.Footer.CannotCover";
    let action = { label: "KT.Barter.Accept", icon: "fa-solid fa-handshake" };
    if (this.counter) action = { label: "KT.Barter.SendCounter", icon: "fa-solid fa-reply" };
    else if (approval) action = { label: "KT.Barter.Propose", icon: "fa-solid fa-paper-plane" };
    return { ...action, disabled: Boolean(reason), reason: reason ? game.i18n.localize(reason) : null };
  }

  /**
   * @param {"customer" | "merchant"} side
   * @param {string} id
   */
  #available(side, id) {
    if (side === "merchant") return this.snapshot.shelf.find((e) => e.id === id)?.quantity ?? null;
    const item = this.customer.items.get(id);
    if (!item) return null;
    const facts = itemFacts(item);
    const holding = holdingFacts(item);
    if (!tradeable(facts, holding) || (facts.type === "container" && holding.contents > 0)) return null;
    return holding.quantity;
  }

  /** @param {string} id */
  async #confirmWorn(id) {
    const item = this.customer.items.get(id);
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

  #refreshCustomer() {
    for (const [id, quantity] of this.offer.give) setLine(this.offer.give, id, quantity, this.#available("customer", id) ?? 0);
    this.offer.coinsGive = clampCoins(this.offer.coinsGive, purse(this.customer));
    this.tooltips.clear();
    this.render({ parts: ["header", ...OFFER_PARTS] });
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
    const target = /** @type {HTMLInputElement} */ (event.target);
    if (target.matches(".kt-sort")) {
      this.view[target.dataset.side].sort = target.value;
      return this.render({ parts: [target.dataset.side] });
    }
    if (target.matches(".kt-keep-change")) {
      if (this.counter) return this.refresh(["give"]);
      this.pending = false;
      this.offer.keepChange = target.checked;
      return this.refresh(["balance", "footer"]);
    }
    if (target.matches(".kt-coin")) {
      const side = target.dataset.side;
      if (this.counter && side === "give") return this.refresh(["give"]);
      this.pending = false;
      const key = side === "give" ? "coinsGive" : "coinsTake";
      const coins = { ...this.offer[key], [target.dataset.coin]: Number(target.value) };
      this.offer[key] = clampCoins(coins, side === "give" ? purse(this.customer) : null);
      target.value = String(this.offer[key][target.dataset.coin] || "");
      return this.refresh(["balance", "footer"]);
    }
  }

  /** @param {MouseEvent} event */
  #onContextMenu(event) {
    const line = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (event.target).closest?.(".kt-line"));
    if (!line) return;
    event.preventDefault();
    this.unstage(/** @type {any} */ (line.dataset.side), line.dataset.itemId);
  }

  /** @param {KeyboardEvent} event */
  #onKeyDown(event) {
    const target = /** @type {HTMLElement} */ (event.target);
    const cardRow = /** @type {HTMLElement | null} */ (target.closest?.(".kt-card"));
    if (cardRow && target === cardRow && ["Enter", " "].includes(event.key)) {
      event.preventDefault();
      return this.stage(/** @type {any} */ (cardRow.dataset.side), cardRow.dataset.itemId, { half: event.shiftKey, all: event.ctrlKey || event.metaKey });
    }
    const line = /** @type {HTMLElement | null} */ (target.closest?.(".kt-line"));
    if (!line || target !== line) return;
    const tray = /** @type {any} */ (line.dataset.side);
    if (["Delete", "Backspace"].includes(event.key)) this.unstage(tray, line.dataset.itemId);
    else if (["+", "="].includes(event.key)) this.step(tray, line.dataset.itemId, 1);
    else if (event.key === "-") this.step(tray, line.dataset.itemId, -1);
    else return;
    event.preventDefault();
  }

  /** @param {DragEvent} event */
  #onDragStart(event) {
    const row = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (event.target).closest?.(".kt-card, .kt-line"));
    if (!row) return;
    const from = row.classList.contains("kt-line") ? "tray" : "inventory";
    event.dataTransfer.setData("text/plain", JSON.stringify({ type: DRAG_TYPE, from, side: row.dataset.side, id: row.dataset.itemId }));
  }

  /** @param {DragEvent} event */
  #onDragOver(event) {
    if (/** @type {HTMLElement} */ (event.target).closest?.(".kt-tray, .kt-inventory")) event.preventDefault();
  }

  /** @param {DragEvent} event */
  async #onDrop(event) {
    const zone = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (event.target).closest?.(".kt-tray, .kt-inventory"));
    if (!zone) return;
    event.preventDefault();
    // Drag data has no static shape.
    const data = /** @type {any} */ (foundry.applications.ux.TextEditor.implementation.getDragEventData(event));
    const zoneSide = zone.dataset.side;
    if (data?.type === DRAG_TYPE) {
      if (data.from === "inventory" && zone.matches(".kt-tray") && trayOf(data.side) === zoneSide) return this.stage(data.side, data.id);
      if (data.from === "tray" && zone.matches(".kt-inventory") && trayOf(zoneSide) === data.side) return this.unstage(data.side, data.id);
      return;
    }
    if (data?.type === "Item" && zoneSide === "give") {
      const item = /** @type {any} */ (await foundry.utils.fromUuid(data.uuid));
      if (item?.parent === this.customer) return this.stage("customer", item.id);
    }
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

  /**
   * @this {BarterWindow}
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static #onStage(event, target) {
    if (/** @type {HTMLElement} */ (event.target).closest("[data-action='empty']")) return;
    this.stage(/** @type {any} */ (target.dataset.side), target.dataset.itemId, { half: event.shiftKey, all: event.ctrlKey || event.metaKey });
  }

  /**
   * @this {BarterWindow}
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static #onStep(event, target) {
    const line = /** @type {HTMLElement} */ (target.closest(".kt-line"));
    this.step(/** @type {any} */ (line.dataset.side), line.dataset.itemId, Number(target.dataset.delta));
  }

  /**
   * @this {BarterWindow}
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static #onUnstage(event, target) {
    const line = /** @type {HTMLElement} */ (target.closest(".kt-line"));
    this.unstage(/** @type {any} */ (line.dataset.side), line.dataset.itemId);
  }

  /**
   * @this {BarterWindow}
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static #onAutoBalance(event, target) {
    this.autoBalance(/** @type {any} */ (target.dataset.side));
  }

  /**
   * @this {BarterWindow}
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static async #onEmpty(event, target) {
    event.stopPropagation();
    const id = /** @type {HTMLElement} */ (target.closest(".kt-card")).dataset.itemId;
    const contents = this.customer.items.filter((item) => item.system?.container === id);
    await this.customer.updateEmbeddedDocuments("Item", contents.map((item) => ({ _id: item.id, "system.container": null })));
  }

  // Accept, propose, or send the GM's counter, by the window's mode.
  /** @this {BarterWindow} */
  static async #onAccept() {
    if (this.busy) return;
    this.busy = true;
    this.render({ parts: ["footer"] });
    let close = false;
    try {
      if (this.counter) {
        const counter = { take: [...this.offer.take], coinsTake: this.offer.coinsTake };
        const merchant = this.snapshot.merchant.uuid;
        await request(MESSAGES.PROPOSAL_ANSWER, { messageId: this.counter.messageId, merchant, answer: "counter", counter });
        ui.notifications.info("KT.Barter.CounterSent", { localize: true });
        close = true;
      } else if (this.snapshot.merchant.executionMode === "approval" && !game.user.isGM) {
        await request(MESSAGES.TRADE_PROPOSE, this.#payload());
        this.pending = true;
        ui.notifications.info("KT.Barter.Proposed", { localize: true });
      } else {
        await request(MESSAGES.TRADE_REQUEST, this.#payload());
        this.offer = emptyOffer();
        this.confirmed.clear();
        ui.notifications.info("KT.Barter.Done", { localize: true });
      }
    } catch (error) {
      warn(error);
    } finally {
      this.busy = false;
      if (close) this.close();
      else if (this.rendered) this.refresh();
    }
  }

  /** @this {BarterWindow} */
  static async #onRevertLast() {
    const actor = foundry.utils.fromUuidSync(this.snapshot.merchant.uuid);
    const last = actor ? ledgerOf(actor).find((entry) => !entry.reverted) : null;
    if (!last) return ui.notifications.info("KT.Ledger.Empty", { localize: true });
    await revertEntry(this.snapshot.merchant.uuid, last.id);
  }

  /** @this {BarterWindow} */
  static async #onToggleMode() {
    const actor = foundry.utils.fromUuidSync(this.snapshot.merchant.uuid);
    if (!actor || !game.user.isGM) return;
    const next = this.snapshot.merchant.executionMode === "approval" ? "instant" : "approval";
    await saveShop(actor, { shop: { executionMode: next } });
  }
}

/**
 * @param {string} merchant
 * @param {string} customer
 */
export function windowId(merchant, customer) {
  return `kt-barter-${merchant}-${customer}`.replace(/[^A-Za-z0-9-]/g, "-");
}

/** @param {string} side */
function trayOf(side) {
  return side === "customer" ? "give" : side === "merchant" ? "take" : side;
}

/**
 * @param {string} id
 * @param {string} side
 * @param {string} name
 * @param {string} img
 * @param {{ type: string, subtype?: string, rarity?: string, magical?: boolean }} facts
 * @param {number} quantity
 * @param {number} staged
 */
function card(id, side, name, img, facts, quantity, staged) {
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
    available: quantity - staged,
    staged: staged > 0,
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
