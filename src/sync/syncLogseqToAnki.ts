import "@logseq/libs";
import {CancelablePromise} from "cancelable-promise";
import WARNING_ICON from "../../node_modules/@tabler/icons/icons/outline/alert-circle.svg?raw";
import SUCCESS_ICON from "../../node_modules/@tabler/icons/icons/outline/circle-check.svg?raw";
import pkg from "../../package.json";
import * as AnkiConnect from "../anki-connect/AnkiConnect";
import {LazyAnkiNoteManager} from "../anki-connect/LazyAnkiNoteManager";
import {ClozeNote} from "../anki-notes/ClozeNote";
import {HighlightMaskNote} from "../anki-notes/HighlightMaskNote";
import {ImageOcclusionNote} from "../anki-notes/ImageOcclusionNote";
import {MultilineCardNote} from "../anki-notes/MultilineCardNote";
import {Note} from "../anki-notes/Note";
import {SwiftArrowNote} from "../anki-notes/SwiftArrowNote";
import {
    getTemplateBack,
    getTemplateFront,
    getTemplateMediaFiles
} from "../anki-template/AnkiCardTemplates";
import {createLogger, LoggerCategory} from "../logger";
import {LogseqAppInfoFetcher} from "../logseq/LogseqAppInfoFetcher";
import {LogseqProxy} from "../logseq/LogseqProxy";
import {WindowParentBridge} from "../logseq/WindowParentBridge";
import {
    ProgressNotification,
    showConfirmModal,
    showSyncResultDialog,
    showSyncSelectionDialog
} from "../ui";
import {ActionNotification} from "../ui/notifications/ActionNotification";
import {handleAnkiError, sortAsync} from "../utils/utils";
import {NoteHashCalculator} from "./cache";
import {CreateNotesTask} from "./tasks/CreateNotesTask";
import {DeleteNotesTask} from "./tasks/DeleteNotesTask";
import {SuspendUnsuspendNotesTask} from "./tasks/SuspendUnsuspendNotesTask";
import {UpdateNotesTask} from "./tasks/UpdateNotesTask";
import type {SyncResult} from "./types";

const logger = createLogger(LoggerCategory.SyncMain);

export interface LogseqToAnkiSyncOptions {
    mode?: "manual" | "auto";
    triggerAnkiWebSync?: boolean;
    forceRegenerate?: boolean;
}

export interface LogseqToAnkiSyncOutcome {
    status: "completed" | "cancelled" | "skipped" | "already-syncing" | "failed";
    changed: boolean;
    result?: SyncResult;
    error?: unknown;
}

interface ExecuteSyncPlanOptions {
    autoSync: boolean;
    silentProgress: boolean;
    skippedDelete: number;
    forceRegenerate?: boolean;
}

export class LogseqToAnkiSync {
    static isSyncing: boolean;
    graphName: string;
    logseqLinkGraphName: string;
    modelName: string;

    public async sync(options: LogseqToAnkiSyncOptions = {}): Promise<LogseqToAnkiSyncOutcome> {
        const syncOptions = {mode: "manual" as const, ...options};
        // if (await LogseqProxy.App.checkCurrentIsDbGraph()  === true) {
        //     await logseq.UI.showMsg("Anki sync not supported in DB Graphs yet.\nDevelopment to support it is going on in db branch.", "error");
        //     return;
        // }
        if (!LogseqAppInfoFetcher.checkHostAccess()) {
            const settings = LogseqProxy.Settings.getPluginSettings();
            if (!settings.enableExperimentalWebSync) {
                await logseq.UI.showMsg(
                    "Syncing is not supported in Logseq Web since plugin cannot read image files at the moment.",
                    "error"
                );
                return {status: "skipped", changed: false};
            }
        }
        if (LogseqToAnkiSync.isSyncing) {
            logger.info("Syncing already in process");
            return {status: "already-syncing", changed: false};
        }
        LogseqToAnkiSync.isSyncing = true;
        try {
            return await this.performSync(syncOptions);
        } catch (e) {
            const errorMessage = e?.toString?.() ?? String(e);
            if (syncOptions.mode === "auto") {
                logseq.UI.showMsg(`Auto sync failed: ${errorMessage}`, "error", {
                    timeout: 8000
                });
            } else {
                handleAnkiError(errorMessage);
            }
            logseq.provideUI({
                key: `logseq-anki-sync-progress-notification-${logseq.baseInfo.id}`,
                template: ``
            });
            logger.error("Sync failed", e);
            return {status: "failed", changed: false, error: e};
        } finally {
            this.completeSyncCleanup();
            LogseqToAnkiSync.isSyncing = false;
        }
    }

