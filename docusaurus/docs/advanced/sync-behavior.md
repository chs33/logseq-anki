---
id: sync-behavior
title: Syncing Behavior
description: Understanding how the plugin syncs with Anki and what gets overwritten
---

# Syncing Behavior

This plugin performs **one-way sync** from Logseq to Anki.

## One-Way Sync Explained

The sync process is **unidirectional** - it only transfers data **from Logseq to Anki**, never the other way around.

```
Logseq → Anki (✓ Supported)
Anki → Logseq (✗ Not Supported)
```

This means:
- Changes made in Logseq will be reflected in Anki after syncing
- Changes made directly in Anki (with some exceptions) will be overwritten on the next sync
- Review history, and scheduling data in Anki is preserved

## Incremental Updates

The plugin keeps a dependency hash in each synced Anki note. The hash includes the rendered note fields, card dependencies, relevant page/block metadata, plugin settings, plugin version, deck, tags, breadcrumb, and asset modification times.

When an existing note's stored dependency hash still matches the current Logseq graph state, the sync skips rendering and updating that note. This makes repeated syncs much faster when most cards have not changed. Missing media files are still restored when possible.

Sync still scans eligible Logseq cards each run so it can detect new cards, changed cards, and stale Anki notes. Manual sync can still show update candidates before the hash skip is applied, but only notes with real changes are sent through the Anki update operation.

## AnkiConnect Port

By default, the plugin connects to AnkiConnect at `127.0.0.1:8765`.

If your AnkiConnect `webBindPort` is customized, set the same value in the plugin setting **AnkiConnect port**. Invalid ports fall back to `8765`.

## What Gets Overwritten

### Always Overwritten (Cannot be Disabled)

These fields are always updated from Logseq during sync:

| Field | Description |
|-------|-------------|
| **Template** | The card template (HTML/CSS/JS structure) |
| **Content** | The main card content (Text field) |
| **Deck** | Which deck the card belongs to |
| **Tags** | All card tags |

### Conditionally Overwritten (Configurable)

These can be controlled via the **"Overwrite following on every sync"** setting in the plugin settings:

| Field | Default | Description |
|-------|---------|-------------|
| **Suspended** | Enabled | Whether the card is suspended/unsuspended. Controlled by the `suspend-anki-card` property in Logseq. |

To change this behavior:
1. Open Logseq Settings
2. Go to the plugin settings for "Logseq Anki Sync"
3. Find "Overwrite following on every sync"
4. Check/uncheck "Suspended" as needed

### Never Overwritten

These fields are **never** touched by the plugin during sync:

| Field                             | Description                             |
|-----------------------------------|-----------------------------------------|
| **User Controlled Field (Front)** | Custom content only on the front side   |
| **User Controlled Field (Back)**  | Custom content only on the back side    |
| **User Controlled Field (Both)**  | Custom content on both sides            |
| **CSS Section of Template**       | See [Custom CSS](./custom-css) for details |
| **Leech Tag**                     | Anki's leech tag (e.g., "leech" on a card) is never overwritten |
| **Review History**                | Your review history and scheduling data |

## User Controlled Fields

User Controlled Fields allow you to add custom content directly to your Anki cards that **will not be overwritten** during sync. This is useful for adding personal notes, mnemonics, or additional context that you want to maintain separately in anki.

### Available Fields

| Field Name | Display Location |
|------------|------------------|
| **User Controlled Field (Front)** | Only on the front side of cards |
| **User Controlled Field (Back)** | Only on the back side of cards |
| **User Controlled Field (Both)** | On both front and back sides of cards |
