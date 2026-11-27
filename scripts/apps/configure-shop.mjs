// Configure Shop: turns an NPC into a merchant, and sets its stock, prices, attitude and history in tabs.
import { MODULE_ID } from "../constants.mjs";
import { DEFAULT_ARCHETYPE } from "../data/archetypes.mjs";
import { archetypeLabel, getArchetypes } from "../services/archetypes.mjs";
import { attitudeRows, attitudeTables, setAttitude } from "../services/attitude.mjs";
import { feature } from "../settings.mjs";
import { EXECUTION_MODES, merchantFlags, TIERS } from "../data/flags.mjs";
import { coinsToCopper, COPPER, formatCopper, toCopper } from "../engine/money.mjs";
import { coinLabels, locale } from "../adapter/dnd5e.mjs";
import { warn } from "../services/errors.mjs";
import { openTrade } from "../services/open-trade.mjs";
import { ledgerOf, revertEntry } from "../services/receipts.mjs";
import { postShopCard } from "../services/shop-card.mjs";
import { showShop } from "../services/show.mjs";
import { generateStock, importStock, rerollWanted, restock } from "../services/stock.mjs";
import { wantedLabels, wantedView } from "../services/session.mjs";
import { baseActorOf, IDENTITY_ICONS, identityOf, makeGeneric, makeUnique, uniqueOptions } from "../services/identity.mjs";
import { removeShop, saveShop, shelf } from "../services/shop.mjs";

/** @import { UniqueMode } from "../services/identity.mjs"; */

import { HandlebarsDocumentSheet } from "./base.mjs";

const template = (name) => `modules/${MODULE_ID}/templates/configure/${name}.hbs`;
const SHOP_HEIGHT = 720;

