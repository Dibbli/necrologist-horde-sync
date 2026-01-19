# Necrologist Horde Sync

FoundryVTT module for PF2e that syncs stats between Necrologist summoners and their zombie hordes.

> **Note:** This was vibe coded, so don't expect perfection. It works for my use case, YMMV.

## TL;DR

1. Install module in FoundryVTT
2. Enable it in your world
3. Import macros from the included compendium (see below)
4. Click "Link Horde" macro to connect your summoner to their horde
5. Stats sync automatically from then on

## Macros

The module includes a compendium pack with ready-to-use macros:

1. Go to **Compendiums** tab in the sidebar
2. Find **"Necrologist Horde Sync Macros"**
3. Right-click a macro → **Import**
4. Drag the macro to your hotbar

**Included macros:**
- **Link Horde** - Opens dialog to link a summoner to a horde
- **Unlink Horde** - Opens dialog to remove a link
- **Sync All Hordes** - Force sync all linked pairs

## What it does

- Syncs AC, saves, and HP from summoner to horde
- Damage to horde syncs back to summoner (shared HP pool)
- Creates a "Necrologist Bond" effect on the horde
- Supports multiple summoner/horde pairs
- Auto-syncs on world load and when stats change

## Manifest URL

```
https://raw.githubusercontent.com/Dibbli/necrologist-horde-sync/main/module.json
```
