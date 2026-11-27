// A trade between two players' characters: each puts up items and coins, and both press Accept.
import { MODULE_ID } from "../constants.mjs";
import { coinLabels, locale, purse } from "../adapter/dnd5e.mjs";
import { coinsToCopper, formatCoins, formatCopper } from "../engine/money.mjs";
import { warn } from "../services/errors.mjs";
import { MESSAGES, request } from "../services/socket.mjs";
import { playCoins } from "../ui/effects.mjs";
import { loadTradePartials } from "./cards.mjs";
import OfferWindow from "./offer-window.mjs";

/** @import { PlayerTradeView } from "../services/player-trade.mjs"; */

const template = (name) => `modules/${MODULE_ID}/templates/${name}.hbs`;

export default class PlayerTradeWindow extends OfferWindow {
  static DEFAULT_OPTIONS = {
    classes: ["kt-player-trade"],
    window: { icon: "fa-solid fa-handshake" },
    position: { width: 1040, height: 720 },
    actions: { accept: PlayerTradeWindow.#onAccept },
  };

  static PARTS = {
    header: { template: template("offer/header") },
    inventory: { template: template("offer/inventory"), scrollable: [".kt-inventory-list"] },
    tray: { template: template("offer/tray"), scrollable: [".kt-tray-list"] },
    status: { template: template("player/status") },
    theirs: { template: template("player/theirs"), scrollable: [".kt-tray-list"] },
    footer: { template: template("barter/footer") },
  };

  static OFFER_PARTS = ["inventory", "tray", "status", "footer"];

  /** @type {Map<string, Promise<any>>} */
  static #opening = new Map();

  // Opens the window for a trade, or brings an open one up to date.
  /** @param {PlayerTradeView} view */
  static async sync(view) {
    PlayerTradeWindow.#closeInvite(view.id);
    const id = `kt-player-${view.id}`;
    const existing = /** @type {any} */ (foundry.applications.instances.get(id));
    if (existing) {
      existing.applyState(view);
      return existing;
    }
    if (PlayerTradeWindow.#opening.has(id)) {
      const app = await PlayerTradeWindow.#opening.get(id);
      app.applyState(view);
      return app;
    }
    const opening = PlayerTradeWindow.#open(id, view);
    PlayerTradeWindow.#opening.set(id, opening);
    try {
      return await opening;
    } finally {
      PlayerTradeWindow.#opening.delete(id);
    }
  }

  /**
   * @param {string} id
   * @param {PlayerTradeView} view
   */
  static async #open(id, view) {
    const mine = view.sides.findIndex((side) => side.userId === game.user.id);
    if (mine < 0) return null;
    const actor = await foundry.utils.fromUuid(view.sides[mine].actor);
    if (!actor) return null;
    await loadTradePartials();
    const app = new PlayerTradeWindow({ id, actor, state: view, mine });
    await app.render({ force: true });
    return app;
  }

  // Asks the invited player, and answers null when the invite ends first.
  /**
   * @param {string} id
   * @param {string} name
   * @returns {Promise<boolean | null>}
   */
  static async invite(id, name) {
    const asking = /** @type {any} */ (foundry.applications.instances.get(`kt-invite-${id}`));
    if (asking) {
      asking.bringToFront();
      return null;
    }
    const answer = await foundry.applications.api.DialogV2.wait(/** @type {any} */ ({
      id: `kt-invite-${id}`,
      window: { title: game.i18n.localize("KT.PlayerTrade.InviteTitle", { name }), icon: "fa-solid fa-handshake" },
      content: `<p>${game.i18n.localize("KT.PlayerTrade.Invited", { name: foundry.utils.escapeHTML(name) })}</p>`,
      buttons: [
        { action: "yes", label: "KT.PlayerTrade.Yes", icon: "fa-solid fa-handshake", default: true },
        { action: "no", label: "KT.PlayerTrade.No" },
      ],
      rejectClose: false,
    }));
    if (PlayerTradeWindow.#gone.delete(id)) return null;
    return answer === "yes";
  }

  /** @type {Set<string>} */
  static #gone = new Set();

  // Closes an invite that no longer needs an answer.
  /** @param {string} id */
  static #closeInvite(id) {
    const question = foundry.applications.instances.get(`kt-invite-${id}`);
    if (!question) return;
    PlayerTradeWindow.#gone.add(id);
    question.close();
  }

  // The GM ended the trade: done, closed by one side, a player left, or the invite was turned down or ran out.
  /**
   * @param {string} id
   * @param {string} reason
   * @param {string} name
   * @param {string} asker
   */
  static ended(id, reason, name, asker) {
    PlayerTradeWindow.#closeInvite(id);
    const app = /** @type {any} */ (foundry.applications.instances.get(`kt-player-${id}`));
    if (!app) {
      const key = { declined: "KT.PlayerTrade.Declined", expired: "KT.PlayerTrade.Expired", combat: "KT.Error.InCombat" }[reason];
      if (asker === game.user.id && key) ui.notifications.warn(game.i18n.localize(key, { name }));
      return;
    }
    if (reason === "done") {
      playCoins("trade");
      ui.notifications.info("KT.Barter.Done", { localize: true });
    } else if (name && name !== app.actor.name) ui.notifications.warn(game.i18n.localize(reason === "left" ? "KT.PlayerTrade.Left" : "KT.PlayerTrade.Closed", { name }));
    app.over = true;
    app.close();
  }

