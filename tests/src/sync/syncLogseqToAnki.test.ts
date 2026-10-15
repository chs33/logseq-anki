import {afterEach, beforeEach, describe, expect, test, vi} from "vitest";
import type {SyncResult} from "../../../src/sync/types";

const progressNotificationMock = vi.hoisted(() =>
    vi.fn(function ProgressNotification() {
        this.increment = vi.fn();
        this.setIndeterminate = vi.fn();
        this.updateMessage = vi.fn();
    })
);

const ankiConnectMock = vi.hoisted(() => ({
    invoke: vi.fn(),
    requestPermission: vi.fn(),
    upsertModel: vi.fn(),
    getAnkiConnectUrl: vi.fn(() => "http://127.0.0.1:8765")
}));

const windowParentBridgeMock = vi.hoisted(() => ({
    addEventListener: vi.fn(),
    dispatchLogseqAnkiSyncEvent: vi.fn(),
    dispatchEvent: vi.fn(),
    getDocument: vi.fn(() => document),
    setGlobalObject: vi.fn()
}));

const updateNotesTaskExecuteMock = vi.hoisted(() => vi.fn());

vi.mock("../../../src/anki-connect/AnkiConnect", () => ankiConnectMock);

vi.mock("../../../src/logseq/LogseqAppInfoFetcher", () => ({
    LogseqAppInfoFetcher: {
        checkHostAccess: vi.fn(() => true)
    }
}));

vi.mock("../../../src/logseq/WindowParentBridge", () => ({
    WindowParentBridge: windowParentBridgeMock
}));

vi.mock("../../../src/ui", () => ({
    ProgressNotification: progressNotificationMock,
    showConfirmModal: vi.fn(),
    showSyncResultDialog: vi.fn(),
    showSyncSelectionDialog: vi.fn()
}));

vi.mock("../../../src/sync/tasks/UpdateNotesTask", () => ({
    UpdateNotesTask: vi.fn(function UpdateNotesTask() {
        return {
            execute: updateNotesTaskExecuteMock
        };
    })
}));

import {ClozeNote} from "../../../src/anki-notes/ClozeNote";
import {HighlightMaskNote} from "../../../src/anki-notes/HighlightMaskNote";
import {ImageOcclusionNote} from "../../../src/anki-notes/ImageOcclusionNote";
import {MultilineCardNote} from "../../../src/anki-notes/MultilineCardNote";
import {SwiftArrowNote} from "../../../src/anki-notes/SwiftArrowNote";
import {LoggerCategory} from "../../../src/logger";
import {LogseqProxy} from "../../../src/logseq/LogseqProxy";
import {LogseqToAnkiSync} from "../../../src/sync/syncLogseqToAnki";
import {targetedSyncIndex} from "../../../src/sync/targeted/TargetedSyncIndex";
import type {TargetedChangeBatch} from "../../../src/sync/targeted/types";

const originalLogseq = globalThis.logseq;
const showMsgMock = vi.fn();
const updateSettingsMock = vi.fn();

const createNote = {uuid: "create-uuid", type: "cloze", properties: {id: "create-uuid"}};
const updateNote = {uuid: "update-uuid", type: "cloze", properties: {id: "update-uuid"}};
const targetedChanges: TargetedChangeBatch = {
    classification: "targeted",
    reason: "test event",
    blocks: [],
    deletedBlockUuids: [],
    txAttributes: [],
    outlinerOps: ["save-block"],
    changedEntities: [],
    eventCount: 1
};

function createSyncResult(changed: boolean): SyncResult {
    return {
        toCreateNotes: changed ? [createNote as any] : [],
        toUpdateNotes: [],
        toDeleteNotes: [],
        failedCreated: {},
        failedUpdated: {},
        failedDeleted: {},
        mediaUpdated: 0,
        suspended: 0,
        unsuspended: 0,
        skippedUpdate: 0,
        skippedDelete: 0,
        changed,
        ankiWebSynced: false
    };
}

