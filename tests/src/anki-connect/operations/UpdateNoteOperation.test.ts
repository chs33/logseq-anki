import {beforeEach, describe, expect, test, vi} from "vitest";

const ankiConnectMock = vi.hoisted(() => ({
    invoke: vi.fn()
}));

vi.mock("../../../../src/anki-connect/AnkiConnect", () => ankiConnectMock);

import {UpdateNoteOperation} from "../../../../src/anki-connect/operations/UpdateNoteOperation";

function createOperation(existingTags: string[]) {
    const fields = {
        "uuid-type": {value: "note-uuid-cloze"},
        "Logseq Block UUID": {value: "note-uuid"},
        "Logseq Page Id": {value: "42"},
        Text: {value: "html"},
        Breadcrumb: {value: "breadcrumb"},
        Config: {value: "{}"}
    };

    const cache = {
        getNoteInfo: vi.fn(() => ({
            noteId: 100,
            cards: [200],
            deck: "Default",
            tags: existingTags,
            fields
        }))
    };

    return new UpdateNoteOperation(cache as any);
}

describe("UpdateNoteOperation", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    test("does not queue tag updates for case-only tag differences", async () => {
        const operation = createOperation(["card", "Page"]);

        operation.updateNote(
            100,
            "Default",
            "Model",
            {
                "uuid-type": "note-uuid-cloze",
                "Logseq Block UUID": "note-uuid",
                "Logseq Page Id": "42",
                Text: "html",
                Breadcrumb: "breadcrumb",
                Config: "{}"
            },
            ["Card", "page"]
        );

        const result = await operation.execute();

        expect(result.successfulNotes).toEqual([]);
        expect(result.failedNotes).toEqual([]);
        expect(ankiConnectMock.invoke).not.toHaveBeenCalled();
    });
});
