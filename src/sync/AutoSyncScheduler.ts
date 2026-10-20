import _ from "lodash";
import {createLogger, LoggerCategory} from "../logger";
import {LogseqProxy} from "../logseq/LogseqProxy";
import type {PluginSettings} from "../settings";
import {
    LogseqToAnkiSync,
    type LogseqToAnkiSyncOptions,
    type LogseqToAnkiSyncOutcome
} from "./syncLogseqToAnki";
import {
    classifyLogseqDBChange,
    isIgnorableLogseqSystemViewChange,
    mergeClassifiedDBChanges
} from "./targeted/LogseqDBChangeClassifier";
import {TargetedAutoSyncState} from "./targeted/TargetedAutoSyncState";
import {targetedSyncIndex} from "./targeted/TargetedSyncIndex";
import type {
    ClassifiedDBChange,
    TargetedChangeBatch,
    TargetedSyncDiagnostics
} from "./targeted/types";

const logger = createLogger(LoggerCategory.SyncMain);

const NON_RENDERING_SETTING_KEYS = new Set<keyof PluginSettings>([
    "ankiConnectPort",
    "autoSyncAnkiWebAfterChanges",
    "autoSyncEnabled",
    "autoSyncFullSyncRequired",
    "autoSyncFullSyncRequiredReason",
    "debug",
    "hideClozeMarcosUntilHoverInLogseq",
    "lastSyncDiagnostics",
    "lastTargetedAutoSyncDiagnostics",
    "lastWelcomeVersion",
    "renderClozeMarcosInLogseq"
]);

export type AutoSyncRunner = (options: LogseqToAnkiSyncOptions) => Promise<LogseqToAnkiSyncOutcome>;

const isStrictEventValidationEnabled = (): boolean =>
    import.meta.env.MODE === "test" || import.meta.env.DEV;

const changedRenderingSettingKeys = (
    newSettings: PluginSettings,
    oldSettings: PluginSettings
): string[] =>
    [...new Set([...Object.keys(newSettings), ...Object.keys(oldSettings)])]
        .filter((key) => !NON_RENDERING_SETTING_KEYS.has(key as keyof PluginSettings))
        .filter(
            (key) =>
                !_.isEqual(
                    newSettings[key as keyof PluginSettings],
                    oldSettings[key as keyof PluginSettings]
                )
        )
        .sort();

export class AutoSyncScheduler {
    static readonly MINIMUM_INTERVAL_SECONDS = 60;
    static readonly CHANGE_DEBOUNCE_SECONDS = 15;
    static readonly BUSY_RETRY_SECONDS = 1;

    private timerId: ReturnType<typeof setTimeout> | null = null;
    private enabled = false;
    private initializing = false;
    private initializationBlockingReason: string | null = null;
    private running = false;
    private disposed = false;
    private pendingChanges: ClassifiedDBChange[] = [];
    private lastChangeAtMs: number | null = null;
    private lastRunStartedAtMs: number | null = null;
    private triggerAnkiWebSync = true;

    constructor(
        private readonly syncRunner: AutoSyncRunner = (options) =>
            new LogseqToAnkiSync().sync(options)
    ) {}

    init(): void {
        const startupSettings = this.disableAutoSyncOnStartup(
            LogseqProxy.Settings.getPluginSettings()
        );
        this.applySettings(startupSettings);
        LogseqProxy.Settings.registerSettingsChangeListener((newSettings, oldSettings) => {
            const renderingChanges = changedRenderingSettingKeys(newSettings, oldSettings);
            if (renderingChanges.length > 0) {
                this.requireFullSync(
                    `Card-rendering settings changed: ${renderingChanges.join(", ")}.`
                );
            }
            if (this.didAutoSyncSettingsChange(newSettings, oldSettings)) {
                this.configureFromSettings(
                    newSettings.autoSyncEnabled === true && oldSettings.autoSyncEnabled !== true
                );
            }
        });
        LogseqProxy.DB.registerDBChangeListener((event) => this.queueDBChange(event));
        LogseqProxy.App.registerGraphChangeListener(() => {
            targetedSyncIndex.clear();
            this.pendingChanges = [];
            this.clearTimer();
            this.requireFullSync(
                this.initializing
                    ? "The active Logseq graph changed while Full Sync was initializing Auto Sync."
                    : "The active Logseq graph changed."
            );
        });
        LogseqProxy.App.registerPluginUnloadListener(() => this.dispose());
    }

    dispose(): void {
        this.disposed = true;
        this.pendingChanges = [];
        this.clearTimer();
    }

