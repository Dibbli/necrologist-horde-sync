/**
 * Necrologist Horde Sync Module for Foundry VTT + PF2e
 *
 * Syncs stats between a Necrologist summoner and their zombie horde using Active Effects.
 *
 * Game Rules (Necrologist's horde):
 * - Uses summoner's AC, saves, and skill DCs
 * - Shares HP pool (damage to horde is dealt to summoner instead)
 * - Has resistance equal to level to physical damage
 * - Has weakness equal to level to area/splash damage
 */

const MODULE_ID = "necrologist-horde-sync";
const EFFECT_SLUG = "necrologist-bond";

// Track registered hooks for cleanup
const registeredHooks = {
  updateActor: null,
  ready: null,
};

// Debounce state
let debounceTimer = null;
let syncInProgress = false;

/**
 * Log a message if logging is enabled
 */
function log(...args) {
  if (game.settings.get(MODULE_ID, "enableLogging")) {
    console.log(`[${MODULE_ID}]`, ...args);
  }
}

/**
 * Log an error (always shown)
 */
function logError(...args) {
  console.error(`[${MODULE_ID}]`, ...args);
}

/**
 * Check if current user is the GM
 */
function isGM() {
  return game.user?.isGM ?? false;
}

/**
 * Find the Necrologist Bond effect on a horde actor
 * @param {Actor} horde - The horde actor to search
 * @returns {Item|null} The bond effect if found
 */
function findBondEffect(horde) {
  if (!horde?.items) return null;
  return horde.items.find((item) => item.type === "effect" && item.system?.slug === EFFECT_SLUG) ?? null;
}

/**
 * Get the summoner ID from a horde's bond effect
 * @param {Actor} horde - The horde actor
 * @returns {string|null} The summoner actor ID or null
 */
function findLinkedSummoner(horde) {
  const effect = findBondEffect(horde);
  if (!effect) return null;
  return effect.flags?.[MODULE_ID]?.summonerId ?? null;
}

/**
 * Find all hordes linked to a specific summoner
 * @param {Actor} summoner - The summoner actor
 * @returns {Actor[]} Array of linked horde actors
 */
function findLinkedHordes(summoner) {
  if (!summoner?.id) return [];

  const hordes = [];
  for (const actor of game.actors) {
    const linkedSummonerId = findLinkedSummoner(actor);
    if (linkedSummonerId === summoner.id) {
      hordes.push(actor);
    }
  }
  return hordes;
}

/**
 * Create the base Necrologist Bond effect data
 * @param {string} summonerId - The summoner's actor ID
 * @returns {object} Effect item data
 */
function createBondEffectData(summonerId) {
  return {
    name: "Necrologist Bond",
    type: "effect",
    img: "icons/magic/unholy/strike-body-explode-disintegrate.webp",
    system: {
      slug: EFFECT_SLUG,
      description: {
        value: "<p>This creature is linked to a Necrologist summoner and uses their AC, saves, and shares their HP pool.</p>",
      },
      rules: [
        { key: "FlatModifier", selector: "ac", value: 0, label: "Necrologist Bond" },
        { key: "FlatModifier", selector: "fortitude", value: 0, label: "Necrologist Bond" },
        { key: "FlatModifier", selector: "reflex", value: 0, label: "Necrologist Bond" },
        { key: "FlatModifier", selector: "will", value: 0, label: "Necrologist Bond" },
      ],
    },
    flags: {
      [MODULE_ID]: {
        summonerId: summonerId,
      },
    },
  };
}

/**
 * Calculate stat modifiers to make horde match summoner
 * @param {Actor} summoner - The summoner actor
 * @param {Actor} horde - The horde actor
 * @returns {object} Modifier values for AC and saves
 */
