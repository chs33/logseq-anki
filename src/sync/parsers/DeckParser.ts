import _ from "lodash";
import type {Note} from "../../anki-notes/Note";
import {LOGSEQ_PAGE_REF_REGEXP} from "../../constants";
import {createLogger, LoggerCategory} from "../../logger";
import {LogseqProxy} from "../../logseq/LogseqProxy";
import {getLogseqBlockPropSafe} from "../../utils/utils";

const logger = createLogger(LoggerCategory.SyncInternal);
const DEFAULT_ANKI_DECK = "Default";

export class DeckParser {
    /**
     * Resolves the deck name for a note following the hierarchy:
     * 1. Block hierarchy (traverse up looking for deck property)
     * 2. Namespace hierarchy (traverse up looking for deck property)
     * 3. Default Anki deck
     */
    static async parse(note: Note): Promise<string> {
        let deck = await DeckParser.findDeckInBlockHierarchy(note);
        if (deck !== null) {
            return DeckParser.normalizeDeck(deck);
        }

        deck = await DeckParser.findDeckInNamespaceHierarchy(note);
        if (deck !== null) {
            return DeckParser.normalizeDeck(deck);
        }

        return DEFAULT_ANKI_DECK;
    }

    private static async findDeckInBlockHierarchy(note: Note): Promise<string | null> {
        try {
            let parentBlockUUID: string | number = note.uuid;
            while (parentBlockUUID != null) {
                const parentBlock = await LogseqProxy.Editor.getBlock(parentBlockUUID);
                const deck = getLogseqBlockPropSafe(parentBlock, "properties.deck");
                if (deck != null) return deck;
                parentBlockUUID = _.get(parentBlock, "parent.id", null);
            }
        } catch (e) {
            logger.error("[DeckParser] Error finding deck in block hierarchy:", e);
        }
        return null;
    }

    private static async findDeckInNamespaceHierarchy(note: Note): Promise<string | null> {
        try {
            const page = await LogseqProxy.Editor.getPage(note.pageId);
            const parents = await LogseqProxy.Editor.getParentNamespacePages(page);
            const hierarchy = [page, ...parents];
            for (const page of hierarchy) {
                const deck = getLogseqBlockPropSafe(page, "properties.deck");
                if (deck != null) return deck;
            }
        } catch (e) {
            logger.error("[DeckParser] Error finding deck in namespace hierarchy:", e);
        }
        return null;
    }

    private static async normalizeDeck(deck: any): Promise<string> {
        if (Array.isArray(deck)) deck = deck[0];
        if (typeof deck !== "string") deck = String(deck ?? "");

        deck = deck.replace(LOGSEQ_PAGE_REF_REGEXP, "$1"); // Handle direct [[Page Name]] as deck value in db versions
        const deckSegments = deck
            .split(/::|\//)
            .map((segment) => segment.trim())
            .filter(Boolean);

        return deckSegments.length > 0 ? deckSegments.join("::") : DEFAULT_ANKI_DECK;
    }
}
