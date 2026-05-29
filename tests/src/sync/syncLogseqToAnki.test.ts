import {beforeEach, describe, expect, test, vi} from "vitest";
import type {SyncResult} from "../../../src/sync/types";

const ankiConnectMock = vi.hoisted(() => ({
    invoke: vi.fn(),
    requestPermission: vi.fn(),
    upsertModel: vi.fn()
}));

vi.mock("../../../src/anki-connect/AnkiConnect", () => ankiConnectMock);

vi.mock("../../../src/logseq/LogseqAppInfoFetcher", () => ({
    LogseqAppInfoFetcher: {
        checkHostAccess: vi.fn(() => true)
    }
}));

vi.mock("../../../src/logseq/WindowParentBridge", () => ({
    WindowParentBridge: {
        addEventListener: vi.fn(),
        dispatchLogseqAnkiSyncEvent: vi.fn(),
        dispatchEvent: vi.fn(),
        getDocument: vi.fn(() => document),
        setGlobalObject: vi.fn()
    }
}));

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

    test("auto mode omits deletes and records skipped delete count", async () => {
        const sync = buildSync(createSyncResult(false));

        await sync.sync({mode: "auto", triggerAnkiWebSync: false});

        expect(sync.executeSyncPlan).toHaveBeenCalledWith(
            [createNote],
            [updateNote],
            [],
            expect.anything(),
            {
                autoSync: true,
                silentProgress: true,
                skippedDelete: 1
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
