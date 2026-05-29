import "@logseq/libs";
import type {PageEntity} from "@logseq/libs/dist/LSPlugin";
import {afterEach, beforeEach, describe, expect, test, vi} from "vitest";
import {MultilineCardNote} from "../../../src/anki-notes/MultilineCardNote";
import {Note} from "../../../src/anki-notes/Note";
import {LogseqProxy} from "../../../src/logseq/LogseqProxy";

describe("MultilineCardNote E2E Tests", () => {
    let page: PageEntity;

    beforeEach(async () => {
        page = await logseq.Editor.createPage(
            "Test MultilineCardNote E2E",
            {},
            {redirect: false, createFirstBlock: false}
        );
        await new Promise((resolve) => setTimeout(resolve, 100));
    });

    afterEach(async () => {
        await logseq.Editor.deletePage("Test MultilineCardNote E2E");
        await new Promise((resolve) => setTimeout(resolve, 100));
    });

    test.skipIf(!globalThis.isLogseqAvailable)("Creates note with #card tag", async () => {
        const initialNotes = await MultilineCardNote.getNotesFromLogseqBlocks([]);
        const initialCount = initialNotes.length;

        const parentBlock = await logseq.Editor.appendBlockInPage(page.uuid, "Parent #card");
        await logseq.Editor.insertBlock(parentBlock.uuid, "Child");
        await new Promise((resolve) => setTimeout(resolve, 100));

        const finalNotes = await MultilineCardNote.getNotesFromLogseqBlocks([]);
        expect(finalNotes.length).toBe(initialCount + 1);
    });

    test.skipIf(!globalThis.isLogseqAvailable)("Creates note with #flashcard tag", async () => {
        const initialNotes = await MultilineCardNote.getNotesFromLogseqBlocks([]);
        const initialCount = initialNotes.length;

        const parentBlock = await logseq.Editor.appendBlockInPage(page.uuid, "Parent #flashcard");
        await logseq.Editor.insertBlock(parentBlock.uuid, "Child");
        await new Promise((resolve) => setTimeout(resolve, 100));

        const finalNotes = await MultilineCardNote.getNotesFromLogseqBlocks([]);
        expect(finalNotes.length).toBe(initialCount + 1);
    });

    test.skipIf(!globalThis.isLogseqAvailable)(
        "Creates multiple notes with #card-group tag",
        async () => {
            const initialNotes = await MultilineCardNote.getNotesFromLogseqBlocks([]);
            const initialCount = initialNotes.length;

            const rootBlock = await logseq.Editor.appendBlockInPage(page.uuid, "Root");

            const card1Parent = await logseq.Editor.insertBlock(
                rootBlock.uuid,
                "Parent Card 1 #card-group"
            );
            await logseq.Editor.insertBlock(card1Parent.uuid, "Child Card 1");

            const card2Parent = await logseq.Editor.insertBlock(
                rootBlock.uuid,
                "Parent Card 2 #card-group"
            );
            await logseq.Editor.insertBlock(card2Parent.uuid, "Child Card 2");
            await new Promise((resolve) => setTimeout(resolve, 100));

            const finalNotes = await MultilineCardNote.getNotesFromLogseqBlocks([]);
            expect(finalNotes.length).toBe(initialCount + 2);
        }
    );
});

describe("MultilineCardNote DB card-group filtering", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    test("skips imported parent property value children but keeps real card-group children", async () => {
        vi.spyOn(LogseqProxy.App, "checkCurrentIsDbGraph").mockResolvedValue(true);
        vi.spyOn(LogseqProxy.DB, "datascriptQuery")
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([
                [{uuid: "deck-artifact", page: {id: 1}, parent: {id: 10}}],
                [{uuid: "real-card", page: {id: 1}, parent: {id: 10}}],
                [{uuid: "embed-wrapper", page: {id: 1}, parent: {id: 10}}]
            ] as any);
        vi.spyOn(LogseqProxy.Editor, "getBlock").mockImplementation(async (id: any) => {
            if (id === 10) {
                return {
                    uuid: "card-group-parent",
                    content: "uuid:: card-group-parent\ndeck:: [[Project Deck]]\nParent",
                    format: "markdown",
                    properties: {
                        deck: {name: "Project Deck"},
                        tags: ["card-group", "forward"],
                        uuid: "card-group-parent"
                    },
                    children: []
                } as any;
            }

            if (id === "deck-artifact") {
                return {
                    uuid: "deck-artifact",
                    content: "uuid:: deck-artifact\n[[Project Deck]]",
                    format: "markdown",
                    properties: {uuid: "deck-artifact"},
                    children: []
                } as any;
            }

            if (id === "real-card") {
                return {
                    uuid: "real-card",
                    content: "uuid:: real-card\nReal card content",
                    format: "markdown",
                    properties: {uuid: "real-card"},
                    children: []
                } as any;
            }

            if (id === "embed-wrapper") {
                return {
                    uuid: "embed-wrapper",
                    content: "uuid:: embed-wrapper\nlink:: 123",
                    format: "markdown",
                    properties: {uuid: "embed-wrapper", link: 123},
                    children: []
                } as any;
            }

            return null;
        });
        vi.spyOn(Note, "removeUnwantedNotes").mockImplementation(
            async (notes) => notes.filter(Boolean) as Note[]
        );

        const notes = await MultilineCardNote.getNotesFromLogseqBlocks([]);

        expect(notes.map((note) => note.uuid)).toEqual(["real-card", "embed-wrapper"]);
        expect(notes[0].tags).toEqual(["card-group", "forward"]);
        expect(notes[1].tags).toEqual(["card-group", "forward"]);
    });

    test("keeps DB embed wrapper after shared property-only filtering", async () => {
        const note = new MultilineCardNote(
            "embed-wrapper",
            "uuid:: embed-wrapper\nlink:: 123",
            "markdown",
            {uuid: "embed-wrapper", link: 123},
            1,
            ["card-group"],
            []
        );

        const notes = await Note.removeUnwantedNotes([note]);

        expect(notes.map((remainingNote) => remainingNote.uuid)).toEqual(["embed-wrapper"]);
    });
});
