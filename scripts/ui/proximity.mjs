// The Trade button that floats above the nearest open merchant while the player's own token stands close, and the merchant's greeting.
// Placeables and documents are typed any here because their schema fields have no generated types.
import { MODULE_ID, SETTINGS } from "../constants.mjs";
import { merchantFlags } from "../data/flags.mjs";
import { squaresBetween } from "../engine/access.mjs";
import { attitudeBandOf } from "../services/attitude.mjs";
import { combatBlocks } from "../services/combat.mjs";
import { openTrade } from "../services/open-trade.mjs";
import { reactionLine } from "../services/reactions.mjs";
import { getTables } from "../settings.mjs";

const BUTTON_ID = "kt-proximity";
const GREET_AGAIN = 5 * 60 * 1000;

/** @type {Set<string>} */
let near = new Set();
/** @type {Map<string, number>} */
const greeted = new Map();
const HOOKS = ["controlToken", "refreshToken", "updateToken", "createToken", "deleteToken", "canvasReady", "canvasPan", "updateActor", "updateCombat", "deleteCombat", "createCombatant", "deleteCombatant"];

export function registerProximityButton() {
  const update = foundry.utils.debounce(() => {
    refresh();
    greet();
  }, 60);
  for (const hook of HOOKS) Hooks.on(hook, update);
}

/** @param {any} token */
function box(token) {
  return { x: token.x, y: token.y, width: token.document.width, height: token.document.height };
}

// The user's selected token and the nearest open merchant within reach, if any.
export function nearestMerchant() {
  const board = /** @type {any} */ (canvas);
  if (!board?.ready || game.user.isGM) return null;
  const own = board.tokens.controlled.find((token) => token.actor?.isOwner && !merchantFlags(token.actor).enabled);
  if (!own || combatBlocks(own.actor)) return null;
  const reach = getTables().access.proximity;
  let best = null;
  for (const token of board.tokens.placeables) {
    if (token === own || !token.visible || !token.actor) continue;
    const flags = merchantFlags(token.actor);
    if (!flags.enabled || !flags.open || combatBlocks(token.actor)) continue;
    const squares = squaresBetween(box(own), box(token), board.grid.size);
    if (squares <= reach && (!best || squares < best.squares)) best = { token, squares };
  }
  return best ? { customer: own.actor, merchant: best.token } : null;
}

function refresh() {
  const found = nearestMerchant();
  const layer = document.getElementById("interface");
  let button = document.getElementById(BUTTON_ID);
  if (!found || !layer) return button?.remove();
  if (!button) {
    button = createButton();
    layer.append(button);
  }
  const { merchant, customer } = found;
  button.dataset.merchant = merchant.actor.uuid;
  button.dataset.customer = customer.uuid;
  button.setAttribute("aria-label", game.i18n.localize("KT.Proximity.Label", { name: merchant.name }));
  // Screen position, so the button keeps its size at any zoom.
  const point = /** @type {any} */ (canvas).clientCoordinatesFromCanvas({ x: merchant.x + merchant.w / 2, y: merchant.y });
  button.style.setProperty("--kt-x", `${point.x}px`);
  button.style.setProperty("--kt-y", `${point.y}px`);
}

function createButton() {
  const button = document.createElement("button");
  button.type = "button";
  button.id = BUTTON_ID;
  button.className = `${MODULE_ID} kt-proximity`;
  button.innerHTML = `<i class="fa-solid fa-scale-balanced" inert></i><span>${game.i18n.localize("KT.Proximity.Trade")}</span>`;
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openTrade(button.dataset.customer, button.dataset.merchant);
  });
  button.addEventListener("pointerdown", (event) => event.stopPropagation());
  return button;
}

// A speech bubble from each open merchant a player's token walks up to, at most once every few minutes.
function greet() {
  const board = /** @type {any} */ (canvas);
  if (game.user.isGM || !board?.ready || !game.settings.get(MODULE_ID, SETTINGS.GREETING)) {
    near = new Set();
    return;
  }
  const reach = getTables().access.proximity;
  const own = board.tokens.placeables.filter((token) => token.actor?.isOwner && !merchantFlags(token.actor).enabled);
  /** @type {Set<string>} */
  const now = new Set();
  for (const merchant of board.tokens.placeables) {
    if (!merchant.visible || !merchant.actor) continue;
    const flags = merchantFlags(merchant.actor);
    if (!flags.enabled || !flags.open || combatBlocks(merchant.actor)) continue;
    const customer = own.find((token) => !combatBlocks(token.actor) && squaresBetween(box(token), box(merchant), board.grid.size) <= reach);
    if (!customer) continue;
    now.add(merchant.id);
    if (near.has(merchant.id) || Date.now() - (greeted.get(merchant.id) ?? 0) < GREET_AGAIN) continue;
    greeted.set(merchant.id, Date.now());
    const line = reactionLine(flags.archetype, "greeting", attitudeBandOf(merchant.actor, customer.actor));
    if (line) board.hud.bubbles.say(merchant, line, { pan: false, requireVisible: true });
  }
  near = now;
}