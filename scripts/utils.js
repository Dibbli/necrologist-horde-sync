/**
 * Utility functions for Necrologist Horde Sync
 * @module utils
 */

export const MODULE_ID = "necrologist-horde-sync";
export const EFFECT_SLUG = "necrologist-bond";
export const EFFECT_LABEL = "Necrologist Bond";
export const EFFECT_ICON = "icons/magic/unholy/strike-body-explode-disintegrate.webp";

/**
 * Escape HTML entities to prevent XSS
 * @param {string} str - String to escape
 * @returns {string} Escaped string
 */
export function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Log a message if logging is enabled
 * @param {...unknown} args - Arguments to log
 */
export function log(...args) {
  try {
    if (game.settings.get(MODULE_ID, "enableLogging")) {
      console.log(`[${MODULE_ID}]`, ...args);
    }
  } catch {
    // Settings not yet registered, ignore
  }
}

/**
 * Log an error (always shown)
 * @param {...unknown} args - Arguments to log
 */
export function logError(...args) {
  console.error(`[${MODULE_ID}]`, ...args);
}

/**
 * Check if user can modify an actor (owns it or is GM)
 * @param {Actor} actor - The actor to check
 * @returns {boolean}
 */
export function canModifyActor(actor) {
  if (!actor) return false;
  return game.user?.isGM || actor.isOwner;
}