function buildSync(result: SyncResult) {
    const sync = new LogseqToAnkiSync() as any;
    sync.getGraphName = vi.fn().mockResolvedValue("Graph");
    sync.getLogseqLinkGraphName = vi.fn().mockResolvedValue("Graph");
    sync.getModelName = vi.fn().mockReturnValue("GraphModel");
    sync.setupAnkiModel = vi.fn().mockResolvedValue(undefined);
    sync.initializeAnkiNoteManager = vi.fn().mockResolvedValue({noteInfoMap: new Map()});
    sync.collectAllNotes = vi.fn().mockResolvedValue([]);
    sync.collectTargetedNotes = vi.fn().mockResolvedValue([]);
    sync.persistLogseqBlockIds = vi.fn().mockResolvedValue(undefined);
    sync.createSyncPlan = vi.fn().mockResolvedValue({
        toCreateNotesOriginal: [createNote],
        toUpdateNotesOriginal: [updateNote],
        toDeleteNotesOriginal: [123]
    });
    sync.createTargetedSyncPlan = vi.fn().mockResolvedValue({
        toCreateNotes: [createNote],
        toUpdateNotes: [updateNote],
        toDeleteNotes: [123],
        skippedDelete: 0
    });
    sync.getUserConfirmation = vi.fn().mockResolvedValue({
        toCreateNotes: [createNote],
        toUpdateNotes: [updateNote],
        toDeleteNotes: [123]
    });
    sync.executeSyncPlan = vi.fn().mockResolvedValue(result);
    sync.performPostSyncCleanup = vi.fn().mockResolvedValue(undefined);
    sync.displayResults = vi.fn();
    sync.displayAutoResults = vi.fn();
    return sync;
}

function expectSyncTiming(result: SyncResult | undefined, mode: "manual" | "auto") {
    expect(result).toBeDefined();
    expect(result?.mode).toBe(mode);
    expect(result?.startedAt).toEqual(expect.any(String));
    expect(result?.completedAt).toEqual(expect.any(String));
    expect(Date.parse(result?.startedAt ?? "")).not.toBeNaN();
    expect(Date.parse(result?.completedAt ?? "")).not.toBeNaN();
    expect(result?.durationMs).toEqual(expect.any(Number));
    expect(result?.durationMs).toBeGreaterThanOrEqual(0);
}

function getStoredLastSyncResult(): SyncResult | undefined {
    const call = windowParentBridgeMock.setGlobalObject.mock.calls.find(
        ([key]) => key === "lastSyncLogseqToAnkiResult"
    );
    return call?.[1];
}

function getStoredLastChangedSyncResult(): SyncResult | undefined {
    const call = windowParentBridgeMock.setGlobalObject.mock.calls.find(
        ([key]) => key === "lastChangedSyncLogseqToAnkiResult"
    );
    return call?.[1];
}

