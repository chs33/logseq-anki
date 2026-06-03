import type {SyncResult} from "../../sync/types";

export function formatSyncMode(mode: SyncResult["mode"]): string {
    if (mode === "auto") return "Auto";
    if (mode === "manual") return "Manual";
    return "Unknown";
}

export function formatSyncDuration(durationMs: SyncResult["durationMs"]): string {
    if (durationMs == null || !Number.isFinite(durationMs) || durationMs < 0) return "Unknown";

    if (durationMs < 1000) return `${Math.round(durationMs)}ms`;

    if (durationMs < 60000) {
        const seconds = durationMs / 1000;
        const roundedSeconds = seconds < 10 ? seconds.toFixed(1) : Math.round(seconds).toString();
        return `${roundedSeconds}s`;
    }

    const totalSeconds = Math.round(durationMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
}

export function formatSyncCompletedAt(completedAt: SyncResult["completedAt"]): string {
    if (!completedAt) return "Unknown";

    const completedDate = new Date(completedAt);
    if (Number.isNaN(completedDate.getTime())) return "Unknown";

    return completedDate.toLocaleString();
}
