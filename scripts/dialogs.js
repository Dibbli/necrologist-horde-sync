/**
 * UI dialogs for Necrologist Horde Sync
 * @module dialogs
 */

import { escapeHtml, isGM } from "./utils.js";
import { findLinkedSummoner } from "./effects.js";
import { linkHorde, unlinkHorde } from "./sync.js";

/**
 * Show dialog to link a horde to a summoner
 */
export function showLinkDialog() {
  if (!isGM()) {
    ui.notifications.warn("Only the GM can link hordes to summoners.");
    return;
  }

  const characters = game.actors.filter((a) => a.type === "character");
  const npcs = game.actors.filter((a) => a.type === "npc");

  if (characters.length === 0) {
    ui.notifications.warn("No character actors found.");
    return;
  }

  if (npcs.length === 0) {
    ui.notifications.warn("No NPC actors found.");
    return;
  }

  const summonerOptions = characters
    .map((a) => `<option value="${a.id}">${escapeHtml(a.name)}</option>`)
    .join("");
  const hordeOptions = npcs
    .map((a) => `<option value="${a.id}">${escapeHtml(a.name)}</option>`)
    .join("");

  const content = `
    <form>
      <div class="form-group">
        <label>Summoner (Character):</label>
        <select name="summonerId" style="width:100%">${summonerOptions}</select>
      </div>
      <div class="form-group">
        <label>Horde (NPC):</label>
        <select name="hordeId" style="width:100%">${hordeOptions}</select>
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
        callback: (html) => {
          const summonerId = html.find('[name="summonerId"]').val();
          const hordeId = html.find('[name="hordeId"]').val();
          linkHorde(summonerId, hordeId);
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
export function showUnlinkDialog() {
  if (!isGM()) {
    ui.notifications.warn("Only the GM can unlink hordes.");
    return;
  }

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
    .map((h) => `<option value="${h.horde.id}">${escapeHtml(h.horde.name)} (linked to ${escapeHtml(h.summonerName)})</option>`)
    .join("");

  const content = `
    <form>
      <div class="form-group">
        <label>Select Horde to Unlink:</label>
        <select name="hordeId" style="width:100%">${hordeOptions}</select>
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
        callback: (html) => {
          const hordeId = html.find('[name="hordeId"]').val();
          unlinkHorde(hordeId);
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
