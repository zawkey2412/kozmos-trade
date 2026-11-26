// Market rules on the GM's side: the world's and each scene's, and the ones in force at a merchant.
// Documents are typed any here because their schema fields have no generated types.
import { MODULE_ID, SETTINGS } from "../constants.mjs";
import { clock } from "../adapter/dnd5e.mjs";
import { cleanFlags, SceneFlags, sceneFlags } from "../data/flags.mjs";
import { activeRules, newRule } from "../engine/market.mjs";
import { feature, getTables } from "../settings.mjs";
import { TradeError } from "./errors.mjs";
import { broadcast, MESSAGES } from "./socket.mjs";

/** @import { MarketRule } from "../engine/market.mjs"; */

/** @returns {MarketRule[]} */
export function worldRules() {
  return foundry.utils.deepClone(game.settings.get(MODULE_ID, SETTINGS.MARKET) ?? []);
}

/**
 * @param {any} scene
 * @returns {MarketRule[]}
 */
export function sceneRules(scene) {
  return scene ? sceneFlags(scene).market : [];
}

// The scene a merchant trades in: its token's, or the active or viewed scene where it has a token.
/** @param {any} merchant */
export function merchantScene(merchant) {
  if (merchant.isToken) return merchant.token?.parent ?? null;
  const scenes = /** @type {any[]} */ (game.scenes.contents).filter((scene) => scene.tokens.some((token) => token.actorLink && token.actorId === merchant.id));
  return scenes.find((scene) => scene.active) ?? scenes.find((scene) => scene.isView) ?? scenes[0] ?? null;
}

// The world's rules and the merchant's scene's, while market modifiers are on and the rules have not ended.
/**
 * @param {any} merchant
 * @returns {MarketRule[]}
 */
export function marketRulesFor(merchant) {
  if (!feature("market")) return [];
  return activeRules([...worldRules(), ...sceneRules(merchantScene(merchant))], game.time.worldTime);
}

// GM side: a new rule for the world, or for one scene.
/**
 * @param {{ name: unknown, categories: unknown, percent: unknown, days: unknown }} input
 * @param {{ scene?: any }} [options]
 */
export async function addMarketRule(input, { scene = null } = {}) {
  if (!game.user.isGM) throw new TradeError("KT.Error.GMOnly");
  const { now, day } = clock();
  let rule;
  try {
    rule = newRule(input, { id: foundry.utils.randomID(), now, day, limits: getTables().market });
  } catch (error) {
    throw new TradeError(error.message);
  }
  if (scene) await saveSceneRules(scene, [...sceneRules(scene), rule]);
  else await game.settings.set(MODULE_ID, SETTINGS.MARKET, [...worldRules(), rule]);
  announce();
  return rule;
}

// GM side: removes a rule wherever it is.
/** @param {string} id */
export async function removeMarketRule(id) {
  if (!game.user.isGM) throw new TradeError("KT.Error.GMOnly");
  const world = worldRules();
  if (world.some((rule) => rule.id === id)) await game.settings.set(MODULE_ID, SETTINGS.MARKET, world.filter((rule) => rule.id !== id));
  for (const scene of /** @type {any[]} */ (game.scenes.contents)) {
    const rules = sceneRules(scene);
    if (rules.some((rule) => rule.id === id)) await saveSceneRules(scene, rules.filter((rule) => rule.id !== id));
  }
  announce();
}

/**
 * @param {any} scene
 * @param {MarketRule[]} rules
 */
async function saveSceneRules(scene, rules) {
  const flags = /** @type {any} */ (cleanFlags(SceneFlags, { market: rules }));
  await scene.update({ [`flags.${MODULE_ID}.market`]: flags.market });
}

function announce() {
  broadcast(MESSAGES.MARKET_CHANGED, {});
}
