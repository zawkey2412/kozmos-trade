// Configure Shop: turns an NPC into a merchant and sets its prices and pins.
import { MODULE_ID } from "../constants.mjs";
import { ARCHETYPES, DEFAULT_ARCHETYPE } from "../data/archetypes.mjs";
import { EXECUTION_MODES, merchantFlags, TIERS } from "../data/flags.mjs";
import { coinsToCopper, COPPER, formatCopper, toCopper } from "../engine/money.mjs";
import { coinLabels, locale } from "../adapter/dnd5e.mjs";
import { ledgerOf, revertEntry } from "../services/receipts.mjs";
import { removeShop, saveShop, shelf } from "../services/shop.mjs";

import { HandlebarsDocumentSheet } from "./base.mjs";

export default class ConfigureShop extends HandlebarsDocumentSheet {
  static DEFAULT_OPTIONS = {
    classes: ["kozmos-trade", "kt-configure-shop"],
    position: { width: 560 },
    window: { icon: "fa-solid fa-scale-balanced", contentClasses: ["standard-form"] },
    form: { handler: ConfigureShop.#onSubmit, closeOnSubmit: true },
    actions: { removeShop: ConfigureShop.#onRemoveShop, revert: ConfigureShop.#onRevert },
    sheetConfig: false,
    ownershipConfig: false,
  };

  static PARTS = {
    settings: { template: `modules/${MODULE_ID}/templates/configure/settings.hbs` },
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
      forSale: value.forSale,
    }));
    const names = (/** @type {{ quantity: number, name: string }[]} */ lines, /** @type {Record<string, number>} */ coins) => [...lines.map((l) => game.i18n.localize("KT.Ledger.Item", { quantity: l.quantity, name: l.name })),...(coinsToCopper(coins) ? [formatCopper(coinsToCopper(coins), money)] : [])].join(", ") || game.i18n.localize("KT.Proposal.Nothing");
    const ledger = ledgerOf(this.document).map((entry) => ({
      id: entry.id,
      customer: entry.customerName,
      reverted: entry.reverted,
      summary: game.i18n.localize("KT.Ledger.Summary", { gets: names(entry.received, entry.paid), gives: names(entry.given, entry.coinsGive) }),
    }));
    return Object.assign(context, {
      ledger,
      shop: { ...flags, archetype: flags.archetype || DEFAULT_ARCHETYPE },
      archetypes: Object.fromEntries(Object.keys(ARCHETYPES).map((id) => [id, `KT.Archetype.${id}`])),
      tiers: Object.fromEntries(TIERS.map((id) => [id, `KT.Tier.${id}`])),
      modes: Object.fromEntries(EXECUTION_MODES.map((id) => [id, `KT.ExecutionMode.${id}`])),
      rows,
      buttons: flags.enabled
        ? [
            { type: "button", action: "removeShop", icon: "fa-solid fa-store-slash", label: "KT.Configure.Remove" },
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
  }

  /**
   * @this {ConfigureShop}
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static async #onRevert(event, target) {
    await revertEntry(this.document.uuid, target.dataset.entry);
  }

  /** @this {ConfigureShop} */
  static async #onRemoveShop() {
    await removeShop(this.document);
    await this.close();
  }
}
