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
import { ledgerOf, revertEntry } from "../services/receipts.mjs";
import { postShopCard } from "../services/shop-card.mjs";
import { showShop } from "../services/show.mjs";
import { generateStock, importStock, rerollWanted } from "../services/stock.mjs";
import { wantedLabels, wantedView } from "../services/session.mjs";
import { removeShop, saveShop, shelf } from "../services/shop.mjs";

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
      removeShop: ConfigureShop.#onRemoveShop,
      revert: ConfigureShop.#onRevert,
      postCard: ConfigureShop.#onPostCard,
      generate: ConfigureShop.#onGenerate,
      rollWanted: ConfigureShop.#onRollWanted,
      showPlayers: ConfigureShop.#onShowPlayers,
    },
    sheetConfig: false,
    ownershipConfig: false,
  };

  static PARTS = {
    intro: { template: template("intro") },
    tabs: { template: "templates/generic/tab-navigation.hbs" },
    setup: { template: template("settings"), scrollable: [""] },
    stock: { template: template("stock"), scrollable: [".kt-stock-list"] },
    attitude: { template: template("attitude"), scrollable: [""] },
    wanted: { template: template("wanted"), scrollable: [""] },
    ledger: { template: template("ledger"), scrollable: [".kt-ledger-list"] },
    footer: { template: "templates/generic/form-footer.hbs" },
  };

  static TABS = {
    primary: {
      tabs: [
        { id: "setup", icon: "fa-solid fa-store" },
        { id: "stock", icon: "fa-solid fa-boxes-stacked" },
        { id: "attitude", icon: "fa-regular fa-face-smile" },
        { id: "wanted", icon: "fa-solid fa-bullhorn" },
        { id: "ledger", icon: "fa-solid fa-book" },
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

  _configureRenderParts(options) {
    const parts = super._configureRenderParts(options);
    if (this.enabled) delete parts.intro;
    else for (const id of ["tabs", "attitude", "wanted", "ledger"]) delete parts[id];
    if (!feature("attitude")) delete parts.attitude;
    if (!feature("wanted")) delete parts.wanted;
    return parts;
  }

  _getTabsConfig(group) {
    const config = super._getTabsConfig(group);
    if (!config) return config;
    const hidden = new Set([...(feature("attitude") ? [] : ["attitude"]), ...(feature("wanted") ? [] : ["wanted"])]);
    return { ...config, tabs: config.tabs.filter((tab) => !hidden.has(tab.id)) };
  }

  async _preparePartContext(partId, context, options) {
    const partContext = await super._preparePartContext(partId, context, options);
    if (!this.enabled) partContext.tab = { id: partId, group: "primary", active: true };
    else if (partContext.tabs && partId in partContext.tabs) partContext.tab = partContext.tabs[partId];
    return partContext;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const flags = merchantFlags(this.document);
    const money = { locale: locale(), labels: coinLabels() };
    const rows = shelf(this.document).map(({ item, holding, flags: itemFlagData, value, price }) => ({
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
    return Object.assign(context, {
      ledger,
      attitudes: flags.enabled ? attitudeRows(this.document) : [],
      wanted: wantedLabels(wantedView(this.document)),
      attitudeRange: { min: tables.min, max: tables.max },
      theftOn: feature("theft"),
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

  /**
   * @this {ConfigureShop}
   * @param {SubmitEvent} event
   * @param {HTMLFormElement} form
   * @param {any} formData
   */
  static async #onSubmit(event, form, formData) {
    // Form data has no static shape.
    const data = /** @type {any} */ (foundry.utils.expandObject(formData.object));
    const current = merchantFlags(this.document);
    const enabled = current.enabled;
    const shop = {
      enabled: true,
      open: enabled ? Boolean(data.open) : true,
      remoteTrade: enabled ? Boolean(data.remoteTrade) : false,
      theftProof: data.theftProof === undefined ? current.theftProof : Boolean(data.theftProof),
      archetype: data.archetype,
      tier: data.tier,
      executionMode: data.executionMode,
    };
    const items = Object.fromEntries(
      Object.entries(data.items ?? {}).map(([id, row]) => [
        id,
        { listedPrice: Number.isFinite(row.price) ? toCopper(row.price, "gp") : null, pinned: Boolean(row.pinned) },
      ]),
    );
    await saveShop(this.document, { shop, items });
    const shown = new Map(attitudeRows(this.document).map((row) => [row.key, row.value]));
    for (const [key, value] of Object.entries(data.attitude ?? {})) {
      if (Number.isFinite(value) && shown.has(key) && shown.get(key) !== value) await setAttitude(this.document, key, value);
    }
    if (!enabled) return this.#becameShop("stock");
    ui.notifications.info(game.i18n.localize("KT.Configure.Saved", { name: this.document.name }));
  }

  // Reopens a new shop with its tabs, on the given tab.
  /** @param {string} [tab] */
  async #becameShop(tab) {
    ui.notifications.info(game.i18n.localize("KT.Configure.Opened", { name: this.document.name }));
    const { left, top } = this.position;
    await this.close();
    const app = /** @type {any} */ (await ConfigureShop.open(this.document, { tab }));
    app?.setPosition({ left, top, height: SHOP_HEIGHT });
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
    const unpinned = shelf(this.document).filter((entry) => !entry.flags.pinned).length;
    if (unpinned) {
      const ok = await foundry.applications.api.DialogV2.confirm(/** @type {any} */ ({
        window: { title: "KT.Configure.Generate" },
        content: `<p>${game.i18n.localize("KT.Configure.GenerateConfirm", { count: unpinned })}</p>`,
        rejectClose: false,
      }));
      if (!ok) return;
    }
    const isNew = !this.enabled;
    if (isNew) await saveShop(this.document, { shop: { open: true, archetype: data.archetype, tier: data.tier, executionMode: data.executionMode } });
    const result = await generateStock(this.document, { archetype: data.archetype, tier: data.tier }).catch((error) => warn(error));
    if (!result) return;
    const purse = formatCopper(result.purse, { locale: locale(), labels: coinLabels() });
    ui.notifications.info(game.i18n.localize("KT.Configure.Generated", { count: result.items.length, purse }));
    if (isNew) return this.#becameShop("stock");
  }

  /** @this {ConfigureShop} */
  static async #onRollWanted() {
    await rerollWanted(this.document).catch((error) => warn(error));
    this.render({ parts: ["wanted"] });
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
