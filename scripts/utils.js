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
 * Check if current user is the GM
 * @returns {boolean}
 */
export function isGM() {
  return game.user?.isGM ?? false;
}