describe("LogseqToAnkiSync modes", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal("logseq", {
            ...originalLogseq,
            UI: {
                ...originalLogseq?.UI,
                showMsg: showMsgMock
            },
            provideUI: vi.fn(),
            baseInfo: {
                id: "test-plugin"
            },
            settings: {debug: [LoggerCategory.SyncMain]},
            updateSettings: updateSettingsMock
        });
        LogseqToAnkiSync.isSyncing = false;
        targetedSyncIndex.replaceAll("Graph", [], []);
        ankiConnectMock.invoke.mockResolvedValue(null);
    });

    afterEach(() => {
        targetedSyncIndex.clear();
        vi.unstubAllGlobals();
    });

    test("auto mode does not open the manual selection dialog", async () => {
        const sync = buildSync(createSyncResult(false));

        await sync.sync({mode: "auto", triggerAnkiWebSync: false, targetedChanges});

        expect(sync.getUserConfirmation).not.toHaveBeenCalled();
    });

    test("auto mode without a classified event refuses to run a full scan", async () => {
        const sync = buildSync(createSyncResult(false));

        const outcome = await sync.sync({mode: "auto", triggerAnkiWebSync: false});

        expect(outcome.status).toBe("skipped");
        expect(sync.collectAllNotes).not.toHaveBeenCalled();
        expect(updateSettingsMock).toHaveBeenCalledWith(
            expect.objectContaining({
                autoSyncFullSyncRequired: true,
                autoSyncFullSyncRequiredReason: expect.stringContaining("without a classified")
            })
        );
    });

    test("auto mode includes deletes", async () => {
        const sync = buildSync(createSyncResult(false));

        await sync.sync({mode: "auto", triggerAnkiWebSync: false, targetedChanges});

        expect(sync.executeSyncPlan).toHaveBeenCalledWith(
            [createNote],
            [updateNote],
            [123],
            expect.anything(),
            {
                autoSync: true,
                silentProgress: true,
                skippedDelete: 0
            }
        );
    });

    test("force regenerate mode propagates to sync plan execution", async () => {
        const sync = buildSync(createSyncResult(false));

        await sync.sync({forceRegenerate: true});

        expect(sync.executeSyncPlan).toHaveBeenCalledWith(
            [createNote],
            [updateNote],
            [123],
            expect.anything(),
            {
                autoSync: false,
                silentProgress: false,
                skippedDelete: 0,
                forceRegenerate: true
            }
        );
    });

    test("manual mode keeps the confirmation flow and delete selection", async () => {
        const sync = buildSync(createSyncResult(false));

        await sync.sync();

        expect(sync.getUserConfirmation).toHaveBeenCalledWith(
            [createNote],
            [updateNote],
            [123],
            []
        );
        expect(sync.executeSyncPlan).toHaveBeenCalledWith(
            [createNote],
            [updateNote],
            [123],
            expect.anything(),
            {
                autoSync: false,
                silentProgress: false,
                skippedDelete: 0
            }
        );
    });

    test("Auto Sync initialization applies the complete Full Sync plan without confirmation", async () => {
        const sync = buildSync(createSyncResult(false));

        await sync.sync({mode: "manual", fullSyncSelection: "all"});

        expect(sync.getUserConfirmation).not.toHaveBeenCalled();
        expect(sync.executeSyncPlan).toHaveBeenCalledWith(
            [createNote],
            [updateNote],
            [123],
            expect.anything(),
            {
                autoSync: false,
                silentProgress: false,
                skippedDelete: 0
            }
        );
    });

    test("manual mode immediately reports that the sync started", async () => {
        const sync = buildSync(createSyncResult(false));

        await sync.sync();

        expect(showMsgMock).toHaveBeenCalledWith(
            "Logseq to Anki sync started. Preparing graph scan…",
            "success",
            {timeout: 2500}
        );
    });

    test("manual mode reports when another sync is already running", async () => {
        LogseqToAnkiSync.isSyncing = true;

        const outcome = await new LogseqToAnkiSync().sync();

        expect(outcome.status).toBe("already-syncing");
        expect(showMsgMock).toHaveBeenCalledWith(
            "A Logseq to Anki sync is already in progress.",
            "warning",
            {timeout: 4000}
        );
    });

    test("manual sync stores duration metadata on the completed result", async () => {
        const sync = buildSync(createSyncResult(false));

        const outcome = await sync.sync();

        expect(outcome.status).toBe("completed");
        expectSyncTiming(outcome.result, "manual");
        expectSyncTiming(getStoredLastSyncResult(), "manual");
    });

    test("persists phase diagnostics when Sync Main logging is enabled", async () => {
        const sync = buildSync(createSyncResult(false));

        await sync.sync();

        const diagnosticsUpdate = updateSettingsMock.mock.calls.find(
            ([settings]) => settings.lastSyncDiagnostics
        )?.[0];
        const diagnostics = JSON.parse(diagnosticsUpdate.lastSyncDiagnostics);
        expect(diagnostics).toMatchObject({
            schemaVersion: 1,
            pluginVersion: expect.any(String),
            graphName: "Graph",
            mode: "manual",
            durationMs: expect.any(Number),
            collectedNoteCount: 0
        });
        expect(diagnostics.phases).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    phase: "collect Logseq notes",
                    durationMs: expect.any(Number),
                    status: "completed"
                }),
                expect.objectContaining({
                    phase: "execute sync plan",
                    durationMs: expect.any(Number),
                    status: "completed"
                })
            ])
        );
    });

    test("successful Full Sync clears the Full sync required state", async () => {
        (globalThis.logseq.settings as any).autoSyncFullSyncRequired = true;
        (globalThis.logseq.settings as any).autoSyncFullSyncRequiredReason = "Unknown event";
        const sync = buildSync(createSyncResult(false));

        const outcome = await sync.sync();

        expect(outcome.status).toBe("completed");
        expect(updateSettingsMock).toHaveBeenCalledWith({
            autoSyncFullSyncRequired: false,
            autoSyncFullSyncRequiredReason: ""
        });
        expect(targetedSyncIndex.isReadyForGraph("Graph")).toBe(true);
    });

    test("auto no-change sync still stores last sync details with duration metadata", async () => {
        const sync = buildSync(createSyncResult(false));

        const outcome = await sync.sync({
            mode: "auto",
            triggerAnkiWebSync: false,
            targetedChanges
        });

        expect(outcome.status).toBe("completed");
        expectSyncTiming(outcome.result, "auto");
        expectSyncTiming(getStoredLastSyncResult(), "auto");
        expect(sync.displayAutoResults).toHaveBeenCalledWith(
            expect.objectContaining({changed: false, mode: "auto"})
        );
        expect(getStoredLastChangedSyncResult()).toBeUndefined();
    });

    test("changed sync stores last changed sync details with duration metadata", async () => {
        const sync = buildSync(createSyncResult(true));

        const outcome = await sync.sync({
            mode: "auto",
            triggerAnkiWebSync: false,
            targetedChanges
        });

        expect(outcome.status).toBe("completed");
        expectSyncTiming(outcome.result, "auto");
        expectSyncTiming(getStoredLastSyncResult(), "auto");
        expectSyncTiming(getStoredLastChangedSyncResult(), "auto");
    });

    test("auto mode skips when AnkiConnect is unreachable", async () => {
        const originalLogseq = (globalThis as any).logseq;
        const showMsg = vi.fn();
        const provideUI = vi.fn();
        const sync = buildSync(createSyncResult(false));
        sync.setupAnkiModel = vi.fn().mockRejectedValue("failed to issue request");

        vi.stubGlobal("logseq", {
            ...originalLogseq,
            UI: {
                ...originalLogseq?.UI,
                showMsg
            },
            provideUI,
            baseInfo: {
                id: "test-plugin"
            }
        });

        try {
            const outcome = await sync.sync({
                mode: "auto",
                triggerAnkiWebSync: false,
                targetedChanges
            });

            expect(outcome.status).toBe("skipped");
            expect(showMsg).toHaveBeenCalledWith(
                "Auto sync skipped: Anki is not reachable at http://127.0.0.1:8765. Open Anki with AnkiConnect installed, or update the AnkiConnect port setting.",
                "warning",
                {timeout: 8000}
            );
        } finally {
            vi.stubGlobal("logseq", originalLogseq);
        }
    });

    test("AnkiWeb sync runs after auto mode changes", async () => {
        const sync = buildSync(createSyncResult(true));

        await sync.sync({mode: "auto", triggerAnkiWebSync: true, targetedChanges});

        expect(ankiConnectMock.invoke).toHaveBeenCalledWith("sync", {});
    });

    test("AnkiWeb sync is skipped when auto mode finds no changes", async () => {
        const sync = buildSync(createSyncResult(false));

        await sync.sync({mode: "auto", triggerAnkiWebSync: true, targetedChanges});

        expect(ankiConnectMock.invoke).not.toHaveBeenCalledWith("sync", {});
    });
});

