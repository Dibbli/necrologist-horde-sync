# Necrologist Horde Sync

FoundryVTT module for PF2e that syncs stats between Necrologist summoners and their zombie hordes.

> **Note:** This was mostly vibe coded, so don't expect amazing quality. It works for my use case, YMMV.

## Installation

1. Open FoundryVTT
2. Go to **Add-on Modules** → **Install Module**
3. Paste the manifest URL and click **Install**:

```
https://raw.githubusercontent.com/Dibbli/necrologist-horde-sync/main/module.json
```

## Usage

1. Enable the module in your world
2. Import macros from the included compendium:
   - Go to **Compendiums** tab
   - Find **Necrologist Horde Sync Macros**
   - Right-click a macro → **Import**
   - Drag to your hotbar
3. Click **Link Horde** to connect your summoner to their horde
4. Stats sync automatically from then on

### Included Macros

- **Link Horde** - Opens dialog to link a summoner to a horde
- **Unlink Horde** - Opens dialog to remove a link
- **Sync All Hordes** - Force sync all linked pairs

## What It Does

- Syncs AC, saves, and HP from summoner to horde
- Damage to horde syncs back to summoner (shared HP pool)
- Creates a "Necrologist Bond" effect on the horde
- Supports multiple summoner/horde pairs
- Auto-syncs on world load and when stats change

## License

MIT License - see [LICENSE](LICENSE) for details.
