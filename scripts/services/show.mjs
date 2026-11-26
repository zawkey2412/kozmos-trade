// "Show to players": a GM opens a shop's window on chosen players' screens, without the usual access checks.
// Documents and users are typed any here because their schema fields have no generated types.
import { merchantFlags } from "../data/flags.mjs";
import { TradeError, warn } from "./errors.mjs";
import { openTrade } from "./open-trade.mjs";
import { grantShow } from "./session.mjs";
import { broadcast, MESSAGES, onBroadcast, onRequest, request } from "./socket.mjs";

export function registerShowHandlers() {
  onRequest(MESSAGES.SHOW_SHOP, grantAndShow);
  onBroadcast(MESSAGES.SHOP_SHOWN, ({ merchant, users }) => {
    if (users.includes(game.user.id)) openShown(merchant);
  });
}

// GM side, on the answering window: the grants first, then the players' windows.
/**
 * @param {{ merchant: string, users: string[] }} payload
 * @param {any} sender
 */
async function grantAndShow({ merchant, users }, sender) {
  if (!sender.isGM) throw new TradeError("KT.Error.GMOnly");
  const actor = /** @type {any} */ (await foundry.utils.fromUuid(merchant));
  if (!actor || !merchantFlags(actor).enabled) throw new TradeError("KT.Error.NotShop", { name: actor?.name ?? "" });
  const players = (Array.isArray(users) ? users : []).filter((id) => game.users.get(id)?.active && !game.users.get(id)?.isGM);
  if (!players.length) throw new TradeError("KT.Show.NoPlayers");
  grantShow(merchant, players);
  broadcast(MESSAGES.SHOP_SHOWN, { merchant, users: players }, { users: players });
  return players.length;
}

// A player's own character trades, or they pick one.
/** @param {string} merchant */
function openShown(merchant) {
  const own = /** @type {any} */ (game.user).character;
  return openTrade(own?.isOwner ? own : null, merchant);
}

// The GM picks players who are online.
/** @param {any} merchant */
export async function showShop(merchant) {
  if (!game.user.isGM) return;
  const players = /** @type {any[]} */ (game.users.contents).filter((user) => user.active && !user.isGM);
  if (!players.length) return ui.notifications.warn("KT.Show.NoPlayers", { localize: true });
  const boxes = players
    .map((user) => {
      const character = user.character ? ` (${foundry.utils.escapeHTML(user.character.name)})` : "";
      return `<label class="checkbox"><input type="checkbox" name="${user.id}" checked> ${foundry.utils.escapeHTML(user.name)}${character}</label>`;
    })
    .join("");
  const data = /** @type {any} */ (await foundry.applications.api.DialogV2.input(/** @type {any} */ ({
    window: { title: game.i18n.localize("KT.Show.Title", { name: merchant.name }), icon: "fa-solid fa-eye" },
    content: `<p class="hint">${game.i18n.localize("KT.Show.Hint")}</p><div class="kt-show-players">${boxes}</div>`,
    ok: { label: "KT.Show.Ok", icon: "fa-solid fa-eye" },
    rejectClose: false,
  })));
  if (!data) return;
  const users = players.filter((user) => data[user.id]).map((user) => user.id);
  if (!users.length) return;
  try {
    const count = await request(MESSAGES.SHOW_SHOP, { merchant: merchant.uuid, users });
    ui.notifications.info(game.i18n.localize("KT.Show.Done", { name: merchant.name, count }));
  } catch (error) {
    warn(error);
  }
}