function calculateModifiers(summoner, horde) {
  // Get summoner stats
  const summonerAC = summoner.system.attributes?.ac?.value ?? 10;
  const summonerFort = summoner.system.saves?.fortitude?.totalModifier ?? 0;
  const summonerRef = summoner.system.saves?.reflex?.totalModifier ?? 0;
  const summonerWill = summoner.system.saves?.will?.totalModifier ?? 0;

  // Get horde base stats (without our effect)
  const effect = findBondEffect(horde);
  const currentEffectModifiers = {
    ac: 0,
    fortitude: 0,
    reflex: 0,
    will: 0,
  };

  if (effect?.system?.rules) {
    for (const rule of effect.system.rules) {
      if (rule.key === "FlatModifier" && rule.label === "Necrologist Bond") {
        if (rule.selector === "ac") currentEffectModifiers.ac = rule.value ?? 0;
        else if (rule.selector === "fortitude") currentEffectModifiers.fortitude = rule.value ?? 0;
        else if (rule.selector === "reflex") currentEffectModifiers.reflex = rule.value ?? 0;
        else if (rule.selector === "will") currentEffectModifiers.will = rule.value ?? 0;
      }
    }
  }

  // Calculate horde's base stats (current - our existing modifier)
  const hordeBaseAC = (horde.system.attributes?.ac?.value ?? 10) - currentEffectModifiers.ac;
  const hordeBaseFort = (horde.system.saves?.fortitude?.totalModifier ?? 0) - currentEffectModifiers.fortitude;
  const hordeBaseRef = (horde.system.saves?.reflex?.totalModifier ?? 0) - currentEffectModifiers.reflex;
  const hordeBaseWill = (horde.system.saves?.will?.totalModifier ?? 0) - currentEffectModifiers.will;

  // Calculate what modifiers we need to reach summoner's values
  return {
    ac: summonerAC - hordeBaseAC,
    fortitude: summonerFort - hordeBaseFort,
    reflex: summonerRef - hordeBaseRef,
    will: summonerWill - hordeBaseWill,
  };
}

/**
 * Update the bond effect's rule elements with new modifier values
 * @param {Item} effect - The bond effect item
 * @param {object} modifiers - The modifier values
 */
async function updateEffectModifiers(effect, modifiers) {
  const rules = [
    { key: "FlatModifier", selector: "ac", value: modifiers.ac, label: "Necrologist Bond" },
    { key: "FlatModifier", selector: "fortitude", value: modifiers.fortitude, label: "Necrologist Bond" },
    { key: "FlatModifier", selector: "reflex", value: modifiers.reflex, label: "Necrologist Bond" },
    { key: "FlatModifier", selector: "will", value: modifiers.will, label: "Necrologist Bond" },
  ];

  await effect.update({
    "system.rules": rules,
  });
}

/**
 * Link a horde to a summoner by creating/updating the bond effect
 * @param {string} summonerId - The summoner's actor ID
 * @param {string} hordeId - The horde's actor ID
 */
async function linkHorde(summonerId, hordeId) {
  if (!isGM()) {
    ui.notifications.warn("Only the GM can link hordes to summoners.");
    return;
  }

  const summoner = game.actors.get(summonerId);
  const horde = game.actors.get(hordeId);

  if (!summoner) {
    ui.notifications.error(`Summoner actor not found: ${summonerId}`);
    return;
  }

  if (!horde) {
    ui.notifications.error(`Horde actor not found: ${hordeId}`);
    return;
  }

  log(`Linking horde "${horde.name}" to summoner "${summoner.name}"`);

  // Check if effect already exists
  let effect = findBondEffect(horde);

  if (effect) {
    // Update existing effect with new summoner ID
    await effect.update({
      [`flags.${MODULE_ID}.summonerId`]: summonerId,
    });
    log("Updated existing bond effect");
  } else {
    // Create new effect
    const effectData = createBondEffectData(summonerId);
    const created = await horde.createEmbeddedDocuments("Item", [effectData]);
    effect = created[0];
    log("Created new bond effect");
  }

  // Sync stats immediately
  await syncSummonerToHorde(summoner, horde);

  ui.notifications.info(`Linked "${horde.name}" to "${summoner.name}"`);
}

