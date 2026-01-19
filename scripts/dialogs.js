/**
 * UI dialogs for Necrologist Horde Sync
 * @module dialogs
 */

import { escapeHtml } from "./utils.js";
import { findLinkedSummoner } from "./effects.js";
import { linkHorde, unlinkHorde } from "./sync.js";

/**
 * Show dialog to link a horde to a summoner
 */
export function showLinkDialog() {
  const ownedCharacters = game.actors.filter(
    (a) => a.type === "character" && a.isOwner
  );

  if (ownedCharacters.length < 2) {
    ui.notifications.warn("You need ownership of at least 2 characters to link.");
    return;
  }

  const characterOptions = ownedCharacters
    .map((a) => `<option value="${a.id}">${escapeHtml(a.name)}</option>`)
    .join("");

  const content = `
    <form>
      <div class="form-group">
        <label>Summoner:</label>
        <select name="summonerId" style="width:100%">${characterOptions}</select>
      </div>
      <div class="form-group">
        <label>Horde:</label>
        <select name="hordeId" style="width:100%">${characterOptions}</select>
      </div>
      <div class="form-group">
        <label>Sync Options:</label>
        <div style="display:flex;flex-direction:column;gap:4px;margin-top:4px">
          <label style="display:flex;align-items:center;gap:6px">
            <input type="checkbox" name="syncAC" checked> AC
          </label>
          <label style="display:flex;align-items:center;gap:6px">
            <input type="checkbox" name="syncSaves" checked> Saves (Fort/Ref/Will)
          </label>
          <label style="display:flex;align-items:center;gap:6px">
            <input type="checkbox" name="syncSkills" checked> Skills
          </label>
          <label style="display:flex;align-items:center;gap:6px">
            <input type="checkbox" name="syncHP" checked> HP (shared pool)
          </label>
        </div>
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
          if (summonerId === hordeId) {
            ui.notifications.warn("Summoner and Horde must be different characters.");
            return;
          }
          const syncOptions = {
            ac: html.find('[name="syncAC"]').is(':checked'),
            saves: html.find('[name="syncSaves"]').is(':checked'),
            skills: html.find('[name="syncSkills"]').is(':checked'),
            hp: html.find('[name="syncHP"]').is(':checked'),
          };
          if (!syncOptions.ac && !syncOptions.saves && !syncOptions.skills && !syncOptions.hp) {
            ui.notifications.warn("Please select at least one stat to sync.");
            return;
          }
          linkHorde(summonerId, hordeId, syncOptions);
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
  const linkedHordes = [];
  for (const actor of game.actors) {
    if (!actor.isOwner) continue;
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
