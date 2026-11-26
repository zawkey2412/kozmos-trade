// The barter window: both inventories, both offer trays and the balance between them.
// Documents are typed any here because their schema fields have no generated types.
import { MODULE_ID, SETTINGS } from "../constants.mjs";
import { coinLabels, combatStats, holdingFacts, itemDescription, itemFacts, locale, purse, rarityLabel, rollCheck, skillLabel } from "../adapter/dnd5e.mjs";
import { appraisalDC } from "../engine/appraisal.mjs";
import { situationOf } from "../engine/reactions.mjs";
import { arrange, CATEGORIES, SORTS } from "../engine/catalog.mjs";
import { COPPER, coinsToCopper, formatCopper, payFrom, splitCopper } from "../engine/money.mjs";
import { tradeable } from "../engine/shelf.mjs";
import { settle } from "../engine/quote.mjs";
import { addCoins, clampCoins, emptyOffer, isEmpty, setLine, stageAmount } from "../engine/tray.mjs";
import { proposalOf } from "../services/approval.mjs";
import { archetypeLabel } from "../services/archetypes.mjs";
import { ATTITUDE_ICONS } from "../services/attitude.mjs";
import { TradeError, warn } from "../services/errors.mjs";
import { APPRAISE_ROLL } from "../services/appraisal.mjs";
import { reactionLine } from "../services/reactions.mjs";
import { showShop } from "../services/show.mjs";
import { HAGGLE_ROLL, haggleChoices } from "../services/haggle.mjs";
import { rollFlags } from "../services/rolls.mjs";
import { closeTrade } from "../services/open-trade.mjs";
import { buyQuote, sellQuote } from "../services/offer.mjs";
import { ledgerOf, revertEntry } from "../services/receipts.mjs";
import { snapshot as shelfSnapshot, wantedLabels } from "../services/session.mjs";
import { saveShop } from "../services/shop.mjs";
import { importStock, restock } from "../services/stock.mjs";
import { MESSAGES, request } from "../services/socket.mjs";
import { getTables } from "../settings.mjs";
import ConfigureShop from "./configure-shop.mjs";
import { HandlebarsApplication } from "./base.mjs";