/**
 * Unlink a horde by removing its bond effect
 * @param {string} hordeId - The horde's actor ID
 */
async function unlinkHorde(hordeId) {
  if (!isGM()) {
    ui.notifications.warn("Only the GM can unlink hordes.");
    return;
  }

  const horde = game.actors.get(hordeId);

  if (!horde) {
    ui.notifications.error(`Horde actor not found: ${hordeId}`);
    return;
  }

  const effect = findBondEffect(horde);

  if (!effect) {
    ui.notifications.warn(`"${horde.name}" is not linked to any summoner.`);
    return;
  }

  log(`Unlinking horde "${horde.name}"`);

  await effect.delete();

  ui.notifications.info(`Unlinked "${horde.name}"`);
}

/**
 * Sync stats from summoner to horde
 * @param {Actor} summoner - The summoner actor
 * @param {Actor} horde - The horde actor
 */
async function syncSummonerToHorde(summoner, horde) {
  if (!summoner || !horde) {
    log("Missing summoner or horde, skipping sync");
    return;
  }

  const effect = findBondEffect(horde);
  if (!effect) {
    log(`Horde "${horde.name}" has no bond effect, skipping sync`);
    return;
  }

  log(`Syncing summoner "${summoner.name}" -> horde "${horde.name}"`);

  try {
    // Calculate and apply stat modifiers
    const modifiers = calculateModifiers(summoner, horde);
    log("Calculated modifiers:", modifiers);

    await updateEffectModifiers(effect, modifiers);

    // Sync HP values
    const summonerHPValue = summoner.system.attributes?.hp?.value ?? 0;
    const summonerHPMax = summoner.system.attributes?.hp?.max ?? 0;

    const updateData = {
      "system.attributes.hp.value": summonerHPValue,
      "system.attributes.hp.max": summonerHPMax,
      [`flags.${MODULE_ID}.lastSync`]: Date.now(),
    };

    await horde.update(updateData);

    log(`Sync complete: summoner -> horde "${horde.name}"`);
  } catch (error) {
    logError("Error syncing summoner to horde:", error);
  }
}

/**
 * Sync HP from horde back to summoner (shared damage pool)
 * @param {Actor} horde - The horde actor
 * @param {Actor} summoner - The summoner actor
 */
async function syncHordeToSummoner(horde, summoner) {
  if (!summoner || !horde) {
    log("Missing summoner or horde, skipping HP sync");
    return;
  }

  log(`Syncing horde "${horde.name}" -> summoner "${summoner.name}" (HP only)`);

  try {
    const hordeHPValue = horde.system.attributes?.hp?.value ?? 0;
    const hordeHPMax = horde.system.attributes?.hp?.max ?? 0;

    const updateData = {
      "system.attributes.hp.value": hordeHPValue,
      "system.attributes.hp.max": hordeHPMax,
    };

    await summoner.update(updateData);

    log(`Sync complete: horde -> summoner`);
  } catch (error) {
    logError("Error syncing horde to summoner:", error);
  }
}

/**
 * Sync all linked pairs
 */
async function syncAll() {
  if (!isGM()) {
    ui.notifications.warn("Only the GM can sync hordes.");
    return;
  }

  log("Syncing all linked pairs");

  const processedSummoners = new Set();
  let syncCount = 0;

  for (const actor of game.actors) {
    const summonerId = findLinkedSummoner(actor);
    if (!summonerId) continue;

    const summoner = game.actors.get(summonerId);
    if (!summoner) {
      log(`Summoner ${summonerId} not found for horde "${actor.name}"`);
      continue;
    }

    if (!processedSummoners.has(summonerId)) {
      processedSummoners.add(summonerId);

      const hordes = findLinkedHordes(summoner);
      for (const horde of hordes) {
        await syncSummonerToHorde(summoner, horde);
        syncCount++;
      }
    }
  }

  ui.notifications.info(`Synced ${syncCount} horde(s)`);
  log("Sync all complete");
}

