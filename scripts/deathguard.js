/**
 * Deathguard: allies sharing the horde's space become Concealed.
 *
 * The PF2e Aura RE cannot express "shared-square only" (radius 0 still bleeds
 * 5 ft cardinally). This module drives the rule from token-position hooks,
 * keyed off a flag on the existing `necrologist-bond` effect — so the hot path
 * never scans feats.
 *
 * @module deathguard
 */

import {
  MODULE_ID,
  DEATHGUARD_FEAT_SLUG,
  DEATHGUARD_FLAG,
  DEATHGUARD_SOURCE_FLAG,
  DEATHGUARD_EFFECT_UUID_DEFAULT,
  log,
  logError,
  canModifyActor,
} from "./utils.js";
import {
  findBondEffect,
  findLinkedHordes,
  findLinkedSummoner,
  getDeathguardFlag,
  hasDeathguardFeat,
  setDeathguardFlag,
} from "./effects.js";

const SETTING_EFFECT_UUID = "deathguardEffectUuid";

/** @type {Map<string, Set<string>>} sceneId -> Set<tokenId> for deathguard hordes */
const sceneCache = new Map();

/** @type {Map<string, number>} per-scene debounce timers */
const sceneDebounce = new Map();

function getEffectUuid() {
  try {
    return game.settings.get(MODULE_ID, SETTING_EFFECT_UUID) || DEATHGUARD_EFFECT_UUID_DEFAULT;
  } catch {
    return DEATHGUARD_EFFECT_UUID_DEFAULT;
  }
}

/**
 * Resolve the effective position/size of a token, preferring fields from a
 * pending `changes` object over the document's current state. Foundry v13/v14
 * fires `updateToken` with the destination in `changes` while `tokenDoc.x/y`
 * may still reflect the pre-move position until the movement settles, so
 * reading off the doc alone causes "fires on the wrong edge of movement".
 * @param {TokenDocument} tokenDoc
 * @param {Object} [changes]
 * @returns {{x:number,y:number,w:number,h:number}}
 */
function effectiveDims(tokenDoc, changes) {
  const c = changes ?? {};
  return {
    x: c.x ?? tokenDoc.x,
    y: c.y ?? tokenDoc.y,
    w: c.width ?? tokenDoc.width,
    h: c.height ?? tokenDoc.height,
  };
}

/**
 * @param {{x:number,y:number,w:number,h:number}} dims
 * @returns {Set<string>} grid-cell keys "gx,gy"
 */
function getOccupiedSquares(dims) {
  const grid = canvas?.grid;
  if (!grid?.size) return new Set();
  const gx = Math.round(dims.x / grid.size);
  const gy = Math.round(dims.y / grid.size);
  const w = Math.max(1, Math.round(dims.w));
  const h = Math.max(1, Math.round(dims.h));
  const out = new Set();
  for (let dx = 0; dx < w; dx++) {
    for (let dy = 0; dy < h; dy++) out.add(`${gx + dx},${gy + dy}`);
  }
  return out;
}

/**
 * Pixel-rect AABB overlap.
 * @param {{x:number,y:number,w:number,h:number}} a
 * @param {{x:number,y:number,w:number,h:number}} b
 */
function aabbOverlap(a, b) {
  const g = canvas.grid.size;
  const ax2 = a.x + a.w * g;
  const ay2 = a.y + a.h * g;
  const bx2 = b.x + b.w * g;
  const by2 = b.y + b.h * g;
  return a.x < bx2 && ax2 > b.x && a.y < by2 && ay2 > b.y;
}

function setsOverlap(a, b) {
  for (const v of a) if (b.has(v)) return true;
  return false;
}

function isAlly(hordeActor, otherActor) {
  if (!hordeActor || !otherActor || hordeActor === otherActor) return false;
  if (typeof hordeActor.isAllyOf === "function") return hordeActor.isAllyOf(otherActor);
  return hordeActor.alliance && hordeActor.alliance === otherActor.alliance;
}

function findGrantedEffect(actor, hordeActorId) {
  return actor.itemTypes.effect.find(
    (e) => e.getFlag(MODULE_ID, DEATHGUARD_SOURCE_FLAG) === hordeActorId
  );
}

async function ensureEffect(actor, hordeActorId) {
  if (findGrantedEffect(actor, hordeActorId)) return;
  const uuid = getEffectUuid();
  const source = await fromUuid(uuid);
  if (!source) {
    logError(`Deathguard effect not found at UUID: ${uuid}`);
    return;
  }
  const data = source.toObject();
  data.flags = data.flags || {};
  data.flags[MODULE_ID] = {
    ...(data.flags[MODULE_ID] || {}),
    [DEATHGUARD_SOURCE_FLAG]: hordeActorId,
  };
  await actor.createEmbeddedDocuments("Item", [data]);
  log(`Deathguard: applied concealed to "${actor.name}" from horde ${hordeActorId}`);
}

