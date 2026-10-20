import type {BlockEntity} from "@logseq/libs/dist/LSPlugin";
import getParentBlockIdentity from "../../logseq/getParentBlockIdentity";
import getUUIDFromBlock from "../../logseq/getUUIDFromBlock";
import {LogseqProxy} from "../../logseq/LogseqProxy";
import {
    createTargetedEntitySnapshot,
    entityIdKey,
    entityUuidKey,
    type TargetedSyncIndex
} from "./TargetedSyncIndex";
import type {TargetedChangeBatch, TargetedResolution} from "./types";

const MAX_REFERENCE_EXPANSION = 5000;
const MAX_REFERENCE_DEPTH = 32;

// Hierarchy moves can be emitted with only the changed parent snapshot. Reconcile its previously
// indexed descendants so cards moved out of a card-group are removed from Anki.
const ANCESTOR_DEPENDENT_OUTLINER_OPERATIONS = new Set([
    "cycle-todos",
    "indent-outdent-blocks",
    "move-blocks",
    "remove-block-property",
    "rename-page",
    "save-block",
    "set-block-properties",
    "set-block-property",
    "toggle-reaction"
]);

const normalizeUuid = (uuid: string): string => uuid.toLowerCase();

const addIdentities = (target: Set<string>, source: Iterable<string>): void => {
    for (const identity of source) target.add(identity);
};

const addIdentityRoots = (
    identities: Iterable<string>,
    index: TargetedSyncIndex,
    candidateRootUuids: Set<string>
): void => {
    for (const identity of identities) {
        const record = index.getRecord(identity);
        if (record) candidateRootUuids.add(record.rootUuid);
    }
};

const readEntityId = (value: unknown): number | null => {
    if (typeof value === "number") return value;
    if (
        typeof value === "object" &&
        value != null &&
        typeof (value as {id?: unknown}).id === "number"
    ) {
        return (value as {id: number}).id;
    }
    return null;
};

const getBlockTagNames = (block: BlockEntity): string[] => {
    const propertyTags = block.properties?.tags;
    if (Array.isArray(propertyTags)) {
        return propertyTags.filter((tag): tag is string => typeof tag === "string");
    }
    const tags = Array.isArray((block as BlockEntity & {tags?: unknown[]}).tags)
        ? (block as BlockEntity & {tags: unknown[]}).tags
        : [];
    return tags
        .map((tag) =>
            typeof tag === "string"
                ? tag
                : typeof tag === "object" && tag != null
                  ? String(
                        (tag as {name?: unknown; title?: unknown}).name ??
                            (tag as {title?: unknown}).title ??
                            ""
                    )
                  : ""
        )
        .filter(Boolean);
};

const didHierarchyChange = (block: BlockEntity, index: TargetedSyncIndex): boolean => {
    const previous = index.getSnapshot(block.uuid);
    if (!previous) return false;
    const current = createTargetedEntitySnapshot(block);
    return previous.parentId !== current.parentId || previous.pageId !== current.pageId;
};

const txAttributesAffectRendering = (attributes: string[]): boolean =>
    attributes.some(
        (attribute) =>
            attribute === ":block/title" ||
            attribute === ":block/content" ||
            attribute === ":block/tags" ||
            attribute === ":block/parent" ||
            attribute === ":block/page" ||
            attribute.startsWith(":user.property/") ||
            attribute.startsWith(":logseq.property/") ||
            attribute.includes(".property/")
    );

const queryReverseReferences = async (entityIds: Set<number>): Promise<BlockEntity[]> => {
    if (entityIds.size === 0) return [];
    const ids = [...entityIds].filter(Number.isSafeInteger);
    if (ids.length === 0) return [];
    const idSet = `#{${ids.join(" ")}}`;
    return (
        (await LogseqProxy.DB.datascriptQuery(
            `[:find (pull ?b [:db/id :block/uuid :block/page :block/parent])
              :where
              [?b :block/refs ?ref]
              [(contains? ${idSet} ?ref)]]`,
            {suppressErrors: false}
        )) || []
    )
        .map((row: [BlockEntity]) => row[0])
        .filter(
            (block: BlockEntity | null | undefined): block is BlockEntity => block?.uuid != null
        );
};

async function expandReverseReferences(blocks: BlockEntity[]): Promise<BlockEntity[]> {
    const allBlocks = new Map<string, BlockEntity>();
    let pendingIds = new Set<number>();

    for (const block of blocks) {
        pendingIds.add(block.id);
        const pageId = readEntityId(block.page);
        if (pageId != null) pendingIds.add(pageId);
    }

    const visitedIds = new Set<number>();
    for (let depth = 0; pendingIds.size > 0 && depth < MAX_REFERENCE_DEPTH; depth++) {
        const queryIds = new Set([...pendingIds].filter((id) => !visitedIds.has(id)));
        pendingIds = new Set();
        if (queryIds.size === 0) break;
        for (const id of queryIds) visitedIds.add(id);

        const referencingBlocks = await queryReverseReferences(queryIds);
        for (const block of referencingBlocks) {
            const uuid = normalizeUuid(block.uuid);
            if (!allBlocks.has(uuid)) {
                allBlocks.set(uuid, block);
                pendingIds.add(block.id);
            }
        }
        if (allBlocks.size > MAX_REFERENCE_EXPANSION) {
            throw new Error(
                `Reference expansion exceeded ${MAX_REFERENCE_EXPANSION} blocks and is unsafe to target.`
            );
        }
    }
    if (pendingIds.size > 0) {
        throw new Error(`Reference expansion exceeded ${MAX_REFERENCE_DEPTH} transitive levels.`);
    }
    return [...allBlocks.values()];
}