describe("LogseqToAnkiSync sync planning", () => {
    function createPlanNote(uuid: string, ankiId: number | null) {
        return {
            uuid,
            type: "cloze",
            getAnkiId: vi.fn(() => ankiId)
        };
    }

    test("classifies create, update, and delete candidates without changing behavior", async () => {
        const sync = new LogseqToAnkiSync() as any;
        const newNote = createPlanNote("new-note", null);
        const existingNote = createPlanNote("existing-note", 100);
        const ankiNoteManager = {
            noteInfoMap: new Map([
                [100, {}],
                [200, {}]
            ])
        };

        const result = await sync.createSyncPlan(
            [newNote, existingNote] as any,
            ankiNoteManager as any
        );

        expect(result.toCreateNotesOriginal).toEqual([newNote]);
        expect(result.toUpdateNotesOriginal).toEqual([existingNote]);
        expect(result.toDeleteNotesOriginal).toEqual([200]);
    });

    test("uses set semantics for deletion detection on large note lists", async () => {
        const sync = new LogseqToAnkiSync() as any;
        const notes = Array.from({length: 5000}, (_, index) =>
            createPlanNote(`note-${index}`, index + 1)
        );
        const noteInfoMap = new Map(notes.map((note) => [note.getAnkiId(), {}]));
        noteInfoMap.set(9999, {});

        const result = await sync.createSyncPlan(notes as any, {noteInfoMap} as any);

        expect(result.toCreateNotesOriginal).toEqual([]);
        expect(result.toUpdateNotesOriginal).toHaveLength(5000);
        expect(result.toDeleteNotesOriginal).toEqual([9999]);
    });

    test("targeted planning deletes a known card by exact indexed identity", async () => {
        const sync = new LogseqToAnkiSync() as any;
        targetedSyncIndex.replaceAll(
            "Graph",
            [
                {
                    identity: "deleted-cloze",
                    rootUuid: "deleted",
                    type: "cloze",
                    pageId: 1,
                    directBlockUuids: ["deleted"],
                    ancestorBlockUuids: [],
                    pageEntityKeys: [],
                    tagEntityKeys: []
                }
            ],
            []
        );
        const manager = {getAnkiIdByUuidType: vi.fn(() => 42)};

        const result = await sync.createTargetedSyncPlan(
            [],
            {
                classification: "targeted",
                reason: "known delete",
                affectedIdentities: new Set(["deleted-cloze"]),
                candidateRootUuids: new Set(["deleted"]),
                explicitlyDeletedRootUuids: new Set(["deleted"])
            },
            manager
        );

        expect(result).toMatchObject({toDeleteNotes: [42], skippedDelete: 0});
        expect(manager.getAnkiIdByUuidType).toHaveBeenCalledWith("deleted-cloze");
        targetedSyncIndex.clear();
    });

    test("targeted planning permits eligibility removal while the root still exists", async () => {
        const sync = new LogseqToAnkiSync() as any;
        targetedSyncIndex.replaceAll(
            "Graph",
            [
                {
                    identity: "untagged-multiline_card",
                    rootUuid: "untagged",
                    type: "multiline_card",
                    pageId: 1,
                    directBlockUuids: ["untagged"],
                    ancestorBlockUuids: [],
                    pageEntityKeys: [],
                    tagEntityKeys: []
                }
            ],
            []
        );
        const getBlock = vi
            .spyOn(LogseqProxy.Editor, "getBlock")
            .mockResolvedValue({id: 1, uuid: "untagged"} as any);

        try {
            const result = await sync.createTargetedSyncPlan(
                [],
                {
                    classification: "targeted",
                    reason: "card tag removed",
                    affectedIdentities: new Set(["untagged-multiline_card"]),
                    candidateRootUuids: new Set(["untagged"]),
                    explicitlyDeletedRootUuids: new Set()
                },
                {getAnkiIdByUuidType: vi.fn(() => 43)}
            );
            expect(result.toDeleteNotes).toEqual([43]);
            expect(result.ambiguousReason).toBeUndefined();
        } finally {
            getBlock.mockRestore();
            targetedSyncIndex.clear();
        }
    });

    test("targeted planning refuses ambiguous disappearance instead of deleting", async () => {
        const sync = new LogseqToAnkiSync() as any;
        targetedSyncIndex.replaceAll(
            "Graph",
            [
                {
                    identity: "missing-cloze",
                    rootUuid: "missing",
                    type: "cloze",
                    pageId: 1,
                    directBlockUuids: ["missing"],
                    ancestorBlockUuids: [],
                    pageEntityKeys: [],
                    tagEntityKeys: []
                }
            ],
            []
        );
        const getBlock = vi.spyOn(LogseqProxy.Editor, "getBlock").mockResolvedValue(null);

        try {
            const result = await sync.createTargetedSyncPlan(
                [],
                {
                    classification: "targeted",
                    reason: "ambiguous",
                    affectedIdentities: new Set(["missing-cloze"]),
                    candidateRootUuids: new Set(["missing"]),
                    explicitlyDeletedRootUuids: new Set()
                },
                {getAnkiIdByUuidType: vi.fn(() => 44)}
            );
            expect(result.toDeleteNotes).toEqual([]);
            expect(result.ambiguousReason).toContain("stable deletion identity");
        } finally {
            getBlock.mockRestore();
            targetedSyncIndex.clear();
        }
    });
});

