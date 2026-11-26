// Trades between two players' characters on the active GM: no prices, no haggle, no attitude, and both must accept.
// Documents are typed any here because their schema fields have no generated types.
import { MODULE_ID } from "../constants.mjs";
import { coinLabels, holdingFacts, itemFacts, locale, purse } from "../adapter/dnd5e.mjs";
import { COPPER, formatCoins } from "../engine/money.mjs";
import { acceptOffer, bothAccepted, changeOffer, cleanPlayerOffer, offerIsEmpty, resetAccepts, sideIndex, startPlayerTrade } from "../engine/player-trade.mjs";
import { tradeable } from "../engine/shelf.mjs";
import { addCoins } from "../engine/tray.mjs";
import { TradeError, warn } from "./errors.mjs";
import { broadcast, MESSAGES, onBroadcast, onRequest, request } from "./socket.mjs";
import { moveAll } from "./trade.mjs";

/** @import { PlayerOffer, PlayerTrade } from "../engine/player-trade.mjs"; */
/** @import { TradeLine } from "./trade.mjs"; */

/**
 * @typedef {object} PlayerSideView
 * @property {string} actor
 * @property {string} name
 * @property {string} img
 * @property {string} userId
 * @property {boolean} accepted
 * @property {{ id: string, name: string, img: string, quantity: number }[]} lines
 * @property {Record<string, number>} coins
 */

/**
 * @typedef {object} PlayerTradeView
 * @property {string} id
 * @property {number} version
 * @property {PlayerSideView[]} sides
 */

/**
 * @typedef {object} PlayerTradeWindows
 * @property {(view: PlayerTradeView) => Promise<any>} sync
 * @property {(id: string, reason: string, name: string) => void} ended
 */

const TEMPLATE = `modules/${MODULE_ID}/templates/chat/player-trade.hbs`;

/** @type {Map<string, PlayerTrade>} */
const trades = new Map();

/** @type {PlayerTradeWindows | null} */
let windows = null;

/** @param {PlayerTradeWindows} open */
export function setPlayerTradeWindow(open) {
  windows = open;
}

export function registerPlayerTradeHandlers() {
  onRequest(MESSAGES.PLAYER_OPEN, openPlayerTrade);
  onRequest(MESSAGES.PLAYER_OFFER, changePlayerOffer, { queueKey: (payload) => payload?.id });
  onRequest(MESSAGES.PLAYER_ACCEPT, acceptPlayerOffer, { queueKey: (payload) => payload?.id });
  onRequest(MESSAGES.PLAYER_CLOSE, closePlayerTrade, { queueKey: (payload) => payload?.id });
  onBroadcast(MESSAGES.PLAYER_STATE, (view) => windows?.sync(view));
  onBroadcast(MESSAGES.PLAYER_CLOSED, ({ id, reason, name }) => windows?.ended(id, reason, name));
  Hooks.on("userConnected", (user, connected) => {
    if (connected) return;
    for (const trade of [...trades.values()]) {
      const side = trade.sides.find((s) => s.userId === user.id);
      if (side) end(trade, "left", nameOf(side.actor));
    }
  });
}

// Opens a trade with another player's character, with one item already on offer.
/**
 * @param {any} from
 * @param {any} to
 * @param {string | null} [itemId]
 */
export async function tradeWithPlayer(from, to, itemId = null) {
  try {
    /** @type {PlayerTradeView} */
    const view = await request(MESSAGES.PLAYER_OPEN, { from: from.uuid, to: to.uuid });
    const app = await windows?.sync(view);
    if (itemId && app?.stage) await app.stage("customer", itemId);
    return app ?? view;
  } catch (error) {
    warn(error);
    return null;
  }
}

/**
 * @param {{ from: string, to: string }} payload
 * @param {any} sender
 */
