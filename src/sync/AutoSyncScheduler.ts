import {createLogger, LoggerCategory} from "../logger";
import {LogseqProxy} from "../logseq/LogseqProxy";
import type {PluginSettings} from "../settings";
import {
    LogseqToAnkiSync,
    type LogseqToAnkiSyncOptions,
    type LogseqToAnkiSyncOutcome
} from "./syncLogseqToAnki";

const logger = createLogger(LoggerCategory.SyncMain);

export type AutoSyncRunner = (options: LogseqToAnkiSyncOptions) => Promise<LogseqToAnkiSyncOutcome>;

export class AutoSyncScheduler {
    static readonly DEFAULT_INTERVAL_SECONDS = 60;
    static readonly MIN_INTERVAL_SECONDS = 60;

    private timerId: ReturnType<typeof setTimeout> | null = null;
    private enabled = false;
    private running = false;
    private disposed = false;
    private intervalMs = AutoSyncScheduler.DEFAULT_INTERVAL_SECONDS * 1000;
    private triggerAnkiWebSync = true;

    constructor(
        private readonly syncRunner: AutoSyncRunner = (options) =>
            new LogseqToAnkiSync().sync(options)
    ) {}

    init(): void {
        this.applySettings(LogseqProxy.Settings.getPluginSettings());
        LogseqProxy.Settings.registerSettingsChangeListener((newSettings, oldSettings) => {
            if (this.didAutoSyncSettingsChange(newSettings, oldSettings)) {
                this.configureFromSettings();
            }
        });
        LogseqProxy.App.registerPluginUnloadListener(() => this.dispose());
        this.scheduleNext();
    }

    dispose(): void {
        this.disposed = true;
        this.clearTimer();
    }

    static getEffectiveIntervalSeconds(intervalSeconds?: number): number {
        if (typeof intervalSeconds !== "number" || !Number.isFinite(intervalSeconds)) {
            return AutoSyncScheduler.DEFAULT_INTERVAL_SECONDS;
        }

        return Math.max(AutoSyncScheduler.MIN_INTERVAL_SECONDS, Math.floor(intervalSeconds));
    }

    private configureFromSettings(): void {
        this.applySettings(LogseqProxy.Settings.getPluginSettings());
        this.clearTimer();
        this.scheduleNext();
    }

    private applySettings(settings: PluginSettings): void {
        this.enabled = settings.autoSyncEnabled === true;
        this.intervalMs =
            AutoSyncScheduler.getEffectiveIntervalSeconds(settings.autoSyncIntervalSeconds) * 1000;
        this.triggerAnkiWebSync = settings.autoSyncAnkiWebAfterChanges !== false;
    }

    private didAutoSyncSettingsChange(
        newSettings: PluginSettings,
        oldSettings: PluginSettings
    ): boolean {
        return (
            newSettings.autoSyncEnabled !== oldSettings.autoSyncEnabled ||
            newSettings.autoSyncIntervalSeconds !== oldSettings.autoSyncIntervalSeconds ||
            newSettings.autoSyncAnkiWebAfterChanges !== oldSettings.autoSyncAnkiWebAfterChanges
        );
    }

    private scheduleNext(): void {
        if (this.disposed || !this.enabled || this.running || this.timerId != null) {
            return;
        }

        this.timerId = setTimeout(() => {
            this.timerId = null;
            void this.runOnce();
        }, this.intervalMs);
    }

    private clearTimer(): void {
        if (this.timerId == null) return;
        clearTimeout(this.timerId);
        this.timerId = null;
    }

    private async runOnce(): Promise<void> {
        if (this.disposed || !this.enabled) return;
        if (this.running || LogseqToAnkiSync.isSyncing) {
            logger.info("Auto sync skipped because a sync is already running");
            this.scheduleNext();
            return;
        }

        this.running = true;
        try {
            await this.syncRunner({
                mode: "auto",
                triggerAnkiWebSync: this.triggerAnkiWebSync
            });
        } finally {
            this.running = false;
            this.applySettings(LogseqProxy.Settings.getPluginSettings());
            this.scheduleNext();
        }
    }
}