export default class ConfigureShop extends HandlebarsDocumentSheet {
  static DEFAULT_OPTIONS = {
    classes: ["kozmos-trade", "kt-configure-shop"],
    position: { width: 600 },
    window: { icon: "fa-solid fa-scale-balanced", contentClasses: ["standard-form"], resizable: true },
    form: { handler: ConfigureShop.#onSubmit, closeOnSubmit: false, submitOnChange: false },
    actions: {
      trade: ConfigureShop.#onTrade,
      removeShop: ConfigureShop.#onRemoveShop,
      revert: ConfigureShop.#onRevert,
      postCard: ConfigureShop.#onPostCard,
      generate: ConfigureShop.#onGenerate,
      rollWanted: ConfigureShop.#onRollWanted,
      showPlayers: ConfigureShop.#onShowPlayers,
      changeIdentity: ConfigureShop.#onChangeIdentity,
    },
    sheetConfig: false,
    ownershipConfig: false,
  };

  static PARTS = {
    new: { template: template("new") },
    tabs: { template: "templates/generic/tab-navigation.hbs" },
    setup: { template: template("settings"), scrollable: [""] },
    stock: { template: template("stock"), scrollable: [".kt-stock-list"] },
    customers: { template: template("customers"), scrollable: [""] },
    footer: { template: "templates/generic/form-footer.hbs" },
  };

  static TABS = {
    primary: {
      tabs: [
        { id: "setup", icon: "fa-solid fa-store" },
        { id: "stock", icon: "fa-solid fa-boxes-stacked" },
        { id: "customers", icon: "fa-solid fa-users" },
      ],
      initial: "setup",
      labelPrefix: "KT.Configure.Tab",
    },
  };

  /**
   * @param {any} actor
   * @param {{ tab?: string }} [options]
   */
  static open(actor, { tab } = {}) {
    const existing = /** @type {any} */ (foundry.applications.instances.get(`ConfigureShop-${actor.uuid.replaceAll(".", "-")}`));
    if (existing) {
      if (tab) existing.changeTab(tab, "primary");
      return existing.render({ force: true });
    }
    const app = new ConfigureShop({ document: actor, position: merchantFlags(actor).enabled ? { height: SHOP_HEIGHT } : {} });
    if (tab) app.tabGroups.primary = tab;
    return app.render({ force: true });
  }

  // Asks before an NPC stops being a shop, and whether to forget its records too.
  /** @param {any} actor */
  static async confirmRemove(actor) {
    const { createCheckboxInput, createFormGroup } = foundry.applications.fields;
    const forget = createFormGroup({ label: game.i18n.localize("KT.Configure.RemoveForget"), input: createCheckboxInput({ name: "forget", value: false }), hint: game.i18n.localize("KT.Configure.RemoveForgetHint") });
    const data = /** @type {any} */ (await foundry.applications.api.DialogV2.input(/** @type {any} */ ({
      window: { title: game.i18n.localize("KT.Configure.RemoveTitle", { name: actor.name }), icon: "fa-solid fa-store-slash" },
      content: `<p>${game.i18n.localize("KT.Configure.RemoveBody", { name: foundry.utils.escapeHTML(actor.name) })}</p>${forget.outerHTML}`,
      ok: { label: "KT.Configure.Remove", icon: "fa-solid fa-store-slash" },
      rejectClose: false,
    })));
    if (!data) return false;
    await removeShop(actor, { forget: Boolean(data.forget) }).catch((error) => warn(error));
    ui.notifications.info(game.i18n.localize("KT.Configure.Removed", { name: actor.name }));
    return true;
  }

  // Asks before rolling a new shelf with the shop's own archetype and wealth.
  /** @param {any} actor */
  static async confirmRestock(actor) {
    const ok = await foundry.applications.api.DialogV2.confirm(/** @type {any} */ ({
      window: { title: "KT.Stock.Restock", icon: "fa-solid fa-dice" },
      content: `<p>${game.i18n.localize("KT.Stock.RestockConfirm")}</p>`,
      rejectClose: false,
    }));
    if (!ok) return false;
    const done = await restock(actor).then(() => true, (error) => {
      warn(error);
      return false;
    });
    if (done) ui.notifications.info(game.i18n.localize("KT.Stock.Restocked", { name: actor.name }));
    return done;
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    const zone = this.element.querySelector(".kt-configure-stock");
    if (!zone || zone.dataset.dropReady) return;
    zone.dataset.dropReady = "true";
    zone.addEventListener("dragover", (event) => event.preventDefault());
    zone.addEventListener("drop", async (event) => {
      event.preventDefault();
      const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
      const count = await importStock(this.document, /** @type {any} */ (data)).catch((error) => warn(error));
      if (count) ui.notifications.info(game.i18n.localize("KT.Stock.Imported", { count }));
    });
  }

  get title() {
    const key = merchantFlags(this.document).enabled ? "KT.Configure.Title" : "KT.Configure.NewTitle";
    return game.i18n.localize(key, { name: this.document.name });
  }

  get enabled() {
    return merchantFlags(this.document).enabled;
  }

  // Shop-wide actions in the window menu, for a shop that is set up.
  _getHeaderControls() {
    const controls = super._getHeaderControls();
    const shop = () => this.enabled;
    return [
      ...controls,
      { action: "trade", icon: "fa-solid fa-scale-balanced", label: "KT.Shop.Trade", visible: shop },
      { action: "showPlayers", icon: "fa-solid fa-eye", label: "KT.Show.Control", visible: shop },
      { action: "postCard", icon: "fa-solid fa-bullhorn", label: "KT.Configure.PostCard", visible: shop },
      { action: "removeShop", icon: "fa-solid fa-store-slash", label: "KT.Configure.Remove", visible: shop },
    ];
  }

  _configureRenderParts(options) {
    const parts = super._configureRenderParts(options);
    if (this.enabled) delete parts.new;
    else for (const id of ["tabs", "setup", "stock", "customers"]) delete parts[id];
    return parts;
  }

  async _preparePartContext(partId, context, options) {
    const partContext = await super._preparePartContext(partId, context, options);
    if (partContext.tabs && partId in partContext.tabs) partContext.tab = partContext.tabs[partId];
    return partContext;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const flags = merchantFlags(this.document);
    const money = { locale: locale(), labels: coinLabels() };
    const entries = shelf(this.document);
    const rows = entries.map(({ item, holding, flags: itemFlagData, value, price }) => ({
      id: item.id,
      name: item.name,
      img: item.img,
      quantity: holding.quantity,
      value: value.forSale ? formatCopper(value.copper, money) : game.i18n.localize("KT.Configure.NotForSale"),
      price: itemFlagData.listedPrice === null ? "" : itemFlagData.listedPrice / COPPER.gp,
      placeholder: price === null ? "" : price / COPPER.gp,
      pinned: itemFlagData.pinned,
      underCounter: itemFlagData.underCounter,
      forSale: value.forSale,
    }));
    const names = (/** @type {{ quantity: number, name: string }[]} */ lines, /** @type {Record<string, number>} */ coins) => [...lines.map((l) => game.i18n.localize("KT.Ledger.Item", { quantity: l.quantity, name: l.name })), ...(coinsToCopper(coins) ? [formatCopper(coinsToCopper(coins), money)] : [])].join(", ") || game.i18n.localize("KT.Proposal.Nothing");
    const ledger = ledgerOf(this.document).map((entry) => ({
      id: entry.id,
      customer: entry.customerName,
      reverted: entry.reverted,
      summary: game.i18n.localize("KT.Ledger.Summary", { gets: names(entry.received, entry.paid), gives: names(entry.given, entry.coinsGive) }),
    }));
    const tables = attitudeTables();
    const forSale = entries.filter((entry) => entry.value.forSale).length;
    return Object.assign(context, {
      ledger,
      attitudeOn: feature("attitude"),
      attitudes: flags.enabled && feature("attitude") ? attitudeRows(this.document) : [],
      wantedOn: feature("wanted"),
      wanted: wantedLabels(wantedView(this.document)),
      attitudeRange: { min: tables.min, max: tables.max },
      theftOn: feature("theft"),
      identity: this.#identityContext(),
      carries: game.i18n.localize(forSale ? "KT.Configure.New.Carries" : "KT.Configure.New.Nothing", { name: this.document.name, count: forSale }),
      shop: { ...flags, archetype: flags.archetype || DEFAULT_ARCHETYPE },
      archetypes: Object.fromEntries(Object.keys(getArchetypes()).map((id) => [id, archetypeLabel(id)])),
      tiers: Object.fromEntries(TIERS.map((id) => [id, `KT.Tier.${id}`])),
      modes: Object.fromEntries(EXECUTION_MODES.map((id) => [id, `KT.ExecutionMode.${id}`])),
      rows,
      buttons: flags.enabled
        ? [{ type: "submit", icon: "fa-solid fa-floppy-disk", label: "KT.Configure.Save" }]
        : [
            { type: "button", action: "generate", icon: "fa-solid fa-dice", label: "KT.Configure.GenerateOpen" },
            { type: "submit", icon: "fa-solid fa-store", label: "KT.Configure.OpenShop" },
          ],
    });
  }

  // Who the merchant is now, and where its shop lives.
  #identityContext() {
    const actor = this.document;
    const value = identityOf(actor);
    const name = baseActorOf(actor)?.name ?? actor.name;
    const hint = game.i18n.localize(`KT.Identity.Hint.${actor.isToken ? "token" : value}`, { name });
    const fresh = !actor.isToken && value === "generic" && merchantFlags(actor).freshStock;
    return {
      icon: IDENTITY_ICONS[value],
      label: game.i18n.localize(`KT.Identity.Short.${value}`),
      hint: fresh ? `${hint} ${game.i18n.localize("KT.Identity.Hint.fresh")}` : hint,
    };
  }

