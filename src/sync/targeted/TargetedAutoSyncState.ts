import {createLogger, LoggerCategory} from "../../logger";
import {LogseqProxy} from "../../logseq/LogseqProxy";
import type {TargetedSyncDiagnostics} from "./types";

const logger = createLogger(LoggerCategory.SyncMain);

export class TargetedAutoSyncState {
    private static lastDisplayedReason: string | null = null;

    static isFullSyncRequired(): boolean {
        return LogseqProxy.Settings.getPluginSettings().autoSyncFullSyncRequired === true;
    }

    static getFullSyncRequiredReason(): string | null {
        return (
            LogseqProxy.Settings.getPluginSettings().autoSyncFullSyncRequiredReason?.trim() || null
        );
    }

    static markFullSyncRequired(reason: string): void {
        const normalizedReason = reason.trim() || "Targeted auto-sync cannot classify the change.";
        LogseqProxy.Settings.updatePluginSettings({
            autoSyncFullSyncRequired: true,
            autoSyncFullSyncRequiredReason: normalizedReason
        });
        logger.warn("Targeted auto-sync requires Full Sync", {reason: normalizedReason});

        if (TargetedAutoSyncState.lastDisplayedReason !== normalizedReason) {
            TargetedAutoSyncState.lastDisplayedReason = normalizedReason;
            void logseq.UI.showMsg(`Full sync required: ${normalizedReason}`, "warning", {
                timeout: 10000
            });
        }
    }

    static clearAfterSuccessfulFullSync(): void {
        TargetedAutoSyncState.lastDisplayedReason = null;
        LogseqProxy.Settings.updatePluginSettings({
            autoSyncFullSyncRequired: false,
            autoSyncFullSyncRequiredReason: ""
        });
    }

    static recordDiagnostics(diagnostics: TargetedSyncDiagnostics): void {
        LogseqProxy.Settings.updatePluginSettings({
            lastTargetedAutoSyncDiagnostics: JSON.stringify(diagnostics)
        });
        logger.info("Targeted auto-sync diagnostics", diagnostics);
    }

    static resetTransientStateForTests(): void {
        TargetedAutoSyncState.lastDisplayedReason = null;
    }
}
