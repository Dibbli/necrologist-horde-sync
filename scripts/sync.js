/**
 * Sync logic for Necrologist Horde Sync
 * @module sync
 */

import { MODULE_ID, log, logError, canModifyActor } from "./utils.js";
import {
  findBondEffect,
  findLinkedSummoner,
  findLinkedHordes,
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
  log(`Syncing summoner "${summoner.name}" -> horde "${horde.name}"`);

  try {
    const modifiers = calculateModifiers(summoner, horde);
    log("Calculated modifiers:", modifiers);

    await updateEffectModifiers(effect, modifiers);

    const summonerHP = summoner.system.attributes?.hp?.value ?? 0;
    const summonerHPMax = summoner.system.attributes?.hp?.max ?? 0;

    await horde.update({
      "system.attributes.hp.value": summonerHP,
      "system.attributes.hp.max": summonerHPMax,
      [`flags.${MODULE_ID}.lastSync`]: Date.now(),
    });

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

  if (syncingActors.has(summoner.id)) {
    log(`Summoner "${summoner.name}" already syncing, skipping`);
    return false;
  }

  syncingActors.add(summoner.id);
  log(`Syncing horde "${horde.name}" -> summoner "${summoner.name}" (HP only)`);

  try {
    const hordeHP = horde.system.attributes?.hp?.value ?? 0;

    // Only sync HP value, not max - summoner is source of truth for max HP
    await summoner.update({
      "system.attributes.hp.value": hordeHP,
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
    // Only sync hordes the user can modify
    if (!canModifyActor(actor)) continue;

    const summonerId = findLinkedSummoner(actor);
    if (!summonerId) continue;

    const summoner = game.actors.get(summonerId);
    if (!summoner) {
      log(`Summoner ${summonerId} not found for horde "${actor.name}"`);
      continue;
    }

    // Also need permission on summoner to sync
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
 * Link a horde to a summoner by creating/updating the bond effect
 * @param {string} summonerId - The summoner's actor ID
 * @param {string} hordeId - The horde's actor ID
 * @returns {Promise<boolean>} Success status
 */
export async function linkHorde(summonerId, hordeId) {
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

  log(`Linking horde "${horde.name}" to summoner "${summoner.name}"`);

  try {
    let effect = findBondEffect(horde);

    if (effect) {
      await effect.update({ [`flags.${MODULE_ID}.summonerId`]: summonerId });
      log("Updated existing bond effect");
    } else {
      const effectData = createBondEffectData(summonerId);
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
    // Only sync hordes the user can modify
    if (!canModifyActor(actor)) continue;

    const summonerId = findLinkedSummoner(actor);
    if (!summonerId) continue;

    const summoner = game.actors.get(summonerId);
    if (!summoner) continue;

    // Also need permission on summoner
    if (!canModifyActor(summoner)) continue;

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