    private disableAutoSyncOnStartup(settings: PluginSettings): PluginSettings {
        if (settings.autoSyncEnabled !== true) return settings;

        LogseqProxy.Settings.updatePluginSettings({autoSyncEnabled: false});
        return {...settings, autoSyncEnabled: false};
    }

    private configureFromSettings(initializeOnEnable = false): void {
        const settings = LogseqProxy.Settings.getPluginSettings();
        this.triggerAnkiWebSync = settings.autoSyncAnkiWebAfterChanges !== false;
        this.clearTimer();

        if (settings.autoSyncEnabled !== true) {
            this.enabled = false;
            this.pendingChanges = [];
            this.lastChangeAtMs = null;
            return;
        }

        if (initializeOnEnable) {
            if (!this.initializing) void this.initializeAutoSync();
            return;
        }

        if (this.initializing) return;

        if (this.pendingChanges.length > 0) this.schedulePendingRun();
    }

    private async initializeAutoSync(): Promise<void> {
        this.initializing = true;
        this.initializationBlockingReason = null;
        this.enabled = false;
        this.running = true;
        this.pendingChanges = [];
        this.lastChangeAtMs = null;
        this.clearTimer();
        targetedSyncIndex.clear();

        void logseq.UI.showMsg("Running Full Sync before enabling targeted Auto Sync…", "success", {
            timeout: 5000
        });

        let outcome: LogseqToAnkiSyncOutcome;
        try {
            outcome = await this.syncRunner({
                mode: "manual",
                fullSyncSelection: "all",
                triggerAnkiWebSync: this.triggerAnkiWebSync
            });
        } catch (error) {
            outcome = {status: "failed", changed: false, error};
            logger.error("Full Sync failed while initializing targeted Auto Sync", error);
        }
        this.running = false;

        if (this.disposed) {
            this.initializing = false;
            return;
        }

        const settings = LogseqProxy.Settings.getPluginSettings();
        this.triggerAnkiWebSync = settings.autoSyncAnkiWebAfterChanges !== false;
        if (settings.autoSyncEnabled !== true) {
            this.disableAutoSyncAfterInitialization();
            return;
        }

        const failureReason = this.getInitializationFailureReason(outcome);
        if (failureReason != null) {
            if (this.initializationBlockingReason != null) {
                this.requireFullSync(this.initializationBlockingReason);
            }
            this.disableAutoSyncAfterInitialization();
            await logseq.UI.showMsg(`Auto Sync remains off: ${failureReason}`, "warning", {
                timeout: 10000
            });
            return;
        }

        this.enabled = true;
        this.initializing = false;
        this.initializationBlockingReason = null;
        await logseq.UI.showMsg(
            "Full Sync completed. Targeted Auto Sync is now enabled.",
            "success",
            {
                timeout: 5000
            }
        );
        if (this.pendingChanges.length > 0) this.schedulePendingRun();
    }

    private getInitializationFailureReason(outcome: LogseqToAnkiSyncOutcome): string | null {
        if (this.initializationBlockingReason != null) return this.initializationBlockingReason;

        if (outcome.status === "cancelled") return "Full Sync was cancelled.";
        if (outcome.status === "already-syncing") {
            return "another sync was already running. Turn Auto Sync on again after it finishes.";
        }
        if (outcome.status === "skipped") return "Full Sync was skipped.";
        if (outcome.status === "failed") return "Full Sync failed.";

        if (targetedSyncIndex.getGraphName() == null) {
            const fullSyncRequiredReason = TargetedAutoSyncState.getFullSyncRequiredReason();
            if (TargetedAutoSyncState.isFullSyncRequired()) {
                return (
                    fullSyncRequiredReason || "Full Sync did not finish a complete reconciliation."
                );
            }
            return "Full Sync did not build the targeted dependency index.";
        }
        return null;
    }

    private disableAutoSyncAfterInitialization(): void {
        this.enabled = false;
        this.initializing = false;
        this.pendingChanges = [];
        this.lastChangeAtMs = null;
        this.clearTimer();
        if (LogseqProxy.Settings.getPluginSettings().autoSyncEnabled === true) {
            LogseqProxy.Settings.updatePluginSettings({autoSyncEnabled: false});
        }
    }

    private applySettings(settings: PluginSettings): void {
        this.enabled = settings.autoSyncEnabled === true;
        this.triggerAnkiWebSync = settings.autoSyncAnkiWebAfterChanges !== false;
    }

    private didAutoSyncSettingsChange(
        newSettings: PluginSettings,
        oldSettings: PluginSettings
    ): boolean {
        return (
            newSettings.autoSyncEnabled !== oldSettings.autoSyncEnabled ||
            newSettings.autoSyncAnkiWebAfterChanges !== oldSettings.autoSyncAnkiWebAfterChanges
        );
    }