async function removeEffect(actor, hordeActorId) {
  const existing = findGrantedEffect(actor, hordeActorId);
  if (!existing) return;
  await actor.deleteEmbeddedDocuments("Item", [existing.id]);
  log(`Deathguard: removed concealed from "${actor.name}" (horde ${hordeActorId})`);
}

/**
 * Build the cached set of deathguard horde token ids for a scene.
 * @param {Scene} scene
 */
function buildSceneCache(scene) {
  const set = new Set();
  for (const t of scene.tokens) {
    if (t.actor && getDeathguardFlag(t.actor)) set.add(t.id);
  }
  sceneCache.set(scene.id, set);
  return set;
}

function getCache(scene) {
  if (!scene) return new Set();
  return sceneCache.get(scene.id) ?? buildSceneCache(scene);
}

function invalidateScene(scene) {
  if (!scene) return;
  sceneCache.delete(scene.id);
}

/**
 * Evaluate overlap between a horde token and a candidate ally token.
 * Callers supply already-resolved dims so the moving side can pass its
 * destination instead of the document's stale x/y.
 * @param {TokenDocument} hordeTok
 * @param {TokenDocument} otherTok
 * @param {{x:number,y:number,w:number,h:number}} hordeDims
 * @param {{x:number,y:number,w:number,h:number}} otherDims
 * @returns {Promise<void>}
 */
async function evaluatePair(hordeTok, otherTok, hordeDims, otherDims) {
  const hordeActor = hordeTok.actor;
  const otherActor = otherTok.actor;
  if (!hordeActor || !otherActor) return;
  if (!isAlly(hordeActor, otherActor)) return;
  if (!canModifyActor(otherActor)) return;

  let overlapping = aabbOverlap(hordeDims, otherDims);
  if (overlapping) {
    overlapping = setsOverlap(getOccupiedSquares(hordeDims), getOccupiedSquares(otherDims));
  }

  if (overlapping) await ensureEffect(otherActor, hordeActor.id);
  else if (findGrantedEffect(otherActor, hordeActor.id)) {
    await removeEffect(otherActor, hordeActor.id);
  }
}

/**
 * Re-evaluate everything in a scene from scratch (used on scene load / cache flush).
 * @param {Scene} scene
 */
async function recomputeScene(scene) {
  if (!scene || !game.user?.isGM) return;
  const cache = getCache(scene);
  if (cache.size === 0) {
    // Best-effort cleanup: drop any stale grants whose source horde is no longer present.
    for (const t of scene.tokens) {
      if (!t.actor) continue;
      for (const eff of t.actor.itemTypes.effect) {
        const src = eff.getFlag(MODULE_ID, DEATHGUARD_SOURCE_FLAG);
        if (src && !scene.tokens.some((tt) => tt.actor?.id === src)) {
          if (canModifyActor(t.actor)) {
            await t.actor.deleteEmbeddedDocuments("Item", [eff.id]);
          }
        }
      }
    }
    return;
  }
  const hordeTokens = [];
  for (const id of cache) {
    const t = scene.tokens.get(id);
    if (t) hordeTokens.push(t);
  }
  for (const ht of hordeTokens) {
    const hDims = effectiveDims(ht);
    for (const ot of scene.tokens) {
      if (ot.id === ht.id) continue;
      await evaluatePair(ht, ot, hDims, effectiveDims(ot));
    }
  }
}

function scheduleRecompute(scene) {
  if (!scene) return;
  const id = scene.id;
  if (sceneDebounce.has(id)) clearTimeout(sceneDebounce.get(id));
  sceneDebounce.set(
    id,
    setTimeout(() => {
      sceneDebounce.delete(id);
      recomputeScene(scene).catch((e) => logError("Deathguard recompute failed:", e));
    }, 100)
  );
}

/**
 * Hot path: a single token just changed position/size.
 * @param {TokenDocument} tokenDoc
 * @param {Object} [changes] - the pending update; we merge x/y/width/height
 *   from it onto the doc so geometry uses the destination, not the stale doc.
 */
async function onTokenMoved(tokenDoc, changes) {
  const scene = tokenDoc.parent;
  if (!scene || !game.user?.isGM) return;
  const cache = getCache(scene);
  if (cache.size === 0) return;

  const movedDims = effectiveDims(tokenDoc, changes);

  if (cache.has(tokenDoc.id)) {
    for (const ot of scene.tokens) {
      if (ot.id === tokenDoc.id) continue;
      await evaluatePair(tokenDoc, ot, movedDims, effectiveDims(ot));
    }
  } else {
    for (const id of cache) {
      const ht = scene.tokens.get(id);
      if (!ht) continue;
      await evaluatePair(ht, tokenDoc, effectiveDims(ht), movedDims);
    }
  }
}

