import {createLogger, LoggerCategory} from "../../logger";
import * as AnkiConnect from "../AnkiConnect";
import type {AnkiNoteInfo} from "../types";

const logger = createLogger(LoggerCategory.LazyAnkiNoteManagerInternal);

export class AnkiNoteCache {
    private noteInfoMap: Map<number, AnkiNoteInfo> = new Map();
    private noteIdByUuidType: Map<string, number> = new Map();
    private mediaInfo: Set<string> | null = null;

    async buildNoteInfoMap(modelName: string): Promise<void> {
        this.noteInfoMap = new Map();
        this.noteIdByUuidType = new Map();

        const noteIds = await AnkiConnect.query(`"note:${modelName}"`);
        const notes = await AnkiConnect.invoke("notesInfo", {notes: noteIds});

        // Build reverse lookup: card ID → deck name
        const cardIds = notes.map((note: any) => note.cards[0]).filter(Boolean);
        const decks = await AnkiConnect.invoke("getDecks", {cards: cardIds});
        const cardToDeck = new Map<string, string>();
        for (const [deckName, cards] of Object.entries(decks)) {
            for (const cardId of cards as any[]) {
                cardToDeck.set(cardId.toString(), deckName);
            }
        }

        // Add deck info based on first card to note object
        for (const note of notes) {
            const noteId = AnkiNoteCache.parseNoteId(note.noteId);
            if (noteId === null) {
                logger.warn("Skipping Anki note with invalid noteId", note);
                continue;
            }

            const firstCardId = note.cards[0];
            const deck = firstCardId ? cardToDeck.get(firstCardId.toString()) || "" : "";
            const noteInfo = {...note, noteId, deck};
            this.noteInfoMap.set(noteId, noteInfo);

            const uuidType = noteInfo.fields?.["uuid-type"]?.value;
            if (
                typeof uuidType === "string" &&
                uuidType.trim() !== "" &&
                !this.noteIdByUuidType.has(uuidType)
            ) {
                this.noteIdByUuidType.set(uuidType, noteId);
            }
        }

        logger.debug("noteInfoMap built", this.noteInfoMap);
    }

    async buildMediaInfo(): Promise<void> {
        const mediaFileNames = await AnkiConnect.invoke("getMediaFilesNames", {});
        this.mediaInfo = new Set(mediaFileNames);

        logger.debug("mediaInfo built", this.mediaInfo);
    }

    getNoteInfo(ankiId: number): AnkiNoteInfo | undefined {
        return this.noteInfoMap.get(ankiId);
    }

    getNoteIdByUuidType(uuidType: string): number | null {
        return this.noteIdByUuidType.get(uuidType) ?? null;
    }

    async hasMedia(filename: string): Promise<boolean> {
        if (this.mediaInfo == null) {
            await this.buildMediaInfo();
        }

        return this.mediaInfo.has(filename);
    }

    get noteInfoMapRaw(): Map<number, AnkiNoteInfo> {
        return this.noteInfoMap;
    }

    get mediaInfoRaw(): Set<string> {
        return this.mediaInfo ?? new Set();
    }

    private static parseNoteId(noteId: unknown): number | null {
        if (typeof noteId === "number" && Number.isFinite(noteId)) {
            return noteId;
        }

        if (typeof noteId === "string" && /^\d+$/.test(noteId.trim())) {
            return Number(noteId);
        }

        return null;
    }
}
