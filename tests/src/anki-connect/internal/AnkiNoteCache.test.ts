import {beforeEach, describe, expect, test, vi} from "vitest";

const ankiConnectMock = vi.hoisted(() => ({
    invoke: vi.fn(),
    query: vi.fn()
}));

vi.mock("../../../../src/anki-connect/AnkiConnect", () => ankiConnectMock);

import {AnkiNoteCache} from "../../../../src/anki-connect/internal/AnkiNoteCache";

function mockAnkiNotes(notes: any[], decks: Record<string, number[]> = {Default: [10, 20, 30]}) {
    ankiConnectMock.query.mockResolvedValue(notes.map((note) => note.noteId));
    ankiConnectMock.invoke.mockImplementation(async (action: string) => {
        if (action === "notesInfo") return notes;
        if (action === "getDecks") return decks;
        return null;
    });
}

function createAnkiNote(noteId: number | string, uuidType?: unknown, cardId = 10) {
    return {
        noteId,
        cards: [cardId],
        fields:
            uuidType === undefined
                ? {}
                : {
                      "uuid-type": {
                          value: uuidType
                      }
                  },
        tags: []
    };
}

describe("AnkiNoteCache", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    test("indexes Anki note IDs by uuid-type", async () => {
        const cache = new AnkiNoteCache();
        mockAnkiNotes([createAnkiNote(100, "block-uuid-cloze")], {Deck: [10]});

        await cache.buildNoteInfoMap("Model");

        expect(cache.getNoteIdByUuidType("block-uuid-cloze")).toBe(100);
        expect(cache.getNoteInfo(100)?.deck).toBe("Deck");
    });

    test("returns null when uuid-type is not present", async () => {
        const cache = new AnkiNoteCache();
        mockAnkiNotes([createAnkiNote(100, "block-uuid-cloze")]);

        await cache.buildNoteInfoMap("Model");

        expect(cache.getNoteIdByUuidType("missing-cloze")).toBeNull();
    });

    test("keeps the first duplicate uuid-type and ignores malformed field data", async () => {
        const cache = new AnkiNoteCache();
        mockAnkiNotes([
            createAnkiNote("100", "duplicate-cloze", 10),
            createAnkiNote(200, "duplicate-cloze", 20),
            createAnkiNote(300, undefined, 30),
            createAnkiNote(400, 123, 40)
        ]);

        await expect(cache.buildNoteInfoMap("Model")).resolves.toBeUndefined();

        expect(cache.getNoteIdByUuidType("duplicate-cloze")).toBe(100);
        expect(cache.getNoteIdByUuidType("123")).toBeNull();
    });

    test("loads Anki media names lazily", async () => {
        const cache = new AnkiNoteCache();
        mockAnkiNotes([]);
        ankiConnectMock.invoke.mockImplementation(async (action: string) => {
            if (action === "notesInfo") return [];
            if (action === "getDecks") return {};
            if (action === "getMediaFilesNames") return ["image.png"];
            return null;
        });

        await cache.buildNoteInfoMap("Model");

        expect(ankiConnectMock.invoke).not.toHaveBeenCalledWith("getMediaFilesNames", {});
        await expect(cache.hasMedia("image.png")).resolves.toBe(true);
        expect(ankiConnectMock.invoke).toHaveBeenCalledWith("getMediaFilesNames", {});
    });
});
