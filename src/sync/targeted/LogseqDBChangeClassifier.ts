import type {BlockEntity, IDatom} from "@logseq/libs/dist/LSPlugin";
import type {
    ChangedEntitySummary,
    ClassifiedDBChange,
    LogseqDBChangeEvent,
    TargetedChangeBatch,
    TargetedEventClassification
} from "./types";

const TARGETABLE_OUTLINER_OPERATIONS = new Set([
    "create-page",
    "cycle-todos",
    "delete-blocks",
    "indent-outdent-blocks",
    "insert-blocks",
    "insert-template-blocks",
    "move-blocks",
    "move-blocks-up-down",
    "paste",
    "remove-block-property",
    "rename-page",
    "save-block",
    "set-block-properties",
    "set-block-property",
    "toggle-reaction"
]);

const REQUIRES_FULL_SYNC_OUTLINER_OPERATIONS = new Set([
    "add-existing-values-to-closed-values",
    "apply-template",
    "batch-delete-property-value",
    "batch-import-edn",
    "batch-remove-property",
    "batch-set-property",
    "class-add-property",
    "class-remove-property",
    "create-property-text-block",
    "create-view",
    "delete-closed-value",
    "delete-page",
    "delete-property-value",
    "recycle-delete-permanently",
    "recycle-gc",
    "restore-recycled",
    "update-property",
    "upsert-closed-value",
    "upsert-property"
]);

const isTargetableAttribute = (attribute: string): boolean =>
    [
        ":block/alias",
        ":block/content",
        ":block/created-at",
        ":block/name",
        ":block/order",
        ":block/page",
        ":block/parent",
        ":block/properties",
        ":block/refs",
        ":block/tags",
        ":block/title",
        ":block/updated-at",
        ":block/uuid"
    ].includes(attribute) ||
    attribute.startsWith(":user.property/") ||
    attribute.startsWith(":logseq.property/") ||
    attribute.includes(".property/");

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

const isValidDatom = (value: unknown): value is IDatom =>
    Array.isArray(value) &&
    value.length === 5 &&
    typeof value[0] === "number" &&
    typeof value[1] === "string" &&
    typeof value[3] === "number" &&
    typeof value[4] === "boolean";

const normalizeDeletedBlockUuids = (value: unknown): string[] | null => {
    if (value == null) return [];
    const values = Array.isArray(value) ? value : value instanceof Set ? [...value] : null;
    if (!values?.every((uuid) => typeof uuid === "string" && uuid.length > 0)) {
        return null;
    }
    return [...new Set(values.map((uuid) => uuid.toLowerCase()))];
};

const summarizeBlock = (block: BlockEntity): ChangedEntitySummary => ({
    uuid: block.uuid.toLowerCase(),
    id: block.id,
    pageId:
        typeof block.page === "object" && block.page != null && typeof block.page.id === "number"
            ? block.page.id
            : undefined,
    kind: typeof (block as BlockEntity & {name?: unknown}).name === "string" ? "page" : "block"
});

export class UnexpectedLogseqDBEventError extends Error {}

export interface ClassifierOptions {
    strict?: boolean;
}

const unexpected = (
    reason: string,
    options: ClassifierOptions,
    partial: Partial<ClassifiedDBChange> = {}
): ClassifiedDBChange => {
    if (options.strict === true) throw new UnexpectedLogseqDBEventError(reason);
    return {
        classification: "unsupported",
        reason,
        blocks: [],
        deletedBlockUuids: [],
        txAttributes: [],
        outlinerOps: [],
        changedEntities: [],
        ...partial
    };
};

