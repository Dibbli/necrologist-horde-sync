/**
 * Sync logic for Necrologist Horde Sync
 * @module sync
 */

import { MODULE_ID, log, logError, canModifyActor } from "./utils.js";
import {
  findBondEffect,
  findLinkedSummoner,
  findLinkedHordes,
  getSyncOptions,
  buildSyncDescription,
  createBondEffectData,
  calculateModifiers,
  updateEffectModifiers,
} from "./effects.js";

/** @type {Set<string>} Actor IDs currently being synced (prevents race conditions) */
export const syncingActors = new Set();

/**
 * Sync stats from summoner to horde
 * @param {Actor} summoner - The summoner actor
 * @param {Actor} horde - The horde actor
 * @returns {Promise<boolean>} Success status
 */
export async function syncSummonerToHorde(summoner, horde) {
  if (!summoner || !horde) {
    log("Missing summoner or horde, skipping sync");
    return false;
  }

  if (syncingActors.has(horde.id)) {
    log(`Horde "${horde.name}" already syncing, skipping`);
    return false;
  }

  const effect = findBondEffect(horde);
  if (!effect) {
    log(`Horde "${horde.name}" has no bond effect, skipping sync`);
    return false;
  }

  syncingActors.add(horde.id);
  const syncOptions = getSyncOptions(horde);
  log(`Syncing summoner "${summoner.name}" -> horde "${horde.name}"`, syncOptions);

  try {
    const modifiers = calculateModifiers(summoner, horde, syncOptions);
    log("Calculated modifiers:", modifiers);

    await updateEffectModifiers(effect, modifiers, syncOptions);

    const updateData = { [`flags.${MODULE_ID}.lastSync`]: Date.now() };
    if (syncOptions.hp) {
      updateData["system.attributes.hp.value"] = summoner.system.attributes?.hp?.value ?? 0;
      updateData["system.attributes.hp.temp"] = summoner.system.attributes?.hp?.temp ?? 0;
    }
    await horde.update(updateData);

    log(`Sync complete: summoner -> horde "${horde.name}"`);
    return true;
  } catch (error) {
    logError("Error syncing summoner to horde:", error);
    return false;
  } finally {
    syncingActors.delete(horde.id);
  }
}

/**
 * Sync HP from horde back to summoner (shared damage pool)
 * @param {Actor} horde - The horde actor
 * @param {Actor} summoner - The summoner actor
 * @returns {Promise<boolean>} Success status
 */
export async function syncHordeToSummoner(horde, summoner) {
  if (!summoner || !horde) {
    log("Missing summoner or horde, skipping HP sync");
    return false;
  }

  const syncOptions = getSyncOptions(horde);
  if (!syncOptions.hp) {
    log(`HP sync disabled for horde "${horde.name}", skipping`);
    return false;
  }

  if (syncingActors.has(summoner.id)) {
    log(`Summoner "${summoner.name}" already syncing, skipping`);
    return false;
  }

  syncingActors.add(summoner.id);
  log(`Syncing horde "${horde.name}" -> summoner "${summoner.name}" (HP only)`);

  try {
    const hordeHP = horde.system.attributes?.hp?.value ?? 0;
    const hordeTempHP = horde.system.attributes?.hp?.temp ?? 0;

    // Summoner is source of truth for max HP, so only sync value and temp
    await summoner.update({
      "system.attributes.hp.value": hordeHP,
      "system.attributes.hp.temp": hordeTempHP,
    });

    log(`Sync complete: horde -> summoner`);
    return true;
  } catch (error) {
    logError("Error syncing horde to summoner:", error);
    return false;
  } finally {
    syncingActors.delete(summoner.id);
  }
}

/**
 * Sync all linked pairs the user owns
 * @returns {Promise<number>} Number of hordes synced
 */
export async function syncAll() {
  log("Syncing all owned linked pairs");

  const processedSummoners = new Set();
  let syncCount = 0;

  for (const actor of game.actors) {
    if (!canModifyActor(actor)) continue;

    const summonerId = findLinkedSummoner(actor);
    if (!summonerId) continue;

    const summoner = game.actors.get(summonerId);
    if (!summoner) {
      log(`Summoner ${summonerId} not found for horde "${actor.name}"`);
      continue;
    }

    if (!canModifyActor(summoner)) continue;

    if (!processedSummoners.has(summonerId)) {
      processedSummoners.add(summonerId);

      const hordes = findLinkedHordes(summoner);
      for (const horde of hordes) {
        if (!canModifyActor(horde)) continue;
        const success = await syncSummonerToHorde(summoner, horde);
        if (success) syncCount++;
      }
    }
  }

  if (syncCount === 0) {
    ui.notifications.info("No linked hordes found that you can sync.");
  } else {
    ui.notifications.info(`Synced ${syncCount} horde(s)`);
  }
  log("Sync all complete");
  return syncCount;
}

