import type {BlockEntity, PageEntity} from "@logseq/libs/dist/LSPlugin";
import type {Note} from "../../anki-notes/Note";
import getParentBlockIdentity from "../../logseq/getParentBlockIdentity";
import getUUIDFromBlock from "../../logseq/getUUIDFromBlock";
import {LogseqProxy} from "../../logseq/LogseqProxy";
import type {TargetedEntitySnapshot, TargetedNoteRecord} from "./types";

const normalizeUuid = (uuid: string): string => uuid.toLowerCase();

export const entityIdKey = (id: number): string => `id:${id}`;
export const entityUuidKey = (uuid: string): string => `uuid:${normalizeUuid(uuid)}`;

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

const collectTagIds = (entity: BlockEntity | PageEntity): number[] => {
    const propertyTagIds = Array.isArray(entity.properties?.tagIds)
        ? entity.properties.tagIds.filter((id): id is number => typeof id === "number")
        : [];
    const rawTags = Array.isArray((entity as BlockEntity & {tags?: unknown[]}).tags)
        ? ((entity as BlockEntity & {tags: unknown[]}).tags ?? [])
        : [];
    const rawTagIds = rawTags
        .map(readEntityId)
        .filter((id): id is number => typeof id === "number");
    return [...new Set([...propertyTagIds, ...rawTagIds])].sort((a, b) => a - b);
};

const semanticProperties = (entity: BlockEntity | PageEntity): Record<string, unknown> => {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(entity)) {
        const normalizedKey = key.startsWith(":") ? key.slice(1) : key;
        if (
            normalizedKey.startsWith("user.property/") ||
            normalizedKey.startsWith("logseq.property/") ||
            normalizedKey.includes(".property/")
        ) {
            result[normalizedKey] = value;
        }
    }

    for (const [key, value] of Object.entries(entity.properties || {})) {
        if (["id", "uuid", "tagIds"].includes(key)) continue;
        if (key.startsWith(":")) continue;
        result[key] = value;
    }
    return result;
};

export function createTargetedEntitySnapshot(
    entity: BlockEntity | PageEntity
): TargetedEntitySnapshot {
    const isPage = typeof (entity as PageEntity).name === "string";
    const block = entity as BlockEntity;
    const page = entity as PageEntity & {parent?: unknown};
    return {
        uuid: normalizeUuid(entity.uuid),
        id: entity.id,
        title: String((entity as PageEntity).name ?? block.title ?? block.content ?? ""),
        order: String(block.order ?? ""),
        parentId: readEntityId(block.parent ?? page.namespace),
        pageId: readEntityId(block.page),
        semanticProperties: semanticProperties(entity),
        tagIds: collectTagIds(entity),
        kind: isPage ? "page" : "block"
    };
}

const addToMultiMap = (map: Map<string, Set<string>>, key: string, identity: string): void => {
    const values = map.get(key) ?? new Set<string>();
    values.add(identity);
    map.set(key, values);
};

export class TargetedSyncIndex {
    private records = new Map<string, TargetedNoteRecord>();
    private directBlockToNotes = new Map<string, Set<string>>();
    private ancestorBlockToNotes = new Map<string, Set<string>>();
    private pageToNotes = new Map<string, Set<string>>();
    private tagToNotes = new Map<string, Set<string>>();
    private rootToNotes = new Map<string, Set<string>>();
    private snapshots = new Map<string, TargetedEntitySnapshot>();
    private graphName: string | null = null;
    private ready = false;

    isReadyForGraph(graphName: string): boolean {
        return this.ready && this.graphName === graphName;
    }

    getGraphName(): string | null {
        return this.graphName;
    }

    clear(): void {
        this.records.clear();
        this.snapshots.clear();
        this.graphName = null;
        this.ready = false;
        this.rebuildLookupMaps();
    }

    replaceAll(
        graphName: string,
        records: TargetedNoteRecord[],
        snapshots: Iterable<TargetedEntitySnapshot>
    ): void {
        this.records = new Map(records.map((record) => [record.identity, record]));
        this.snapshots = new Map(
            [...snapshots].map((snapshot) => [normalizeUuid(snapshot.uuid), snapshot])
        );
        this.graphName = graphName;
        this.ready = true;
        this.rebuildLookupMaps();
    }

    replaceRoots(
        rootUuids: Iterable<string>,
        records: TargetedNoteRecord[],
        snapshots: Iterable<TargetedEntitySnapshot>
    ): void {
        const normalizedRoots = new Set([...rootUuids].map(normalizeUuid));
        for (const [identity, record] of this.records) {
            if (normalizedRoots.has(record.rootUuid)) this.records.delete(identity);
        }
        for (const record of records) this.records.set(record.identity, record);
        for (const snapshot of snapshots) {
            this.snapshots.set(normalizeUuid(snapshot.uuid), snapshot);
        }
        this.rebuildLookupMaps();
    }

    getRecord(identity: string): TargetedNoteRecord | undefined {
        return this.records.get(identity);
    }

    getRecordsForRoot(rootUuid: string): TargetedNoteRecord[] {
        return [...(this.rootToNotes.get(normalizeUuid(rootUuid)) ?? [])]
            .map((identity) => this.records.get(identity))
            .filter((record): record is TargetedNoteRecord => record != null);
    }

    getDirectDependents(blockUuid: string): Set<string> {
        return new Set(this.directBlockToNotes.get(normalizeUuid(blockUuid)) ?? []);
    }

