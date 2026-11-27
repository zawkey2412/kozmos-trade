// Who a merchant is: one person whose shop follows them to every map, or a kind of merchant where every token is its own shop.
// Documents are typed any here because their schema fields have no generated types.
import { MODULE_ID } from "../constants.mjs";
import { merchantFlags } from "../data/flags.mjs";
import { TradeError } from "./errors.mjs";
import { generateStock } from "./stock.mjs";

/** @typedef {"unique" | "generic"} Identity */
/** @typedef {"move" | "link" | "copy"} UniqueMode */

export const IDENTITY_ICONS = Object.freeze({ unique: "fa-user", generic: "fa-users" });

// One person when its tokens share the actor, a kind of merchant when each token keeps its own.
/**
 * @param {any} actor
 * @returns {Identity}
 */
export function identityOf(actor) {
  if (actor.isToken) return "generic";
  return actor.prototypeToken?.actorLink ? "unique" : "generic";
}

// The sidebar actor behind a merchant.
/** @param {any} actor */
export function baseActorOf(actor) {
  return actor.isToken ? (game.actors.get(actor.token?.actorId) ?? null) : actor;
}

// How a token's shop can become one person: moved onto its actor, or a choice when the actor already is a shop.
/**
 * @param {any} actor
 * @returns {"world" | "move" | "choose"}
 */
export function uniqueOptions(actor) {
  if (!actor.isToken) return "world";
  const base = baseActorOf(actor);
  return base && merchantFlags(base).enabled ? "choose" : "move";
}

// GM side: makes the merchant one person. Answers the actor that now holds the shop.
/**
 * @param {any} actor
 * @param {UniqueMode} [mode]
 */
export async function makeUnique(actor, mode = "move") {
  if (!game.user.isGM) throw new TradeError("KT.Error.GMOnly");
  if (!actor.isToken) {
    await actor.update({ "prototypeToken.actorLink": true });
    await linkPlacedTokens(actor);
    return actor;
  }
  const token = actor.token;
  const base = baseActorOf(actor);
  if (!base) throw new TradeError("KT.Error.Missing");
  let target = base;
  if (mode === "copy") {
    const data = actor.toObject();
    delete data._id;
    data.prototypeToken = { ...(data.prototypeToken ?? {}), actorLink: true };
    target = await Actor.create(data, { keepEmbeddedIds: true });
  } else if (mode === "move") {
    await copyShop(actor, base);
  }
  await target.update({ "prototypeToken.actorLink": true });
  await token.update({ actorId: target.id, actorLink: true });
  return target;
}

// GM side: tokens placed from now on each become their own shop.
/** @param {any} actor */
export async function makeGeneric(actor) {
  if (!game.user.isGM) throw new TradeError("KT.Error.GMOnly");
  const base = baseActorOf(actor);
  if (base && base.prototypeToken?.actorLink) await base.update({ "prototypeToken.actorLink": false });
  return actor;
}

// The token's items, coins and shop records replace the actor's own.
/**
 * @param {any} from
 * @param {any} to
 */
async function copyShop(from, to) {
  const old = /** @type {any[]} */ (to.items.contents).map((item) => item.id);
  if (old.length) await to.deleteEmbeddedDocuments("Item", old);
  const items = /** @type {any[]} */ (from.items.contents).map((item) => item.toObject());
  if (items.length) await to.createEmbeddedDocuments("Item", items, { keepId: true });
  await to.update({ "system.currency": foundry.utils.deepClone(from.system.currency), [`flags.${MODULE_ID}`]: foundry.utils.deepClone(from.flags?.[MODULE_ID] ?? {}) });
}

// Unlinked tokens of this actor with no shop of their own join the one person.
/** @param {any} actor */
async function linkPlacedTokens(actor) {
  for (const scene of /** @type {any[]} */ (game.scenes.contents)) {
    const ids = scene.tokens
      .filter((token) => token.actorId === actor.id && !token.actorLink && !token.delta?.toObject()?.flags?.[MODULE_ID])
      .map((token) => token.id);
    if (ids.length) await scene.updateEmbeddedDocuments("Token", ids.map((_id) => ({ _id, actorLink: true })));
  }
}

// GM side: a token of a kind of merchant rolls its own shelf the first time it trades.
/** @param {any} merchant */
export async function stockForToken(merchant) {
  const flags = merchantFlags(merchant);
  if (!merchant.isToken || !flags.enabled || !flags.freshStock || flags.stockedToken === merchant.token?.id) return false;
  await generateStock(merchant);
  return true;
}
