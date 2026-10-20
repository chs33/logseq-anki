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

For DB graphs, the scan loads each candidate card's descendant tree with one recursive database query instead of reading every descendant separately. Blocks that the query proves have no properties, aliases, or tags also skip a redundant property API request. Blocks with any of those values continue through Logseq's normal property resolution, including class defaults. These are performance optimizations only; they do not change which cards are eligible or how they are rendered.

When **Sync Main** info-level logging is enabled, the plugin also saves diagnostics for the most recently completed sync in its local settings. The diagnostics include total duration and per-phase timings without storing card content.

## Event-driven auto sync

When auto sync is enabled, the plugin listens for Logseq database changes instead of scanning the graph on a repeating timer. It waits until Logseq has been quiet for 15 seconds, then resolves and syncs only cards affected by the accumulated changes. A built-in cooldown prevents auto sync from running more than once per minute while edits continue.

Targeted note discovery constrains the existing note-type DataScript queries to the resolved stable block UUIDs before Logseq executes them. It does not enumerate every eligible card and filter the results afterward. The same renderers, hash checks, Anki operations, and asset pipeline are then used for the selected cards.

Changes that arrive during a sync are coalesced into one follow-up run, so they are not lost and cannot create overlapping syncs. Auto sync is still turned off whenever the plugin starts and must be enabled for the current session.

Hierarchy-changing move and indent/outdent events also reconcile cards previously indexed beneath
the changed parent. This covers Logseq events that report the old card-group parent without the
moved child: moving a direct child out from under `card-group` removes that child's corresponding
Anki note during the targeted Auto Sync run. Order-only moves remain scoped to the reordered card.

Targeted auto sync depends on an in-memory dependency index produced by a successful **Full Sync**. Turning Auto Sync on runs that Full Sync first and applies its complete reconciliation plan without opening the manual change-selection or deletion-confirmation dialogs. Targeted event processing becomes active only after the reconciliation and index build both succeed. Failing the initialization leaves Auto Sync off. Safely classified changes received during initialization are retained for a targeted follow-up run.

When **Sync AnkiWeb after auto sync changes** is enabled, this initialization Full Sync also runs
AnkiWeb sync if it created, updated, or deleted local Anki content. The same rule applies to later
targeted runs; no AnkiWeb request is made when a run produces no local changes.

After initialization, if the index is unavailable, an event is unsupported, a deletion cannot be tied to a known card identity, or a global rendering setting changes, auto sync stops and displays **Full sync required** with a reason. It never hides uncertainty by silently starting a full graph scan. A successful Full Sync rebuilds the index and clears this state. Auto Sync is disabled again when the plugin starts, so enabling it in a new Logseq session performs a fresh Full Sync.

### Installed Logseq 2.0.2 DB event contract

The targeted classifier is based on the event bridge shipped by the installed Logseq 2.0.2 build and its bundled `@logseq/libs` 0.3.3 SDK:

- `DB.onChanged` exposes `{ blocks, txData, txMeta }`; the installed DB pipeline additionally sends `deletedBlockUuids`.
- `blocks` contains complete changed block/page snapshots with stable `uuid` and numeric `id` values. Ordering is represented by `order`; visible sibling positions are not identities.
- SDK `txData` entries use the five-item DataScript datom form `[entityId, attribute, value, transactionId, added]`. In the installed DB-graph pipeline, `txData` is deliberately an empty array, so targeting primarily uses snapshots, deleted UUIDs, and `txMeta`.
- Clojure keyword keys are converted to camel case before delivery, so `:outliner-op` arrives as `txMeta.outlinerOp` and `:deleted-block-uuids` arrives as `deletedBlockUuids`.
- The installed pipeline publishes the hook only when at least one changed block is present and the changed-block count is at most 1,000. Payloads outside the recognized contract are not treated as successful auto syncs.

Logseq can also lazily create UI-only view definitions under its hidden built-in `$$$views` page.
These events may contain the changed view snapshots without an outliner operation or transaction
datoms. Auto Sync ignores a metadata-free event only when every changed entity is either that
hidden built-in page or a recognizable view definition directly beneath it. Logseq can also omit
transaction metadata for ordinary user edits. When the event still contains complete snapshots
with stable block/page IDs and UUIDs, Auto Sync targets those entities conservatively and expands
all semantic dependencies. Malformed events and known graph-wide operations still require Full
Sync.

Each targeted run records its classification, reason, changed entities, affected-card count, duration, and whether Full Sync is required. Deletions are executed only for identities already known by the Full Sync index.

Use **Force Regenerate All Anki Cards** from the command palette, or **Force Regenerate All** from the plugin toolbar menu, when you need to rerender every selected existing card even if its dependency hash still matches. This is useful after renderer, template, or Logseq link behavior changes where the stored hash may otherwise prevent an unchanged card from being sent to Anki. **Full Sync** remains the authoritative graph-wide reconciliation and deletion check.

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
