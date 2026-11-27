// The Shops window: for players, the party to trade with and merchants the party has met. For the GM, every shop by scene, and the selected NPC token.
import { MODULE_ID } from "../constants.mjs";
import { activeRules } from "../engine/market.mjs";
import { merchantFlags } from "../data/flags.mjs";
import { warn } from "../services/errors.mjs";
import { openTrade, pickCustomer } from "../services/open-trade.mjs";
import { tradeWithPlayer } from "../services/player-trade.mjs";
import { sceneRules, worldRules } from "../services/market-rules.mjs";
import { postShopCard } from "../services/shop-card.mjs";
import { showShop } from "../services/show.mjs";
import { canBeShop, isShop, saveShop } from "../services/shop.mjs";
import { MESSAGES, request } from "../services/socket.mjs";
import { feature } from "../settings.mjs";
import ConfigureShop from "./configure-shop.mjs";
import MarketRules from "./market-rules.mjs";
import { HandlebarsApplication } from "./base.mjs";

/** @import { MarketRow } from "../services/market-list.mjs"; */

const GM_GROUPS = ["here", "elsewhere", "nowhere"];

export default class MarketList extends HandlebarsApplication {
  static DEFAULT_OPTIONS = {
    id: "kt-market-list",
    classes: ["kozmos-trade", "kt-market-list"],
    window: { title: "KT.Market.Title", icon: "fa-solid fa-store", resizable: true },
    position: { width: 540, height: 640 },
    actions: {
      trade: MarketList.#onTrade,
      tradePlayer: MarketList.#onTradePlayer,
      configure: MarketList.#onConfigure,
      find: MarketList.#onFind,
      toggleOpen: MarketList.#onToggleOpen,
      setUp: MarketList.#onSetUp,
      rules: MarketList.#onRules,
    },
  };

  static PARTS = {
    list: { template: `modules/${MODULE_ID}/templates/market-list.hbs`, scrollable: [".kt-market-scroll"] },
  };

  static toggle() {
    const existing = foundry.applications.instances.get(MarketList.DEFAULT_OPTIONS.id);
    if (existing) return existing.close();
    return new MarketList().render({ force: true });
  }

  // Open lists ask the GM again.
  static refreshAll() {
    const existing = /** @type {any} */ (foundry.applications.instances.get(MarketList.DEFAULT_OPTIONS.id));
    if (existing?.rendered) existing.render();
  }

  constructor(options = {}) {
    super(options);
    this.search = "";
    /** @type {string | null} */
    this.shownSelection = null;
    /** @type {[string, number][]} */
    this.hooks = [];
    this.redraw = foundry.utils.debounce(() => this.rendered && this.render(), 100);
  }

  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    for (const hook of ["userConnected", "updateUser"]) this.hooks.push([hook, Hooks.on(hook, () => this.redraw())]);
    if (game.user.isGM) {
      for (const hook of ["controlToken", "canvasReady"]) this.hooks.push([hook, Hooks.on(hook, () => this.redraw())]);
      new foundry.applications.ux.ContextMenu.implementation(this.element, ".kt-market-row", this.#rowMenu(), { jQuery: false, fixed: true });
    }
    this.element.addEventListener("input", (event) => {
      const target = /** @type {HTMLInputElement} */ (event.target);
      if (!target.matches(".kt-market-search")) return;
      this.search = target.value;
      this.#applySearch();
    });
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    this.#applySearch();
    const selected = /** @type {HTMLElement | null} */ (this.element.querySelector(".kt-market-row.active"));
    const uuid = selected?.dataset.uuid ?? null;
    if (selected && uuid !== this.shownSelection) selected.scrollIntoView({ block: "nearest" });
    this.shownSelection = uuid;
  }

