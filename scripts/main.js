/**
 * Necrologist Horde Sync Module for Foundry VTT + PF2e
 *
 * Syncs stats between a Necrologist summoner and their zombie horde using Active Effects.
 *
 * Game Rules (Necrologist's horde):
 * - Uses summoner's AC and saves
 * - Shares HP pool (damage to horde is dealt to summoner instead)
 * - Has resistance equal to level to physical damage
 * - Has weakness equal to level to area/splash damage
 *
 * @module necrologist-horde-sync
 */

import { MODULE_ID, log, logError } from "./utils.js";
import { findLinkedSummoner, findLinkedHordes } from "./effects.js";
import {
  syncingActors,
  syncSummonerToHorde,
  syncHordeToSummoner,
  syncAll,
  linkHorde,
  unlinkHorde,
  performInitialSync,
} from "./sync.js";
import { showLinkDialog, showUnlinkDialog } from "./dialogs.js";

/** @type {number|null} */
let updateActorHookId = null;

/** @type {number|null} */
let debounceTimer = null;

/**
 * Debounced sync handler
 * @param {Actor} actor - The actor that changed
 * @param {Object} changes - The changes made
 */
function debouncedSync(actor, changes) {
  if (syncingActors.has(actor.id)) {
    log("Actor already syncing, skipping debounced sync");
    return;
  }

  const debounceMs = game.settings.get(MODULE_ID, "debounceMs") || 250;

  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }

  debounceTimer = setTimeout(() => {
    handleActorUpdate(actor, changes);
  }, debounceMs);
}

/**
 * Handle actor updates and trigger appropriate sync
 * @param {Actor} actor - The actor that changed
 * @param {Object} changes - The changes made
 */
async function handleActorUpdate(actor, changes) {
  if (!game.user?.isGM) return;

  const linkedHordes = findLinkedHordes(actor);
  if (linkedHordes.length > 0) {
    log(`Summoner "${actor.name}" changed, syncing to ${linkedHordes.length} horde(s)`);
    for (const horde of linkedHordes) {
      await syncSummonerToHorde(actor, horde);
    }
    return;
  }

  const summonerId = findLinkedSummoner(actor);
  if (summonerId && changes?.system?.attributes?.hp !== undefined) {
    const summoner = game.actors.get(summonerId);
    if (summoner) {
      log(`Horde "${actor.name}" HP changed, syncing to summoner`);
      await syncHordeToSummoner(actor, summoner);
    }
  }
}

/**
 * Register module settings
 */
function registerSettings() {
  game.settings.register(MODULE_ID, "debounceMs", {
    name: "Debounce Delay (ms)",
    hint: "How long to wait after changes before syncing. Prevents rapid-fire updates.",
    scope: "world",
    config: true,
    type: Number,
    default: 250,
    range: { min: 50, max: 1000, step: 50 },
  });

  game.settings.register(MODULE_ID, "enableLogging", {
    name: "Enable Verbose Logging",
    hint: "Log detailed sync information to the console for debugging.",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
  });
}

/**
 * Register hooks
 */
function registerHooks() {
  updateActorHookId = Hooks.on("updateActor", (actor, changes, options, userId) => {
    try {
      if (userId !== game.user?.id) return;

      const isHorde = findLinkedSummoner(actor) !== null;
      const isSummoner = findLinkedHordes(actor).length > 0;

      if (isHorde || isSummoner) {
        debouncedSync(actor, changes);
      }
    } catch (error) {
      logError("Error in updateActor hook:", error);
    }
  });

  log("Hooks registered");
}

/**
 * Expose module API
 */
function exposeApi() {
  const module = game.modules.get(MODULE_ID);
  if (!module) {
    logError("Module not found, cannot expose API");
    return;
  }

  module.api = {
    linkHorde,
    unlinkHorde,
    sync: syncAll,
    showLinkDialog,
    showUnlinkDialog,
    findLinkedHordes: (summonerId) => {
      const summoner = game.actors.get(summonerId);
      return summoner ? findLinkedHordes(summoner) : [];
    },
    findLinkedSummoner: (hordeId) => {
      const horde = game.actors.get(hordeId);
      if (!horde) return null;
      const summonerId = findLinkedSummoner(horde);
      return summonerId ? game.actors.get(summonerId) : null;
    },
  };

  log("Module API ready");
}

Hooks.once("init", () => {
  console.log(`[${MODULE_ID}] Initializing`);
  registerSettings();
});

Hooks.once("ready", () => {
  console.log(`[${MODULE_ID}] Ready`);
  registerHooks();
  exposeApi();
  performInitialSync();
});
