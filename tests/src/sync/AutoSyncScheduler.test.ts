import {afterEach, beforeEach, describe, expect, test, vi} from "vitest";

const testState = vi.hoisted(() => ({
    settings: {} as any,
    settingsUpdates: [] as any[],
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
            }),
            updatePluginSettings: vi.fn((settings) => {
                testState.settingsUpdates.push(settings);
                testState.settings = {...testState.settings, ...settings};
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
        testState.settingsUpdates = [];
        testState.settingsListeners = [];
        testState.unloadListeners = [];
        testState.isSyncing = false;
        runner = vi.fn().mockResolvedValue({status: "completed", changed: false});
    });

    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
    });

    const initScheduler = () => {
        const scheduler = new AutoSyncScheduler(runner);
        scheduler.init();
        return scheduler;
    };

    const applySettingsChange = (settings: any) => {
        const oldSettings = testState.settings;
        const newSettings = {...testState.settings, ...settings};
        testState.settings = newSettings;
        testState.settingsListeners[0](newSettings, oldSettings);
    };

    const enableAutoSync = (autoSyncIntervalSeconds: number | string = 60) => {
        applySettingsChange({autoSyncEnabled: true, autoSyncIntervalSeconds});
    };

    test("is disabled by default", async () => {
        initScheduler();

        await vi.advanceTimersByTimeAsync(120_000);

        expect(runner).not.toHaveBeenCalled();
    });

    test("turns persisted auto sync off on startup", async () => {
        testState.settings = {autoSyncEnabled: true, autoSyncIntervalSeconds: 60};
        initScheduler();

        await vi.advanceTimersByTimeAsync(120_000);

        expect(testState.settingsUpdates).toEqual([{autoSyncEnabled: false}]);
        expect(runner).not.toHaveBeenCalled();
    });

    test("starts when enabled", async () => {
        initScheduler();
        enableAutoSync(60);

        await vi.advanceTimersByTimeAsync(60_000);

        expect(runner).toHaveBeenCalledTimes(1);
        expect(runner).toHaveBeenCalledWith({
            mode: "auto",
            triggerAnkiWebSync: true
        });
    });

    test("clamps too-small intervals to 60 seconds", async () => {
        initScheduler();
        enableAutoSync(5);

        await vi.advanceTimersByTimeAsync(59_000);
        expect(runner).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(1_000);
        expect(runner).toHaveBeenCalledTimes(1);
    });

    test("uses interval settings stored by Logseq as strings", async () => {
        initScheduler();
        enableAutoSync("60");

        await vi.advanceTimersByTimeAsync(60_000);

        expect(runner).toHaveBeenCalledTimes(1);
    });

    test("does not overlap runs", async () => {
        let resolveRun: (value: any) => void = () => {};
        runner.mockImplementation(
            () =>
                new Promise((resolve) => {
                    resolveRun = resolve;
                })
        );
        initScheduler();
        enableAutoSync(60);

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
        initScheduler();
        enableAutoSync(120);

        await vi.advanceTimersByTimeAsync(30_000);
        applySettingsChange({autoSyncEnabled: true, autoSyncIntervalSeconds: 60});

        await vi.advanceTimersByTimeAsync(59_000);
        expect(runner).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(1_000);
        expect(runner).toHaveBeenCalledTimes(1);
    });

    test("stops on unload", async () => {
        initScheduler();
        enableAutoSync(60);

        testState.unloadListeners[0]();
        await vi.advanceTimersByTimeAsync(120_000);

        expect(runner).not.toHaveBeenCalled();
    });
});