// ============================================
// DIALOG UI FUNCTIONS
// ============================================

/**
 * Show dialog to link a horde to a summoner
 */
async function showLinkDialog() {
  if (!isGM()) {
    ui.notifications.warn("Only the GM can link hordes to summoners.");
    return;
  }

  // Get all character actors for summoner selection
  const characters = game.actors.filter((a) => a.type === "character");
  // Get all NPC actors for horde selection
  const npcs = game.actors.filter((a) => a.type === "npc");

  if (characters.length === 0) {
    ui.notifications.warn("No character actors found.");
    return;
  }

  if (npcs.length === 0) {
    ui.notifications.warn("No NPC actors found.");
    return;
  }

  const summonerOptions = characters.map((a) => `<option value="${a.id}">${a.name}</option>`).join("");
  const hordeOptions = npcs.map((a) => `<option value="${a.id}">${a.name}</option>`).join("");

  const content = `
    <form>
      <div class="form-group">
        <label>Summoner (Character):</label>
        <select name="summonerId" style="width: 100%;">
          ${summonerOptions}
        </select>
      </div>
      <div class="form-group">
        <label>Horde (NPC):</label>
        <select name="hordeId" style="width: 100%;">
          ${hordeOptions}
        </select>
      </div>
    </form>
  `;

  new Dialog({
    title: "Link Horde to Summoner",
    content,
    buttons: {
      link: {
        icon: '<i class="fas fa-link"></i>',
        label: "Link",
        callback: async (html) => {
          const summonerId = html.find('[name="summonerId"]').val();
          const hordeId = html.find('[name="hordeId"]').val();
          await linkHorde(summonerId, hordeId);
        },
      },
      cancel: {
        icon: '<i class="fas fa-times"></i>',
        label: "Cancel",
      },
    },
    default: "link",
  }).render(true);
}

/**
 * Show dialog to unlink a horde
 */
async function showUnlinkDialog() {
  if (!isGM()) {
    ui.notifications.warn("Only the GM can unlink hordes.");
    return;
  }

  // Find all linked hordes
  const linkedHordes = [];
  for (const actor of game.actors) {
    const summonerId = findLinkedSummoner(actor);
    if (summonerId) {
      const summoner = game.actors.get(summonerId);
      linkedHordes.push({
        horde: actor,
        summonerName: summoner?.name ?? "Unknown",
      });
    }
  }

  if (linkedHordes.length === 0) {
    ui.notifications.info("No linked hordes found.");
    return;
  }

  const hordeOptions = linkedHordes
    .map((h) => `<option value="${h.horde.id}">${h.horde.name} (linked to ${h.summonerName})</option>`)
    .join("");

  const content = `
    <form>
      <div class="form-group">
        <label>Select Horde to Unlink:</label>
        <select name="hordeId" style="width: 100%;">
          ${hordeOptions}
        </select>
      </div>
    </form>
  `;

  new Dialog({
    title: "Unlink Horde",
    content,
    buttons: {
      unlink: {
        icon: '<i class="fas fa-unlink"></i>',
        label: "Unlink",
        callback: async (html) => {
          const hordeId = html.find('[name="hordeId"]').val();
          await unlinkHorde(hordeId);
        },
      },
      cancel: {
        icon: '<i class="fas fa-times"></i>',
        label: "Cancel",
      },
    },
    default: "unlink",
  }).render(true);
}

// ============================================
// DEBOUNCE AND HOOKS
// ============================================

/**
 * Debounced sync handler
 */
function debouncedSync(actor, changes) {
  if (syncInProgress) {
    log("Sync already in progress, skipping");
    return;
  }

  const debounceMs = game.settings.get(MODULE_ID, "debounceMs");

  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }

  debounceTimer = setTimeout(async () => {
    await handleActorUpdate(actor, changes);
  }, debounceMs);
}

