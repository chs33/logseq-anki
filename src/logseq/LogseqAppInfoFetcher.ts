import "@logseq/libs";
import type {AppGraphInfo} from "@logseq/libs/dist/LSPlugin";

const LOGSEQ_DB_GRAPH_NAME_PREFIX = "logseq_db_";

/**
 * LogseqAppInfoFetcher - Provides abstracted access to Logseq app information
 * and host environment checks with consistent error handling
 */
export class LogseqAppInfoFetcher {
    /**
     * Logseq DB graphs can expose an internal graph name prefixed with
     * `logseq_db_`, but deep links expect the user-facing graph name.
     */
    static getGraphNameForLogseqLinks(
        graph: Pick<AppGraphInfo, "name" | "path"> | null | undefined,
        isDbGraph: boolean
    ): string {
        const graphName = LogseqAppInfoFetcher.getNonEmptyString(graph?.name);
        const pathGraphName = LogseqAppInfoFetcher.getGraphNameFromPath(graph?.path);

        if (!isDbGraph) return graphName ?? pathGraphName ?? "Default";
        if (!graphName) return pathGraphName ?? "Default";

        if (graphName.startsWith(LOGSEQ_DB_GRAPH_NAME_PREFIX)) {
            return (
                graphName.slice(LOGSEQ_DB_GRAPH_NAME_PREFIX.length) || pathGraphName || graphName
            );
        }

        return graphName;
    }

    static async getCurrentGraphNameForLogseqLinks(): Promise<string> {
        const [graph, isDbGraph] = await Promise.all([
            logseq.App.getCurrentGraph(),
            LogseqAppInfoFetcher.checkCurrentIsDbGraph()
        ]);
        return LogseqAppInfoFetcher.getGraphNameForLogseqLinks(graph, isDbGraph);
    }

    /**
     * Check if the current graph is a database graph
     * @returns Promise<boolean> - true if current graph is a database graph, false otherwise
     */
    static async checkCurrentIsDbGraph(): Promise<boolean> {
        try {
            const value = await logseq.App.checkCurrentIsDbGraph();
            if (typeof value === "boolean") {
                return value;
            }
        } catch (_e) {
            // Silently fail and return false
        }
        return false;
    }

    private static getNonEmptyString(value: unknown): string | null {
        return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
    }

    private static getGraphNameFromPath(pathValue: unknown): string | null {
        const pathString = LogseqAppInfoFetcher.getNonEmptyString(pathValue);
        if (!pathString) return null;

        const segments = pathString
            .replace(/[\\/]+$/, "")
            .split(/[\\/]/)
            .filter((segment) => segment !== "");
        const lastSegment = segments[segments.length - 1];
        if (lastSegment === "db.sqlite" && segments.length > 1)
            return segments[segments.length - 2];
        return lastSegment || null;
    }

    /**
     * Check if the host scope (parent window) is accessible
     * @param targetWindow - The window to check access for (defaults to window.parent)
     * @returns boolean - true if host scope is accessible, false otherwise
     */
    static checkHostAccess(targetWindow: Window = window.parent): boolean {
        try {
            // Access addEventListener to check if the window is accessible
            return targetWindow.addEventListener !== null;
        } catch {
            return false;
        }
    }
}
