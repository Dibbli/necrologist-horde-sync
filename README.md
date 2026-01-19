# Necrologist Horde Sync

FoundryVTT module for PF2e that syncs stats between Necrologist summoners and their zombie hordes.

> **Note:** This was vibe coded, so don't expect perfection. It works for my use case, YMMV.

## TL;DR

1. Install module in FoundryVTT
2. Enable it in your world
3. Open browser console (F12) and run:
   ```javascript
   const api = game.modules.get('necrologist-horde-sync').api;
   api.linkHorde('summoner-actor-id', 'horde-actor-id');
   ```
4. Get actor IDs by right-clicking actors in the sidebar

## What it does

- Syncs AC, saves, and HP from summoner to horde
- Damage to horde syncs back to summoner (shared HP pool)
- Creates a "Necrologist Bond" effect on the horde
- Supports multiple summoner/horde pairs

## API

```javascript
const api = game.modules.get('necrologist-horde-sync').api;
api.linkHorde(summonerId, hordeId);  // Link a pair
api.unlinkHorde(hordeId);            // Unlink
api.sync();                          // Manual sync all
```

## Manifest URL

```
https://raw.githubusercontent.com/Dibbli/necrologist-horde-sync/main/module.json
```