    private async performSync(
        options: Required<Pick<LogseqToAnkiSyncOptions, "mode">> & LogseqToAnkiSyncOptions
    ): Promise<LogseqToAnkiSyncOutcome> {
        const syncStartedAtMs = Date.now();
        const syncStartedAt = new Date(syncStartedAtMs).toISOString();
        const isAutoSync = options.mode === "auto";
        this.graphName = await this.getGraphName();
        this.logseqLinkGraphName = await this.getLogseqLinkGraphName();
        this.modelName = this.getModelName();
        logger.success(`Starting Logseq to Anki Sync V${pkg.version} for graph ${this.graphName}`);

        await this.measureSyncPhase("setup Anki model", () => this.setupAnkiModel());
        const ankiNoteManager = await this.measureSyncPhase("initialize Anki cache", () =>
            this.initializeAnkiNoteManager()
        );

        const notes = await this.measureSyncPhase("collect Logseq notes", () =>
            this.collectAllNotes(isAutoSync)
        );
        await this.persistLogseqBlockIds(notes);

        const syncPlan = await this.measureSyncPhase("create sync plan", () =>
            this.createSyncPlan(notes, ankiNoteManager)
        );
        const {toCreateNotesOriginal, toUpdateNotesOriginal, toDeleteNotesOriginal} = syncPlan;

        const confirmation = isAutoSync
            ? this.getAutoSelection(toCreateNotesOriginal, toUpdateNotesOriginal)
            : await this.getUserConfirmation(
                  toCreateNotesOriginal,
                  toUpdateNotesOriginal,
                  toDeleteNotesOriginal,
                  notes
              );

        if (!confirmation) return {status: "cancelled", changed: false};

        const {toCreateNotes, toUpdateNotes, toDeleteNotes} = confirmation;
        const syncResult = await this.executeSyncPlan(
            toCreateNotes,
            toUpdateNotes,
            toDeleteNotes,
            ankiNoteManager,
            {
                autoSync: isAutoSync,
                silentProgress: isAutoSync,
                skippedDelete: isAutoSync ? toDeleteNotesOriginal.length : 0,
                ...(options.forceRegenerate === true ? {forceRegenerate: true} : {})
            }
        );

        await this.performPostSyncCleanup(syncResult.toCreateNotes);
        await this.performAnkiWebSyncIfNeeded(syncResult, options);
        this.attachSyncTiming(syncResult, options.mode, syncStartedAtMs, syncStartedAt);

        WindowParentBridge.dispatchLogseqAnkiSyncEvent("syncLogseqToAnkiComplete");
        WindowParentBridge.setGlobalObject("lastSyncLogseqToAnkiResult", syncResult);
        if (isAutoSync) {
            this.displayAutoResults(syncResult);
        } else {
            this.displayResults(syncResult);
        }

        return {status: "completed", changed: syncResult.changed, result: syncResult};
    }

    private attachSyncTiming(
        syncResult: SyncResult,
        mode: "manual" | "auto",
        startedAtMs: number,
        startedAt: string
    ): void {
        const completedAtMs = Date.now();
        syncResult.mode = mode;
        syncResult.startedAt = startedAt;
        syncResult.completedAt = new Date(completedAtMs).toISOString();
        syncResult.durationMs = completedAtMs - startedAtMs;
    }

