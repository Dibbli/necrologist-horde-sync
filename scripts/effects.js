/**
 * Effect management functions for Necrologist Horde Sync
 * @module effects
 */

import { MODULE_ID, EFFECT_SLUG, EFFECT_LABEL, EFFECT_ICON, SKILLS, log, logError } from "./utils.js";

/**
 * @typedef {Object} StatModifiers
 * @property {number} ac - AC modifier
 * @property {number} fortitude - Fortitude save modifier
 * @property {number} reflex - Reflex save modifier
 * @property {number} will - Will save modifier
 * @property {Object.<string, number>} [skills] - Skill modifiers keyed by skill name
 */

/**
 * Find the Necrologist Bond effect on a horde actor
 * @param {Actor} horde - The horde actor to search
 * @returns {Item|null} The bond effect if found
 */
export function findBondEffect(horde) {
  if (!horde?.items) return null;
  return horde.items.find((item) => item.type === "effect" && item.system?.slug === EFFECT_SLUG) ?? null;
}

/**
 * Get the summoner ID from a horde's bond effect
 * @param {Actor} horde - The horde actor
 * @returns {string|null} The summoner actor ID or null
 */
export function findLinkedSummoner(horde) {
  const effect = findBondEffect(horde);
  if (!effect) return null;
  return effect.flags?.[MODULE_ID]?.summonerId ?? null;
}

/**
 * @typedef {Object} SyncOptions
 * @property {boolean} ac - Sync AC
 * @property {boolean} saves - Sync Fort/Ref/Will saves
 * @property {boolean} skills - Sync all skills
 * @property {boolean} hp - Sync HP (shared pool)
 */

/** @type {SyncOptions} */
const DEFAULT_SYNC_OPTIONS = { ac: true, saves: true, skills: true, hp: true };

/**
 * Get sync options from a horde's bond effect
 * @param {Actor} horde - The horde actor
 * @returns {SyncOptions} The sync options (defaults to all enabled)
 */
export function getSyncOptions(horde) {
  const effect = findBondEffect(horde);
  return effect?.flags?.[MODULE_ID]?.syncOptions ?? { ...DEFAULT_SYNC_OPTIONS };
}

/**
 * Find all hordes linked to a specific summoner
 * @param {Actor} summoner - The summoner actor
 * @returns {Actor[]} Array of linked horde actors
 */
