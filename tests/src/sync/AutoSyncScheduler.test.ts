import {afterEach, beforeEach, describe, expect, test, vi} from "vitest";

const testState = vi.hoisted(() => ({
    settings: {} as any,
    settingsUpdates: [] as any[],
    settingsListeners: [] as Array<(newSettings: any, oldSettings: any) => void>,
    databaseChangeListeners: [] as Array<(event: unknown) => void>,
    graphChangeListeners: [] as Array<() => void>,
    unloadListeners: [] as Array<() => void>,
    isSyncing: false
}));

vi.mock("../../../src/logseq/LogseqProxy", () => ({
    LogseqProxy: {
        DB: {
            registerDBChangeListener: vi.fn((listener) => {
                testState.databaseChangeListeners.push(listener);
            })
        },
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
            registerGraphChangeListener: vi.fn((listener) => {
                testState.graphChangeListeners.push(listener);
            }),
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
import {TargetedAutoSyncState} from "../../../src/sync/targeted/TargetedAutoSyncState";
import {targetedSyncIndex} from "../../../src/sync/targeted/TargetedSyncIndex";

const changedBlock = {
    id: 1,
    uuid: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    title: "Card",
    page: {id: 10}
};

const databaseEvent = (title = "Card") => ({
    blocks: [{...changedBlock, title}],
    txData: [],
    txMeta: {outlinerOp: "save-block"}
});

describe("AutoSyncScheduler", () => {
    let runner: ReturnType<typeof vi.fn<AutoSyncRunner>>;

    beforeEach(() => {
        vi.useFakeTimers();
        vi.stubGlobal("logseq", {UI: {showMsg: vi.fn()}});
        testState.settings = {};
        testState.settingsUpdates = [];
        testState.settingsListeners = [];
        testState.databaseChangeListeners = [];
        testState.graphChangeListeners = [];
        testState.unloadListeners = [];
        testState.isSyncing = false;
        runner = vi.fn().mockImplementation(async (options) => {
            if (options.mode === "manual") {
                targetedSyncIndex.replaceAll("Graph", [], []);
                testState.settings = {
                    ...testState.settings,
                    autoSyncFullSyncRequired: false,
                    autoSyncFullSyncRequiredReason: ""
                };
            }
            return {status: "completed", changed: false};
        });
        targetedSyncIndex.clear();
        TargetedAutoSyncState.resetTransientStateForTests();
    });

    afterEach(() => {
        targetedSyncIndex.clear();
        vi.clearAllTimers();
        vi.useRealTimers();
        vi.unstubAllGlobals();
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

    const enableAutoSync = async () => {
        applySettingsChange({autoSyncEnabled: true});
        await Promise.resolve();
        await Promise.resolve();
        runner.mockClear();
    };
    const emitDatabaseChange = (event: unknown = databaseEvent()) =>
        testState.databaseChangeListeners[0](event);

    test("is disabled by default", async () => {
        initScheduler();
        emitDatabaseChange();
        await vi.advanceTimersByTimeAsync(120_000);
        expect(runner).not.toHaveBeenCalled();
    });

    test("turns persisted auto sync off on startup", async () => {
        testState.settings = {autoSyncEnabled: true};
        initScheduler();
        emitDatabaseChange();
        await vi.advanceTimersByTimeAsync(120_000);
        expect(testState.settingsUpdates).toEqual([{autoSyncEnabled: false}]);
        expect(runner).not.toHaveBeenCalled();
    });

    test("enabling runs Full Sync before activating targeted Auto Sync", async () => {
        initScheduler();
        applySettingsChange({autoSyncEnabled: true});

        expect(runner).toHaveBeenCalledOnce();
        expect(runner).toHaveBeenCalledWith({
            mode: "manual",
            fullSyncSelection: "all",
            triggerAnkiWebSync: true
        });
        await Promise.resolve();
        await Promise.resolve();

        runner.mockClear();
        emitDatabaseChange();
        await vi.advanceTimersByTimeAsync(15_000);
        expect(runner).toHaveBeenCalledWith(
            expect.objectContaining({mode: "auto", targetedChanges: expect.any(Object)})
        );
    });

    test("leaves Auto Sync off when Full Sync does not build an index", async () => {
        runner.mockResolvedValueOnce({status: "completed", changed: false});
        targetedSyncIndex.clear();
        initScheduler();
        applySettingsChange({autoSyncEnabled: true});
        await Promise.resolve();
        await Promise.resolve();

        expect(testState.settings.autoSyncEnabled).toBe(false);
        expect(logseq.UI.showMsg).toHaveBeenCalledWith(
            expect.stringContaining("did not build the targeted dependency index"),
            "warning",
            expect.any(Object)
        );
    });

    test("accepts the newly built index while the cleared setting is still propagating", async () => {
        testState.settings = {
            autoSyncFullSyncRequired: true,
            autoSyncFullSyncRequiredReason: "Previous unsupported change"
        };
        runner.mockImplementationOnce(async () => {
            targetedSyncIndex.replaceAll("Graph", [], []);
            return {status: "completed", changed: false};
        });

        initScheduler();
        applySettingsChange({autoSyncEnabled: true});
        await Promise.resolve();
        await Promise.resolve();

        expect(testState.settings.autoSyncEnabled).toBe(true);
        expect(logseq.UI.showMsg).toHaveBeenCalledWith(
            "Full Sync completed. Targeted Auto Sync is now enabled.",
            "success",
            expect.any(Object)
        );
    });

    test("does not reuse an index from before Auto Sync initialization", async () => {
        targetedSyncIndex.replaceAll("Graph", [], []);
        runner.mockResolvedValueOnce({status: "completed", changed: false});

        initScheduler();
        applySettingsChange({autoSyncEnabled: true});
        await Promise.resolve();
        await Promise.resolve();

        expect(testState.settings.autoSyncEnabled).toBe(false);
        expect(logseq.UI.showMsg).toHaveBeenCalledWith(
            expect.stringContaining("did not build the targeted dependency index"),
            "warning",
            expect.any(Object)
        );
    });

    test("queues changes received during the initializing Full Sync", async () => {
        let resolveInitialization: (value: any) => void = () => {};
        runner.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    resolveInitialization = resolve;
                })
        );

        initScheduler();
        applySettingsChange({autoSyncEnabled: true});
        emitDatabaseChange(databaseEvent("Changed during Full Sync"));
        await vi.advanceTimersByTimeAsync(120_000);

        expect(runner).toHaveBeenCalledOnce();
        expect(runner).toHaveBeenCalledWith({
            mode: "manual",
            fullSyncSelection: "all",
            triggerAnkiWebSync: true
        });

        targetedSyncIndex.replaceAll("Graph", [], []);
        resolveInitialization({status: "completed", changed: false});
        await Promise.resolve();
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(0);

        expect(runner).toHaveBeenCalledTimes(2);
        expect(runner.mock.calls[1][0]).toMatchObject({
            mode: "auto",
            targetedChanges: {
                classification: "targeted",
                eventCount: 1,
                blocks: [expect.objectContaining({title: "Changed during Full Sync"})]
            }
        });
    });

    test("initialization respects the disabled AnkiWeb setting", async () => {
        testState.settings = {autoSyncAnkiWebAfterChanges: false};
        initScheduler();
        applySettingsChange({autoSyncEnabled: true});

        expect(runner).toHaveBeenCalledWith({
            mode: "manual",
            fullSyncSelection: "all",
            triggerAnkiWebSync: false
        });
    });

    test.each([
        "cancelled",
        "failed",
        "skipped",
        "already-syncing"
    ] as const)("leaves Auto Sync off when initializing Full Sync is %s", async (status) => {
        runner.mockResolvedValueOnce({status, changed: false});
        initScheduler();
        applySettingsChange({autoSyncEnabled: true});
        await Promise.resolve();
        await Promise.resolve();

        expect(testState.settings.autoSyncEnabled).toBe(false);
        expect(logseq.UI.showMsg).toHaveBeenCalledWith(
            expect.stringContaining("Auto Sync remains off"),
            "warning",
            expect.any(Object)
        );
    });

    test("does not mask an unsupported event received during initialization", async () => {
        let resolveInitialization: (value: any) => void = () => {};
        runner.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    resolveInitialization = resolve;
                })
        );

        initScheduler();
        applySettingsChange({autoSyncEnabled: true});
        emitDatabaseChange({
            blocks: [changedBlock],
            txData: [],
            txMeta: {outlinerOp: "batch-import-edn"}
        });

        // Simulate Full Sync clearing the state when it finishes. The scheduler must restore
        // the unsupported event's requirement instead of enabling targeted processing.
        targetedSyncIndex.replaceAll("Graph", [], []);
        testState.settings = {
            ...testState.settings,
            autoSyncFullSyncRequired: false,
            autoSyncFullSyncRequiredReason: ""
        };
        resolveInitialization({status: "completed", changed: false});
        await Promise.resolve();
        await Promise.resolve();

        expect(testState.settings.autoSyncEnabled).toBe(false);
        expect(testState.settings.autoSyncFullSyncRequired).toBe(true);
        expect(testState.settings.autoSyncFullSyncRequiredReason).toContain("graph-wide");
        expect(runner).toHaveBeenCalledOnce();
    });

    test("debounces and merges bursts of database changes", async () => {
        initScheduler();
        await enableAutoSync();
        emitDatabaseChange(databaseEvent("One"));
        await vi.advanceTimersByTimeAsync(10_000);
        emitDatabaseChange(databaseEvent("Two"));
        await vi.advanceTimersByTimeAsync(14_999);
        expect(runner).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(1);
        expect(runner).toHaveBeenCalledOnce();
        expect(runner).toHaveBeenCalledWith(
            expect.objectContaining({
                mode: "auto",
                triggerAnkiWebSync: true,
                targetedChanges: expect.objectContaining({
                    classification: "targeted",
                    eventCount: 2,
                    blocks: [expect.objectContaining({title: "Two"})]
                })
            })
        );
    });

    test("enforces cooldown between targeted runs", async () => {
        initScheduler();
        await enableAutoSync();
        emitDatabaseChange();
        await vi.advanceTimersByTimeAsync(15_000);
        expect(runner).toHaveBeenCalledOnce();

        await vi.advanceTimersByTimeAsync(5_000);
        emitDatabaseChange();
        await vi.advanceTimersByTimeAsync(54_999);
        expect(runner).toHaveBeenCalledOnce();
        await vi.advanceTimersByTimeAsync(1);
        expect(runner).toHaveBeenCalledTimes(2);
    });

    test("coalesces changes received during a running sync into one follow-up run", async () => {
        let resolveFirstRun: (value: any) => void = () => {};
        initScheduler();
        await enableAutoSync();
        runner
            .mockImplementationOnce(
                () =>
                    new Promise((resolve) => {
                        resolveFirstRun = resolve;
                    })
            )
            .mockResolvedValue({status: "completed", changed: false});
        emitDatabaseChange(databaseEvent("First"));
        await vi.advanceTimersByTimeAsync(15_000);
        emitDatabaseChange(databaseEvent("While running 1"));
        emitDatabaseChange(databaseEvent("While running 2"));
        await vi.advanceTimersByTimeAsync(120_000);
        expect(runner).toHaveBeenCalledOnce();

        resolveFirstRun({status: "completed", changed: false});
        await Promise.resolve();
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(0);
        expect(runner).toHaveBeenCalledTimes(2);
        expect(runner.mock.calls[1][0].targetedChanges?.eventCount).toBe(2);
    });

    test("waits for a manual sync without dropping a pending targeted change", async () => {
        initScheduler();
        await enableAutoSync();
        emitDatabaseChange();
        testState.isSyncing = true;
        await vi.advanceTimersByTimeAsync(15_000);
        expect(runner).not.toHaveBeenCalled();

        testState.isSyncing = false;
        await vi.advanceTimersByTimeAsync(1_000);
        expect(runner).toHaveBeenCalledOnce();
    });

    test("unknown transaction shapes fail loudly in test builds", async () => {
        initScheduler();
        await enableAutoSync();
        expect(() => emitDatabaseChange({blocks: [changedBlock], txData: {}})).toThrow();
        expect(runner).not.toHaveBeenCalled();
    });

    test("unsupported operations set Full sync required and record diagnostics", async () => {
        initScheduler();
        await enableAutoSync();
        emitDatabaseChange({
            blocks: [changedBlock],
            txData: [],
            txMeta: {outlinerOp: "batch-import-edn"}
        });

        expect(testState.settings.autoSyncFullSyncRequired).toBe(true);
        expect(testState.settings.autoSyncFullSyncRequiredReason).toContain("graph-wide");
        const diagnostics = JSON.parse(testState.settings.lastTargetedAutoSyncDiagnostics);
        expect(diagnostics).toMatchObject({
            classification: "unsupported",
            affectedCardCount: 0,
            fullSyncRequired: true
        });
    });

    test("ignores metadata-free changes to Logseq's hidden built-in views", async () => {
        initScheduler();
        await enableAutoSync();
        emitDatabaseChange({
            blocks: [
                {
                    id: 15326,
                    uuid: "00000006-5909-6900-2000-000000000000",
                    title: "Linked references",
                    page: {id: 180},
                    parent: {id: 180},
                    featureType: "linked-references",
                    viewFor: {id: 6865}
                },
                {
                    id: 180,
                    uuid: "00000004-1906-3437-5800-000000000000",
                    name: "$$$views",
                    title: "$$$views",
                    "builtIn?": true,
                    "hide?": true
                }
            ],
            txData: [],
            txMeta: {},
            deletedBlockUuids: new Set<string>()
        });
        await vi.advanceTimersByTimeAsync(120_000);

        expect(runner).not.toHaveBeenCalled();
        expect(testState.settings.autoSyncFullSyncRequired).not.toBe(true);
    });

    test("targets user block snapshots when Logseq omits transaction metadata", async () => {
        initScheduler();
        await enableAutoSync();
        emitDatabaseChange({
            blocks: [
                {
                    id: 15329,
                    uuid: "6ad3b707-8065-4c10-ae83-f0ca8791baf6",
                    title: "you see function definition, why it can still have default argument",
                    page: {id: 4727},
                    parent: {id: 4847},
                    properties: {}
                }
            ],
            txData: [],
            txMeta: {},
            deletedBlockUuids: new Set<string>()
        });
        await vi.advanceTimersByTimeAsync(15_000);

        expect(testState.settings.autoSyncFullSyncRequired).not.toBe(true);
        expect(runner).toHaveBeenCalledWith(
            expect.objectContaining({
                mode: "auto",
                targetedChanges: expect.objectContaining({
                    classification: "targeted",
                    blocks: [expect.objectContaining({id: 15329})]
                })
            })
        );
    });

    test("relevant settings and template inputs require Full Sync", async () => {
        initScheduler();
        await enableAutoSync();
        applySettingsChange({includeParentContent: false});
        expect(testState.settings.autoSyncFullSyncRequiredReason).toContain("includeParentContent");

        applySettingsChange({ankiFieldOptions: ["tts"]});
        expect(testState.settings.autoSyncFullSyncRequiredReason).toContain("ankiFieldOptions");
    });

    test("diagnostic state settings do not recursively require Full Sync", async () => {
        initScheduler();
        await enableAutoSync();
        applySettingsChange({lastTargetedAutoSyncDiagnostics: "{}"});
        expect(testState.settings.autoSyncFullSyncRequired).not.toBe(true);
    });

    test("graph changes require Full Sync instead of queuing reconciliation", async () => {
        initScheduler();
        await enableAutoSync();
        testState.graphChangeListeners[0]();
        await vi.advanceTimersByTimeAsync(120_000);
        expect(testState.settings.autoSyncFullSyncRequiredReason).toContain("graph changed");
        expect(runner).not.toHaveBeenCalled();
    });

    test("disabling and unload cancel pending work", async () => {
        const scheduler = initScheduler();
        await enableAutoSync();
        emitDatabaseChange();
        applySettingsChange({autoSyncEnabled: false});
        scheduler.dispose();
        await vi.advanceTimersByTimeAsync(120_000);
        expect(runner).not.toHaveBeenCalled();
    });
});