    private async createNotes(
        toCreateNotes: Note[],
        failedCreated: {[key: string]: Error},
        ankiNoteManager: LazyAnkiNoteManager,
        syncNotificationObj: ProgressNotification
    ): Promise<Note[]> {
        const graphPath = (await LogseqProxy.App.getCurrentGraph()).path;
        const task = new CreateNotesTask();
        const result = await task.execute(
            toCreateNotes,
            this.modelName,
            this.logseqLinkGraphName,
            graphPath,
            ankiNoteManager,
            syncNotificationObj
        );
        Object.assign(failedCreated, result.failed);
        return result.succeeded;
    }

    private async updateNotes(
        toUpdateNotes: Note[],
        failedUpdated: {[key: string]: Error},
        ankiNoteManager: LazyAnkiNoteManager,
        syncNotificationObj: ProgressNotification,
        options: {autoSync: boolean; forceRegenerate?: boolean}
    ): Promise<{updated: Note[]; skipped: Note[]}> {
        const graphPath = (await LogseqProxy.App.getCurrentGraph()).path;
        const task = new UpdateNotesTask();
        const skipUnchangedNotes =
            !options.forceRegenerate &&
            (options.autoSync ||
                LogseqProxy.Settings.getPluginSettings().skipOnDependencyHashMatch !== false);
        const result = await task.execute(
            toUpdateNotes,
            this.modelName,
            this.logseqLinkGraphName,
            graphPath,
            ankiNoteManager,
            syncNotificationObj,
            {skipUnchangedNotes}
        );
        Object.assign(failedUpdated, result.failed);
        return {updated: result.succeeded, skipped: result.skipped};
    }

    private async updateAssets(ankiNoteManager: LazyAnkiNoteManager): Promise<number> {
        return await ankiNoteManager.executeAssets();
    }

    private async deleteNotes(
        toDeleteNotes: number[],
        failedDeleted: {[key: string]: Error},
        ankiNoteManager: LazyAnkiNoteManager,
        syncNotificationObj: ProgressNotification
    ): Promise<number[]> {
        const task = new DeleteNotesTask();
        const result = await task.execute(toDeleteNotes, ankiNoteManager, syncNotificationObj);
        Object.assign(failedDeleted, result.failed);
        return result.succeeded;
    }

    private async suspendUnsuspendNotes(
        notes: Note[],
        ankiNoteManager: LazyAnkiNoteManager,
        syncNotificationObj: ProgressNotification
    ): Promise<{suspended: number; unsuspended: number}> {
        const task = new SuspendUnsuspendNotesTask();
        const result = await task.execute(notes, ankiNoteManager, syncNotificationObj);
        logger.info(`Suspended ${result.suspended} cards, Unsuspended ${result.unsuspended} cards`);
        return result;
    }

    private async getGraphName(): Promise<string> {
        return (await LogseqProxy.App.getCurrentGraph())?.name || "Default";
    }

    private async getLogseqLinkGraphName(): Promise<string> {
        return await LogseqProxy.App.getCurrentGraphNameForLogseqLinks();
    }

    private getModelName(): string {
        return `${this.graphName}Model`.replace(/\s/g, "_");
    }

    private async setupAnkiModel(): Promise<void> {
        await AnkiConnect.requestPermission();
        await AnkiConnect.upsertModel(
            this.modelName,
            [
                "uuid-type",
                "Logseq Block UUID",
                "Logseq Page Id",
                "Text",
                "Breadcrumb",
                "User Controlled Field (Front)",
                "User Controlled Field (Back)",
                "User Controlled Field (Both)",
                "Config"
            ],
            getTemplateFront(),
            getTemplateBack(),
            getTemplateMediaFiles()
        );
    }

    private async initializeAnkiNoteManager(): Promise<LazyAnkiNoteManager> {
        const ankiNoteManager = new LazyAnkiNoteManager(this.modelName);
        await ankiNoteManager.init();
        Note.setAnkiNoteManager(ankiNoteManager);
        return ankiNoteManager;
    }