describe("LogseqToAnkiSync note collection progress", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    test("keeps scanning visible until note ordering completes", async () => {
        const notesByType = {
            cloze: {uuid: "cloze", type: "cloze"},
            swiftArrow: {uuid: "swift", type: "swift_arrow"},
            imageOcclusion: {uuid: "image", type: "image_occlusion"},
            highlightMask: {uuid: "highlight", type: "highlight_mask"},
            multiline: {uuid: "multiline", type: "multiline_card"}
        };
        vi.spyOn(ClozeNote, "getNotesFromLogseqBlocks").mockResolvedValue([
            notesByType.cloze as any
        ]);
        vi.spyOn(SwiftArrowNote, "getNotesFromLogseqBlocks").mockResolvedValue([
            notesByType.swiftArrow as any
        ]);
        vi.spyOn(ImageOcclusionNote, "getNotesFromLogseqBlocks").mockResolvedValue([
            notesByType.imageOcclusion as any
        ]);
        vi.spyOn(HighlightMaskNote, "getNotesFromLogseqBlocks").mockResolvedValue([
            notesByType.highlightMask as any
        ]);
        vi.spyOn(MultilineCardNote, "getNotesFromLogseqBlocks").mockResolvedValue([
            notesByType.multiline as any
        ]);
        vi.spyOn(LogseqProxy.Editor, "getBlock").mockImplementation(
            async (uuid: any) =>
                ({
                    id: String(uuid).length,
                    uuid
                }) as any
        );

        const sync = new LogseqToAnkiSync() as any;
        sync.graphName = "Graph";
        const notes = await sync.collectAllNotes(false);

        const progressNotification = progressNotificationMock.mock.instances.at(-1) as any;
        expect(progressNotificationMock).toHaveBeenLastCalledWith(
            expect.stringContaining("Scanning Logseq Graph"),
            6,
            "graph",
            {silent: false}
        );
        expect(progressNotification.increment).toHaveBeenCalledTimes(6);
        expect(progressNotification.setIndeterminate).toHaveBeenCalledTimes(5);
        expect(progressNotification.updateMessage).toHaveBeenCalledWith(
            "Scanning Graph: loading multiline card trees"
        );
        expect(progressNotification.updateMessage).toHaveBeenCalledWith(
            "Scanning Graph: ordering 5 notes"
        );
        expect(notes).toHaveLength(5);
    });
});

