import type {Note} from "../anki-notes/Note";

/**
 * ====== Type definitions for sync operations ======
 */

/**
 * Represents parsed note data before conversion to Anki note fields.
 * This is the intermediate format returned by parseNote() and used in hash calculation.
 */
export type ParsedNoteData = [
    html: string,
    assets: Set<string>,
    deck: string,
    breadcrumb: string,
    tags: string[]
];

/**
 * Contains result info from syncing.
 */
export interface SyncResult {
    /** Notes that were successfully created */
    toCreateNotes: Note[];
    /** Notes that were successfully updated */
    toUpdateNotes: Note[];
    /** Anki note IDs that were successfully deleted */
    toDeleteNotes: number[];
    /** Map of failed create operations: key is "uuid-type", value is the error */
    failedCreated: {[key: string]: Error};
    /** Map of failed update operations: key is "uuid-type", value is the error */
    failedUpdated: {[key: string]: Error};
    /** Map of failed delete operations: key is note ID, value is the error */
    failedDeleted: {[key: string]: Error};
    /** Number of Anki media files updated during sync */
    mediaUpdated: number;
    /** Number of cards suspended during sync */
    suspended: number;
    /** Number of cards unsuspended during sync */
    unsuspended: number;
    /** Number of update candidates skipped because their dependency hash still matched */
    skippedUpdate: number;
    /** Number of Anki notes detected as stale but intentionally skipped */
    skippedDelete: number;
    /** True when the run changed local Anki data */
    changed: boolean;
    /** True when AnkiWeb sync was triggered successfully after local changes */
    ankiWebSynced: boolean;
    /** Error string when AnkiWeb sync failed */
    ankiWebSyncError?: string;
}