async function addCurrentHierarchyDependencies(
    changedBlock: BlockEntity,
    index: TargetedSyncIndex,
    affectedIdentities: Set<string>,
    candidateRootUuids: Set<string>
): Promise<void> {
    let childOnPathUuid = normalizeUuid(changedBlock.uuid);
    let parentIdentity = getParentBlockIdentity(changedBlock);
    const visited = new Set<string>();

    while (parentIdentity != null) {
        const parent = await LogseqProxy.Editor.getBlock(parentIdentity);
        if (!parent) break;
        const parentUuid = normalizeUuid(getUUIDFromBlock(parent));
        if (!parentUuid || visited.has(parentUuid)) break;
        visited.add(parentUuid);

        const parentDirectDependents = index.getDirectDependents(parentUuid);
        addIdentities(affectedIdentities, parentDirectDependents);
        addIdentityRoots(parentDirectDependents, index, candidateRootUuids);

        if (getBlockTagNames(parent).some((tag) => tag.toLowerCase() === "card-group")) {
            candidateRootUuids.add(childOnPathUuid);
        }

        childOnPathUuid = parentUuid;
        parentIdentity = getParentBlockIdentity(parent);
    }
}

export async function resolveTargetedChanges(
    changes: TargetedChangeBatch,
    index: TargetedSyncIndex
): Promise<TargetedResolution> {
    if (changes.classification !== "targeted") {
        return {
            classification: changes.classification,
            reason: changes.reason,
            affectedIdentities: new Set(),
            candidateRootUuids: new Set(),
            explicitlyDeletedRootUuids: new Set(changes.deletedBlockUuids)
        };
    }

    const affectedIdentities = new Set<string>();
    const candidateRootUuids = new Set<string>();
    const explicitlyDeletedRootUuids = new Set(changes.deletedBlockUuids.map(normalizeUuid));
    const changeSemanticsAreUnspecified =
        changes.outlinerOps.length === 0 && changes.txAttributes.length === 0;
    const ancestorDependentsMayHaveChanged =
        changeSemanticsAreUnspecified ||
        changes.outlinerOps.some((operation) =>
            ANCESTOR_DEPENDENT_OUTLINER_OPERATIONS.has(operation)
        ) ||
        txAttributesAffectRendering(changes.txAttributes);

    try {
        for (const block of changes.blocks) {
            const uuid = normalizeUuid(block.uuid);
            candidateRootUuids.add(uuid);

            const directDependents = index.getDirectDependents(uuid);
            addIdentities(affectedIdentities, directDependents);

            if (ancestorDependentsMayHaveChanged || didHierarchyChange(block, index)) {
                addIdentities(affectedIdentities, index.getAncestorDependents(uuid));
            }

            const entityKeys = [entityIdKey(block.id), entityUuidKey(uuid)];
            addIdentities(affectedIdentities, index.getTagDependents(...entityKeys));
            if (typeof (block as BlockEntity & {name?: unknown}).name === "string") {
                addIdentities(affectedIdentities, index.getPageDependents(...entityKeys));
            }

            await addCurrentHierarchyDependencies(
                block,
                index,
                affectedIdentities,
                candidateRootUuids
            );
        }

        for (const deletedUuid of explicitlyDeletedRootUuids) {
            const directDependents = index.getDirectDependents(deletedUuid);
            addIdentities(affectedIdentities, directDependents);
            for (const record of index.getRecordsForRoot(deletedUuid)) {
                affectedIdentities.add(record.identity);
            }
        }

        const reverseReferences = await expandReverseReferences(changes.blocks);
        for (const block of reverseReferences) {
            const uuid = normalizeUuid(block.uuid);
            const dependents = new Set([
                ...index.getDirectDependents(uuid),
                ...index.getAncestorDependents(uuid)
            ]);
            addIdentities(affectedIdentities, dependents);
            candidateRootUuids.add(uuid);
        }

        addIdentityRoots(affectedIdentities, index, candidateRootUuids);
        return {
            classification: "targeted",
            reason: changes.reason,
            affectedIdentities,
            candidateRootUuids,
            explicitlyDeletedRootUuids
        };
    } catch (error) {
        return {
            classification: "ambiguous",
            reason: error instanceof Error ? error.message : String(error),
            affectedIdentities,
            candidateRootUuids,
            explicitlyDeletedRootUuids
        };
    }
}
