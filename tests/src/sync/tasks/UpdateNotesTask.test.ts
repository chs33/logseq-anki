import {beforeEach, describe, expect, test, vi} from "vitest";

const noteHashCalculatorMock = vi.hoisted(() => ({
    getHash: vi.fn()
}));

const parseNoteMock = vi.hoisted(() => vi.fn());

const makeAssetUrlMock = vi.hoisted(() => vi.fn());

vi.mock("../../../../src/sync/cache", () => ({
    NoteHashCalculator: noteHashCalculatorMock
}));

vi.mock("../../../../src/sync/parsers/NoteParser", () => ({
    parseNote: parseNoteMock
}));

vi.mock("../../../../src/logseq/LogseqProxy", () => ({
    LogseqProxy: {
        Settings: {
            getPluginSettings: vi.fn(() => ({skipOnDependencyHashMatch: true}))
        }
    }
}));

vi.mock("../../../../src/logseq/WindowParentBridge", () => ({
    WindowParentBridge: {
        makeAssetUrl: makeAssetUrlMock
    }
}));

import {UpdateNotesTask} from "../../../../src/sync/tasks/UpdateNotesTask";

function createNote() {
    return {
        uuid: "note-uuid",
        type: "cloze",
        pageId: 42,
        getAnkiId: vi.fn(() => 100)
    };
}

function createAnkiNoteManager(
    options: {mediaInfo?: Set<string>; successfulNotes?: string[]} = {}
) {
    return {
        noteInfoMap: new Map([
            [
                100,
                {
                    cards: [200],
                    deck: "Default",
                    tags: ["existing-tag"],
                    fields: {
                        Config: {
                            value: JSON.stringify({
                                dependencyHash: 123,
                                assets: ["../assets/existing.png"]
                            })
                        },
                        Text: {value: "old html"},
                        Breadcrumb: {value: "old breadcrumb"}
                    }
                }
            ]
        ]),
        mediaInfo: options.mediaInfo ?? new Set(["existing.png"]),
        storeAsset: vi.fn(),
        updateNote: vi.fn(),
        executeUpdateNotes: vi.fn().mockResolvedValue({
            successfulNotes: options.successfulNotes ?? [],
            failedNotes: []
        })
    };
}

describe("UpdateNotesTask", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        noteHashCalculatorMock.getHash.mockReset();
        parseNoteMock.mockReset();
        makeAssetUrlMock.mockReset();
        makeAssetUrlMock.mockImplementation((asset: string) => `asset-url:${asset}`);
    });

    test("skips parsing and updating when dependency hash matches", async () => {
        const note = createNote();
        const ankiNoteManager = createAnkiNoteManager();
        const progressNotification = {increment: vi.fn()};
        noteHashCalculatorMock.getHash.mockResolvedValue(123);

        const result = await new UpdateNotesTask().execute(
            [note as any],
            "Model",
            "Graph",
            "/graph",
            ankiNoteManager as any,
            progressNotification as any,
            {skipUnchangedNotes: true}
        );

        expect(parseNoteMock).not.toHaveBeenCalled();
        expect(ankiNoteManager.updateNote).not.toHaveBeenCalled();
        expect(ankiNoteManager.storeAsset).not.toHaveBeenCalled();
        expect(result.succeeded).toEqual([]);
        expect(result.skipped).toEqual([note]);
        expect(result.failed).toEqual({});
        expect(progressNotification.increment).toHaveBeenCalledTimes(1);
    });

    test("restores missing media without rendering the unchanged note", async () => {
        const note = createNote();
        const ankiNoteManager = createAnkiNoteManager({mediaInfo: new Set()});
        const progressNotification = {increment: vi.fn()};
        noteHashCalculatorMock.getHash.mockResolvedValue(123);

        const result = await new UpdateNotesTask().execute(
            [note as any],
            "Model",
            "Graph",
            "/graph",
            ankiNoteManager as any,
            progressNotification as any,
            {skipUnchangedNotes: true}
        );

        expect(parseNoteMock).not.toHaveBeenCalled();
        expect(ankiNoteManager.updateNote).not.toHaveBeenCalled();
        expect(makeAssetUrlMock).toHaveBeenCalledWith("../assets/existing.png");
        expect(ankiNoteManager.storeAsset).toHaveBeenCalledWith(
            "existing.png",
            "asset-url:../assets/existing.png"
        );
        expect(result.skipped).toEqual([note]);
    });

    test("renders and queues an update when dependency hash differs", async () => {
        const note = createNote();
        const ankiNoteManager = createAnkiNoteManager({successfulNotes: ["note-uuid-cloze"]});
        const progressNotification = {increment: vi.fn()};
        noteHashCalculatorMock.getHash.mockResolvedValueOnce(111).mockResolvedValueOnce(222);
        parseNoteMock.mockResolvedValue([
            "new html",
            new Set(["assets/new.png"]),
            "NewDeck",
            "new breadcrumb",
            ["new-tag"]
        ]);

        const result = await new UpdateNotesTask().execute(
            [note as any],
            "Model",
            "Graph",
            "/graph",
            ankiNoteManager as any,
            progressNotification as any,
            {skipUnchangedNotes: true}
        );

        expect(parseNoteMock).toHaveBeenCalledWith(note, "Graph");
        expect(ankiNoteManager.updateNote).toHaveBeenCalledWith(
            100,
            "NewDeck",
            "Model",
            expect.objectContaining({
                "uuid-type": "note-uuid-cloze",
                "Logseq Block UUID": "note-uuid",
                "Logseq Page Id": "42",
                Text: "new html",
                Breadcrumb: "new breadcrumb",
                Config: JSON.stringify({
                    dependencyHash: 222,
                    assets: ["assets/new.png"]
                })
            }),
            ["new-tag"]
        );
        expect(result.succeeded).toEqual([note]);
        expect(result.skipped).toEqual([]);
    });

    test("honors explicit request to update even when dependency hash matches", async () => {
        const note = createNote();
        const ankiNoteManager = createAnkiNoteManager({successfulNotes: ["note-uuid-cloze"]});
        const progressNotification = {increment: vi.fn()};
        noteHashCalculatorMock.getHash.mockResolvedValueOnce(123).mockResolvedValueOnce(123);
        parseNoteMock.mockResolvedValue([
            "old html",
            new Set(["../assets/existing.png"]),
            "Default",
            "old breadcrumb",
            ["existing-tag"]
        ]);

        const result = await new UpdateNotesTask().execute(
            [note as any],
            "Model",
            "Graph",
            "/graph",
            ankiNoteManager as any,
            progressNotification as any,
            {skipUnchangedNotes: false}
        );

        expect(parseNoteMock).toHaveBeenCalled();
        expect(ankiNoteManager.updateNote).toHaveBeenCalled();
        expect(result.succeeded).toEqual([note]);
        expect(result.skipped).toEqual([]);
    });
});
