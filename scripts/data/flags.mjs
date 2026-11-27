// Schemas for the module's flags on actors, items and tokens.
import { MODULE_ID } from "../constants.mjs";
import { TABLES } from "./tables.mjs";

/** @import { AttitudeState } from "../engine/attitude.mjs"; */
/** @import { MarketRule } from "../engine/market.mjs"; */
/** @import { VisitRecord } from "../engine/visits.mjs"; */

/**
 * @typedef {object} MerchantFlagData
 * @property {boolean} enabled
 * @property {boolean} open
 * @property {boolean} remoteTrade
 * @property {string} archetype
 * @property {"poor" | "modest" | "wealthy"} tier
 * @property {Record<string, AttitudeState>} attitude
 * @property {Record<string, number>} haggleLock
 * @property {Record<string, { day: number, success: boolean }>} appraisals
 * @property {Record<string, number>} banned
 * @property {Record<string, VisitRecord>} visits
 * @property {{ category: string, uuid: string, name: string, multiplier: number }[]} wanted
 * @property {number | null} lastRestock
 * @property {object[]} ledger
 * @property {"instant" | "approval"} executionMode
 * @property {number} suspicion
 * @property {number | null} suspicionDay
 * @property {boolean} theftProof
 * @property {{ actor: string, name: string, item: string, time: number }[]} thefts
 * @property {Record<string, number>} grudges
 * @property {boolean} freshStock
 * @property {string | null} stockedToken
 */

/**
 * @typedef {object} ItemFlagData
 * @property {number | null} listedPrice
 * @property {boolean} pinned
 * @property {boolean} limited
 * @property {boolean} curio
 * @property {boolean} underCounter
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

/**
 * @typedef {object} SceneFlagData
 * @property {MarketRule[]} market
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
      appraisals: new TypedObjectField(
        new SchemaField({
          day: new NumberField({ ...whole, initial: 0 }),
          success: new BooleanField(),
        }),
      ),
      banned: new TypedObjectField(new NumberField({ required: true, nullable: false })),
      visits: new TypedObjectField(
        new SchemaField({
          last: new NumberField({ required: true, nullable: false, initial: 0 }),
          tradedAt: new NumberField({ nullable: true, initial: null }),
          sold: new ArrayField(visitLine()),
          bought: new ArrayField(visitLine()),
        }),
      ),
      wanted: new ArrayField(
        new SchemaField({
          category: new StringField({ required: true, blank: true }),
          uuid: new StringField({ required: true, blank: true }),
          name: new StringField({ required: true, blank: true }),
          multiplier: new NumberField({ required: true, nullable: false, positive: true, initial: 1 }),
        }),
      ),
      lastRestock: new NumberField({ nullable: true, initial: null }),
      ledger: new ArrayField(new ObjectField()),
      executionMode: new StringField({ required: true, choices: [...EXECUTION_MODES], initial: "instant" }),
      suspicion: new NumberField({ ...whole, min: 0, initial: 0 }),
      suspicionDay: new NumberField({ integer: true, nullable: true, initial: null }),
      theftProof: new BooleanField(),
      thefts: new ArrayField(
        new SchemaField({
          actor: new StringField({ required: true, blank: false }),
          name: new StringField({ required: true, blank: true }),
          item: new StringField({ required: true, blank: true }),
          time: new NumberField({ required: true, nullable: false, initial: 0 }),
        }),
      ),
      grudges: new TypedObjectField(new NumberField({ required: true, nullable: false, integer: true })),
      freshStock: new BooleanField(),
      stockedToken: new StringField({ required: true, nullable: true, blank: false, initial: null }),
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
      underCounter: new BooleanField(),
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

// One item a character traded on a visit.
function visitLine() {
  const { NumberField, SchemaField, StringField } = foundry.data.fields;
  return new SchemaField({
    name: new StringField({ required: true, blank: true }),
    quantity: new NumberField({ required: true, nullable: false, integer: true, min: 0, initial: 1 }),
  });
}

// One market rule, for a scene's flags and the world setting.
export function marketRuleField() {
  const { ArrayField, NumberField, SchemaField, StringField } = foundry.data.fields;
  return new SchemaField({
    id: new StringField({ required: true, blank: false }),
    name: new StringField({ required: true, blank: false }),
    categories: new ArrayField(new StringField({ required: true, blank: false })),
    multiplier: new NumberField({ required: true, nullable: false, positive: true, initial: 1 }),
    until: new NumberField({ required: true, nullable: true, initial: null }),
  });
}

export class SceneFlags extends foundry.abstract.DataModel {
  static defineSchema() {
    return { market: new foundry.data.fields.ArrayField(marketRuleField()) };
  }
}

/**
 * @param {{ flags?: object }} document
 * @returns {SceneFlagData}
 */
export function sceneFlags(document) {
  return readFlags(SceneFlags, document);
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