export function classifyLogseqDBChange(
    value: unknown,
    options: ClassifierOptions = {}
): ClassifiedDBChange {
    if (!isRecord(value)) return unexpected("DB change payload is not an object.", options);

    const blocks = value.blocks;
    const txData = value.txData;
    const txMeta = value.txMeta;
    const deletedBlockUuids = normalizeDeletedBlockUuids(value.deletedBlockUuids);

    if (!Array.isArray(blocks)) {
        return unexpected("DB change payload has no blocks array.", options);
    }
    if (!Array.isArray(txData) || !txData.every(isValidDatom)) {
        return unexpected("DB change payload has an unexpected txData shape.", options);
    }
    if (txMeta != null && !isRecord(txMeta)) {
        return unexpected("DB change payload has an unexpected txMeta shape.", options);
    }
    if (deletedBlockUuids == null) {
        return unexpected("DB change payload has an unexpected deletedBlockUuids shape.", options);
    }
    if (blocks.length > 1000) {
        return unexpected("DB change contains more than 1,000 changed entities.", options);
    }
    if (blocks.length === 0) {
        return unexpected("DB change contains no changed block/page snapshots.", options);
    }
    if (
        !blocks.every(
            (block) =>
                isRecord(block) &&
                typeof block.id === "number" &&
                typeof block.uuid === "string" &&
                block.uuid.length > 0
        )
    ) {
        return unexpected("A changed block/page is missing its stable id or UUID.", options);
    }

    const rawOutlinerOp = (txMeta as Record<string, unknown> | undefined)?.outlinerOp;
    if (rawOutlinerOp != null && typeof rawOutlinerOp !== "string") {
        return unexpected("txMeta.outlinerOp is not a string.", options);
    }
    const outlinerOp = typeof rawOutlinerOp === "string" ? rawOutlinerOp : undefined;

    const outlinerOps = outlinerOp ? [outlinerOp] : [];
    const txAttributes = [...new Set(txData.map((datom) => datom[1]))].sort();
    const common = {
        blocks: blocks as BlockEntity[],
        deletedBlockUuids,
        txAttributes,
        outlinerOps,
        changedEntities: (blocks as BlockEntity[]).map(summarizeBlock)
    };

    if (outlinerOp && REQUIRES_FULL_SYNC_OUTLINER_OPERATIONS.has(outlinerOp)) {
        return {
            classification: "unsupported",
            reason: `Logseq operation “${outlinerOp}” can affect graph-wide card eligibility or rendering.`,
            ...common
        };
    }

    if (outlinerOp && !TARGETABLE_OUTLINER_OPERATIONS.has(outlinerOp)) {
        return unexpected(`Unknown Logseq outliner operation “${outlinerOp}”.`, options, common);
    }

    const unexpectedAttribute = txAttributes.find((attribute) => !isTargetableAttribute(attribute));
    if (unexpectedAttribute) {
        return unexpected(
            `Unknown Logseq transaction attribute “${unexpectedAttribute}”.`,
            options,
            common
        );
    }

    if (!outlinerOp && txData.length === 0 && deletedBlockUuids.length === 0) {
        return {
            classification: "ambiguous",
            reason: "DB change has neither a recognized operation nor transaction datoms.",
            ...common
        };
    }

    if (outlinerOp === "delete-blocks" && deletedBlockUuids.length === 0) {
        return {
            classification: "ambiguous",
            reason: "Block deletion did not include stable deleted UUIDs.",
            ...common
        };
    }

    return {
        classification: "targeted",
        reason: outlinerOp
            ? `Recognized Logseq operation “${outlinerOp}”.`
            : "Recognized DataScript transaction datoms.",
        ...common
    };
}

const classificationPriority: Record<TargetedEventClassification, number> = {
    targeted: 0,
    ambiguous: 1,
    unsupported: 2
};

export function mergeClassifiedDBChanges(changes: ClassifiedDBChange[]): TargetedChangeBatch {
    if (changes.length === 0) {
        throw new Error("Cannot merge an empty DB change batch.");
    }

    const decisiveChange = [...changes].sort(
        (a, b) =>
            classificationPriority[b.classification] - classificationPriority[a.classification]
    )[0];
    const blocksByUuid = new Map<string, BlockEntity>();
    for (const change of changes) {
        for (const block of change.blocks) blocksByUuid.set(block.uuid.toLowerCase(), block);
    }

    const blocks = [...blocksByUuid.values()];
    return {
        classification: decisiveChange.classification,
        reason: decisiveChange.reason,
        blocks,
        deletedBlockUuids: [...new Set(changes.flatMap((change) => change.deletedBlockUuids))],
        txAttributes: [...new Set(changes.flatMap((change) => change.txAttributes))].sort(),
        outlinerOps: [...new Set(changes.flatMap((change) => change.outlinerOps))],
        changedEntities: blocks.map(summarizeBlock),
        eventCount: changes.length
    };
}

export function isLogseqDBChangeEvent(value: unknown): value is LogseqDBChangeEvent {
    try {
        return classifyLogseqDBChange(value, {strict: true}).classification === "targeted";
    } catch {
        return false;
    }
}
