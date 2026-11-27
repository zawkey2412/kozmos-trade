// Notoriety: catches a character has in each scene, and what they cost with every merchant there.
// Documents are typed any here because their schema fields have no generated types.
import { MODULE_ID } from "../constants.mjs";
import { clock } from "../adapter/dnd5e.mjs";
import { characterFlags } from "../data/flags.mjs";
import { addCatch, notorietyNow } from "../engine/theft.mjs";
import { feature, getTables } from "../settings.mjs";
import { merchantScene } from "./market-rules.mjs";

// The customer's notoriety in the merchant's scene, after it fades.
/**
 * @param {any} merchant
 * @param {any} customer
 */
export function notorietyAt(merchant, customer) {
  if (!feature("theft") || !customer) return 0;
  const scene = merchantScene(merchant);
  if (!scene) return 0;
  const { now, week } = clock();
  return notorietyNow(characterFlags(customer).notoriety[scene.id], now, week, getTables().theft);
}

// GM side: one more catch for the character in the merchant's scene. Answers the points it now has there.
/**
 * @param {any} merchant
 * @param {any} customer
 */
export async function addNotoriety(merchant, customer) {
  const scene = merchantScene(merchant);
  if (!scene) return 0;
  const { now, week } = clock();
  const record = addCatch(characterFlags(customer).notoriety[scene.id], now, week, getTables().theft);
  await customer.update({ [`flags.${MODULE_ID}.notoriety.${scene.id}`]: record });
  return record.points;
}