    getAncestorDependents(blockUuid: string): Set<string> {
        return new Set(this.ancestorBlockToNotes.get(normalizeUuid(blockUuid)) ?? []);
    }

    getPageDependents(...entityKeys: string[]): Set<string> {
        return this.getDependentsForKeys(this.pageToNotes, entityKeys);
    }

    getTagDependents(...entityKeys: string[]): Set<string> {
        return this.getDependentsForKeys(this.tagToNotes, entityKeys);
    }

    getSnapshot(uuid: string): TargetedEntitySnapshot | undefined {
        return this.snapshots.get(normalizeUuid(uuid));
    }

    get size(): number {
        return this.records.size;
    }

    private getDependentsForKeys(map: Map<string, Set<string>>, keys: string[]): Set<string> {
        const result = new Set<string>();
        for (const key of keys) {
            for (const identity of map.get(key) ?? []) result.add(identity);
        }
        return result;
    }

    private rebuildLookupMaps(): void {
        this.directBlockToNotes = new Map();
        this.ancestorBlockToNotes = new Map();
        this.pageToNotes = new Map();
        this.tagToNotes = new Map();
        this.rootToNotes = new Map();

        for (const record of this.records.values()) {
            addToMultiMap(this.rootToNotes, record.rootUuid, record.identity);
            for (const uuid of record.directBlockUuids) {
                addToMultiMap(this.directBlockToNotes, uuid, record.identity);
            }
            for (const uuid of record.ancestorBlockUuids) {
                addToMultiMap(this.ancestorBlockToNotes, uuid, record.identity);
            }
            for (const key of record.pageEntityKeys)
                addToMultiMap(this.pageToNotes, key, record.identity);
            for (const key of record.tagEntityKeys)
                addToMultiMap(this.tagToNotes, key, record.identity);
        }
    }
}

export interface BuiltTargetedRecords {
    records: TargetedNoteRecord[];
    snapshots: TargetedEntitySnapshot[];
}

export async function buildTargetedNoteRecords(notes: Note[]): Promise<BuiltTargetedRecords> {
    const snapshots = new Map<string, TargetedEntitySnapshot>();
    const records: TargetedNoteRecord[] = [];

    for (const note of notes) {
        const directBlockUuids = [
            ...new Set(
                note
                    .getBlockDependencies()
                    .filter((dependency) => dependency.type === "Block")
                    .map((dependency) => normalizeUuid(String(dependency.value)))
            )
        ];
        const directBlocks = (
            await Promise.all(directBlockUuids.map((uuid) => LogseqProxy.Editor.getBlock(uuid)))
        ).filter((block): block is BlockEntity => block != null);
        for (const block of directBlocks) {
            snapshots.set(normalizeUuid(block.uuid), createTargetedEntitySnapshot(block));
        }

        const ancestorBlockUuids: string[] = [];
        const ancestorBlocks: BlockEntity[] = [];
        let parentIdentity = getParentBlockIdentity(
            directBlocks.find((block) => normalizeUuid(block.uuid) === normalizeUuid(note.uuid))
        );
        const visitedAncestors = new Set<string>();
        while (parentIdentity != null) {
            const parent = await LogseqProxy.Editor.getBlock(parentIdentity);
            if (!parent) break;
            const parentUuid = normalizeUuid(getUUIDFromBlock(parent));
            if (!parentUuid || visitedAncestors.has(parentUuid)) break;
            visitedAncestors.add(parentUuid);
            ancestorBlockUuids.push(parentUuid);
            ancestorBlocks.push(parent);
            snapshots.set(parentUuid, createTargetedEntitySnapshot(parent));
            parentIdentity = getParentBlockIdentity(parent);
        }

        const pageEntityKeys = new Set<string>([entityIdKey(note.pageId)]);
        const pages: PageEntity[] = [];
        const page = await LogseqProxy.Editor.getPage(note.pageId);
        if (page) {
            pages.push(page);
            pageEntityKeys.add(entityUuidKey(page.uuid));
            snapshots.set(normalizeUuid(page.uuid), createTargetedEntitySnapshot(page));
            const namespaceParents = await LogseqProxy.Editor.getParentNamespacePages(page);
            for (const namespacePage of namespaceParents) {
                pages.push(namespacePage);
                pageEntityKeys.add(entityIdKey(namespacePage.id));
                pageEntityKeys.add(entityUuidKey(namespacePage.uuid));
                snapshots.set(
                    normalizeUuid(namespacePage.uuid),
                    createTargetedEntitySnapshot(namespacePage)
                );
            }
        }

        const tagEntityKeys = new Set<string>();
        for (const entity of [...directBlocks, ...ancestorBlocks, ...pages]) {
            for (const tagId of collectTagIds(entity)) tagEntityKeys.add(entityIdKey(tagId));
        }

        records.push({
            identity: `${normalizeUuid(note.uuid)}-${note.type}`,
            rootUuid: normalizeUuid(note.uuid),
            type: note.type,
            pageId: note.pageId,
            directBlockUuids,
            ancestorBlockUuids,
            pageEntityKeys: [...pageEntityKeys],
            tagEntityKeys: [...tagEntityKeys]
        });
    }

    return {records, snapshots: [...snapshots.values()]};
}

export const targetedSyncIndex = new TargetedSyncIndex();