/**
 * Push the deathguard flag onto every horde linked to a summoner.
 * @param {Actor} summoner
 */
export async function syncDeathguardFlag(summoner) {
  if (!summoner) return;
  const hordes = findLinkedHordes(summoner);
  if (!hordes.length) return;
  const value = hasDeathguardFeat(summoner);
  let changed = false;
  for (const horde of hordes) {
    if (!canModifyActor(horde)) continue;
    const wrote = await setDeathguardFlag(horde, value);
    if (wrote) changed = true;
  }
  if (changed) {
    for (const scene of game.scenes) {
      if (scene.tokens.some((t) => hordes.some((h) => h.id === t.actor?.id))) {
        invalidateScene(scene);
        if (scene === canvas?.scene) scheduleRecompute(scene);
      }
    }
  }
}

function registerSettings() {
  game.settings.register(MODULE_ID, SETTING_EFFECT_UUID, {
    name: "Deathguard Effect UUID",
    hint:
      "UUID of the effect granted to allies sharing the horde's space. Default is the Spirit Shroud effect bundled with this module.",
    scope: "world",
    config: true,
    type: String,
    default: DEATHGUARD_EFFECT_UUID_DEFAULT,
  });
}

function registerHooks() {
  Hooks.on("updateToken", (tokenDoc, changes, _options, _userId) => {
    try {
      // Process on the designated GM client regardless of who moved the token.
      // Gating on the initiating user (userId === game.user.id) made player
      // moves invisible: the player client bailed at the isGM check in
      // onTokenMoved, and the GM client bailed here — so only GM-initiated
      // moves were ever evaluated.
      if (game.user !== game.users?.activeGM) return;
      if (!("x" in changes || "y" in changes || "width" in changes || "height" in changes)) return;
      onTokenMoved(tokenDoc, changes).catch((e) => logError("onTokenMoved:", e));
    } catch (e) {
      logError("updateToken hook:", e);
    }
  });

  Hooks.on("createToken", (tokenDoc) => {
    invalidateScene(tokenDoc.parent);
    scheduleRecompute(tokenDoc.parent);
  });
  Hooks.on("deleteToken", (tokenDoc) => {
    invalidateScene(tokenDoc.parent);
    scheduleRecompute(tokenDoc.parent);
  });

  // Bond effect changes (deathguard flag flip, or bond add/remove) → invalidate cache
  const onBondChange = (item) => {
    try {
      if (item?.type !== "effect") return;
      if (item.slug !== "necrologist-bond") return;
      const actor = item.parent;
      if (!actor) return;
      for (const scene of game.scenes) {
        if (scene.tokens.some((t) => t.actor?.id === actor.id)) {
          invalidateScene(scene);
          if (scene === canvas?.scene) scheduleRecompute(scene);
        }
      }
    } catch (e) {
      logError("bond-change hook:", e);
    }
  };
  Hooks.on("createItem", onBondChange);
  Hooks.on("updateItem", onBondChange);
  Hooks.on("deleteItem", onBondChange);

  // Summoner feat add/remove for Deathguard → push flag to linked hordes
  const onFeatChange = (item) => {
    try {
      if (item?.type !== "feat") return;
      if (item.slug !== DEATHGUARD_FEAT_SLUG) return;
      const actor = item.parent;
      if (!actor) return;
      // Only act if this actor is a known summoner (has linked hordes)
      if (findLinkedHordes(actor).length === 0) return;
      syncDeathguardFlag(actor).catch((e) => logError("syncDeathguardFlag:", e));
    } catch (e) {
      logError("feat-change hook:", e);
    }
  };
  Hooks.on("createItem", onFeatChange);
  Hooks.on("deleteItem", onFeatChange);

  Hooks.on("canvasReady", () => {
    invalidateScene(canvas.scene);
    scheduleRecompute(canvas.scene);
  });

  log("Deathguard hooks registered");
}

/**
 * Init entry point — call from main `init` hook.
 */
export function initDeathguard() {
  registerSettings();
  Hooks.once("ready", () => {
    registerHooks();
    // Push flags for any already-loaded pairs (covers worlds opened pre-update)
    for (const actor of game.actors) {
      if (findLinkedHordes(actor).length > 0) {
        syncDeathguardFlag(actor).catch((e) => logError("initial syncDeathguardFlag:", e));
      }
    }
    if (canvas?.scene) scheduleRecompute(canvas.scene);
  });
}