export function findLinkedHordes(summoner) {
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
 * Build effect description based on sync options
 * @param {SyncOptions} syncOptions - Which stats are being synced
 * @returns {string} HTML description string
 */
export function buildSyncDescription(syncOptions) {
  const syncedParts = [];
  if (syncOptions.ac) syncedParts.push("AC");
  if (syncOptions.saves) syncedParts.push("saves");
  if (syncOptions.skills) syncedParts.push("skills");
  if (syncOptions.hp) syncedParts.push("HP pool");
  return syncedParts.length > 0
    ? `<p>This creature is linked to a Necrologist summoner and syncs: ${syncedParts.join(", ")}.</p>`
    : `<p>This creature is linked to a Necrologist summoner.</p>`;
}

/**
 * Create the base Necrologist Bond effect data
 * @param {string} summonerId - The summoner's actor ID
 * @param {SyncOptions} [syncOptions] - Which stats to sync
 * @returns {Object} Effect item data
 */
export function createBondEffectData(summonerId, syncOptions = DEFAULT_SYNC_OPTIONS) {
  const rules = [];

  if (syncOptions.ac) {
    rules.push({ key: "FlatModifier", selector: "ac", value: 0, label: EFFECT_LABEL });
  }

  if (syncOptions.saves) {
    rules.push(
      { key: "FlatModifier", selector: "fortitude", value: 0, label: EFFECT_LABEL },
      { key: "FlatModifier", selector: "reflex", value: 0, label: EFFECT_LABEL },
      { key: "FlatModifier", selector: "will", value: 0, label: EFFECT_LABEL }
    );
  }

  if (syncOptions.skills) {
    for (const skill of SKILLS) {
      rules.push({ key: "FlatModifier", selector: skill, value: 0, label: EFFECT_LABEL });
    }
  }

  if (syncOptions.hp) {
    rules.push({ key: "FlatModifier", selector: "hp", value: 0, label: EFFECT_LABEL });
  }

  return {
    name: EFFECT_LABEL,
    type: "effect",
    img: EFFECT_ICON,
    system: {
      slug: EFFECT_SLUG,
      description: { value: buildSyncDescription(syncOptions) },
      rules,
    },
    flags: {
      [MODULE_ID]: {
        summonerId,
        syncOptions: { ...syncOptions },
      },
    },
  };
}

/**
 * Calculate stat modifiers to make horde match summoner
 * @param {Actor} summoner - The summoner actor
 * @param {Actor} horde - The horde actor
 * @param {SyncOptions} [syncOptions] - Which stats to calculate
 * @returns {StatModifiers} Modifier values for enabled AC, saves, and skills
 */
export function calculateModifiers(summoner, horde, syncOptions = DEFAULT_SYNC_OPTIONS) {
  const effect = findBondEffect(horde);
  const currentMods = {};
  const modifiers = {};

  if (syncOptions.ac) {
    currentMods.ac = 0;
  }
  if (syncOptions.saves) {
    currentMods.fortitude = 0;
    currentMods.reflex = 0;
    currentMods.will = 0;
  }
  if (syncOptions.skills) {
    for (const skill of SKILLS) {
      currentMods[skill] = 0;
    }
  }
  if (syncOptions.hp) {
    currentMods.hp = 0;
  }

  if (effect?.system?.rules) {
    for (const rule of effect.system.rules) {
      if (rule.key === "FlatModifier" && rule.label === EFFECT_LABEL) {
        if (rule.selector in currentMods) {
          currentMods[rule.selector] = rule.value ?? 0;
        }
      }
    }
  }

  if (syncOptions.ac) {
    const summonerAC = summoner.system.attributes?.ac?.value ?? 10;
    const hordeBaseAC = (horde.system.attributes?.ac?.value ?? 10) - currentMods.ac;
    modifiers.ac = summonerAC - hordeBaseAC;
  }

  if (syncOptions.saves) {
    const summonerFort = summoner.system.saves?.fortitude?.totalModifier ?? 0;
    const summonerRef = summoner.system.saves?.reflex?.totalModifier ?? 0;
    const summonerWill = summoner.system.saves?.will?.totalModifier ?? 0;

    const hordeBaseFort = (horde.system.saves?.fortitude?.totalModifier ?? 0) - currentMods.fortitude;
    const hordeBaseRef = (horde.system.saves?.reflex?.totalModifier ?? 0) - currentMods.reflex;
    const hordeBaseWill = (horde.system.saves?.will?.totalModifier ?? 0) - currentMods.will;

    modifiers.fortitude = summonerFort - hordeBaseFort;
    modifiers.reflex = summonerRef - hordeBaseRef;
    modifiers.will = summonerWill - hordeBaseWill;
  }

  if (syncOptions.skills) {
    for (const skill of SKILLS) {
      const summonerSkill = summoner.system.skills?.[skill]?.totalModifier ?? 0;
      const hordeBaseSkill = (horde.system.skills?.[skill]?.totalModifier ?? 0) - currentMods[skill];
      modifiers[skill] = summonerSkill - hordeBaseSkill;
    }
  }

  if (syncOptions.hp) {
    const summonerMaxHP = summoner.system.attributes?.hp?.max ?? 0;
    const hordeBaseMaxHP = (horde.system.attributes?.hp?.max ?? 0) - currentMods.hp;
    modifiers.hp = summonerMaxHP - hordeBaseMaxHP;
  }

  return modifiers;
}

/**
 * Update the bond effect's rule elements with new modifier values
 * @param {Item} effect - The bond effect item
 * @param {StatModifiers} modifiers - The modifier values
 * @param {SyncOptions} [syncOptions] - Which stats to include in rules
 * @returns {Promise<boolean>} Success status
 */
export async function updateEffectModifiers(effect, modifiers, syncOptions = DEFAULT_SYNC_OPTIONS) {
  try {
    const rules = [];

    if (syncOptions.ac && modifiers.ac !== undefined) {
      rules.push({ key: "FlatModifier", selector: "ac", value: modifiers.ac, label: EFFECT_LABEL });
    }

    if (syncOptions.saves) {
      if (modifiers.fortitude !== undefined) {
        rules.push({ key: "FlatModifier", selector: "fortitude", value: modifiers.fortitude, label: EFFECT_LABEL });
      }
      if (modifiers.reflex !== undefined) {
        rules.push({ key: "FlatModifier", selector: "reflex", value: modifiers.reflex, label: EFFECT_LABEL });
      }
      if (modifiers.will !== undefined) {
        rules.push({ key: "FlatModifier", selector: "will", value: modifiers.will, label: EFFECT_LABEL });
      }
    }

    if (syncOptions.skills) {
      for (const skill of SKILLS) {
        if (modifiers[skill] !== undefined) {
          rules.push({ key: "FlatModifier", selector: skill, value: modifiers[skill], label: EFFECT_LABEL });
        }
      }
    }

    if (syncOptions.hp && modifiers.hp !== undefined) {
      rules.push({ key: "FlatModifier", selector: "hp", value: modifiers.hp, label: EFFECT_LABEL });
    }

    await effect.update({ "system.rules": rules });
    return true;
  } catch (error) {
    logError("Failed to update effect modifiers:", error);
    return false;
  }
}
