import "@logseq/libs";
import _ from "lodash";
import type {LazyAnkiNoteManager} from "../anki-connect/LazyAnkiNoteManager";
import {MD_PROPERTIES_REGEXP, ORG_PROPERTIES_REGEXP} from "../constants";
import {createLogger, LoggerCategory} from "../logger";
import type {DependencyEntity} from "../logseq/getLogseqContentDirectDependencies";
import getParentBlockIdentity from "../logseq/getParentBlockIdentity";
import {LogseqProxy} from "../logseq/LogseqProxy";
import type {HTMLFile} from "../logseq/LogseqToHtmlConverter";
import {getLogseqBlockPropSafe} from "../utils/utils";

const logger = createLogger(LoggerCategory.AnkiNotes);

export abstract class Note {
    public uuid: string;
    public content: string;
    public format: string;
    public properties: any;
    public pageId: number;
    public type: string;
    public ankiId: number;
    public tags: string[];
    static ankiNoteManager: LazyAnkiNoteManager;

    public constructor(
        uuid: string,
        content: string,
        format: string,
        properties: any,
        pageId: number,
        tags: string[]
    ) {
        this.uuid = uuid;
        this.content = content;
        this.format = format;
        this.properties = properties;
        this.pageId = pageId;
        this.tags = tags;
    }

    public static setAnkiNoteManager(ankiNoteManager: LazyAnkiNoteManager) {
        Note.ankiNoteManager = ankiNoteManager;
    }

    public abstract getClozedContentHTML(): Promise<HTMLFile>;

    public getContent(): string {
        return this.content;
    }

    public getAnkiId(): number {
        if (this.ankiId) return this.ankiId;
        const ankiNotesArr = Array.from(Note.ankiNoteManager.noteInfoMap.values());
        const filteredankiNotesArr = ankiNotesArr.filter(
            (note) => note.fields["uuid-type"].value === `${this.uuid}-${this.type}`
        );
        if (filteredankiNotesArr.length === 0) this.ankiId = null;
        else
            this.ankiId =
                typeof filteredankiNotesArr[0].noteId === "number"
                    ? filteredankiNotesArr[0].noteId
                    : parseInt(filteredankiNotesArr[0].noteId, 10);
        return this.ankiId;
    }

    public getBlockDependencies(): DependencyEntity[] {
        return [this.uuid].map((block) => ({type: "Block", value: block}) as DependencyEntity);
    }

    public static initLogseqOperations = () => {
        logseq.provideStyle(`
            .anki_only {
                display: none;
            }
            .page-reference[data-ref=hide-all-card-parent], a[data-ref=hide-all-card-parent] {
                opacity: .3;
            }
            .page-reference[data-ref=hide-when-card-parent], a[data-ref=hide-when-card-parent] {
                opacity: .3;
            }
        `);
        LogseqProxy.Editor.createTagSilentlyIfNotExists("hide-all-card-parent");
        LogseqProxy.Editor.createTagSilentlyIfNotExists("hide-when-card-parent");
        LogseqProxy.Editor.createTagSilentlyIfNotExists("hide-all-test-one");
        LogseqProxy.Editor.registerProperty("tags", {
            type: "node",
            cardinality: "many",
            hide: false
        });
        LogseqProxy.Editor.registerProperty("disable-anki-sync", {
            type: "checkbox",
            cardinality: "one",
            hide: false
        });
        LogseqProxy.Editor.registerProperty("suspend-anki-card", {
            type: "checkbox",
            cardinality: "one",
            hide: false
        });
        // TODO: Add EXTRA, ANKI_ONLY here
    };

    public static async removeUnwantedNotes(notes: Note[]): Promise<Note[]> {
        let newNotes = notes;
        newNotes = _.uniqBy(newNotes, "uuid");
        newNotes = _.without(newNotes, undefined, null);
        newNotes = _.filter(newNotes, (note) => {
            // Remove template blocks and blocks without uuid
            return note?.properties?.template == null || false || note?.uuid == null;
        });
        newNotes = _.filter(newNotes, (note) => !Note.isPropertyOnlyBlock(note));
        newNotes = (
            await Promise.all(
                newNotes.map(async (note) => {
                    let isAnkiSyncDisabled = null;
                    try {
                        let parentBlockUUID: string | number = note.uuid;
                        while (parentBlockUUID != null) {
                            const parentBlock = await LogseqProxy.Editor.getBlock(parentBlockUUID);
                            if (parentBlock == null) break;
                            if (
                                [true, "true"].includes(
                                    getLogseqBlockPropSafe(
                                        parentBlock,
                                        "properties.disable-anki-sync"
                                    )
                                )
                            ) {
                                isAnkiSyncDisabled = true;
                                break;
                            } else if (
                                [false, "false"].includes(
                                    getLogseqBlockPropSafe(
                                        parentBlock,
                                        "properties.disable-anki-sync"
                                    )
                                )
                            ) {
                                isAnkiSyncDisabled = false;
                                break;
                            }
                            parentBlockUUID = getParentBlockIdentity(parentBlock);
                        }
                    } catch (e) {
                        logger.error(e);
                    }

                    if (isAnkiSyncDisabled === null) {
                        try {
                            // Check parents for disable-anki-sync prop
                            const page = await LogseqProxy.Editor.getPage(note.pageId);
                            const parents = await LogseqProxy.Editor.getParentNamespacePages(page);
                            const hierarchy = [page, ...parents];

                            for (const page of hierarchy) {
                                if (
                                    [true, "true"].includes(
                                        getLogseqBlockPropSafe(page, "properties.disable-anki-sync")
                                    )
                                ) {
                                    isAnkiSyncDisabled = true;
                                    break;
                                } else if (
                                    [false, "false"].includes(
                                        getLogseqBlockPropSafe(page, "properties.disable-anki-sync")
                                    )
                                ) {
                                    isAnkiSyncDisabled = false;
                                    break;
                                }
                            }
                        } catch (e) {
                            logger.error(e);
                        }
                    }

                    if (isAnkiSyncDisabled === true) return null;
                    return note;
                })
            )
        ).filter((note) => note !== null);
        return newNotes;
    }

    private static isPropertyOnlyBlock(note: Note): boolean {
        if (!note?.content) return true;
        if (Note.isDbEmbedLinkNote(note)) return false;

        const contentWithoutProperties = note.content
            .replace(ORG_PROPERTIES_REGEXP, "")
            .replace(MD_PROPERTIES_REGEXP, "")
            .trim();

        return contentWithoutProperties === "";
    }

    private static isDbEmbedLinkNote(note: Note): boolean {
        return Boolean(_.get(note, "properties.link") || /^link::\s*\S+/m.test(note.content));
    }

    // public static async abstract getBlocksFromLogseq(): Block[];
}