  /** @param {{ id: string, actor: any, state: PlayerTradeView, mine: number }} options */
  constructor({ state, mine, ...options }) {
    super(options);
    /** @type {PlayerTradeView} */
    this.trade = state;
    this.mineIndex = mine;
    this.dirty = false;
    this.busy = false;
    this.over = false;
    this.sendSoon = foundry.utils.debounce(() => this.send(), 300);
    this.#loadMine();
  }

  get mine() {
    return this.trade.sides[this.mineIndex];
  }

  get other() {
    return this.trade.sides[1 - this.mineIndex];
  }

  get title() {
    return game.i18n.localize("KT.PlayerTrade.Title", { first: this.mine.name, second: this.other.name });
  }

  get money() {
    return { locale: locale(), labels: coinLabels() };
  }

  /** @param {PlayerTradeView} view */
  applyState(view) {
    this.trade = view;
    if (!this.dirty) this.#loadMine();
    if (this.rendered && !this.over) this.render({ parts: ["inventory", "tray", "status", "theirs", "footer"] });
  }

  #loadMine() {
    this.loadOffer(this.mine.lines.map((line) => [line.id, line.quantity]), this.mine.coins);
  }

  offerChanged() {
    this.dirty = true;
    this.sendSoon();
  }

  // Sends this side's offer to the GM, who resets both Accepts when it changed.
  async send() {
    if (!this.dirty || this.over) return;
    this.dirty = false;
    const offer = { items: [...this.offer.items], coins: this.offer.coins };
    try {
      /** @type {PlayerTradeView} */
      const view = await request(MESSAGES.PLAYER_OFFER, { id: this.trade.id, actor: this.mine.actor, offer });
      if (this.dirty) this.trade = view;
      else this.applyState(view);
    } catch (error) {
      warn(error);
      this.dirty = false;
      this.applyState(this.trade);
    }
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const both = this.trade.sides;
    return Object.assign(context, {
      header: {
        mine: { name: this.mine.name, img: this.mine.img },
        other: { name: this.other.name, img: this.other.img, note: null },
        coins: formatCopper(coinsToCopper(purse(this.actor)), this.money),
        icon: "fa-solid fa-handshake",
        heading: game.i18n.localize("KT.PlayerTrade.Heading"),
      },
      inventory: this.inventoryContext(),
      tray: this.trayContext(game.i18n.localize("KT.Barter.YouOffer")),
      status: {
        ready: both.every((side) => side.accepted),
        sides: both.map((side) => ({ name: side.name, accepted: side.accepted, word: game.i18n.localize(side.accepted ? "KT.PlayerTrade.Accepted" : "KT.PlayerTrade.NotYet") })),
      },
      theirs: {
        title: game.i18n.localize("KT.PlayerTrade.TheyOffer", { name: this.other.name }),
        rows: this.other.lines,
        coins: formatCoins(this.other.coins, this.money),
      },
      footer: this.#footer(),
    });
  }

  #footer() {
    const nothing = !this.offer.items.size && Object.values(this.offer.coins).every((count) => !count) && !this.other.lines.length && !formatCoins(this.other.coins);
    let reason = null;
    if (this.busy) reason = game.i18n.localize("KT.Footer.Working");
    else if (!game.users.activeGM) reason = game.i18n.localize("KT.Error.NoGM");
    else if (nothing) reason = game.i18n.localize("KT.Footer.Empty");
    else if (this.mine.accepted && !this.dirty) reason = game.i18n.localize("KT.PlayerTrade.Waiting", { name: this.other.name });
    return { label: "KT.Barter.Accept", icon: "fa-solid fa-handshake", disabled: Boolean(reason), reason };
  }

  async _onClose(options) {
    await super._onClose(options);
    if (!this.over) request(MESSAGES.PLAYER_CLOSE, { id: this.trade.id }).catch(() => false);
  }

  /** @this {PlayerTradeWindow} */
  static async #onAccept() {
    if (this.busy) return;
    this.busy = true;
    this.render({ parts: ["footer"] });
    try {
      if (this.dirty) await this.send();
      const result = await request(MESSAGES.PLAYER_ACCEPT, { id: this.trade.id, actor: this.mine.actor, version: this.trade.version });
      if (!result?.done) this.applyState(result);
    } catch (error) {
      warn(error);
    } finally {
      this.busy = false;
      if (this.rendered && !this.over) this.render({ parts: ["status", "footer"] });
    }
  }
}
