import {beforeEach, describe, expect, test, vi} from "vitest";
import type {SyncResult} from "../../../src/sync/types";

const progressNotificationMock = vi.hoisted(() =>
    vi.fn(function ProgressNotification() {
        this.increment = vi.fn();
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

import {LogseqProxy} from "../../../src/logseq/LogseqProxy";
import {LogseqToAnkiSync} from "../../../src/sync/syncLogseqToAnki";

const createNote = {uuid: "create-uuid", type: "cloze", properties: {id: "create-uuid"}};
const updateNote = {uuid: "update-uuid", type: "cloze", properties: {id: "update-uuid"}};

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
    sync.persistLogseqBlockIds = vi.fn().mockResolvedValue(undefined);
    sync.createSyncPlan = vi.fn().mockResolvedValue({
        toCreateNotesOriginal: [createNote],
        toUpdateNotesOriginal: [updateNote],
        toDeleteNotesOriginal: [123]
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
        LogseqToAnkiSync.isSyncing = false;
        ankiConnectMock.invoke.mockResolvedValue(null);
    });

    test("auto mode does not open the manual selection dialog", async () => {
        const sync = buildSync(createSyncResult(false));

        await sync.sync({mode: "auto", triggerAnkiWebSync: false});

        expect(sync.getUserConfirmation).not.toHaveBeenCalled();
    });

    test("auto mode includes deletes", async () => {
        const sync = buildSync(createSyncResult(false));

        await sync.sync({mode: "auto", triggerAnkiWebSync: false});

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

    test("manual sync stores duration metadata on the completed result", async () => {
        const sync = buildSync(createSyncResult(false));

        const outcome = await sync.sync();

        expect(outcome.status).toBe("completed");
        expectSyncTiming(outcome.result, "manual");
        expectSyncTiming(getStoredLastSyncResult(), "manual");
    });

    test("auto no-change sync still stores last sync details with duration metadata", async () => {
        const sync = buildSync(createSyncResult(false));

        const outcome = await sync.sync({mode: "auto", triggerAnkiWebSync: false});

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

        const outcome = await sync.sync({mode: "auto", triggerAnkiWebSync: false});

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
            const outcome = await sync.sync({mode: "auto", triggerAnkiWebSync: false});

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

        await sync.sync({mode: "auto", triggerAnkiWebSync: true});

        expect(ankiConnectMock.invoke).toHaveBeenCalledWith("sync", {});
    });

    test("AnkiWeb sync is skipped when auto mode finds no changes", async () => {
        const sync = buildSync(createSyncResult(false));

        await sync.sync({mode: "auto", triggerAnkiWebSync: true});

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