  async _onClose(options) {
    await super._onClose(options);
    for (const [hook, id] of this.hooks) Hooks.off(hook, id);
    this.hooks = [];
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    /** @type {MarketRow[]} */
    let rows = [];
    try {
      rows = await request(MESSAGES.MARKET_LIST);
    } catch (error) {
      warn(error);
    }
    const gm = game.user.isGM;
    const shown = rows.map((row) => this.#row(row));
    return Object.assign(context, {
      gm,
      search: this.search,
      setup: gm ? setupCandidate() : null,
      partyOn: !gm,
      party: gm ? [] : partyRows(),
      rules: gm && feature("market") ? rulesLine() : null,
      groups: gm ? this.#gmGroups(shown) : [{ id: "visited", label: game.i18n.localize("KT.Market.Group.visited"), rows: shown }],
      any: shown.length > 0,
      empty: game.i18n.localize(gm ? "KT.Market.EmptyGM" : "KT.Market.Empty"),
    });
  }

  /** @param {MarketRow} row */
  #row(row) {
    const gm = game.user.isGM;
    const scene = /** @type {any} */ (canvas)?.scene?.id ?? null;
    return {
      ...row,
      status: game.i18n.localize(row.open ? "KT.Market.Open" : "KT.Market.Closed"),
      openHint: game.i18n.localize(row.open ? "KT.Market.OpenHint" : "KT.Market.ClosedHint"),
      visited: visitedLabel(row.days),
      group: !row.place ? "nowhere" : row.place.scene === scene ? "here" : "elsewhere",
      selected: gm && row.uuid === selectedShopUuid(),
      canTrade: gm || (row.open && row.remote),
      note: !gm && row.open && !row.remote ? game.i18n.localize("KT.Market.InPerson") : null,
    };
  }

  // This scene's shops first, then other scenes, then shops with no token anywhere.
  /** @param {(MarketRow & { group: string })[]} rows */
  #gmGroups(rows) {
    return GM_GROUPS.map((id) => ({ id, label: game.i18n.localize(`KT.Market.Group.${id}`), rows: rows.filter((row) => row.group === id), elsewhere: id === "elsewhere" })).filter((group) => group.rows.length);
  }

  // The right-click menu on a shop row.
  #rowMenu() {
    const actorOf = async (/** @type {HTMLElement} */ li) => /** @type {any} */ (await foundry.utils.fromUuid(li.dataset.uuid ?? ""));
    const run = (/** @type {(actor: any) => unknown} */ act) => async (/** @type {Event} */ event, /** @type {HTMLElement} */ li) => {
      const actor = await actorOf(li);
      if (actor) await act(actor);
    };
    return [
      { label: "KT.Shop.Configure", icon: "fa-solid fa-sliders", onClick: run((actor) => ConfigureShop.open(actor)) },
      { label: "KT.Shop.Trade", icon: "fa-solid fa-scale-balanced", onClick: run((actor) => openTrade(null, actor, { remote: true })) },
      { label: "KT.Show.Control", icon: "fa-solid fa-eye", onClick: run((actor) => showShop(actor)) },
      {
        label: "KT.Configure.PostCard",
        icon: "fa-solid fa-bullhorn",
        onClick: run(async (actor) => {
          await postShopCard(actor);
          ui.notifications.info("KT.Configure.CardPosted", { localize: true });
        }),
      },
      { label: "KT.Stock.Restock", icon: "fa-solid fa-dice", onClick: run((actor) => ConfigureShop.confirmRestock(actor)) },
      { label: "KT.Configure.Remove", icon: "fa-solid fa-store-slash", onClick: run((actor) => ConfigureShop.confirmRemove(actor)) },
    ];
  }

  #applySearch() {
    const text = this.search.trim().toLocaleLowerCase();
    let shown = 0;
    for (const group of this.element.querySelectorAll(".kt-market-group")) {
      let inGroup = 0;
      for (const row of group.querySelectorAll(".kt-market-row")) {
        const match = !text || (/** @type {HTMLElement} */ (row).dataset.name ?? "").toLocaleLowerCase().includes(text);
        row.classList.toggle("hidden", !match);
        if (match) inGroup++;
      }
      group.classList.toggle("hidden", inGroup === 0);
      shown += inGroup;
    }
    this.element.querySelector(".kt-market-nomatch")?.classList.toggle("hidden", shown > 0);
  }

  /**
   * @this {MarketList}
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static async #onTrade(event, target) {
    const uuid = /** @type {HTMLElement} */ (target.closest("[data-uuid]")).dataset.uuid;
    return openTrade(null, uuid, { remote: true });
  }

  /**
   * @this {MarketList}
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static async #onConfigure(event, target) {
    const uuid = /** @type {HTMLElement} */ (target.closest("[data-uuid]")).dataset.uuid;
    const actor = await foundry.utils.fromUuid(uuid);
    if (actor) ConfigureShop.open(actor);
  }

  // Shows the merchant's token on the map, switching scene if needed, and selects it.
  /**
   * @this {MarketList}
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static async #onFind(event, target) {
    const scene = /** @type {any} */ (game.scenes.get(target.dataset.scene));
    if (!scene) return;
    if (!scene.isView) await scene.view();
    // The tokens layer has no generated types.
    const token = /** @type {any} */ (canvas).tokens?.get(target.dataset.token);
    if (!token) return;
    token.control({ releaseOthers: true });
    await /** @type {any} */ (canvas).animatePan({ x: token.center.x, y: token.center.y });
  }

  // Opens or closes a shop straight from its row.
  /**
   * @this {MarketList}
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static async #onToggleOpen(event, target) {
    const uuid = /** @type {HTMLElement} */ (target.closest("[data-uuid]")).dataset.uuid;
    const actor = /** @type {any} */ (await foundry.utils.fromUuid(uuid));
    if (!actor) return;
    await saveShop(actor, { shop: { open: !merchantFlags(actor).open } }).catch((error) => warn(error));
  }

  // Invites another player's character, trading as the user's own.
  /**
   * @this {MarketList}
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static async #onTradePlayer(event, target) {
    const to = await foundry.utils.fromUuid(/** @type {HTMLElement} */ (target.closest("[data-uuid]")).dataset.uuid ?? "");
    if (!to) return;
    try {
      const own = /** @type {any} */ (game.user).character;
      const from = own?.isOwner ? own : await pickCustomer();
      if (from) await tradeWithPlayer(from, to);
    } catch (error) {
      warn(error);
    }
  }

  /** @this {MarketList} */
  static #onSetUp() {
    const actor = selectedActor();
    if (actor && !isShop(actor)) ConfigureShop.open(actor);
  }

  /** @this {MarketList} */
  static #onRules() {
    MarketRules.open();
  }
}

