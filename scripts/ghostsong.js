/**
 * Ghost Song: when the necrologist has the Ghost Song feat, the module
 *   - grants a "Spirit Horde Toggle" effect on the **summoner** (UI toggle), and
 *   - grants a "Spirit Horde" effect on each linked **horde** (passive REs).
 * Toggling the summoner-side effect propagates the boolean to the horde-side
 * effect's RollOption value, which gates the horde's Incorporeal trait and
 * Mobbing Assault damage-type override.
 *
 * @module ghostsong
 */

import {
  MODULE_ID,
  GHOSTSONG_FEAT_SLUG,
  GHOSTSONG_HORDE_FLAG,
  GHOSTSONG_TOGGLE_FLAG,
  SPIRIT_HORDE_ROLL_OPTION,
  SPIRIT_HORDE_EFFECT_UUID_DEFAULT,
  SPIRIT_HORDE_TOGGLE_EFFECT_UUID_DEFAULT,
  log,
  logError,
  canModifyActor,
} from "./utils.js";
import { findLinkedHordes, findLinkedSummoner, hasGhostsongFeat } from "./effects.js";

const SETTING_HORDE_UUID = "spiritHordeEffectUuid";
const SETTING_TOGGLE_UUID = "spiritHordeToggleEffectUuid";

function getHordeEffectUuid() {
  try {
    return game.settings.get(MODULE_ID, SETTING_HORDE_UUID) || SPIRIT_HORDE_EFFECT_UUID_DEFAULT;
  } catch {
    return SPIRIT_HORDE_EFFECT_UUID_DEFAULT;
  }
}

function getToggleEffectUuid() {
  try {
    return game.settings.get(MODULE_ID, SETTING_TOGGLE_UUID) || SPIRIT_HORDE_TOGGLE_EFFECT_UUID_DEFAULT;
  } catch {
    return SPIRIT_HORDE_TOGGLE_EFFECT_UUID_DEFAULT;
  }
}

function findGrantedByFlag(actor, flag) {
  return actor.itemTypes.effect.find((e) => e.getFlag(MODULE_ID, flag) === true);
}

async function grantEffect(actor, uuid, flag) {
  if (findGrantedByFlag(actor, flag)) return null;
  const source = await fromUuid(uuid);
  if (!source) {
    logError(`Effect not found at UUID: ${uuid}`);
    return null;
  }
  const data = source.toObject();
  data.flags = data.flags || {};
  data.flags[MODULE_ID] = { ...(data.flags[MODULE_ID] || {}), [flag]: true };
  const created = await actor.createEmbeddedDocuments("Item", [data]);
  return created[0] ?? null;
}

async function removeGranted(actor, flag) {
  const existing = findGrantedByFlag(actor, flag);
  if (!existing) return;
  await actor.deleteEmbeddedDocuments("Item", [existing.id]);
}

function readRollOptionValue(effect) {
  const re = effect?.system?.rules?.find(
    (r) => r.key === "RollOption" && r.option === SPIRIT_HORDE_ROLL_OPTION
  );
  return !!re?.value;
}

/**
 * Push the toggle (summoner) and spirit-horde effect (each linked horde) on/off
 * based on whether the summoner has Ghost Song.
 * @param {Actor} summoner
 */
export async function syncGhostsongGrants(summoner) {
  if (!summoner) return;
  const hordes = findLinkedHordes(summoner);
  if (!hordes.length) return;
  const should = hasGhostsongFeat(summoner);

  if (should) {
    if (canModifyActor(summoner)) {
      await grantEffect(summoner, getToggleEffectUuid(), GHOSTSONG_TOGGLE_FLAG);
    }
    const toggleEffect = findGrantedByFlag(summoner, GHOSTSONG_TOGGLE_FLAG);
    const value = toggleEffect ? readRollOptionValue(toggleEffect) : false;
    await mirrorToHordes(summoner, value);
  } else {
    if (canModifyActor(summoner)) await removeGranted(summoner, GHOSTSONG_TOGGLE_FLAG);
    for (const horde of hordes) {
      if (!canModifyActor(horde)) continue;
      await removeGranted(horde, GHOSTSONG_HORDE_FLAG);
    }
  }
}

/**
 * Grant/remove the horde-side Spirit Horde effect on each linked horde based
 * on the summoner's toggle state. The effect's presence is the source of truth
 * for "is this a spirit horde right now".
 * @param {Actor} summoner
 * @param {boolean} value
 */
async function mirrorToHordes(summoner, value) {
  const hordes = findLinkedHordes(summoner);
  for (const horde of hordes) {
    if (!canModifyActor(horde)) continue;
    if (value) {
      await grantEffect(horde, getHordeEffectUuid(), GHOSTSONG_HORDE_FLAG);
    } else {
      await removeGranted(horde, GHOSTSONG_HORDE_FLAG);
    }
  }
}

function registerSettings() {
  game.settings.register(MODULE_ID, SETTING_HORDE_UUID, {
    name: "Spirit Horde Effect UUID (horde-side)",
    hint: "UUID of the passive effect granted to each linked horde when the summoner has Ghost Song.",
    scope: "world",
    config: true,
    type: String,
    default: SPIRIT_HORDE_EFFECT_UUID_DEFAULT,
  });
  game.settings.register(MODULE_ID, SETTING_TOGGLE_UUID, {
    name: "Spirit Horde Toggle Effect UUID (summoner-side)",
    hint: "UUID of the toggle effect granted to the summoner when they have Ghost Song.",
    scope: "world",
    config: true,
    type: String,
    default: SPIRIT_HORDE_TOGGLE_EFFECT_UUID_DEFAULT,
  });
}

function registerHooks() {
  // Feat add/remove on summoner → grant/remove both bundled effects
  const onFeatChange = (item) => {
    try {
      if (item?.type !== "feat") return;
      if (item.slug !== GHOSTSONG_FEAT_SLUG) return;
      const actor = item.parent;
      if (!actor) return;
      if (findLinkedHordes(actor).length === 0) return;
      syncGhostsongGrants(actor).catch((e) => logError("syncGhostsongGrants:", e));
    } catch (e) {
      logError("ghostsong feat-change hook:", e);
    }
  };
  Hooks.on("createItem", onFeatChange);
  Hooks.on("deleteItem", onFeatChange);

  // Summoner toggles the Spirit Horde Toggle → propagate to hordes.
  // The host can be a feat or effect, so gate on the flag rather than type.
  Hooks.on("updateItem", (item, changes) => {
    try {
      if (!item) return;
      if (item.getFlag?.(MODULE_ID, GHOSTSONG_TOGGLE_FLAG) !== true) return;
      const summoner = item.parent;
      if (!summoner) return;
      // Only react when the rules array actually changed (toggle flip lives there)
      if (!changes?.system?.rules) return;
      const value = readRollOptionValue(item);
      mirrorToHordes(summoner, value).catch((e) => logError("mirrorToHordes:", e));
    } catch (e) {
      logError("ghostsong updateItem hook:", e);
    }
  });

  log("Ghost Song hooks registered");
}

export function initGhostsong() {
  registerSettings();
  Hooks.once("ready", () => {
    registerHooks();
    for (const actor of game.actors) {
      if (findLinkedHordes(actor).length > 0) {
        syncGhostsongGrants(actor).catch((e) => logError("initial syncGhostsongGrants:", e));
      }
    }
  });
}
