// The Trade button that floats above the nearest open merchant while the player's own token stands close.
// Placeables and documents are typed any here because their schema fields have no generated types.
import { MODULE_ID } from "../constants.mjs";
import { merchantFlags } from "../data/flags.mjs";
import { squaresBetween } from "../engine/access.mjs";
import { openTrade } from "../services/open-trade.mjs";
import { getTables } from "../settings.mjs";

const BUTTON_ID = "kt-proximity";
const HOOKS = ["controlToken", "refreshToken", "updateToken", "createToken", "deleteToken", "canvasReady", "canvasPan", "updateActor"];

export function registerProximityButton() {
  const update = foundry.utils.debounce(() => refresh(), 60);
  for (const hook of HOOKS) Hooks.on(hook, update);
}

/** @param {any} token */
function box(token) {
  return { x: token.x, y: token.y, width: token.document.width, height: token.document.height };
}

// The user's selected token and the nearest open merchant within reach, if any.
export function nearestMerchant() {
  const board = /** @type {any} */ (canvas);
  if (!board?.ready) return null;
  const own = board.tokens.controlled.find((token) => token.actor?.isOwner && !merchantFlags(token.actor).enabled);
  if (!own) return null;
  const reach = getTables().access.proximity;
  let best = null;
  for (const token of board.tokens.placeables) {
    if (token === own || !token.visible || !token.actor) continue;
    const flags = merchantFlags(token.actor);
    if (!flags.enabled || !flags.open) continue;
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
