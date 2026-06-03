import type {BlockEntity, EntityID} from "@logseq/libs/dist/LSPlugin";

/**
 * Get a block identity for a block's parent.
 *
 * File graphs commonly expose parent blocks as numeric entity IDs, while DB graph
 * datascript queries can include parent UUIDs. LogseqProxy.Editor.getBlock accepts
 * both forms, so prefer UUIDs when available and fall back to entity IDs.
 */
export default function getParentBlockIdentity(
    block: BlockEntity | null | undefined
): string | EntityID | null {
    const parent = block?.parent;
    if (parent == null) return null;

    if (typeof parent === "string" || typeof parent === "number") return parent;

    return (
        (parent.uuid as any)?.["$uuid$"] ||
        (parent.uuid as any)?.Wd ||
        parent.uuid ||
        parent.id ||
        null
    );
}
