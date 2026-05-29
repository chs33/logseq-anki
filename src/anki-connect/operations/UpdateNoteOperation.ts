import _ from "lodash";
import {createLogger, LoggerCategory} from "../../logger";
import {AnkiActionQueue} from "../internal/AnkiActionQueue";
import type {AnkiNoteCache} from "../internal/AnkiNoteCache";
import type {AnkiNoteFields, OperationFailure, UpdateNotesResult} from "../types";

const logger = createLogger(LoggerCategory.LazyAnkiNoteManagerInternal);

export class UpdateNoteOperation {
    private queue: AnkiActionQueue = new AnkiActionQueue();
    private uuidTypeQueue: string[] = [];

    constructor(private cache: AnkiNoteCache) {}

    updateNote(
        ankiId: number,
        deckName: string,
        modelName: string,
        fields: AnkiNoteFields,
        tags: string[]
    ): void {
        const noteinfo = this.cache.getNoteInfo(ankiId);
        if (!noteinfo) {
            logger.error(`Note ${ankiId} not found in cache`);
            return;
        }

        const cards = noteinfo.cards;

        // Change deck if needed
        if (deckName !== noteinfo.deck) {
            this.queue.push({
                action: "changeDeck",
                params: {cards: cards, deck: deckName}
            });
            this.uuidTypeQueue.push(fields["uuid-type"]);
        }

        // Handle tag changes. Anki treats tag names case-insensitively and may preserve
        // an existing canonical casing, so compare normalized names to avoid repeated churn.
        const currentTagNames = new Set(noteinfo.tags.map((tag) => tag.toLowerCase()));
        const desiredTagNames = new Set(tags.map((tag) => tag.toLowerCase()));
        const to_remove_tags = noteinfo.tags.filter((tag) => {
            const normalizedTag = tag.toLowerCase();
            return (
                normalizedTag !== "leech" &&
                normalizedTag !== "marked" &&
                !desiredTagNames.has(normalizedTag)
            );
        });
        const to_add_tags = tags.filter((tag) => !currentTagNames.has(tag.toLowerCase()));

        for (const tag of to_remove_tags) {
            this.queue.push({
                action: "removeTags",
                params: {notes: [ankiId], tags: tag}
            });
            this.uuidTypeQueue.push(fields["uuid-type"]);
        }

        for (const tag of to_add_tags) {
            this.queue.push({
                action: "addTags",
                params: {notes: [ankiId], tags: tag}
            });
            this.uuidTypeQueue.push(fields["uuid-type"]);
        }

        // Check if fields need update
        let needsFieldUpdate = false;
        for (const key in fields) {
            if (
                noteinfo.fields[key as keyof typeof fields]?.value !==
                fields[key as keyof typeof fields]
            ) {
                logger.info("Field difference found", {
                    key,
                    oldValue: noteinfo.fields[key as keyof typeof fields]?.value,
                    newValue: fields[key as keyof typeof fields]
                });
                needsFieldUpdate = true;
                break;
            }
        }

        if (needsFieldUpdate) {
            this.queue.push({
                action: "updateNoteFields",
                params: {
                    note: {
                        id: ankiId,
                        deckName: deckName,
                        modelName: modelName,
                        fields: fields
                    }
                }
            });
            this.uuidTypeQueue.push(fields["uuid-type"]);
        }
    }

    async execute(): Promise<UpdateNotesResult> {
        logger.info("Executing update notes operation", this.queue);

        const result = await this.queue.execute();

        logger.info("Update notes operation completed", {resultCount: result.length});

        const successfulNotes: string[] = [];
        const failedNotes: OperationFailure[] = [];
        for (let i = 0; i < result.length; i++) {
            const uuidType = this.uuidTypeQueue[i];
            if (result[i]?.error) {
                const error = result[i].error;
                failedNotes.push({
                    identifier: uuidType,
                    error: typeof error === "string" ? new Error(error) : error
                });
            } else {
                successfulNotes.push(uuidType);
            }
        }

        this.queue.clear();
        this.uuidTypeQueue = [];

        const uniqueSuccessfulNotes = _.uniq(successfulNotes);
        logger.info("Update notes operation completed", {
            successfulNotes: uniqueSuccessfulNotes,
            failedNotes
        });
        return {successfulNotes: uniqueSuccessfulNotes, failedNotes};
    }
}