describe("LogseqToAnkiSync execution", () => {
    test("skips Anki collection reload when nothing changed", async () => {
        const sync = new LogseqToAnkiSync() as any;
        sync.createNotes = vi.fn().mockResolvedValue([]);
        sync.updateNotes = vi.fn().mockResolvedValue({updated: [], skipped: []});
        sync.deleteNotes = vi.fn().mockResolvedValue([]);
        sync.updateAssets = vi.fn().mockResolvedValue(0);

        const result = await sync.executeSyncPlan([], [], [], {} as any, {
            autoSync: true,
            silentProgress: true,
            skippedDelete: 0
        });

        expect(result.changed).toBe(false);
        expect(ankiConnectMock.invoke).not.toHaveBeenCalledWith("reloadCollection", {});
    });

    test("reloads Anki collection after a changed sync", async () => {
        const sync = new LogseqToAnkiSync() as any;
        const createdNote = {uuid: "created", type: "cloze"};
        sync.createNotes = vi.fn().mockResolvedValue([createdNote]);
        sync.updateNotes = vi.fn().mockResolvedValue({updated: [], skipped: []});
        sync.deleteNotes = vi.fn().mockResolvedValue([]);
        sync.updateAssets = vi.fn().mockResolvedValue(0);
        ankiConnectMock.invoke.mockResolvedValue(null);

        const result = await sync.executeSyncPlan([createdNote], [], [], {} as any, {
            autoSync: true,
            silentProgress: true,
            skippedDelete: 0
        });

        expect(result.changed).toBe(true);
        expect(ankiConnectMock.invoke).toHaveBeenCalledWith("reloadCollection", {});
    });

    test("force regenerate mode disables update hash skipping", async () => {
        const sync = new LogseqToAnkiSync() as any;
        sync.modelName = "Model";
        sync.logseqLinkGraphName = "LinkGraph";
        const failedUpdated = {};
        const ankiNoteManager = {};
        const progressNotification = {increment: vi.fn()};
        const getCurrentGraphSpy = vi
            .spyOn(LogseqProxy.App, "getCurrentGraph")
            .mockResolvedValue({path: "/graph"} as any);
        const getPluginSettingsSpy = vi
            .spyOn(LogseqProxy.Settings, "getPluginSettings")
            .mockReturnValue({skipOnDependencyHashMatch: true} as any);
        updateNotesTaskExecuteMock.mockResolvedValue({
            succeeded: [updateNote],
            skipped: [],
            failed: {}
        });

        try {
            await sync.updateNotes(
                [updateNote as any],
                failedUpdated,
                ankiNoteManager,
                progressNotification,
                {autoSync: false, forceRegenerate: true}
            );

            expect(updateNotesTaskExecuteMock).toHaveBeenCalledWith(
                [updateNote],
                "Model",
                "LinkGraph",
                "/graph",
                ankiNoteManager,
                progressNotification,
                {skipUnchangedNotes: false}
            );
            expect(getPluginSettingsSpy).not.toHaveBeenCalled();
        } finally {
            getCurrentGraphSpy.mockRestore();
            getPluginSettingsSpy.mockRestore();
        }
    });
});
