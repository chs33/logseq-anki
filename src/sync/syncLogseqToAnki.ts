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
import {
    getReadableAnkiErrorMessage,
    handleAnkiError,
    isAnkiConnectUnavailableError,
    sortAsync
} from "../utils/utils";
import {NoteHashCalculator} from "./cache";
import {TargetedAutoSyncState} from "./targeted/TargetedAutoSyncState";
import {buildTargetedNoteRecords, targetedSyncIndex} from "./targeted/TargetedSyncIndex";
import {resolveTargetedChanges} from "./targeted/TargetedSyncResolver";
import type {
    TargetedChangeBatch,
    TargetedResolution,
    TargetedSyncDiagnostics
} from "./targeted/types";
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
    targetedChanges?: TargetedChangeBatch;
    fullSyncSelection?: "interactive" | "all";
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

interface SyncPhaseTiming {
    phase: string;
    startedAt: string;
    durationMs: number;
    status: "completed" | "failed";
}

interface TargetedSyncPlan {
    toCreateNotes: Note[];
    toUpdateNotes: Note[];
    toDeleteNotes: number[];
    skippedDelete: number;
    ambiguousReason?: string;
}

export class LogseqToAnkiSync {
    static isSyncing: boolean;
    graphName: string;
    logseqLinkGraphName: string;
    modelName: string;
    private syncPhaseTimings: SyncPhaseTiming[] = [];
    private collectedNoteCount = 0;

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
            if (syncOptions.mode === "manual") {
                await logseq.UI.showMsg(
                    "A Logseq to Anki sync is already in progress.",
                    "warning",
                    {
                        timeout: 4000
                    }
                );
            }
            return {status: "already-syncing", changed: false};
        }
        LogseqToAnkiSync.isSyncing = true;
        try {
            if (syncOptions.mode === "manual") {
                await logseq.UI.showMsg(
                    "Logseq to Anki sync started. Preparing graph scan…",
                    "success",
                    {
                        timeout: 2500
                    }
                );
            }
            return await this.performSync(syncOptions);
        } catch (e) {
            const errorMessage = e?.toString?.() ?? String(e);
            if (syncOptions.mode === "auto") {
                if (syncOptions.targetedChanges) {
                    this.recordTargetedFailure(syncOptions.targetedChanges, errorMessage);
                }
                const readableErrorMessage = getReadableAnkiErrorMessage(errorMessage, {
                    ankiConnectUrl: AnkiConnect.getAnkiConnectUrl()
                });
                const ankiConnectUnavailable = isAnkiConnectUnavailableError(errorMessage);
                logseq.UI.showMsg(
                    `Auto sync ${ankiConnectUnavailable ? "skipped" : "failed"}: ${readableErrorMessage}`,
                    ankiConnectUnavailable ? "warning" : "error",
                    {
                        timeout: 8000
                    }
                );
                logseq.provideUI({
                    key: `logseq-anki-sync-progress-notification-${logseq.baseInfo.id}`,
                    template: ``
                });
                if (ankiConnectUnavailable) {
                    logger.warn("Auto sync skipped because AnkiConnect is unavailable", e);
                    return {status: "skipped", changed: false};
                }
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
        if (options.mode === "auto") {
            if (!options.targetedChanges) {
                const reason = "Auto Sync was invoked without a classified Logseq DB change.";
                TargetedAutoSyncState.markFullSyncRequired(reason);
                return {status: "skipped", changed: false};
            }
            return await this.performTargetedSync(options, options.targetedChanges);
        }

        const syncStartedAtMs = Date.now();
        const syncStartedAt = new Date(syncStartedAtMs).toISOString();
        this.syncPhaseTimings = [];
        this.collectedNoteCount = 0;
        const isAutoSync = false;
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
        this.collectedNoteCount = notes.length;
        await this.measureSyncPhase("persist Logseq block IDs", () =>
            this.persistLogseqBlockIds(notes)
        );

        const syncPlan = await this.measureSyncPhase("create sync plan", () =>
            this.createSyncPlan(notes, ankiNoteManager)
        );
        const {toCreateNotesOriginal, toUpdateNotesOriginal, toDeleteNotesOriginal} = syncPlan;

        const confirmation = await this.measureSyncPhase("select sync changes", async () =>
            options.fullSyncSelection === "all"
                ? this.selectAllSyncChanges(
                      toCreateNotesOriginal,
                      toUpdateNotesOriginal,
                      toDeleteNotesOriginal
                  )
                : await this.getUserConfirmation(
                      toCreateNotesOriginal,
                      toUpdateNotesOriginal,
                      toDeleteNotesOriginal,
                      notes
                  )
        );

        if (!confirmation) return {status: "cancelled", changed: false};

        const {toCreateNotes, toUpdateNotes, toDeleteNotes} = confirmation;
        const syncResult = await this.measureSyncPhase("execute sync plan", () =>
            this.executeSyncPlan(toCreateNotes, toUpdateNotes, toDeleteNotes, ankiNoteManager, {
                autoSync: isAutoSync,
                silentProgress: isAutoSync,
                skippedDelete: 0,
                ...(options.forceRegenerate === true ? {forceRegenerate: true} : {})
            })
        );

        await this.measureSyncPhase("post-sync cleanup", () =>
            this.performPostSyncCleanup(syncResult.toCreateNotes)
        );
        await this.measureSyncPhase("AnkiWeb sync", () =>
            this.performAnkiWebSyncIfNeeded(syncResult, options)
        );

        const hasFailures = this.hasSyncFailures(syncResult);
        const completedFullSelection =
            toCreateNotes.length === toCreateNotesOriginal.length &&
            toUpdateNotes.length === toUpdateNotesOriginal.length &&
            toDeleteNotes.length === toDeleteNotesOriginal.length;
        if (!hasFailures && completedFullSelection) {
            try {
                const targetedRecords = await this.measureSyncPhase(
                    "build targeted auto-sync index",
                    () => buildTargetedNoteRecords(notes)
                );
                targetedSyncIndex.replaceAll(
                    this.graphName,
                    targetedRecords.records,
                    targetedRecords.snapshots
                );
                TargetedAutoSyncState.clearAfterSuccessfulFullSync();
            } catch (error) {
                const reason = `Full Sync completed, but its targeted dependency index could not be built: ${
                    error instanceof Error ? error.message : String(error)
                }`;
                logger.error(reason, error);
                TargetedAutoSyncState.markFullSyncRequired(reason);
            }
        } else if (hasFailures) {
            TargetedAutoSyncState.markFullSyncRequired(
                "Full Sync completed with failed Anki operations. Resolve them and run Full Sync again."
            );
        } else {
            TargetedAutoSyncState.markFullSyncRequired(
                "Full Sync did not reconcile every discovered change because some changes were deselected."
            );
        }
        this.attachSyncTiming(syncResult, options.mode, syncStartedAtMs, syncStartedAt);
        this.persistSyncDiagnostics(syncResult);

        WindowParentBridge.dispatchLogseqAnkiSyncEvent("syncLogseqToAnkiComplete");
        WindowParentBridge.setGlobalObject("lastSyncLogseqToAnkiResult", syncResult);
        if (syncResult.changed) {
            WindowParentBridge.setGlobalObject("lastChangedSyncLogseqToAnkiResult", syncResult);
        }
        if (isAutoSync) {
            this.displayAutoResults(syncResult);
        } else {
            this.displayResults(syncResult);
        }

        return {status: "completed", changed: syncResult.changed, result: syncResult};
    }

    private async performTargetedSync(
        options: Required<Pick<LogseqToAnkiSyncOptions, "mode">> & LogseqToAnkiSyncOptions,
        changes: TargetedChangeBatch
    ): Promise<LogseqToAnkiSyncOutcome> {
        const syncStartedAtMs = Date.now();
        const syncStartedAt = new Date(syncStartedAtMs).toISOString();
        this.syncPhaseTimings = [];
        this.collectedNoteCount = 0;
        this.graphName = await this.getGraphName();
        this.logseqLinkGraphName = await this.getLogseqLinkGraphName();
        this.modelName = this.getModelName();

        if (TargetedAutoSyncState.isFullSyncRequired()) {
            return this.skipTargetedSync(
                changes,
                TargetedAutoSyncState.getFullSyncRequiredReason() ||
                    "A previous change requires Full Sync.",
                syncStartedAtMs,
                syncStartedAt
            );
        }
        if (!targetedSyncIndex.isReadyForGraph(this.graphName)) {
            return this.skipTargetedSync(
                changes,
                "The targeted dependency index is unavailable for this graph. Run Full Sync once.",
                syncStartedAtMs,
                syncStartedAt
            );
        }

        logger.success(
            `Starting targeted Logseq to Anki Auto Sync V${pkg.version} for graph ${this.graphName}`
        );
        const resolution = await this.measureSyncPhase("resolve targeted changes", () =>
            resolveTargetedChanges(changes, targetedSyncIndex)
        );
        if (resolution.classification !== "targeted") {
            return this.skipTargetedSync(
                changes,
                resolution.reason,
                syncStartedAtMs,
                syncStartedAt,
                resolution.affectedIdentities.size
            );
        }

        await this.measureSyncPhase("setup Anki model", () => this.setupAnkiModel());
        const ankiNoteManager = await this.measureSyncPhase("initialize Anki cache", () =>
            this.initializeAnkiNoteManager()
        );
        const notes = await this.measureSyncPhase("collect targeted Logseq notes", () =>
            this.collectTargetedNotes(resolution.candidateRootUuids)
        );
        this.collectedNoteCount = notes.length;
        await this.measureSyncPhase("persist targeted Logseq block IDs", () =>
            this.persistLogseqBlockIds(notes)
        );

        const plan = await this.measureSyncPhase("create targeted sync plan", () =>
            this.createTargetedSyncPlan(notes, resolution, ankiNoteManager)
        );
        const affectedCardCount =
            plan.toCreateNotes.length + plan.toUpdateNotes.length + plan.toDeleteNotes.length;
        if (plan.ambiguousReason) {
            return this.skipTargetedSync(
                changes,
                plan.ambiguousReason,
                syncStartedAtMs,
                syncStartedAt,
                affectedCardCount
            );
        }

        const syncResult = await this.measureSyncPhase("execute targeted sync plan", () =>
            this.executeSyncPlan(
                plan.toCreateNotes,
                plan.toUpdateNotes,
                plan.toDeleteNotes,
                ankiNoteManager,
                {
                    autoSync: true,
                    silentProgress: true,
                    skippedDelete: plan.skippedDelete
                }
            )
        );
        await this.measureSyncPhase("post-sync cleanup", () =>
            this.performPostSyncCleanup(syncResult.toCreateNotes)
        );
        await this.measureSyncPhase("AnkiWeb sync", () =>
            this.performAnkiWebSyncIfNeeded(syncResult, options)
        );

        if (this.hasSyncFailures(syncResult)) {
            return this.finishFailedTargetedSync(
                changes,
                syncResult,
                "Targeted Auto Sync completed with failed Anki operations.",
                syncStartedAtMs,
                syncStartedAt,
                affectedCardCount
            );
        }

        const targetedRecords = await this.measureSyncPhase(
            "refresh targeted dependency index",
            () => buildTargetedNoteRecords(notes)
        );
        targetedSyncIndex.replaceRoots(
            resolution.candidateRootUuids,
            targetedRecords.records,
            targetedRecords.snapshots
        );

        this.attachSyncTiming(syncResult, "auto", syncStartedAtMs, syncStartedAt);
        this.persistSyncDiagnostics(syncResult);
        this.recordTargetedDiagnostics(
            changes,
            "targeted",
            resolution.reason,
            affectedCardCount,
            syncStartedAtMs,
            syncStartedAt,
            false
        );
        WindowParentBridge.dispatchLogseqAnkiSyncEvent("syncLogseqToAnkiComplete");
        WindowParentBridge.setGlobalObject("lastSyncLogseqToAnkiResult", syncResult);
        if (syncResult.changed) {
            WindowParentBridge.setGlobalObject("lastChangedSyncLogseqToAnkiResult", syncResult);
        }
        this.displayAutoResults(syncResult);
        return {status: "completed", changed: syncResult.changed, result: syncResult};
    }

    private async collectTargetedNotes(candidateRootUuids: ReadonlySet<string>): Promise<Note[]> {
        if (candidateRootUuids.size === 0) return [];

        const [clozeNotes, swiftArrowNotes, imageOcclusionNotes, highlightMaskNotes] =
            await Promise.all([
                ClozeNote.getNotesFromLogseqBlocks(candidateRootUuids),
                SwiftArrowNote.getNotesFromLogseqBlocks(candidateRootUuids),
                ImageOcclusionNote.getNotesFromLogseqBlocks(candidateRootUuids),
                HighlightMaskNote.getNotesFromLogseqBlocks(candidateRootUuids)
            ]);
        const nonMultilineNotes: Note[] = [
            ...clozeNotes,
            ...swiftArrowNotes,
            ...imageOcclusionNotes,
            ...highlightMaskNotes
        ];
        const multilineNotes = await MultilineCardNote.getNotesFromLogseqBlocks(
            nonMultilineNotes,
            candidateRootUuids
        );
        return [...nonMultilineNotes, ...multilineNotes];
    }

    private async createTargetedSyncPlan(
        notes: Note[],
        resolution: TargetedResolution,
        ankiNoteManager: LazyAnkiNoteManager
    ): Promise<TargetedSyncPlan> {
        const toCreateNotes: Note[] = [];
        const toUpdateNotes: Note[] = [];
        const toDeleteNotes: number[] = [];
        let skippedDelete = 0;
        const currentIdentities = new Set<string>();

        for (const note of notes) {
            const identity = `${note.uuid.toLowerCase()}-${note.type}`;
            currentIdentities.add(identity);
            const ankiId = note.getAnkiId();
            if (ankiId == null || Number.isNaN(ankiId)) toCreateNotes.push(note);
            else toUpdateNotes.push(note);
        }

        const priorRecords = new Map(
            [...resolution.affectedIdentities]
                .map((identity) => targetedSyncIndex.getRecord(identity))
                .filter((record) => record != null)
                .map((record) => [record.identity, record])
        );
        for (const deletedRootUuid of resolution.explicitlyDeletedRootUuids) {
            for (const record of targetedSyncIndex.getRecordsForRoot(deletedRootUuid)) {
                priorRecords.set(record.identity, record);
            }
        }

        for (const record of priorRecords.values()) {
            if (currentIdentities.has(record.identity)) continue;

            const deletionWasExplicit = resolution.explicitlyDeletedRootUuids.has(record.rootUuid);
            const rootStillExists = deletionWasExplicit
                ? false
                : (await LogseqProxy.Editor.getBlock(record.rootUuid)) != null;
            if (!deletionWasExplicit && !rootStillExists) {
                return {
                    toCreateNotes: [],
                    toUpdateNotes: [],
                    toDeleteNotes: [],
                    skippedDelete,
                    ambiguousReason: `Card ${record.identity} disappeared without a stable deletion identity.`
                };
            }

            const ankiId = ankiNoteManager.getAnkiIdByUuidType(record.identity);
            if (ankiId == null || Number.isNaN(ankiId)) skippedDelete += 1;
            else toDeleteNotes.push(ankiId);
        }

        return {toCreateNotes, toUpdateNotes, toDeleteNotes, skippedDelete};
    }

    private hasSyncFailures(syncResult: SyncResult): boolean {
        return (
            Object.keys(syncResult.failedCreated).length > 0 ||
            Object.keys(syncResult.failedUpdated).length > 0 ||
            Object.keys(syncResult.failedDeleted).length > 0
        );
    }

    private skipTargetedSync(
        changes: TargetedChangeBatch,
        reason: string,
        startedAtMs: number,
        startedAt: string,
        affectedCardCount = 0
    ): LogseqToAnkiSyncOutcome {
        TargetedAutoSyncState.markFullSyncRequired(reason);
        this.recordTargetedDiagnostics(
            changes,
            changes.classification === "targeted" ? "ambiguous" : changes.classification,
            reason,
            affectedCardCount,
            startedAtMs,
            startedAt,
            true
        );
        return {status: "skipped", changed: false};
    }

    private finishFailedTargetedSync(
        changes: TargetedChangeBatch,
        syncResult: SyncResult,
        reason: string,
        startedAtMs: number,
        startedAt: string,
        affectedCardCount: number
    ): LogseqToAnkiSyncOutcome {
        TargetedAutoSyncState.markFullSyncRequired(reason);
        this.attachSyncTiming(syncResult, "auto", startedAtMs, startedAt);
        this.persistSyncDiagnostics(syncResult);
        this.recordTargetedDiagnostics(
            changes,
            "ambiguous",
            reason,
            affectedCardCount,
            startedAtMs,
            startedAt,
            true
        );
        this.displayAutoResults(syncResult);
        return {status: "failed", changed: syncResult.changed, result: syncResult};
    }

    private recordTargetedFailure(changes: TargetedChangeBatch, reason: string): void {
        const nowMs = Date.now();
        const now = new Date(nowMs).toISOString();
        TargetedAutoSyncState.markFullSyncRequired(reason);
        this.recordTargetedDiagnostics(changes, "ambiguous", reason, 0, nowMs, now, true);
    }

    private recordTargetedDiagnostics(
        changes: TargetedChangeBatch,
        classification: TargetedSyncDiagnostics["classification"],
        reason: string,
        affectedCardCount: number,
        startedAtMs: number,
        startedAt: string,
        fullSyncRequired: boolean
    ): void {
        const completedAtMs = Date.now();
        TargetedAutoSyncState.recordDiagnostics({
            schemaVersion: 1,
            classification,
            reason,
            changedEntities: changes.changedEntities,
            deletedBlockUuids: changes.deletedBlockUuids,
            txAttributes: changes.txAttributes,
            outlinerOps: changes.outlinerOps,
            eventCount: changes.eventCount,
            affectedCardCount,
            startedAt,
            completedAt: new Date(completedAtMs).toISOString(),
            durationMs: completedAtMs - startedAtMs,
            fullSyncRequired
        });
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

    private persistSyncDiagnostics(syncResult: SyncResult): void {
        const settings = LogseqProxy.Settings.getPluginSettings();
        if (!settings.debug?.includes(LoggerCategory.SyncMain)) return;

        try {
            LogseqProxy.Settings.updatePluginSettings({
                lastSyncDiagnostics: JSON.stringify({
                    schemaVersion: 1,
                    pluginVersion: pkg.version,
                    graphName: this.graphName,
                    mode: syncResult.mode,
                    startedAt: syncResult.startedAt,
                    completedAt: syncResult.completedAt,
                    durationMs: syncResult.durationMs,
                    collectedNoteCount: this.collectedNoteCount,
                    resultCounts: {
                        created: syncResult.toCreateNotes.length,
                        updated: syncResult.toUpdateNotes.length,
                        deleted: syncResult.toDeleteNotes.length,
                        skippedUpdate: syncResult.skippedUpdate,
                        skippedDelete: syncResult.skippedDelete,
                        mediaUpdated: syncResult.mediaUpdated
                    },
                    phases: this.syncPhaseTimings
                })
            });
        } catch (error) {
            logger.warn("Failed to persist sync diagnostics", error);
        }
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
            6,
            "graph",
            {silent: silentProgress}
        );

        let completedInitialScans = 0;
        const collectNoteType = async <T extends Note>(
            noteType: string,
            collect: () => Promise<T[]>
        ): Promise<T[]> => {
            const collectedNotes = await this.measureSyncPhase(`scan ${noteType} notes`, collect);
            completedInitialScans += 1;
            scanNotification.increment();
            scanNotification.updateMessage(
                `Scanning ${this.graphName}: ${completedInitialScans}/4 note types found (${collectedNotes.length} ${noteType})`
            );
            if (completedInitialScans < 4) scanNotification.setIndeterminate();
            return collectedNotes;
        };

        let notes: Array<Note> = [];
        const [clozeNotes, swiftArrowNotes, imageOcclusionNotes, highlightMaskNotes] =
            await Promise.all([
                collectNoteType("cloze", () => ClozeNote.getNotesFromLogseqBlocks()),
                collectNoteType("swift-arrow", () => SwiftArrowNote.getNotesFromLogseqBlocks()),
                collectNoteType("image-occlusion", () =>
                    ImageOcclusionNote.getNotesFromLogseqBlocks()
                ),
                collectNoteType("highlight-mask", () =>
                    HighlightMaskNote.getNotesFromLogseqBlocks()
                )
            ]);
        notes = [
            ...notes,
            ...clozeNotes,
            ...swiftArrowNotes,
            ...imageOcclusionNotes,
            ...highlightMaskNotes
        ];
        scanNotification.updateMessage(`Scanning ${this.graphName}: loading multiline card trees`);
        scanNotification.setIndeterminate();
        const multilineNotes = await this.measureSyncPhase("scan multiline notes", () =>
            MultilineCardNote.getNotesFromLogseqBlocks(notes)
        );
        notes = [...notes, ...multilineNotes];
        scanNotification.increment();

        scanNotification.updateMessage(
            `Scanning ${this.graphName}: ordering ${notes.length} notes`
        );
        scanNotification.setIndeterminate();
        const sortedNotes = await this.measureSyncPhase("sort collected notes", () =>
            sortAsync(notes, async (a) => {
                return (await LogseqProxy.Editor.getBlock(a.uuid))?.id ?? 0;
            })
        );
        scanNotification.increment();
        return sortedNotes;
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

    private selectAllSyncChanges(
        toCreateNotes: Note[],
        toUpdateNotes: Note[],
        toDeleteNotes: number[]
    ): {toCreateNotes: Note[]; toUpdateNotes: Note[]; toDeleteNotes: number[]} {
        logger.info("Full Sync plan accepted without interactive selection", {
            toCreate: toCreateNotes.length,
            toUpdate: toUpdateNotes.length,
            toDelete: toDeleteNotes.length
        });

        return {toCreateNotes, toUpdateNotes, toDeleteNotes};
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
        const startedAt = new Date().toISOString();
        try {
            const result = await task();
            const durationMs = Math.round((performance.now() - startTime) * 100) / 100;
            this.syncPhaseTimings.push({phase, startedAt, durationMs, status: "completed"});
            logger.info("Sync phase completed", {
                phase,
                timeTaken: `${durationMs.toFixed(2)}ms`
            });
            return result;
        } catch (e) {
            const durationMs = Math.round((performance.now() - startTime) * 100) / 100;
            this.syncPhaseTimings.push({phase, startedAt, durationMs, status: "failed"});
            logger.warn("Sync phase failed", {
                phase,
                timeTaken: `${durationMs.toFixed(2)}ms`
            });
            throw e;
        }
    }
}
