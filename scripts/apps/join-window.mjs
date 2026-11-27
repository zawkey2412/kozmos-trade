// Joining another player's trade at a merchant: this character's items and coins go into their offer.
import { MODULE_ID } from "../constants.mjs";
import { coinLabels, locale, purse, skillLabel } from "../adapter/dnd5e.mjs";
import { coinsToCopper, formatCopper } from "../engine/money.mjs";
import { warn } from "../services/errors.mjs";
import { MESSAGES, request } from "../services/socket.mjs";
import { distract } from "../services/theft.mjs";
import { getTables } from "../settings.mjs";
import { loadTradePartials } from "./cards.mjs";
import OfferWindow from "./offer-window.mjs";

/**
 * @typedef {object} JoinView
 * @property {{ uuid: string, name: string, img: string }} merchant
 * @property {{ uuid: string, name: string, img: string }} lead
 * @property {boolean} [theft]
 */

const template = (name) => `modules/${MODULE_ID}/templates/${name}.hbs`;

export default class JoinWindow extends OfferWindow {
  static DEFAULT_OPTIONS = {
    classes: ["kt-join"],
    window: { icon: "fa-solid fa-people-group" },
    position: { width: 900, height: 680 },
    actions: { leave: JoinWindow.#onLeave, distract: JoinWindow.#onDistract },
  };

  static PARTS = {
    header: { template: template("offer/header") },
    inventory: { template: template("offer/inventory"), scrollable: [".kt-inventory-list"] },
    tray: { template: template("offer/tray"), scrollable: [".kt-tray-list"] },
    panel: { template: template("join/panel") },
  };

  static OFFER_PARTS = ["inventory", "tray", "panel"];

  /**
   * @param {JoinView} view
   * @param {any} actor
   */
  static async show(view, actor) {
    await loadTradePartials();
    const id = `kt-join-${view.merchant.uuid}-${actor.uuid}`.replace(/[^A-Za-z0-9-]/g, "-");
    const existing = /** @type {any} */ (foundry.applications.instances.get(id));
    if (existing) {
      await existing.render({ force: true });
      return existing;
    }
    const app = new JoinWindow({ id, actor, join: view });
    await app.render({ force: true });
    return app;
  }

  // The GM's word on what the pool holds, after any change.
  /** @param {{ merchant: string, pool: { actor: string, give: [string, number][], coins: Record<string, number> }[], traded: boolean }} change */
  static onPool({ merchant, pool, traded }) {
    for (const app of foundry.applications.instances.values()) {
      if (app instanceof JoinWindow && app.join.merchant.uuid === merchant) app.applyPool(pool, traded);
    }
  }

  // The customer left the merchant, so the joined trade is over.
  /** @param {{ merchant: string, name: string }} payload */
  static ended({ merchant, name }) {
    for (const app of [...foundry.applications.instances.values()]) {
      if (!(app instanceof JoinWindow) || app.join.merchant.uuid !== merchant) continue;
      ui.notifications.info(game.i18n.localize("KT.Join.Ended", { name }));
      app.over = true;
      app.close();
    }
  }

  /** @param {{ id: string, actor: any, join: JoinView }} options */
  constructor({ join, ...options }) {
    super(options);
    /** @type {JoinView} */
    this.join = join;
    /** @type {Record<string, number>} */
    this.prices = {};
    this.dirty = false;
    this.over = false;
    this.busy = false;
    this.sendSoon = foundry.utils.debounce(() => this.send(), 300);
  }

  get title() {
    return game.i18n.localize("KT.Join.Title", { lead: this.join.lead.name, merchant: this.join.merchant.name });
  }

  get money() {
    return { locale: locale(), labels: coinLabels() };
  }

  /**
   * @param {string} id
   * @param {number} [quantity]
   */
  priceLabel(id, quantity = 1) {
    const unit = this.prices[id];
    return unit === undefined ? "" : formatCopper(unit * quantity, this.money);
  }

  /**
   * @param {{ actor: string, give: [string, number][], coins: Record<string, number> }[]} pool
   * @param {boolean} traded
   */
  applyPool(pool, traded) {
    const entry = pool.find((e) => e.actor === this.actor.uuid);
    if (!entry) {
      this.over = true;
      this.close();
      return;
    }
    if (traded) {
      ui.notifications.info(game.i18n.localize("KT.Join.Traded", { name: this.join.lead.name }));
      this.prices = {};
    }
    if (!this.dirty) this.loadOffer(entry.give, entry.coins);
    if (this.rendered) this.render({ parts: this.offerParts });
  }

  offerChanged() {
    this.dirty = true;
    this.sendSoon();
  }

  // Sends what this character puts up to the GM, who answers each item's price.
  async send() {
    if (!this.dirty || this.over) return;
    this.dirty = false;
    try {
      const { prices } = await request(MESSAGES.SESSION_CONTRIBUTE, {
        merchant: this.join.merchant.uuid,
        customer: this.actor.uuid,
        give: [...this.offer.items],
        coins: this.offer.coins,
      });
      this.prices = prices ?? {};
    } catch (error) {
      warn(error);
    }
    if (this.rendered && !this.over) this.render({ parts: this.offerParts });
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    let worth = 0;
    for (const [id, quantity] of this.offer.items) worth += (this.prices[id] ?? 0) * quantity;
    worth += coinsToCopper(this.offer.coins);
    return Object.assign(context, {
      header: {
        mine: { name: this.actor.name, img: this.actor.img },
        other: { name: this.join.lead.name, img: this.join.lead.img, note: this.join.merchant.name },
        coins: formatCopper(coinsToCopper(purse(this.actor)), this.money),
        icon: "fa-solid fa-people-group",
        heading: game.i18n.localize("KT.Join.Heading"),
      },
      inventory: this.inventoryContext(),
      tray: this.trayContext(game.i18n.localize("KT.Join.YouAdd")),
      panel: { lead: this.join.lead.name, merchant: this.join.merchant.name, worth: worth ? formatCopper(worth, this.money) : null, distract: Boolean(this.join.theft), busy: this.busy },
    });
  }

  async _onClose(options) {
    await super._onClose(options);
    if (!this.over) request(MESSAGES.SESSION_LEAVE, { merchant: this.join.merchant.uuid, customer: this.actor.uuid }).catch(() => false);
  }

  /** @this {JoinWindow} */
  static #onLeave() {
    this.close();
  }