    private queueDBChange(event: unknown): void {
        if (this.disposed || (!this.enabled && !this.initializing)) return;
        if (isIgnorableLogseqSystemViewChange(event)) {
            logger.info("Ignoring Logseq hidden system-view metadata change");
            return;
        }
        if (!this.initializing && TargetedAutoSyncState.isFullSyncRequired()) {
            logger.warn("Targeted auto-sync ignored because Full Sync is already required", {
                reason: TargetedAutoSyncState.getFullSyncRequiredReason()
            });
            return;
        }

        const change = classifyLogseqDBChange(event, {
            strict: isStrictEventValidationEnabled()
        });
        if (change.classification !== "targeted") {
            this.pendingChanges = [];
            this.clearTimer();
            this.requireFullSync(change.reason, this.toBatch(change));
            return;
        }

        this.pendingChanges.push(change);
        this.lastChangeAtMs = Date.now();

        if (this.running || this.initializing) return;

        this.clearTimer();
        this.schedulePendingRun();
    }

    private schedulePendingRun(): void {
        if (
            this.disposed ||
            !this.enabled ||
            this.pendingChanges.length === 0 ||
            this.running ||
            this.timerId != null
        ) {
            return;
        }

        const now = Date.now();
        const quietPeriodEndsAt =
            (this.lastChangeAtMs ?? now) + AutoSyncScheduler.CHANGE_DEBOUNCE_SECONDS * 1000;
        const minimumIntervalEndsAt =
            this.lastRunStartedAtMs == null
                ? now
                : this.lastRunStartedAtMs + AutoSyncScheduler.MINIMUM_INTERVAL_SECONDS * 1000;
        const delayMs = Math.max(0, quietPeriodEndsAt - now, minimumIntervalEndsAt - now);

        this.timerId = setTimeout(() => {
            this.timerId = null;
            void this.runOnce();
        }, delayMs);
    }

    private scheduleBusyRetry(): void {
        if (
            this.disposed ||
            !this.enabled ||
            this.pendingChanges.length === 0 ||
            this.timerId != null
        ) {
            return;
        }

        this.timerId = setTimeout(() => {
            this.timerId = null;
            void this.runOnce();
        }, AutoSyncScheduler.BUSY_RETRY_SECONDS * 1000);
    }

    private clearTimer(): void {
        if (this.timerId == null) return;
        clearTimeout(this.timerId);
        this.timerId = null;
    }

    private async runOnce(): Promise<void> {
        if (this.disposed || !this.enabled || this.pendingChanges.length === 0) return;
        if (this.running || LogseqToAnkiSync.isSyncing) {
            logger.info("Targeted auto-sync deferred because a sync is already running");
            this.scheduleBusyRetry();
            return;
        }

        const targetedChanges = mergeClassifiedDBChanges(this.pendingChanges);
        this.pendingChanges = [];
        this.running = true;
        this.lastRunStartedAtMs = Date.now();
        try {
            await this.syncRunner({
                mode: "auto",
                triggerAnkiWebSync: this.triggerAnkiWebSync,
                targetedChanges
            });
        } finally {
            this.running = false;
            this.applySettings(LogseqProxy.Settings.getPluginSettings());
            if (this.enabled && this.pendingChanges.length > 0) {
                this.schedulePendingRun();
            }
        }
    }

    private toBatch(change: ClassifiedDBChange): TargetedChangeBatch {
        return {...change, eventCount: 1};
    }

    private requireFullSync(reason: string, batch?: TargetedChangeBatch): void {
        if (!this.enabled && !this.initializing) return;
        if (this.initializing) this.initializationBlockingReason = reason;
        TargetedAutoSyncState.markFullSyncRequired(reason);
        const diagnosticBatch: TargetedChangeBatch = batch ?? {
            classification: "unsupported",
            reason,
            blocks: [],
            deletedBlockUuids: [],
            txAttributes: [],
            outlinerOps: [],
            changedEntities: [],
            eventCount: 0
        };

        const now = new Date().toISOString();
        const diagnostics: TargetedSyncDiagnostics = {
            schemaVersion: 1,
            classification: diagnosticBatch.classification,
            reason,
            changedEntities: diagnosticBatch.changedEntities,
            deletedBlockUuids: diagnosticBatch.deletedBlockUuids,
            txAttributes: diagnosticBatch.txAttributes,
            outlinerOps: diagnosticBatch.outlinerOps,
            eventCount: diagnosticBatch.eventCount,
            affectedCardCount: 0,
            startedAt: now,
            completedAt: now,
            durationMs: 0,
            fullSyncRequired: true
        };
        TargetedAutoSyncState.recordDiagnostics(diagnostics);
    }
}