    private async collectAllNotes(silentProgress = false): Promise<Note[]> {
        const scanNotification = new ProgressNotification(
            `Scanning Logseq Graph <span style="opacity: 0.8">[${this.graphName}]</span>:`,
            5,
            "graph",
            {silent: silentProgress}
        );

        let notes: Array<Note> = [];
        const [clozeNotes, swiftArrowNotes, imageOcclusionNotes, highlightMaskNotes] =
            await Promise.all([
                ClozeNote.getNotesFromLogseqBlocks().then((r) => {
                    scanNotification.increment();
                    return r;
                }),
                SwiftArrowNote.getNotesFromLogseqBlocks().then((r) => {
                    scanNotification.increment();
                    return r;
                }),
                ImageOcclusionNote.getNotesFromLogseqBlocks().then((r) => {
                    scanNotification.increment();
                    return r;
                }),
                HighlightMaskNote.getNotesFromLogseqBlocks().then((r) => {
                    scanNotification.increment();
                    return r;
                })
            ]);
        notes = [
            ...notes,
            ...clozeNotes,
            ...swiftArrowNotes,
            ...imageOcclusionNotes,
            ...highlightMaskNotes
        ];
        notes = [...notes, ...(await MultilineCardNote.getNotesFromLogseqBlocks(notes))];
        scanNotification.increment();

        return await sortAsync(notes, async (a) => {
            return (await LogseqProxy.Editor.getBlock(a.uuid))?.id ?? 0;
        });
    }

    private async persistLogseqBlockIds(notes: Note[]): Promise<void> {
        if ((await LogseqProxy.App.checkCurrentIsDbGraph()) === true) return; // DB graphs don't have reindex feature.

        // Need to persist id inside logseq blocks (which makeup notes) to prevent uuid from changing on re-index
        for (const note of notes) {
            if (!note.properties["id"]) {
                try {
                    await LogseqProxy.Editor.upsertBlockProperty(note.uuid, "id", note.uuid);
                } catch (e) {
                    logger.error("Failed to persist block ID", e);
                }
            }
        }
    }

    private async createSyncPlan(notes: Note[], ankiNoteManager: LazyAnkiNoteManager) {
        const toCreateNotesOriginal: Note[] = [];
        const toUpdateNotesOriginal: Note[] = [];
        const toDeleteNotesOriginal: number[] = [];
        const noteAnkiIds = new Set<number>();

        for (const note of notes) {
            const ankiId = note.getAnkiId();
            if (ankiId == null || Number.isNaN(ankiId)) toCreateNotesOriginal.push(note);
            else {
                toUpdateNotesOriginal.push(note);
                noteAnkiIds.add(ankiId);
            }
        }

        const ankiIds: Array<number> = [...ankiNoteManager.noteInfoMap.keys()];
        for (const ankiId of ankiIds) {
            if (!noteAnkiIds.has(ankiId)) {
                toDeleteNotesOriginal.push(ankiId);
            }
        }

        return {toCreateNotesOriginal, toUpdateNotesOriginal, toDeleteNotesOriginal};
    }

    private async getUserConfirmation(
        toCreateNotesOriginal: Note[],
        toUpdateNotesOriginal: Note[],
        toDeleteNotesOriginal: number[],
        notes: Note[]
    ): Promise<{toCreateNotes: Note[]; toUpdateNotes: Note[]; toDeleteNotes: number[]} | null> {
        let buildNoteHashes: CancelablePromise | null = null;
        setTimeout(() => {
            buildNoteHashes = new CancelablePromise(async (_resolve, _reject, _onCancel) => {
                await new Promise((resolve) => setTimeout(resolve, 10000));
                for (const note of notes) {
                    await NoteHashCalculator.getHash(note, ["", new Set([]), "", "", []]);
                    if (buildNoteHashes.isCanceled()) break;
                }
            });
        }, 1000);

        const noteSelection = await showSyncSelectionDialog(
            toCreateNotesOriginal,
            toUpdateNotesOriginal,
            toDeleteNotesOriginal
        );

        if (!noteSelection) {
            buildNoteHashes?.cancel();
            return null;
        }

        const {toCreateNotes, toUpdateNotes, toDeleteNotes} = noteSelection;
        logger.info("Sync plan created", {
            toCreate: toCreateNotes.length,
            toUpdate: toUpdateNotes.length,
            toDelete: toDeleteNotes.length
        });

        if (
            toCreateNotes.length === 0 &&
            toUpdateNotes.length === 0 &&
            toDeleteNotes.length >= 10
        ) {
            const confirm_msg = `<b class="text-red-600">This will delete all your notes in anki that are generated from this graph.</b><br/>Are you sure you want to continue?`;
            if (!(await showConfirmModal(confirm_msg))) {
                buildNoteHashes?.cancel();
                return null;
            }
        }

        buildNoteHashes?.cancel();
        return {toCreateNotes, toUpdateNotes, toDeleteNotes};
    }