/**
 * Handle actor updates and trigger appropriate sync
 */
async function handleActorUpdate(actor, changes) {
  if (!isGM()) {
    log("Not GM, skipping sync");
    return;
  }

  syncInProgress = true;

  try {
    // Check if this actor is a summoner with linked hordes
    const linkedHordes = findLinkedHordes(actor);
    if (linkedHordes.length > 0) {
      log(`Summoner "${actor.name}" changed, syncing to ${linkedHordes.length} horde(s)`);
      for (const horde of linkedHordes) {
        await syncSummonerToHorde(actor, horde);
      }
      return;
    }

    // Check if this actor is a horde with a linked summoner
    const summonerId = findLinkedSummoner(actor);
    if (summonerId) {
      // Only sync HP changes from horde to summoner
      if (changes?.system?.attributes?.hp !== undefined) {
        const summoner = game.actors.get(summonerId);
        if (summoner) {
          log(`Horde "${actor.name}" HP changed, syncing to summoner`);
          await syncHordeToSummoner(actor, summoner);
        }
      }
    }
  } finally {
    syncInProgress = false;
  }
}

/**
 * Perform initial sync on ready
 */
async function performInitialSync() {
  if (!isGM()) {
    log("Not GM, skipping initial sync");
    return;
  }

  log("Performing initial sync on world ready");
  syncInProgress = true;

  try {
    // Silent sync without notification
    const processedSummoners = new Set();

    for (const actor of game.actors) {
      const summonerId = findLinkedSummoner(actor);
      if (!summonerId) continue;

      const summoner = game.actors.get(summonerId);
      if (!summoner) continue;

      if (!processedSummoners.has(summonerId)) {
        processedSummoners.add(summonerId);

        const hordes = findLinkedHordes(summoner);
        for (const horde of hordes) {
          await syncSummonerToHorde(summoner, horde);
        }
      }
    }
  } finally {
    syncInProgress = false;
  }
}

/**
 * Register module settings
 */
function registerSettings() {
  game.settings.register(MODULE_ID, "debounceMs", {
    name: "Debounce Delay (ms)",
    hint: "How long to wait after changes before syncing. Prevents rapid-fire updates. Default: 250ms",
    scope: "world",
    config: true,
    type: Number,
    default: 250,
    range: {
      min: 50,
      max: 1000,
      step: 50,
    },
  });

  game.settings.register(MODULE_ID, "enableLogging", {
    name: "Enable Verbose Logging",
    hint: "Log detailed sync information to the console for debugging.",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
  });

  log("Settings registered");
}

/**
 * Register hooks
 */
function registerHooks() {
  // Hook for actor updates
  registeredHooks.updateActor = Hooks.on("updateActor", (actor, changes, options, userId) => {
    try {
      // Only process if this update was initiated by the current user
      if (userId !== game.user?.id) return;

      // Check if actor is relevant (summoner or horde)
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
 * Cleanup hooks on module disable
 */
function cleanupHooks() {
  if (registeredHooks.updateActor !== null) {
    Hooks.off("updateActor", registeredHooks.updateActor);
    registeredHooks.updateActor = null;
  }

  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }

  log("Hooks cleaned up");
}

// ============================================
// MODULE INITIALIZATION
// ============================================

Hooks.once("init", () => {
  console.log(`[${MODULE_ID}] Initializing module`);

  try {
    registerSettings();
  } catch (error) {
    logError("Error during initialization:", error);
  }
});

Hooks.once("ready", () => {
  console.log(`[${MODULE_ID}] Module ready`);

  try {
    registerHooks();

    // Delay initial sync slightly to ensure all actors are loaded
    setTimeout(() => {
      performInitialSync();
    }, 1000);
  } catch (error) {
    logError("Error during ready:", error);
  }
});

// Expose module API
Hooks.once("ready", () => {
  game.modules.get(MODULE_ID).api = {
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
});
