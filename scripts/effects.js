/**
 * Effect management functions for Necrologist Horde Sync
 * @module effects
 */

import { MODULE_ID, EFFECT_SLUG, EFFECT_LABEL, EFFECT_ICON, log, logError } from "./utils.js";

/**
 * @typedef {Object} StatModifiers
 * @property {number} ac - AC modifier
 * @property {number} fortitude - Fortitude save modifier
 * @property {number} reflex - Reflex save modifier
 * @property {number} will - Will save modifier
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
 * Create the base Necrologist Bond effect data
 * @param {string} summonerId - The summoner's actor ID
 * @returns {Object} Effect item data
 */
export function createBondEffectData(summonerId) {
  return {
    name: EFFECT_LABEL,
    type: "effect",
    img: EFFECT_ICON,
    system: {
      slug: EFFECT_SLUG,
      description: {
        value: `<p>This creature is linked to a Necrologist summoner and uses their AC, saves, and shares their HP pool.</p>`,
      },
      rules: [
        { key: "FlatModifier", selector: "ac", value: 0, label: EFFECT_LABEL },
        { key: "FlatModifier", selector: "fortitude", value: 0, label: EFFECT_LABEL },
        { key: "FlatModifier", selector: "reflex", value: 0, label: EFFECT_LABEL },
        { key: "FlatModifier", selector: "will", value: 0, label: EFFECT_LABEL },
      ],
    },
    flags: {
      [MODULE_ID]: {
        summonerId,
      },
    },
  };
}

/**
 * Calculate stat modifiers to make horde match summoner
 * @param {Actor} summoner - The summoner actor
 * @param {Actor} horde - The horde actor
 * @returns {StatModifiers} Modifier values for AC and saves
 */
export function calculateModifiers(summoner, horde) {
  const summonerAC = summoner.system.attributes?.ac?.value ?? 10;
  const summonerFort = summoner.system.saves?.fortitude?.totalModifier ?? 0;
  const summonerRef = summoner.system.saves?.reflex?.totalModifier ?? 0;
  const summonerWill = summoner.system.saves?.will?.totalModifier ?? 0;

  const effect = findBondEffect(horde);
  const currentMods = { ac: 0, fortitude: 0, reflex: 0, will: 0 };

  if (effect?.system?.rules) {
    for (const rule of effect.system.rules) {
      if (rule.key === "FlatModifier" && rule.label === EFFECT_LABEL) {
        if (rule.selector in currentMods) {
          currentMods[rule.selector] = rule.value ?? 0;
        }
      }
    }
  }

  const hordeBaseAC = (horde.system.attributes?.ac?.value ?? 10) - currentMods.ac;
  const hordeBaseFort = (horde.system.saves?.fortitude?.totalModifier ?? 0) - currentMods.fortitude;
  const hordeBaseRef = (horde.system.saves?.reflex?.totalModifier ?? 0) - currentMods.reflex;
  const hordeBaseWill = (horde.system.saves?.will?.totalModifier ?? 0) - currentMods.will;

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
 * @param {StatModifiers} modifiers - The modifier values
 * @returns {Promise<boolean>} Success status
 */
export async function updateEffectModifiers(effect, modifiers) {
  try {
    const rules = [
      { key: "FlatModifier", selector: "ac", value: modifiers.ac, label: EFFECT_LABEL },
      { key: "FlatModifier", selector: "fortitude", value: modifiers.fortitude, label: EFFECT_LABEL },
      { key: "FlatModifier", selector: "reflex", value: modifiers.reflex, label: EFFECT_LABEL },
      { key: "FlatModifier", selector: "will", value: modifiers.will, label: EFFECT_LABEL },
    ];

    await effect.update({ "system.rules": rules });
    return true;
  } catch (error) {
    logError("Failed to update effect modifiers:", error);
    return false;
  }
}