  // Applies a change of identity. Answers the actor that holds the shop afterward, or null when the GM backs out.
  /** @param {string | undefined} choice */
  async #applyIdentity(choice) {
    const actor = this.document;
    if (!choice || choice === identityOf(actor)) return actor;
    if (choice === "generic") return makeGeneric(actor);
    const base = baseActorOf(actor);
    const name = foundry.utils.escapeHTML(base?.name ?? actor.name);
    const option = uniqueOptions(actor);
    /** @type {UniqueMode} */
    let mode = "move";
    if (option === "choose") {
      const answer = await foundry.applications.api.DialogV2.wait(/** @type {any} */ ({
        window: { title: game.i18n.localize("KT.Identity.Choose.Title", { name: base?.name ?? actor.name }), icon: "fa-solid fa-user" },
        content: `<p>${game.i18n.localize("KT.Identity.Choose.Body", { name })}</p>`,
        buttons: [
          { action: "link", label: "KT.Identity.Choose.Link", icon: "fa-solid fa-link", default: true },
          { action: "copy", label: "KT.Identity.Choose.Copy", icon: "fa-solid fa-user-plus" },
        ],
        rejectClose: false,
      }));
      if (answer !== "link" && answer !== "copy") return null;
      mode = answer;
    } else if (option === "move" && merchantFlags(actor).enabled) {
      const ok = await foundry.applications.api.DialogV2.confirm(/** @type {any} */ ({
        window: { title: "KT.Identity.Move.Title", icon: "fa-solid fa-user" },
        content: `<p>${game.i18n.localize("KT.Identity.Move.Body", { name })}</p>`,
        rejectClose: false,
      }));
      if (!ok) return null;
    }
    return makeUnique(actor, mode).catch((error) => {
      warn(error);
      return null;
    });
  }

  /**
   * @this {ConfigureShop}
   * @param {SubmitEvent} event
   * @param {HTMLFormElement} form
   * @param {any} formData
   */
  static async #onSubmit(event, form, formData) {
    // Form data has no static shape.
    const data = /** @type {any} */ (foundry.utils.expandObject(formData.object));
    const enabled = this.enabled;
    await this.#saveOn(this.document, data);
    if (!enabled) return this.#becameShop("stock");
    ui.notifications.info(game.i18n.localize("KT.Configure.Saved", { name: this.document.name }));
  }

  // Writes the form's shop settings, prices, pins and attitude to an actor.
  /**
   * @param {any} actor
   * @param {any} data
   */
  async #saveOn(actor, data) {
    const current = merchantFlags(actor);
    const enabled = current.enabled;
    const keep = (/** @type {string} */ key, /** @type {any} */ value) => (data[key] === undefined ? value : data[key]);
    const shop = {
      enabled: true,
      open: enabled ? Boolean(keep("open", current.open)) : true,
      remoteTrade: enabled ? Boolean(keep("remoteTrade", current.remoteTrade)) : false,
      theftProof: Boolean(keep("theftProof", current.theftProof)),
      archetype: keep("archetype", current.archetype),
      tier: keep("tier", current.tier),
      executionMode: keep("executionMode", current.executionMode),
    };
    const items = Object.fromEntries(
      Object.entries(data.items ?? {}).map(([id, row]) => [
        id,
        { listedPrice: Number.isFinite(row.price) ? toCopper(row.price, "gp") : null, pinned: Boolean(row.pinned) },
      ]),
    );
    await saveShop(actor, { shop, items });
    const shown = new Map(attitudeRows(actor).map((row) => [row.key, row.value]));
    for (const [key, value] of Object.entries(data.attitude ?? {})) {
      if (Number.isFinite(value) && shown.has(key) && shown.get(key) !== value) await setAttitude(actor, key, value);
    }
  }

  // Reopens a new shop with its tabs, on the given tab.
  /** @param {string} [tab] */
  async #becameShop(tab) {
    ui.notifications.info(game.i18n.localize("KT.Configure.Opened", { name: this.document.name }));
    return this.#reopen(this.document, tab);
  }

  // Closes this window and opens Configure Shop for an actor in its place.
  /**
   * @param {any} actor
   * @param {string} [tab]
   */
  async #reopen(actor, tab) {
    const { left, top } = this.position;
    await this.close();
    const app = /** @type {any} */ (await ConfigureShop.open(actor, { tab }));
    app?.setPosition({ left, top, ...(merchantFlags(actor).enabled ? { height: SHOP_HEIGHT } : {}) });
  }

  /** @this {ConfigureShop} */
  static #onTrade() {
    return openTrade(null, this.document);
  }

  // Asks who the merchant is, and applies the answer at once.
  /** @this {ConfigureShop} */
  static async #onChangeIdentity() {
    const actor = this.document;
    const current = identityOf(actor);
    const name = baseActorOf(actor)?.name ?? actor.name;
    const safe = foundry.utils.escapeHTML(name);
    const choice = (/** @type {"unique" | "generic"} */ value) => {
      const hint = game.i18n.localize(`KT.Identity.Hint.${value === "generic" && actor.isToken ? "token" : value}`, { name: safe });
      return `<label class="checkbox"><input type="radio" name="identity" value="${value}"${value === current ? " checked" : ""}> ${game.i18n.localize(`KT.Identity.${value}`)}</label><p class="hint">${hint}</p>`;
    };
    const { createCheckboxInput, createFormGroup } = foundry.applications.fields;
    const fresh = actor.isToken
      ? ""
      : createFormGroup({
          label: game.i18n.localize("KT.Identity.Fresh.Label"),
          input: createCheckboxInput({ name: "freshStock", value: merchantFlags(actor).freshStock }),
          hint: game.i18n.localize("KT.Identity.Fresh.Hint"),
          classes: ["kt-fresh-row"],
        }).outerHTML;
    const data = /** @type {any} */ (await foundry.applications.api.DialogV2.input(/** @type {any} */ ({
      window: { title: game.i18n.localize("KT.Identity.ChangeTitle", { name }), icon: "fa-solid fa-user" },
      classes: ["kozmos-trade", "kt-identity-dialog"],
      content: `<p class="hint">${game.i18n.localize("KT.Identity.ChangeHint")}</p><div class="kt-identity-choices">${choice("unique")}${choice("generic")}</div>${fresh}`,
      render: (/** @type {Event} */ event, /** @type {any} */ dialog) => {
        const form = /** @type {HTMLElement} */ (dialog.element);
        const sync = () => form.querySelector(".kt-fresh-row")?.classList.toggle("hidden", /** @type {HTMLInputElement | null} */ (form.querySelector("input[name='identity']:checked"))?.value !== "generic");
        form.addEventListener("change", sync);
        sync();
      },
      ok: { label: "KT.Configure.Save", icon: "fa-solid fa-floppy-disk" },
      rejectClose: false,
    })));
    if (!data) return;
    const target = await this.#applyIdentity(data.identity);
    if (!target) return;
    const flags = merchantFlags(target);
    if (!target.isToken && data.freshStock !== undefined && Boolean(data.freshStock) !== flags.freshStock) {
      await saveShop(target, { shop: { freshStock: Boolean(data.freshStock), enabled: flags.enabled } }).catch((error) => warn(error));
    }
    if (target !== actor) return this.#reopen(target, "setup");
    this.render();
  }

  /**
   * @this {ConfigureShop}
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static async #onRevert(event, target) {
    await revertEntry(this.document.uuid, target.dataset.entry);
  }

  // Rolls a new shelf with the archetype and wealth on screen, opening the shop if it is new.
  /** @this {ConfigureShop} */
  static async #onGenerate() {
    // Form data has no static shape.
    const data = /** @type {any} */ (new foundry.applications.ux.FormDataExtended(this.element)).object;
    const actor = this.document;
    const unpinned = shelf(actor).filter((entry) => !entry.flags.pinned).length;
    if (unpinned) {
      const ok = await foundry.applications.api.DialogV2.confirm(/** @type {any} */ ({
        window: { title: "KT.Stock.Restock" },
        content: `<p>${game.i18n.localize("KT.Configure.GenerateConfirm", { count: unpinned })}</p>`,
        rejectClose: false,
      }));
      if (!ok) return;
    }
    const isNew = !merchantFlags(actor).enabled;
    if (isNew) await saveShop(actor, { shop: { open: true, archetype: data.archetype, tier: data.tier } });
    const result = await generateStock(actor, { archetype: data.archetype, tier: data.tier }).catch((error) => warn(error));
    if (!result) return;
    const purse = formatCopper(result.purse, { locale: locale(), labels: coinLabels() });
    ui.notifications.info(game.i18n.localize("KT.Configure.Generated", { count: result.items.length, purse }));
    if (isNew) return this.#becameShop("stock");
  }

  /** @this {ConfigureShop} */
  static async #onRollWanted() {
    await rerollWanted(this.document).catch((error) => warn(error));
    this.render({ parts: ["stock"] });
  }

  /** @this {ConfigureShop} */
  static async #onPostCard() {
    await postShopCard(this.document);
    ui.notifications.info("KT.Configure.CardPosted", { localize: true });
  }

  /** @this {ConfigureShop} */
  static #onShowPlayers() {
    return showShop(this.document);
  }

  /** @this {ConfigureShop} */
  static async #onRemoveShop() {
    if (await ConfigureShop.confirmRemove(this.document)) await this.close();
  }
}