    private getAutoSelection(
        toCreateNotes: Note[],
        toUpdateNotes: Note[]
    ): {toCreateNotes: Note[]; toUpdateNotes: Note[]; toDeleteNotes: number[]} {
        logger.info("Auto sync plan created", {
            toCreate: toCreateNotes.length,
            toUpdate: toUpdateNotes.length,
            toDelete: 0
        });

        return {toCreateNotes, toUpdateNotes, toDeleteNotes: []};
    }

    private async executeSyncPlan(
        toCreateNotes: Note[],
        toUpdateNotes: Note[],
        toDeleteNotes: number[],
        ankiNoteManager: LazyAnkiNoteManager,
        options: ExecuteSyncPlanOptions = {
            autoSync: false,
            silentProgress: false,
            skippedDelete: 0
        }
    ): Promise<SyncResult> {
        const failedCreated: {[key: string]: Error} = {};
        const failedUpdated: {[key: string]: Error} = {};
        const failedDeleted: {[key: string]: Error} = {};

        const start_time = performance.now();
        const twentyPercent = Math.ceil(
            (toCreateNotes.length + toUpdateNotes.length + toDeleteNotes.length) / 20
        );

        // Add 1 for suspend/unsuspend task if enabled
        const {syncOverwriteList} = LogseqProxy.Settings.getPluginSettings();
        const suspendTaskIncrement = syncOverwriteList?.includes("Suspended") ? 1 : 0;

        const syncNotificationObj = new ProgressNotification(
            "Syncing logseq notes to anki...",
            toCreateNotes.length +
                toUpdateNotes.length +
                toDeleteNotes.length +
                twentyPercent +
                1 +
                suspendTaskIncrement,
            "anki",
            {silent: options.silentProgress}
        );

        const createdNotes = await this.measureSyncPhase("create notes", () =>
            this.createNotes(toCreateNotes, failedCreated, ankiNoteManager, syncNotificationObj)
        );
        const updateResult = await this.measureSyncPhase("update notes", () =>
            this.updateNotes(toUpdateNotes, failedUpdated, ankiNoteManager, syncNotificationObj, {
                autoSync: options.autoSync,
                forceRegenerate: options.forceRegenerate
            })
        );
        const updatedNotes = updateResult.updated;
        const skippedUpdateNotes = updateResult.skipped;
        const deletedNotes = await this.measureSyncPhase("delete notes", () =>
            this.deleteNotes(toDeleteNotes, failedDeleted, ankiNoteManager, syncNotificationObj)
        );

        let suspended = 0;
        let unsuspended = 0;

        if (syncOverwriteList?.includes("Suspended")) {
            const suspendUnsuspendCandidates = options.autoSync
                ? [...createdNotes, ...updatedNotes]
                : [...toCreateNotes, ...toUpdateNotes];
            const suspendResult = await this.suspendUnsuspendNotes(
                suspendUnsuspendCandidates,
                ankiNoteManager,
                syncNotificationObj
            );
            suspended = suspendResult.suspended;
            unsuspended = suspendResult.unsuspended;
        }

        syncNotificationObj.updateMessage("Syncing logseq assets to anki...");
        const mediaUpdated = await this.measureSyncPhase("sync assets", () =>
            this.updateAssets(ankiNoteManager)
        );
        syncNotificationObj.increment(twentyPercent);

        const changed =
            createdNotes.length > 0 ||
            updatedNotes.length > 0 ||
            deletedNotes.length > 0 ||
            mediaUpdated > 0 ||
            suspended > 0 ||
            unsuspended > 0;

        if (changed) {
            await this.measureSyncPhase("reload Anki collection", () =>
                AnkiConnect.invoke("reloadCollection", {})
            );
        } else {
            logger.info("Skipping Anki collection reload because sync made no changes");
        }
        syncNotificationObj.increment();

        logger.info("Sync completed", {
            timeTaken: `${(performance.now() - start_time).toFixed(2)}ms`,
            created: createdNotes.length,
            updated: updatedNotes.length,
            deleted: deletedNotes.length,
            mediaUpdated,
            skippedUpdate: skippedUpdateNotes.length,
            skippedDelete: options.skippedDelete,
            changed
        });

        return {
            toCreateNotes: createdNotes,
            toUpdateNotes: updatedNotes,
            toDeleteNotes: deletedNotes,
            failedCreated,
            failedUpdated,
            failedDeleted,
            mediaUpdated,
            suspended,
            unsuspended,
            skippedUpdate: skippedUpdateNotes.length,
            skippedDelete: options.skippedDelete,
            changed,
            ankiWebSynced: false
        };
    }

