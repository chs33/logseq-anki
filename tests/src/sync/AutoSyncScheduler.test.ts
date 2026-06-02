import {afterEach, beforeEach, describe, expect, test, vi} from "vitest";

const testState = vi.hoisted(() => ({
    settings: {} as any,
    settingsListeners: [] as Array<(newSettings: any, oldSettings: any) => void>,
    unloadListeners: [] as Array<() => void>,
    isSyncing: false
}));

vi.mock("../../../src/logseq/LogseqProxy", () => ({
    LogseqProxy: {
        Settings: {
            getPluginSettings: vi.fn(() => testState.settings),
            registerSettingsChangeListener: vi.fn((listener) => {
                testState.settingsListeners.push(listener);
            })
        },
        App: {
            registerPluginUnloadListener: vi.fn((listener) => {
                testState.unloadListeners.push(listener);
            })
        }
    }
}));

vi.mock("../../../src/sync/syncLogseqToAnki", () => ({
    LogseqToAnkiSync: {
        get isSyncing() {
            return testState.isSyncing;
        }
    }
}));

import {type AutoSyncRunner, AutoSyncScheduler} from "../../../src/sync/AutoSyncScheduler";

describe("AutoSyncScheduler", () => {
    let runner: ReturnType<typeof vi.fn<AutoSyncRunner>>;

    beforeEach(() => {
        vi.useFakeTimers();
        testState.settings = {};
        testState.settingsListeners = [];
        testState.unloadListeners = [];
        testState.isSyncing = false;
        runner = vi.fn().mockResolvedValue({status: "completed", changed: false});
    });

    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
    });

    test("is disabled by default", async () => {
        new AutoSyncScheduler(runner).init();

        await vi.advanceTimersByTimeAsync(120_000);

        expect(runner).not.toHaveBeenCalled();
    });

    test("starts when enabled", async () => {
        testState.settings = {autoSyncEnabled: true, autoSyncIntervalSeconds: 60};
        new AutoSyncScheduler(runner).init();

        await vi.advanceTimersByTimeAsync(60_000);

        expect(runner).toHaveBeenCalledTimes(1);
        expect(runner).toHaveBeenCalledWith({
            mode: "auto",
            triggerAnkiWebSync: true
        });
    });

    test("clamps too-small intervals to 60 seconds", async () => {
        testState.settings = {autoSyncEnabled: true, autoSyncIntervalSeconds: 5};
        new AutoSyncScheduler(runner).init();

        await vi.advanceTimersByTimeAsync(59_000);
        expect(runner).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(1_000);
        expect(runner).toHaveBeenCalledTimes(1);
    });

    test("uses interval settings stored by Logseq as strings", async () => {
        testState.settings = {autoSyncEnabled: true, autoSyncIntervalSeconds: "60"};
        new AutoSyncScheduler(runner).init();

        await vi.advanceTimersByTimeAsync(60_000);

        expect(runner).toHaveBeenCalledTimes(1);
    });

    test("does not overlap runs", async () => {
        testState.settings = {autoSyncEnabled: true, autoSyncIntervalSeconds: 60};
        let resolveRun: (value: any) => void = () => {};
        runner.mockImplementation(
            () =>
                new Promise((resolve) => {
                    resolveRun = resolve;
                })
        );
        new AutoSyncScheduler(runner).init();

        await vi.advanceTimersByTimeAsync(60_000);
        expect(runner).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(180_000);
        expect(runner).toHaveBeenCalledTimes(1);

        resolveRun({status: "completed", changed: false});
        await Promise.resolve();
        await Promise.resolve();

        await vi.advanceTimersByTimeAsync(60_000);
        expect(runner).toHaveBeenCalledTimes(2);
    });

    test("reschedules when auto sync settings change", async () => {
        const oldSettings = {autoSyncEnabled: true, autoSyncIntervalSeconds: 120};
        const newSettings = {autoSyncEnabled: true, autoSyncIntervalSeconds: 60};
        testState.settings = oldSettings;
        new AutoSyncScheduler(runner).init();

        await vi.advanceTimersByTimeAsync(30_000);
        testState.settings = newSettings;
        testState.settingsListeners[0](newSettings, oldSettings);

        await vi.advanceTimersByTimeAsync(59_000);
        expect(runner).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(1_000);
        expect(runner).toHaveBeenCalledTimes(1);
    });

    test("stops on unload", async () => {
        testState.settings = {autoSyncEnabled: true, autoSyncIntervalSeconds: 60};
        new AutoSyncScheduler(runner).init();

        testState.unloadListeners[0]();
        await vi.advanceTimersByTimeAsync(120_000);

        expect(runner).not.toHaveBeenCalled();
    });
});
