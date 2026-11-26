// Opening a trade from any way in: who trades as whom, then a session with the GM.
// Documents are typed any here because their schema fields have no generated types.
import { TradeError, warn } from "./errors.mjs";
import { MESSAGES, request } from "./socket.mjs";

/** @import { Snapshot } from "./session.mjs"; */

/** @type {((snapshot: Snapshot, customer: any) => any) | null} */
let showWindow = null;

/** @type {((view: any, customer: any) => any) | null} */
let showJoin = null;

/** @param {(snapshot: Snapshot, customer: any) => any} open */
export function setTradeWindow(open) {
  showWindow = open;
}

/** @param {(view: any, customer: any) => any} open */
export function setJoinWindow(open) {
  showJoin = open;
}

// A remote trade skips the distance check, where the shop allows it.
/**
 * @param {any | string | null | undefined} customer
 * @param {any | string} merchant
 * @param {{ remote?: boolean }} [options]
 */
export async function openTrade(customer, merchant, { remote = false } = {}) {
  const merchantUuid = typeof merchant === "string" ? merchant : merchant?.uuid;
  let who = null;
  try {
    who = typeof customer === "string" ? await foundry.utils.fromUuid(customer) : customer;
    who ??= await pickCustomer();
    if (!who) return null;
    /** @type {Snapshot} */
    const snapshot = await request(MESSAGES.SESSION_OPEN, { merchant: merchantUuid, customer: who.uuid, remote });
    return showWindow ? showWindow(snapshot, who) : snapshot;
  } catch (error) {
    if (error instanceof TradeError && error.data?.join && who) return askToJoin(who, merchantUuid, String(error.data.name ?? ""));
    warn(error);
    return null;
  }
}

// Busy with another player: offers to join their trade instead.
/**
 * @param {any} customer
 * @param {string} merchant
 * @param {string} name
 */
async function askToJoin(customer, merchant, name) {
  const yes = await foundry.applications.api.DialogV2.confirm(/** @type {any} */ ({
    window: { title: "KT.Join.Ask.Title", icon: "fa-solid fa-people-group" },
    content: `<p>${game.i18n.localize("KT.Join.Ask.Body", { name: foundry.utils.escapeHTML(name) })}</p>`,
    yes: { label: "KT.Join.Ask.Yes", icon: "fa-solid fa-people-group" },
    no: { label: "KT.Join.Ask.No" },
    rejectClose: false,
  }));
  if (!yes) return null;
  try {
    const view = await request(MESSAGES.SESSION_JOIN, { merchant, customer: customer.uuid });
    return showJoin ? showJoin(view, customer) : view;
  } catch (error) {
    warn(error);
    return null;
  }
}

/**
 * @param {any} customer
 * @param {any} merchant
 */
export function closeTrade(customer, merchant) {
  return request(MESSAGES.SESSION_CLOSE, { merchant: merchant.uuid, customer: customer.uuid }).catch(() => false);
}

// The user's own character, or a choice when they have several. For a GM, any player's character.
export async function pickCustomer() {
  const user = /** @type {any} */ (game.user);
  const actors = /** @type {any[]} */ (game.actors.contents);
  const candidates = actors.filter((actor) => actor.type === "character" && (user.isGM ? hasPlayerOwner(actor) : actor.isOwner));
  if (!candidates.length) throw new TradeError("KT.Error.NoCharacter");
  if (candidates.length === 1) return candidates[0];
  const select = foundry.applications.fields.createSelectInput({
    name: "customer",
    value: user.character?.id ?? candidates[0].id,
    options: candidates.map((actor) => ({ value: actor.id, label: actor.name })),
  });
  const group = foundry.applications.fields.createFormGroup({ label: game.i18n.localize("KT.Picker.Label"), input: select });
  const result = await foundry.applications.api.DialogV2.input(/** @type {any} */ ({
    window: { title: "KT.Picker.Title", icon: "fa-solid fa-scale-balanced" },
    content: group.outerHTML,
    ok: { label: "KT.Picker.Ok", icon: "fa-solid fa-check" },
    rejectClose: false,
  }));
  return result ? game.actors.get(result.customer) : null;
}

/** @param {any} actor */
function hasPlayerOwner(actor) {
  return game.users.some((user) => !user.isGM && actor.testUserPermission(user, "OWNER"));
}