async function openPlayerTrade({ from, to }, sender) {
  if (sender.isGM) throw new TradeError("KT.Error.PlayersOnly");
  const first = /** @type {any} */ (await foundry.utils.fromUuid(from));
  const second = /** @type {any} */ (await foundry.utils.fromUuid(to));
  if (!first || !second) throw new TradeError("KT.Error.Missing");
  if (first.type !== "character" || second.type !== "character" || first === second) throw new TradeError("KT.Error.PlayersOnly");
  if (!first.testUserPermission(sender, "OWNER")) throw new TradeError("KT.Error.NotYours");
  const open = [...trades.values()];
  const same = open.find((trade) => sideIndex(trade, first.uuid) >= 0 && sideIndex(trade, second.uuid) >= 0);
  if (same) return publish(same);
  for (const actor of [first, second]) {
    if (open.some((trade) => sideIndex(trade, actor.uuid) >= 0)) throw new TradeError("KT.Error.PlayerBusy", { name: actor.name });
  }
  const partner = partnerOf(second, sender);
  const trade = startPlayerTrade(foundry.utils.randomID(), { actor: first.uuid, userId: sender.id }, { actor: second.uuid, userId: partner.id });
  trades.set(trade.id, trade);
  return publish(trade);
}

/**
 * @param {{ id: string, actor: string, offer: PlayerOffer }} payload
 * @param {any} sender
 */
async function changePlayerOffer({ id, actor, offer }, sender) {
  const { trade, index } = sideFor(id, actor, sender);
  const clean = cleanPlayerOffer(offer);
  if (!clean) throw new TradeError("KT.Error.Empty");
  linesFor(await foundry.utils.fromUuid(actor), clean);
  const next = changeOffer(trade, index, clean);
  trades.set(id, next);
  return next === trade ? viewOf(next) : publish(next);
}

/**
 * @param {{ id: string, actor: string, version: number }} payload
 * @param {any} sender
 */
async function acceptPlayerOffer({ id, actor, version }, sender) {
  const { trade, index } = sideFor(id, actor, sender);
  if (trade.sides.every((side) => offerIsEmpty(side.offer))) throw new TradeError("KT.Error.Empty");
  const next = acceptOffer(trade, index, version);
  if (!next) throw new TradeError("KT.Error.OfferChanged");
  trades.set(id, next);
  if (!bothAccepted(next)) return publish(next);
  try {
    await execute(next);
  } catch (error) {
    const reset = resetAccepts(next);
    trades.set(id, reset);
    publish(reset);
    throw error;
  }
  end(next, "done", "");
  return { done: true };
}

/**
 * @param {{ id: string }} payload
 * @param {any} sender
 */
function closePlayerTrade({ id }, sender) {
  const trade = trades.get(id);
  if (!trade) return true;
  const side = trade.sides.find((s) => s.userId === sender.id);
  if (!side && !sender.isGM) throw new TradeError("KT.Error.NotYours");
  end(trade, "closed", side ? nameOf(side.actor) : sender.name);
  return true;
}

// Both offers checked again, then both sides change hands at once.
/** @param {PlayerTrade} trade */
async function execute(trade) {
  const [a, b] = trade.sides;
  const first = /** @type {any} */ (await foundry.utils.fromUuid(a.actor));
  const second = /** @type {any} */ (await foundry.utils.fromUuid(b.actor));
  if (!first || !second) throw new TradeError("KT.Error.Missing");
  const firstLines = linesFor(first, a.offer);
  const secondLines = linesFor(second, b.offer);
  if (Hooks.call("kozmosTrade.prePlayerTrade", first, second, trade) === false) throw new TradeError("KT.Error.Cancelled");
  await moveAll({
    currency: [
      [first, addCoins(addCoins(purse(first), a.offer.coins, -1), b.offer.coins)],
      [second, addCoins(addCoins(purse(second), b.offer.coins, -1), a.offer.coins)],
    ],
    moves: [
      { from: first, to: second, lines: firstLines },
      { from: second, to: first, lines: secondLines },
    ],
  });
  await postCard(first, second, firstLines, secondLines, a.offer.coins, b.offer.coins).catch((error) => console.error("Kozmos Trade | Card failed", error));
  Hooks.callAll("kozmosTrade.playerTrade", first, second, trade);
}

// An offer's lines, checked against what the character holds now.
/**
 * @param {any} actor
 * @param {PlayerOffer} offer
 * @returns {TradeLine[]}
 */
