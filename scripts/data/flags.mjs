// Schemas for the module's flags on actors, items and tokens.
import { MODULE_ID } from "../constants.mjs";
import { TABLES } from "./tables.mjs";

/** @import { AttitudeState } from "../engine/attitude.mjs"; */

/**
 * @typedef {object} MerchantFlagData
 * @property {boolean} enabled
 * @property {boolean} open
 * @property {boolean} remoteTrade
 * @property {string} archetype
 * @property {"poor" | "modest" | "wealthy"} tier
 * @property {Record<string, AttitudeState>} attitude
 * @property {Record<string, number>} haggleLock
 * @property {{ category: string, uuid: string, multiplier: number }[]} wanted
 * @property {number | null} lastRestock
 * @property {object[]} ledger
 * @property {"instant" | "approval"} executionMode
 * @property {number} suspicion
 * @property {boolean} theftProof
 */

/**
 * @typedef {object} ItemFlagData
 * @property {number | null} listedPrice
 * @property {boolean} pinned
 * @property {boolean} limited
 * @property {boolean} curio
 * @property {number | null} trueValue
 * @property {{ source: string, time: number } | null} stolen
 */

/**
 * @typedef {object} TokenFlagData
 * @property {boolean} guard
 */

/**
 * @typedef {object} CharacterFlagData
 * @property {Record<string, { points: number, lastCatch: number }>} notoriety
 */

export const TIERS = Object.freeze(["poor", "modest", "wealthy"]);
export const EXECUTION_MODES = Object.freeze(["instant", "approval"]);

export class MerchantFlags extends foundry.abstract.DataModel {
  static defineSchema() {
    const { ArrayField, BooleanField, NumberField, ObjectField, SchemaField, StringField, TypedObjectField } = foundry.data.fields;
    const { min, max } = TABLES.attitude;
    const whole = { required: true, nullable: false, integer: true };
    return {
      enabled: new BooleanField(),
      open: new BooleanField(),
      remoteTrade: new BooleanField(),
      archetype: new StringField({ required: true, blank: true }),
      tier: new StringField({ required: true, choices: [...TIERS], initial: "modest" }),
      attitude: new TypedObjectField(
        new SchemaField({
          value: new NumberField({ ...whole, min, max, initial: 0 }),
          day: new NumberField({ ...whole, initial: 0 }),
          gained: new NumberField({ ...whole, min: 0, initial: 0 }),
          fairTradeDay: new NumberField({ integer: true, nullable: true, initial: null }),
          since: new NumberField({ required: true, nullable: false, initial: 0 }),
        }),
      ),
      haggleLock: new TypedObjectField(new NumberField({ required: true, nullable: false })),
      wanted: new ArrayField(
        new SchemaField({
          category: new StringField({ required: true, blank: true }),
          uuid: new StringField({ required: true, blank: true }),
          multiplier: new NumberField({ required: true, nullable: false, positive: true, initial: 1 }),
        }),
      ),
      lastRestock: new NumberField({ nullable: true, initial: null }),
      ledger: new ArrayField(new ObjectField()),
      executionMode: new StringField({ required: true, choices: [...EXECUTION_MODES], initial: "instant" }),
      suspicion: new NumberField({ ...whole, min: 0, initial: 0 }),
      theftProof: new BooleanField(),
    };
  }
}

export class ItemFlags extends foundry.abstract.DataModel {
  static defineSchema() {
    const { BooleanField, NumberField, SchemaField, StringField } = foundry.data.fields;
    return {
      listedPrice: new NumberField({ integer: true, min: 0, nullable: true, initial: null }),
      pinned: new BooleanField(),
      limited: new BooleanField(),
      curio: new BooleanField(),
      trueValue: new NumberField({ integer: true, min: 0, nullable: true, initial: null }),
      stolen: new SchemaField(
        {
          source: new StringField({ required: true, blank: false }),
          time: new NumberField({ required: true, nullable: false }),
        },
        { required: true, nullable: true, initial: null },
      ),
    };
  }
}

export class TokenFlags extends foundry.abstract.DataModel {
  static defineSchema() {
    const { BooleanField } = foundry.data.fields;
    return { guard: new BooleanField() };
  }
}

export class CharacterFlags extends foundry.abstract.DataModel {
  static defineSchema() {
    const { NumberField, SchemaField, TypedObjectField } = foundry.data.fields;
    return {
      notoriety: new TypedObjectField(
        new SchemaField({
          points: new NumberField({ required: true, nullable: false, integer: true, min: 0, initial: 0 }),
          lastCatch: new NumberField({ required: true, nullable: false, initial: 0 }),
        }),
      ),
    };
  }
}

/**
 * @param {{ flags?: object }} document
 * @returns {MerchantFlagData}
 */
export function merchantFlags(document) {
  return readFlags(MerchantFlags, document);
}

/**
 * @param {{ flags?: object }} document
 * @returns {ItemFlagData}
 */
export function itemFlags(document) {
  return readFlags(ItemFlags, document);
}

/**
 * @param {{ flags?: object }} document
 * @returns {TokenFlagData}
 */
export function tokenFlags(document) {
  return readFlags(TokenFlags, document);
}

/**
 * @param {{ flags?: object }} document
 * @returns {CharacterFlagData}
 */
export function characterFlags(document) {
  return readFlags(CharacterFlags, document);
}

// Flag data checked against its schema, ready to write.
/**
 * @param {typeof foundry.abstract.DataModel} Model
 * @param {object} data
 */
export function cleanFlags(Model, data) {
  return new Model(data).toObject();
}

// A document's flags, with bad parts reset to their defaults.
/**
 * @template T
 * @param {typeof foundry.abstract.DataModel} Model
 * @param {{ flags?: object }} document
 * @returns {T}
 */
function readFlags(Model, document) {
  return /** @type {T} */ (new Model(document.flags?.[MODULE_ID] ?? {}, { strict: false }).toObject());
}
