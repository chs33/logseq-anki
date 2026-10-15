import _ from "lodash";
import type {PluginSettings} from "../../settings";

export default function getHashRelevantSettings(settings: PluginSettings): Partial<PluginSettings> {
    return _.omit(settings, [
        "addonsList",
        "renderClozeMarcosInLogseq",
        "hideClozeMarcosUntilHoverInLogseq",
        "skipOnDependencyHashMatch",
        "ankiConnectPort",
        "autoSyncEnabled",
        "autoSyncIntervalSeconds", // Legacy setting; hidden values must not invalidate note hashes.
        "autoSyncAnkiWebAfterChanges",
        "lastWelcomeVersion",
        "lastSyncDiagnostics",
        "autoSyncFullSyncRequired",
        "autoSyncFullSyncRequiredReason",
        "lastTargetedAutoSyncDiagnostics",
        "ankiFieldOptions",
        "debug"
    ]);
}
