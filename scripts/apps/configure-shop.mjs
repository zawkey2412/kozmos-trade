// Configure Shop: turns an NPC into a merchant and sets its prices and pins.
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
import { generateStock, importStock, rerollWanted } from "../services/stock.mjs";
import { wantedLabels, wantedView } from "../services/session.mjs";
import { removeShop, saveShop, shelf } from "../services/shop.mjs";

import { HandlebarsDocumentSheet } from "./base.mjs";

export default class ConfigureShop extends HandlebarsDocumentSheet {
  static DEFAULT_OPTIONS = {
    classes: ["kozmos-trade", "kt-configure-shop"],
    position: { width: 560 },
    window: { icon: "fa-solid fa-scale-balanced", contentClasses: ["standard-form"] },
    form: { handler: ConfigureShop.#onSubmit, closeOnSubmit: true },
    actions: { removeShop: ConfigureShop.#onRemoveShop, revert: ConfigureShop.#onRevert, postCard: ConfigureShop.#onPostCard, generate: ConfigureShop.#onGenerate, rollWanted: ConfigureShop.#onRollWanted },
    sheetConfig: false,
    ownershipConfig: false,
  };

  static PARTS = {
    settings: { template: `modules/${MODULE_ID}/templates/configure/settings.hbs` },
    attitude: { template: `modules/${MODULE_ID}/templates/configure/attitude.hbs` },
    wanted: { template: `modules/${MODULE_ID}/templates/configure/wanted.hbs` },
    stock: { template: `modules/${MODULE_ID}/templates/configure/stock.hbs`, scrollable: [".kt-stock-list"] },
    ledger: { template: `modules/${MODULE_ID}/templates/configure/ledger.hbs`, scrollable: [".kt-ledger-list"] },
    footer: { template: "templates/generic/form-footer.hbs" },
  };

  /** @param {any} actor */
  static open(actor) {
    const existing = foundry.applications.instances.get(`ConfigureShop-${actor.uuid.replaceAll(".", "-")}`);
    if (existing) return existing.render({ force: true });
    return new ConfigureShop({ document: actor }).render({ force: true });
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    const zone = this.element.querySelector(".kt-configure-stock");
    zone?.addEventListener("dragover", (event) => event.preventDefault());
    zone?.addEventListener("drop", async (event) => {
      event.preventDefault();
      const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
      const count = await importStock(this.document, /** @type {any} */ (data)).catch((error) => warn(error));
      if (count) ui.notifications.info(game.i18n.localize("KT.Stock.Imported", { count }));
    });
  }

  get title() {
    return game.i18n.localize("KT.Configure.Title", { name: this.document.name });
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
    const names = (/** @type {{ quantity: number, name: string }[]} */ lines, /** @type {Record<string, number>} */ coins) => [...lines.map((l) => game.i18n.localize("KT.Ledger.Item", { quantity: l.quantity, name: l.name })),...(coinsToCopper(coins) ? [formatCopper(coinsToCopper(coins), money)] : [])].join(", ") || game.i18n.localize("KT.Proposal.Nothing");
    const ledger = ledgerOf(this.document).map((entry) => ({
      id: entry.id,
      customer: entry.customerName,
      reverted: entry.reverted,
      summary: game.i18n.localize("KT.Ledger.Summary", { gets: names(entry.received, entry.paid), gives: names(entry.given, entry.coinsGive) }),
    }));
    const tables = attitudeTables();
    return Object.assign(context, {
      ledger,
      attitudes: attitudeRows(this.document),
      wanted: wantedLabels(wantedView(this.document)),
      attitudeRange: { min: tables.min, max: tables.max },
      theftOn: feature("theft"),
      shop: { ...flags, archetype: flags.archetype || DEFAULT_ARCHETYPE },
      archetypes: Object.fromEntries(Object.keys(getArchetypes()).map((id) => [id, archetypeLabel(id)])),
      tiers: Object.fromEntries(TIERS.map((id) => [id, `KT.Tier.${id}`])),
      modes: Object.fromEntries(EXECUTION_MODES.map((id) => [id, `KT.ExecutionMode.${id}`])),
      rows,
      buttons: flags.enabled
        ? [
            { type: "button", action: "removeShop", icon: "fa-solid fa-store-slash", label: "KT.Configure.Remove" },
            { type: "button", action: "postCard", icon: "fa-solid fa-bullhorn", label: "KT.Configure.PostCard" },
            { type: "submit", icon: "fa-solid fa-floppy-disk", label: "KT.Configure.Save" },
          ]
        : [{ type: "submit", icon: "fa-solid fa-store", label: "KT.Configure.OpenShop" }],
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
    const enabled = merchantFlags(this.document).enabled;
    const shop = {
      enabled: true,
      open: enabled ? Boolean(data.open) : true,
      remoteTrade: enabled ? Boolean(data.remoteTrade) : false,
      theftProof: data.theftProof === undefined ? merchantFlags(this.document).theftProof : Boolean(data.theftProof),
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
  }

  _configureRenderParts(options) {
    const parts = super._configureRenderParts(options);
    const enabled = merchantFlags(this.document).enabled;
    if (!enabled || !feature("attitude")) delete parts.attitude;
    if (!enabled || !feature("wanted")) delete parts.wanted;
    return parts;
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
    if (!merchantFlags(this.document).enabled) {
      await saveShop(this.document, { shop: { open: true, archetype: data.archetype, tier: data.tier, executionMode: data.executionMode } });
    }
    const result = await generateStock(this.document, { archetype: data.archetype, tier: data.tier }).catch((error) => warn(error));
    if (!result) return;
    const purse = formatCopper(result.purse, { locale: locale(), labels: coinLabels() });
    ui.notifications.info(game.i18n.localize("KT.Configure.Generated", { count: result.items.length, purse }));
  }

  /** @this {ConfigureShop} */
  static async #onRollWanted() {
    await rerollWanted(this.document).catch((error) => warn(error));
    this.render({ parts: ["wanted"] });
  }

  /** @this {ConfigureShop} */
  static async #onPostCard() {
    await postShopCard(this.document);
  }

  /** @this {ConfigureShop} */
  static async #onRemoveShop() {
    await removeShop(this.document);
    await this.close();
  }
}