    private async performPostSyncCleanup(toCreateNotes: Note[]): Promise<void> {
        if (toCreateNotes.some((note) => !note.properties["id"])) {
            try {
                //@ts-ignore
                await WindowParentBridge.getInternalLogseqAPI().api.force_save_graph();
                await new Promise((resolve) => setTimeout(resolve, 2000));
            } catch (_e) {}
        }
    }

    private async performAnkiWebSyncIfNeeded(
        syncResult: SyncResult,
        options: LogseqToAnkiSyncOptions
    ): Promise<void> {
        const shouldSyncAnkiWeb =
            options.mode === "auto" && options.triggerAnkiWebSync !== false && syncResult.changed;

        if (!shouldSyncAnkiWeb) return;

        try {
            await AnkiConnect.invoke("sync", {});
            syncResult.ankiWebSynced = true;
        } catch (e) {
            const errorMessage = e?.toString?.() ?? String(e);
            syncResult.ankiWebSyncError = errorMessage;
            logger.error("AnkiWeb sync failed", e);
            logseq.UI.showMsg(
                `Auto sync updated Anki, but AnkiWeb sync failed: ${errorMessage}`,
                "error",
                {
                    timeout: 8000
                }
            );
        }
    }

    private displayAutoResults(syncResult: SyncResult): void {
        const {
            toCreateNotes,
            toUpdateNotes,
            toDeleteNotes,
            failedCreated,
            failedUpdated,
            failedDeleted,
            mediaUpdated,
            suspended,
            unsuspended,
            skippedUpdate,
            ankiWebSynced,
            ankiWebSyncError
        } = syncResult;
        const hasFailures =
            Object.keys(failedCreated).length > 0 ||
            Object.keys(failedUpdated).length > 0 ||
            Object.keys(failedDeleted).length > 0 ||
            ankiWebSyncError != null;

        if (!syncResult.changed && !hasFailures) return;

        let summary = `Auto sync completed.`;
        if (syncResult.changed) {
            summary += `\nCreated: ${toCreateNotes.length}`;
            summary += `\nUpdated: ${toUpdateNotes.length}`;
            summary += `\nDeleted: ${toDeleteNotes.length}`;
            if (mediaUpdated > 0) summary += `\nMedia files: ${mediaUpdated}`;
            if (suspended > 0) summary += `\nSuspended cards: ${suspended}`;
            if (unsuspended > 0) summary += `\nUnsuspended cards: ${unsuspended}`;
            if (skippedUpdate > 0) summary += `\nSkipped unchanged: ${skippedUpdate}`;
            if (ankiWebSynced) summary += `\nAnkiWeb sync: completed`;
        }

        if (Object.keys(failedCreated).length > 0)
            summary += `\nFailed Created: ${Object.keys(failedCreated).length} `;
        if (Object.keys(failedUpdated).length > 0)
            summary += `\nFailed Updated: ${Object.keys(failedUpdated).length} `;
        if (Object.keys(failedDeleted).length > 0)
            summary += `\nFailed Deleted: ${Object.keys(failedDeleted).length} `;
        if (ankiWebSyncError) summary += `\nAnkiWeb sync failed.`;

        ActionNotification(
            [
                {
                    name: "View Details",
                    func: () => {
                        showSyncResultDialog(syncResult);
                    }
                }
            ],
            summary,
            8000,
            hasFailures
                ? `<span class="text-warning">${WARNING_ICON}</span>`
                : `<span class="text-success">${SUCCESS_ICON}</span>`
        );
    }