/**
 * @typedef {import('./effects.js').SyncOptions} SyncOptions
 */

/**
 * Link a horde to a summoner by creating/updating the bond effect
 * @param {string} summonerId - The summoner's actor ID
 * @param {string} hordeId - The horde's actor ID
 * @param {SyncOptions} [syncOptions] - Which stats to sync (defaults to all)
 * @returns {Promise<boolean>} Success status
 */
export async function linkHorde(summonerId, hordeId, syncOptions) {
  if (summonerId === hordeId) {
    ui.notifications.warn("Cannot link an actor to itself.");
    return false;
  }

  const summoner = game.actors.get(summonerId);
  const horde = game.actors.get(hordeId);

  if (!summoner) {
    ui.notifications.error(`Summoner actor not found: ${summonerId}`);
    return false;
  }

  if (!horde) {
    ui.notifications.error(`Horde actor not found: ${hordeId}`);
    return false;
  }

  if (!canModifyActor(summoner) || !canModifyActor(horde)) {
    ui.notifications.warn("You need ownership of both actors to link them.");
    return false;
  }

  log(`Linking horde "${horde.name}" to summoner "${summoner.name}"`, syncOptions);

  try {
    let effect = findBondEffect(horde);

    if (effect) {
      await effect.update({
        [`flags.${MODULE_ID}.summonerId`]: summonerId,
        [`flags.${MODULE_ID}.syncOptions`]: syncOptions,
        "system.description.value": buildSyncDescription(syncOptions),
      });
      log("Updated existing bond effect");
    } else {
      const effectData = createBondEffectData(summonerId, syncOptions);
      const created = await horde.createEmbeddedDocuments("Item", [effectData]);
      effect = created[0];
      log("Created new bond effect");
    }

    await syncSummonerToHorde(summoner, horde);
    ui.notifications.info(`Linked "${horde.name}" to "${summoner.name}"`);
    return true;
  } catch (error) {
    logError("Failed to link horde:", error);
    ui.notifications.error("Failed to link horde. Check console for details.");
    return false;
  }
}

/**
 * Unlink a horde by removing its bond effect
 * @param {string} hordeId - The horde's actor ID
 * @returns {Promise<boolean>} Success status
 */
export async function unlinkHorde(hordeId) {
  const horde = game.actors.get(hordeId);

  if (!horde) {
    ui.notifications.error(`Horde actor not found: ${hordeId}`);
    return false;
  }

  if (!canModifyActor(horde)) {
    ui.notifications.warn("You need ownership of the horde to unlink it.");
    return false;
  }

  const effect = findBondEffect(horde);

  if (!effect) {
    ui.notifications.warn(`"${horde.name}" is not linked to any summoner.`);
    return false;
  }

  log(`Unlinking horde "${horde.name}"`);

  try {
    await effect.delete();
    ui.notifications.info(`Unlinked "${horde.name}"`);
    return true;
  } catch (error) {
    logError("Failed to unlink horde:", error);
    ui.notifications.error("Failed to unlink horde. Check console for details.");
    return false;
  }
}

/**
 * Perform initial sync on ready for owned actors
 */
export async function performInitialSync() {
  log("Performing initial sync on world ready");

  const processedSummoners = new Set();

  for (const actor of game.actors) {
    if (!canModifyActor(actor)) continue;

    const summonerId = findLinkedSummoner(actor);
    if (!summonerId) continue;

    const summoner = game.actors.get(summonerId);
    if (!summoner || !canModifyActor(summoner)) continue;

    if (!processedSummoners.has(summonerId)) {
      processedSummoners.add(summonerId);

      const hordes = findLinkedHordes(summoner);
      for (const horde of hordes) {
        if (!canModifyActor(horde)) continue;
        await syncSummonerToHorde(summoner, horde);
      }
    }
  }
}