/** @import { Snapshot } from "../services/session.mjs"; */
/** @import { PriceContext } from "../services/offer.mjs"; */
/** @import { Offer } from "../engine/tray.mjs"; */
/** @import { Settlement } from "../engine/quote.mjs"; */


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
      merchantTab: BarterWindow.#onTab,
      restock: BarterWindow.#onRestock,
      haggle: BarterWindow.#onHaggle,
      appraise: BarterWindow.#onAppraise,
      showPlayers: BarterWindow.#onShowPlayers,
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
      merchantTab: "shelf",
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
      haggle: this.snapshot.haggle?.discount ?? 0,
      market: 1,
      appraised: Object.keys(this.snapshot.appraisal?.items ?? {}).filter((id) => this.snapshot.appraisal.items[id] === "appraised"),
      wanted: this.snapshot.wanted ?? [],
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
    for (const [id, quantity] of this.offer.buyback) setLine(this.offer.buyback, id, quantity, this.#available("buyback", id) ?? 0);
    if (!snapshot.buyback.length) this.view.merchantTab = "shelf";
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const held = purse(this.customer);
    const budget = coinsToCopper(held);
    const customerCards = this.#customerCards();
    const merchantCards = this.#merchantCards(budget);
    const buybackCards = this.#buybackCards();
    const result = this.#settlement();
    this.#checkPurse(result);
    return Object.assign(context, {
      balance: this.#balance(result),
      footer: this.#footer(result),
      gm: game.user.isGM,
      header: this.#header(budget),
      customerColumn: this.#column("customer", customerCards, budget),
      merchantColumn: { ...this.#column("merchant", this.view.merchantTab === "buyback" ? buybackCards : merchantCards, budget), reaction: this.#reaction(result) },
      giveTray: this.#tray("give", customerCards, this.offer.coinsGive, held),
      takeTray: this.#tray("take", merchantCards, this.offer.coinsTake, null, buybackCards),
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
      buyback: [...this.offer.buyback],
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
        archetype: archetypeLabel(merchant.archetype),
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
      wanted: side === "merchant" ? wantedLabels(this.snapshot.wanted ?? []) : [],
      tabs:
        side === "merchant" && this.snapshot.buyback.length
          ? ["shelf", "buyback"].map((id) => ({ id, label: game.i18n.localize(`KT.Barter.Tab.${id}`), active: this.view.merchantTab === id }))
          : null,
    };
  }

  /**
   * @param {"give" | "take"} side
   * @param {any[]} cards
   * @param {Record<string, number>} coins
   * @param {Record<string, number> | null} held
   * @param {any[]} [buybackCards]
   */
  #tray(side, cards, coins, held, buybackCards = []) {
    const rows = [];
    let total = 0;
    /** @type {[string, any[]][]} */
    const sources = side === "give" ? [["give", cards]] : [["take", cards], ["buyback", buybackCards]];
    for (const [tray, list] of sources) {
      for (const [id, quantity] of this.#linesOf(tray)) {
        const card = list.find((c) => c.id === id);
        if (!card) continue;
        const lineTotal = card.price * quantity;
        total += lineTotal;
        const max = this.#available(sideOf(tray), id) ?? quantity;
        rows.push({ id, side: tray, name: card.name, img: card.img, quantity, max, unitLabel: card.priceLabel, totalLabel: formatCopper(lineTotal, this.money), buyback: tray === "buyback" });
      }
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
      const appraisal = this.snapshot.appraisal?.items[item.id];
      if (quote.scrap) tags.push(tag("scrap", "fa-solid fa-recycle"));
      if (appraisal === "appraised") tags.push(tag("appraised", "fa-solid fa-magnifying-glass-dollar"));
      if (quote.scrap && appraisal === "failed") tags.push(tag("appraiseFailed", "fa-solid fa-clock"));
      if (quote.wanted) tags.push(tag("wanted", "fa-solid fa-bullhorn"));
      else if (quote.favored) tags.push(tag("favored", "fa-solid fa-thumbs-up"));
      const staged = this.offer.give.get(item.id) ?? 0;
      cards.push({
        ...card(item.id, "customer", item.name, item.img, facts, holding.quantity, staged),
        price: quote.unit,
        priceLabel: quote.forSale ? formatCopper(quote.unit, this.money) : game.i18n.localize("KT.Configure.NotForSale"),
        tags: [facts.identified === false ? null : rarityTag(facts.rarity), ...tags].filter(Boolean),
        disabled: !quote.forSale || full,
        canEmpty: full,
        canAppraise: Boolean(this.snapshot.appraisal?.on && quote.scrap && !appraisal && !this.counter && !this.busy),
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
      const unit = buyQuote(entry.price, context, entry.limited).copper;
      const tags = [entry.identified ? rarityTag(entry.rarity) : null];
      if (entry.limited) tags.push(tag("limited", "fa-solid fa-hourglass-half"));
      if (entry.underCounter) tags.push(tag("underCounter", "fa-solid fa-box-open"));
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

  // Items the customer sold this visit, at the price they were paid.
  #buybackCards() {
    return this.snapshot.buyback.flatMap((record) => {
      const entry = this.snapshot.shelf.find((e) => e.id === record.id);
      if (!entry) return [];
      const staged = this.offer.buyback.get(record.id) ?? 0;
      return [{
        ...card(record.id, "buyback", entry.name, entry.img, entry, record.quantity, staged),
        price: record.price,
        priceLabel: formatCopper(record.price, this.money),
        tags: [tag("buyback", "fa-solid fa-rotate-left")],
      }];
    });
  }

  /** @param {string} tray */
  #linesOf(tray) {
    if (tray === "give") return this.offer.give;
    return tray === "buyback" ? this.offer.buyback : this.offer.take;
  }

  // Stage an item from either inventory into its tray.
  /**
   * @param {string} side
   * @param {string} id
   * @param {{ half?: boolean, all?: boolean, amount?: number }} [how]
   */
  async stage(side, id, how = {}) {
    if (this.counter && side === "customer") return;
    const lines = this.#linesOf(trayOf(side));
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
    const lines = this.#linesOf(tray);
    const max = this.#available(sideOf(tray), id) ?? 0;
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
    this.#linesOf(tray).delete(id);
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
      if (entry) merchantItems += buyQuote(entry.price, context, entry.limited).copper * quantity;
    }
    for (const [id, quantity] of this.offer.buyback) {
      const record = this.snapshot.buyback.find((b) => b.id === id);
      if (record) merchantItems += record.price * quantity;
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
      sweetenMin: getTables().attitude.sweeten.minPerPoint,
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
    const haggle = this.snapshot.haggle;
    if (haggle?.on && haggle.discount) {
      modifiers.push({ label: game.i18n.localize("KT.Balance.Haggle"), value: `-${Math.round(haggle.discount * 100)}%`, tone: "good" });
    }
    const needed = this.#coinsNeeded(result);
    return {
      haggle: this.#haggleState(),
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

  // The merchant's line for the offer as it stands. It changes only when the situation or band does.
  /** @param {Settlement} result */
  #reaction(result) {
    if (this.counter || !game.settings.get(MODULE_ID, SETTINGS.REACTIONS)) return null;
    const situation = situationOf(result, isEmpty(this.offer));
    const band = this.snapshot.attitude.on ? this.snapshot.attitude.band : "neutral";
    if (this.reaction?.situation !== situation || this.reaction.band !== band) {
      this.reaction = { situation, band, line: reactionLine(this.snapshot.merchant.archetype, situation, band) };
    }
    return this.reaction.line;
  }

  // The Haggle button, or why haggling is closed.
  #haggleState() {
    const haggle = this.snapshot.haggle;
    if (!haggle?.on || this.counter || haggle.discount) return null;
    if (haggle.locked) return { locked: true, text: game.i18n.localize("KT.Haggle.LockedShort") };
    const buying = this.offer.take.size > 0;
    return { locked: false, disabled: !buying || Boolean(this.busy), reason: buying ? null : game.i18n.localize("KT.Haggle.NeedPurchase") };
  }

  // Asks for a discount: the ask and check first, then the customer's roll, settled by the GM.
  /** @param {PointerEvent} event */
  async haggle(event) {
    const haggle = this.snapshot.haggle;
    const merchant = this.snapshot.merchant.uuid;
    const limited = [...this.offer.take.keys()].some((id) => this.snapshot.shelf.find((entry) => entry.id === id)?.limited);
    const asks = haggle.asks.filter((ask) => !limited || ask <= haggle.limitedMaxAsk + 1e-9);
    const askOptions = asks.map((ask) => {
      const percent = Math.round(ask * 100);
      const dc = haggle.dcs?.[String(ask)];
      return { value: String(ask), label: game.i18n.localize(dc === undefined ? "KT.Haggle.AskOpposed" : "KT.Haggle.AskOption", { percent, dc }) };
    });
    const checkOptions = haggleChoices(this.customer, this.snapshot.merchant.archetype).map((choice) => ({
      value: choice.value,
      label: choice.specialty ? game.i18n.localize("KT.Haggle.Advantage", { label: choice.label }) : choice.label,
    }));
    const { createFormGroup, createSelectInput, createCheckboxInput } = foundry.applications.fields;
    const groups = [
      createFormGroup({ label: game.i18n.localize("KT.Haggle.Ask"), input: createSelectInput({ name: "ask", options: askOptions, value: askOptions[0]?.value }) }),
      createFormGroup({ label: game.i18n.localize("KT.Haggle.Check"), input: createSelectInput({ name: "check", options: checkOptions, value: checkOptions[0]?.value }) }),
      createFormGroup({ label: game.i18n.localize("KT.Haggle.Helped"), input: createCheckboxInput({ name: "helped", value: false }) }),
    ];
    const hints = [haggle.opposed ? "KT.Haggle.OpposedHint" : "KT.Haggle.DcHint", ...(limited ? ["KT.Haggle.LimitedHint"] : [])];
    const content = `${hints.map((key) => `<p class="hint">${game.i18n.localize(key)}</p>`).join("")}${groups.map((group) => group.outerHTML).join("")}`;
    const data = /** @type {any} */ (await foundry.applications.api.DialogV2.input(/** @type {any} */ ({
      window: { title: game.i18n.localize("KT.Haggle.Title", { name: this.snapshot.merchant.name }), icon: "fa-solid fa-comments-dollar" },
      content,
      ok: { label: "KT.Haggle.Roll", icon: "fa-solid fa-dice-d20" },
      rejectClose: false,
    })));
    if (!data) return;
    this.busy = true;
    this.refresh(["balance", "footer"]);
    try {
      const payload = { merchant, customer: this.customer.uuid };
      const start = await request(MESSAGES.HAGGLE_START, { ...payload, ask: Number(data.ask), check: data.check, helped: Boolean(data.helped) });
      const flags = rollFlags(HAGGLE_ROLL, start.nonce, merchant);
      const message = await rollCheck(this.customer, { skill: start.skill ?? undefined, tool: start.tool ?? undefined, advantage: start.advantage, flags, event });
      if (!message) return;
      const outcome = await request(MESSAGES.ROLL_REPORT, { merchant, nonce: start.nonce, messageId: message.id });
      this.snapshot.haggle = outcome.haggle;
      const percent = Math.round(outcome.discount * 100);
      if (outcome.success) ui.notifications.info(game.i18n.localize("KT.Haggle.Result.Success", { percent }));
      else ui.notifications.warn("KT.Haggle.Result.Failure", { localize: true });
    } catch (error) {
      warn(error);
    } finally {
      this.busy = false;
      this.tooltips.clear();
      this.refresh();
    }
  }

  // Asks the merchant to look again at an unpriced item: a check the GM settles, once a day.
  /**
   * @param {string} id
   * @param {PointerEvent} event
   */
  async appraise(id, event) {
    const item = this.customer.items.get(id);
    if (!item) return;
    const tables = getTables().appraisal;
    const dc = appraisalDC(itemFacts(item), tables);
    const select = foundry.applications.fields.createSelectInput({
      name: "skill",
      options: tables.skills.map((skill) => ({ value: skill, label: skillLabel(skill) })),
      value: tables.skills[0],
    });
    const group = foundry.applications.fields.createFormGroup({ label: game.i18n.localize("KT.Haggle.Check"), input: select });
    const hint = game.i18n.localize("KT.Appraise.Hint", { name: foundry.utils.escapeHTML(item.name), dc });
    const data = /** @type {any} */ (await foundry.applications.api.DialogV2.input(/** @type {any} */ ({
      window: { title: game.i18n.localize("KT.Appraise.Title", { name: item.name }), icon: "fa-solid fa-magnifying-glass-dollar" },
      content: `<p class="hint">${hint}</p>${group.outerHTML}`,
      ok: { label: "KT.Haggle.Roll", icon: "fa-solid fa-dice-d20" },
      rejectClose: false,
    })));
    if (!data) return;
    this.busy = true;
    this.refresh(["customer", "footer"]);
    try {
      const merchant = this.snapshot.merchant.uuid;
      const start = await request(MESSAGES.APPRAISE_START, { merchant, customer: this.customer.uuid, itemId: id, skill: data.skill });
      const message = await rollCheck(this.customer, { skill: start.skill, flags: rollFlags(APPRAISE_ROLL, start.nonce, merchant), event });
      if (!message) return;
      const outcome = await request(MESSAGES.ROLL_REPORT, { merchant, nonce: start.nonce, messageId: message.id });
      this.snapshot.appraisal = outcome.appraisal;
      if (outcome.success) ui.notifications.info(game.i18n.localize("KT.Appraise.Result.Success", { name: item.name }));
      else ui.notifications.warn(game.i18n.localize("KT.Appraise.Result.Failure", { name: item.name }));
    } catch (error) {
      warn(error);
    } finally {
      this.busy = false;
      this.tooltips.clear();
      this.refresh();
    }
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
   * @param {string} side
   * @param {string} id
   */
  #available(side, id) {
    if (side === "merchant" || side === "buyback") {
      const onShelf = this.snapshot.shelf.find((e) => e.id === id)?.quantity ?? null;
      if (onShelf === null) return null;
      if (side === "merchant") return onShelf - (this.offer.buyback.get(id) ?? 0);
      const record = this.snapshot.buyback.find((b) => b.id === id);
      return record ? Math.min(record.quantity, onShelf - (this.offer.take.get(id) ?? 0)) : null;
    }
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
      if (data.from === "tray" && zone.matches(".kt-inventory") && sideOf(data.side) === (zoneSide === "merchant" && data.side === "buyback" ? "buyback" : zoneSide)) return this.unstage(data.side, data.id);
      return;
    }
    if (game.user.isGM && zoneSide === "merchant" && ["Item", "Folder", "RollTable"].includes(data?.type)) {
      const actor = foundry.utils.fromUuidSync(this.snapshot.merchant.uuid);
      const count = await importStock(actor, data).catch((error) => warn(error));
      if (count) ui.notifications.info(game.i18n.localize("KT.Stock.Imported", { count }));
      return;
    }
    if (data?.type === "Item" && zoneSide === "give") {
      const item = /** @type {any} */ (await foundry.utils.fromUuid(data.uuid));
      if (item?.parent === this.customer) return this.stage("customer", item.id);
    }
  }

  // Swaps the card's short tooltip for the full one, which core shows and hides like any other tooltip.
  /** @param {PointerEvent} event */
  async #onHover(event) {
    const row = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (event.target).closest?.(".kt-card"));
    if (!row || row.dataset.tooltipReady) return;
    row.dataset.tooltipReady = "true";
    row.dataset.tooltipHtml = await this.#tooltip(row.dataset.side, row.dataset.itemId);
    if (game.tooltip.element === row) game.tooltip.activate(row);
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
    const description = entry?.description ?? (item ? itemDescription(item) : "");
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
  static #onTab(event, target) {
    this.view.merchantTab = target.dataset.tab;
    this.render({ parts: ["merchant"] });
  }

  /** @this {BarterWindow} */
  static #onShowPlayers() {
    return showShop(foundry.utils.fromUuidSync(this.snapshot.merchant.uuid));
  }

  /**
   * @this {BarterWindow}
   * @param {PointerEvent} event
   */
  static #onHaggle(event) {
    return this.haggle(event);
  }

  /**
   * @this {BarterWindow}
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static #onAppraise(event, target) {
    event.stopPropagation();
    const id = /** @type {HTMLElement} */ (target.closest(".kt-card")).dataset.itemId;
    return this.appraise(id, event);
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
  static async #onRestock() {
    const actor = /** @type {any} */ (foundry.utils.fromUuidSync(this.snapshot.merchant.uuid));
    if (!actor || !game.user.isGM) return;
    const ok = await foundry.applications.api.DialogV2.confirm(/** @type {any} */ ({
      window: { title: "KT.Stock.Restock" },
      content: `<p>${game.i18n.localize("KT.Stock.RestockConfirm")}</p>`,
      rejectClose: false,
    }));
    if (!ok) return;
    await restock(actor).catch((error) => warn(error));
    ui.notifications.info(game.i18n.localize("KT.Stock.Restocked", { name: actor.name }));
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

/** @param {string} tray */
function sideOf(tray) {
  return tray === "give" ? "customer" : tray === "take" ? "merchant" : tray;
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
    tooltip: `<h4>${foundry.utils.escapeHTML(name)}</h4>`,
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