function linesFor(actor, offer) {
  if (!actor) throw new TradeError("KT.Error.Missing");
  const held = purse(actor);
  if (Object.keys(COPPER).some((coin) => offer.coins[coin] > held[coin])) throw new TradeError("KT.Error.CoinsGone", { name: actor.name });
  return offer.items.map(([id, quantity]) => {
    const item = actor.items.get(id);
    if (!item) throw new TradeError("KT.Error.SoldOut");
    const facts = itemFacts(item);
    const holding = holdingFacts(item);
    const full = facts.type === "container" && holding.contents > 0;
    if (!tradeable(facts, holding) || full || quantity > holding.quantity) throw new TradeError("KT.Error.ItemGone", { name: item.name });
    return { item, quantity, unit: 0, held: holding.quantity };
  });
}

// The other character's player: online, not the sender, and preferably the one playing them.
/**
 * @param {any} actor
 * @param {any} sender
 */
function partnerOf(actor, sender) {
  const owners = /** @type {any[]} */ (game.users.contents).filter((user) => user.active && !user.isGM && actor.testUserPermission(user, "OWNER"));
  const others = owners.filter((user) => user.id !== sender.id);
  if (!others.length) throw new TradeError(owners.length ? "KT.Error.OwnBoth" : "KT.Error.PartnerAway", { name: actor.name });
  return others.find((user) => user.character?.id === actor.id) ?? others[0];
}

/**
 * @param {string} id
 * @param {string} actor
 * @param {any} sender
 */
function sideFor(id, actor, sender) {
  const trade = trades.get(id);
  if (!trade) throw new TradeError("KT.Error.PlayerTradeGone");
  const index = sideIndex(trade, actor);
  if (index < 0 || trade.sides[index].userId !== sender.id) throw new TradeError("KT.Error.NotYours");
  return { trade, index };
}

/** @param {PlayerTrade} trade */
function publish(trade) {
  const view = viewOf(trade);
  broadcast(MESSAGES.PLAYER_STATE, view, { users: trade.sides.map((side) => side.userId) });
  return view;
}

/**
 * @param {PlayerTrade} trade
 * @param {string} reason
 * @param {string} name
 */
function end(trade, reason, name) {
  trades.delete(trade.id);
  broadcast(MESSAGES.PLAYER_CLOSED, { id: trade.id, reason, name }, { users: trade.sides.map((side) => side.userId) });
}

// What both players see: names, pictures and quantities only.
/**
 * @param {PlayerTrade} trade
 * @returns {PlayerTradeView}
 */
function viewOf(trade) {
  return {
    id: trade.id,
    version: trade.version,
    sides: trade.sides.map((side) => {
      const actor = /** @type {any} */ (foundry.utils.fromUuidSync(side.actor));
      return {
        actor: side.actor,
        name: actor?.name ?? "",
        img: actor?.img ?? "",
        userId: side.userId,
        accepted: side.accepted,
        coins: side.offer.coins,
        lines: side.offer.items.map(([id, quantity]) => {
          const item = actor?.items.get(id);
          return { id, quantity, name: item?.name ?? "", img: item?.img ?? "" };
        }),
      };
    }),
  };
}

/** @param {string} uuid */
function nameOf(uuid) {
  return /** @type {any} */ (foundry.utils.fromUuidSync(uuid))?.name ?? "";
}

/**
 * @param {any} first
 * @param {any} second
 * @param {TradeLine[]} firstLines
 * @param {TradeLine[]} secondLines
 * @param {Record<string, number>} firstCoins
 * @param {Record<string, number>} secondCoins
 */
async function postCard(first, second, firstLines, secondLines, firstCoins, secondCoins) {
  const money = { locale: locale(), labels: coinLabels() };
  const lines = (/** @type {TradeLine[]} */ list, /** @type {Record<string, number>} */ coins) => [
    ...list.map((line) => game.i18n.localize("KT.Ledger.Item", { quantity: line.quantity, name: line.item.name })),
    ...(formatCoins(coins, money) ? [formatCoins(coins, money)] : []),
  ];
  const content = await foundry.applications.handlebars.renderTemplate(TEMPLATE, {
    first: first.name,
    second: second.name,
    firstGives: lines(firstLines, firstCoins),
    secondGives: lines(secondLines, secondCoins),
  });
  return ChatMessage.create(/** @type {any} */ ({
    content,
    speaker: ChatMessage.getSpeaker({ actor: first }),
    flags: { [MODULE_ID]: { playerTrade: true } },
  }));
}