// The NPC behind the one selected token.
function selectedActor() {
  // The tokens layer has no generated types.
  const tokens = /** @type {any[]} */ (/** @type {any} */ (canvas).tokens?.controlled ?? []);
  const actor = tokens.length === 1 ? tokens[0].actor : null;
  return actor && canBeShop(actor) ? actor : null;
}

function selectedShopUuid() {
  const actor = selectedActor();
  return actor && isShop(actor) ? actor.uuid : null;
}

// Other online players' characters.
function partyRows() {
  return /** @type {any[]} */ (game.users.contents)
    .filter((user) => user.active && !user.isGM && !user.isSelf && user.character?.type === "character" && !user.character.isOwner)
    .map((user) => ({ uuid: user.character.uuid, name: user.character.name, img: user.character.img, player: game.i18n.localize("KT.Market.Played", { name: user.name }) }));
}

// The selected NPC token, when it is not a shop yet.
function setupCandidate() {
  const actor = selectedActor();
  if (!actor || isShop(actor)) return null;
  return { name: actor.name, img: actor.img, text: game.i18n.localize("KT.Market.SetUp", { name: actor.name }) };
}

// How many market rules are in force for the world and the viewed scene.
function rulesLine() {
  const scene = /** @type {any} */ (canvas)?.scene ?? null;
  const count = activeRules([...worldRules(), ...sceneRules(scene)], game.time.worldTime).length;
  const key = count === 0 ? "None" : count === 1 ? "One" : "Many";
  return { text: game.i18n.localize(`KT.Market.RulesLine.${key}`, { count: new Intl.NumberFormat(game.i18n.lang).format(count) }) };
}

/** @param {number | null} days */
export function visitedLabel(days) {
  if (days === null) return game.i18n.localize("KT.Market.NotVisited");
  if (days === 0) return game.i18n.localize("KT.Market.VisitedToday");
  if (days === 1) return game.i18n.localize("KT.Market.VisitedYesterday");
  return game.i18n.localize("KT.Market.VisitedDays", { days: new Intl.NumberFormat(game.i18n.lang).format(days) });
}
