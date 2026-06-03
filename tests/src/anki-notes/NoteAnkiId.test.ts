import {beforeEach, describe, expect, test, vi} from "vitest";
import {Note} from "../../../src/anki-notes/Note";

class TestNote extends Note {
    public type = "cloze";

    async getClozedContentHTML() {
        return {html: "", assets: new Set<string>(), tags: new Set<string>()};
    }
}

describe("Note.getAnkiId", () => {
    const getAnkiIdByUuidType = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        Note.setAnkiNoteManager({getAnkiIdByUuidType} as any);
    });

    test("resolves note ID through the manager uuid-type index", () => {
        getAnkiIdByUuidType.mockReturnValue(100);
        const note = new TestNote("block-uuid", "content", "markdown", {}, 42, []);

        expect(note.getAnkiId()).toBe(100);
        expect(getAnkiIdByUuidType).toHaveBeenCalledWith("block-uuid-cloze");
    });

    test("returns null when the manager has no indexed note", () => {
        getAnkiIdByUuidType.mockReturnValue(null);
        const note = new TestNote("block-uuid", "content", "markdown", {}, 42, []);

        expect(note.getAnkiId()).toBeNull();
    });
});
