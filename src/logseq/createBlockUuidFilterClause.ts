// Logseq uses canonical UUID-shaped identifiers that are not always RFC 4122 UUIDs.
// Journal pages, for example, use a zero variant nibble. Keep this deliberately
// restricted to hexadecimal UUID syntax because values are embedded in a DataScript query.
const LOGSEQ_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Restricts a DataScript query's `?b` entity to an explicit stable UUID set.
 * An undefined set preserves the authoritative Full Sync query.
 */
export default function createBlockUuidFilterClause(
    candidateRootUuids?: ReadonlySet<string>
): string {
    if (candidateRootUuids == null) return "";
    if (candidateRootUuids.size === 0) return "[(= 1 0)]";

    const normalizedUuids = [...candidateRootUuids].map((uuid) => uuid.toLowerCase());
    const invalidUuid = normalizedUuids.find((uuid) => !LOGSEQ_UUID_PATTERN.test(uuid));
    if (invalidUuid) {
        throw new Error(`Cannot target invalid Logseq block UUID “${invalidUuid}”.`);
    }

    const uuidSet = normalizedUuids.map((uuid) => `#uuid "${uuid}"`).join(" ");
    return `[?b :block/uuid ?candidate-uuid]
            [(contains? #{${uuidSet}} ?candidate-uuid)]`;
}