    private displayResults(syncResult: SyncResult): void {
        const {
            toCreateNotes,
            toUpdateNotes,
            toDeleteNotes,
            failedCreated,
            failedUpdated,
            failedDeleted,
            mediaUpdated,
            suspended,
            unsuspended,
            skippedUpdate,
            skippedDelete
        } = syncResult;

        let summery = `Sync Completed! \n Created Blocks: ${
            toCreateNotes.length
        } \n Updated Blocks: ${toUpdateNotes.length} \n Deleted Blocks: ${toDeleteNotes.length}`;

        if (mediaUpdated > 0) summery += `\nUpdated Media Files: ${mediaUpdated}`;
        if (suspended > 0) summery += `\nSuspended Cards: ${suspended}`;
        if (unsuspended > 0) summery += `\nUnsuspended Cards: ${unsuspended}`;
        if (skippedUpdate > 0) summery += `\nSkipped Unchanged Updates: ${skippedUpdate}`;
        if (skippedDelete > 0) summery += `\nSkipped Deletes: ${skippedDelete}`;

        if (Object.keys(failedCreated).length > 0)
            summery += `\nFailed Created: ${Object.keys(failedCreated).length} `;
        if (Object.keys(failedUpdated).length > 0)
            summery += `\nFailed Updated: ${Object.keys(failedUpdated).length} `;
        if (Object.keys(failedDeleted).length > 0)
            summery += `\nFailed Deleted: ${Object.keys(failedDeleted).length} `;

        logger.info("Sync summary", {
            created: toCreateNotes,
            updated: toUpdateNotes,
            deleted: toDeleteNotes
        });

        ActionNotification(
            [
                {
                    name: "View Details",
                    func: () => {
                        showSyncResultDialog(syncResult);
                    }
                }
            ],
            summery,
            12000,
            Object.keys(failedCreated).length > 0 ||
                Object.keys(failedUpdated).length > 0 ||
                Object.keys(failedDeleted).length > 0
                ? `<span class="text-warning">${WARNING_ICON}</span>`
                : `<span class="text-success">${SUCCESS_ICON}</span>`
        );

        logger.info(summery);
        if (Object.keys(failedCreated).length > 0) logger.error("Failed Created", failedCreated);
        if (Object.keys(failedUpdated).length > 0) logger.error("Failed Updated", failedUpdated);
        if (Object.keys(failedDeleted).length > 0) logger.error("Failed Deleted", failedDeleted);
    }

    private completeSyncCleanup(): void {
        WindowParentBridge.dispatchLogseqAnkiSyncEvent("syncLogseqToAnkiComplete");
        logger.info("Sync cleanup completed");
    }

    private async measureSyncPhase<T>(phase: string, task: () => Promise<T>): Promise<T> {
        const startTime = performance.now();
        try {
            const result = await task();
            logger.info("Sync phase completed", {
                phase,
                timeTaken: `${(performance.now() - startTime).toFixed(2)}ms`
            });
            return result;
        } catch (e) {
            logger.warn("Sync phase failed", {
                phase,
                timeTaken: `${(performance.now() - startTime).toFixed(2)}ms`
            });
            throw e;
        }
    }
}