  // Distracts the merchant for the customer's next theft attempt.
  /** @this {JoinWindow} */
  static async #onDistract() {
    if (this.busy) return;
    const skills = getTables().theft.distractSkills;
    const select = foundry.applications.fields.createSelectInput({ name: "skill", options: skills.map((skill) => ({ value: skill, label: skillLabel(skill) })), value: skills[0] });
    const group = foundry.applications.fields.createFormGroup({ label: game.i18n.localize("KT.Haggle.Check"), input: select });
    const hint = game.i18n.localize("KT.Theft.Distract.Hint", { lead: foundry.utils.escapeHTML(this.join.lead.name), merchant: foundry.utils.escapeHTML(this.join.merchant.name) });
    const data = /** @type {any} */ (await foundry.applications.api.DialogV2.input(/** @type {any} */ ({
      window: { title: "KT.Theft.Distract.Title", icon: "fa-solid fa-masks-theater" },
      content: `<p class="hint">${hint}</p>${group.outerHTML}`,
      ok: { label: "KT.Haggle.Roll", icon: "fa-solid fa-dice-d20" },
      rejectClose: false,
    })));
    if (!data) return;
    this.busy = true;
    this.render({ parts: ["panel"] });
    await distract(this.actor, this.join.merchant.uuid, data.skill);
    this.busy = false;
    if (this.rendered) this.render({ parts: ["panel"] });
  }
}
