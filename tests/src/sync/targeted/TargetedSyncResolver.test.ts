import type {BlockEntity} from "@logseq/libs/dist/LSPlugin";
import {afterEach, beforeEach, describe, expect, test, vi} from "vitest";
import {LogseqProxy} from "../../../../src/logseq/LogseqProxy";
import {entityIdKey, TargetedSyncIndex} from "../../../../src/sync/targeted/TargetedSyncIndex";
import {resolveTargetedChanges} from "../../../../src/sync/targeted/TargetedSyncResolver";
import type {TargetedChangeBatch, TargetedNoteRecord} from "../../../../src/sync/targeted/types";

const makeBlock = (
    id: number,
    uuid: string,
    parent?: number,
    extra: Record<string, unknown> = {}
): BlockEntity =>
    ({
        id,
        uuid,
        title: uuid,
        content: uuid,
        properties: {},
        page: {id: 500},
        ...(parent == null ? {} : {parent: {id: parent}}),
        ...extra
    }) as unknown as BlockEntity;

const makeRecord = (
    identity: string,
    rootUuid: string,
    overrides: Partial<TargetedNoteRecord> = {}
): TargetedNoteRecord => ({
    identity,
    rootUuid,
    type: "multiline_card",
    pageId: 500,
    directBlockUuids: [rootUuid],
    ancestorBlockUuids: [],
    pageEntityKeys: [entityIdKey(500)],
    tagEntityKeys: [],
    ...overrides
});

const makeBatch = (
    blocks: BlockEntity[],
    overrides: Partial<TargetedChangeBatch> = {}
): TargetedChangeBatch => ({
    classification: "targeted",
    reason: "test event",
    blocks,
    deletedBlockUuids: [],
    txAttributes: [],
    outlinerOps: ["save-block"],
    changedEntities: blocks.map((block) => ({
        id: block.id,
        uuid: String(block.uuid).toLowerCase(),
        pageId: 500,
        kind: "block"
    })),
    eventCount: 1,
    ...overrides
});

describe("TargetedSyncResolver", () => {
    let index: TargetedSyncIndex;
    let blocksByIdentity: Map<string | number, BlockEntity>;

    beforeEach(() => {
        index = new TargetedSyncIndex();
        blocksByIdentity = new Map();
        vi.spyOn(LogseqProxy.Editor, "getBlock").mockImplementation(async (identity) => {
            return blocksByIdentity.get(identity as string | number) ?? null;
        });
        vi.spyOn(LogseqProxy.DB, "datascriptQuery").mockResolvedValue([]);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    test("editing a card block targets that card", async () => {
        const root = makeBlock(1, "root");
        index.replaceAll("Graph", [makeRecord("root-multiline_card", "root")], []);

        const result = await resolveTargetedChanges(makeBatch([root]), index);

        expect(result.affectedIdentities).toEqual(new Set(["root-multiline_card"]));
        expect(result.candidateRootUuids).toEqual(new Set(["root"]));
    });

    test("adding or removing a card tag targets the changed card", async () => {
        const root = makeBlock(1, "root", undefined, {properties: {tags: ["card"]}});
        index.replaceAll("Graph", [makeRecord("root-multiline_card", "root")], []);

        const result = await resolveTargetedChanges(
            makeBatch([root], {
                outlinerOps: ["set-block-property"],
                txAttributes: [":block/tags"]
            }),
            index
        );

        expect(result.affectedIdentities).toContain("root-multiline_card");
        expect(result.candidateRootUuids).toContain("root");
    });

    test("adding a top child under card-group targets only the new child", async () => {
        const group = makeBlock(10, "group", undefined, {properties: {tags: ["card-group"]}});
        const newChild = makeBlock(3, "new-child", 10);
        blocksByIdentity.set(10, group);
        index.replaceAll(
            "Graph",
            [
                makeRecord("sibling-a-multiline_card", "sibling-a", {
                    ancestorBlockUuids: ["group"]
                }),
                makeRecord("sibling-b-multiline_card", "sibling-b", {
                    ancestorBlockUuids: ["group"]
                })
            ],
            []
        );

        const result = await resolveTargetedChanges(
            makeBatch([newChild], {outlinerOps: ["insert-blocks"]}),
            index
        );

        expect(result.candidateRootUuids).toEqual(new Set(["new-child"]));
        expect(result.affectedIdentities).toEqual(new Set());
    });

    test("editing a card-group child does not target independent siblings", async () => {
        const group = makeBlock(10, "group", undefined, {properties: {tags: ["card-group"]}});
        const child = makeBlock(2, "child-a", 10);
        blocksByIdentity.set(10, group);
        index.replaceAll(
            "Graph",
            [
                makeRecord("child-a-multiline_card", "child-a", {
                    ancestorBlockUuids: ["group"]
                }),
                makeRecord("child-b-multiline_card", "child-b", {
                    ancestorBlockUuids: ["group"]
                })
            ],
            []
        );

        const result = await resolveTargetedChanges(makeBatch([child]), index);

        expect(result.affectedIdentities).toEqual(new Set(["child-a-multiline_card"]));
        expect(result.candidateRootUuids).toEqual(new Set(["child-a"]));
    });

    test("reordering card-group children does not target unrelated siblings", async () => {
        const group = makeBlock(10, "group", undefined, {properties: {tags: ["card-group"]}});
        const movedChild = makeBlock(2, "child-a", 10, {order: "a9"});
        blocksByIdentity.set(10, group);
        index.replaceAll(
            "Graph",
            [
                makeRecord("child-a-multiline_card", "child-a", {
                    ancestorBlockUuids: ["group"]
                }),
                makeRecord("child-b-multiline_card", "child-b", {
                    ancestorBlockUuids: ["group"]
                })
            ],
            []
        );

        const result = await resolveTargetedChanges(
            makeBatch([movedChild], {
                outlinerOps: ["move-blocks-up-down"],
                txAttributes: [":block/order"]
            }),
            index
        );

        expect(result.affectedIdentities).toEqual(new Set(["child-a-multiline_card"]));
        expect(result.affectedIdentities).not.toContain("child-b-multiline_card");
    });

    test("editing descendants targets the note that renders them", async () => {
        const descendant = makeBlock(2, "descendant", 1);
        index.replaceAll(
            "Graph",
            [
                makeRecord("root-cloze", "root", {
                    type: "cloze",
                    directBlockUuids: ["root", "descendant"]
                })
            ],
            []
        );

        const result = await resolveTargetedChanges(makeBatch([descendant]), index);

        expect(result.affectedIdentities).toContain("root-cloze");
        expect(result.candidateRootUuids).toContain("root");
    });

    test("parent property, tag, deck, and direction changes target descendants", async () => {
        const parent = makeBlock(1, "parent", undefined, {
            properties: {deck: "Changed", direction: "->", tags: ["topic"]}
        });
        index.replaceAll(
            "Graph",
            [makeRecord("child-multiline_card", "child", {ancestorBlockUuids: ["parent"]})],
            []
        );

        const result = await resolveTargetedChanges(
            makeBatch([parent], {
                outlinerOps: ["set-block-properties"],
                txAttributes: [":user.property/deck", ":user.property/direction", ":block/tags"]
            }),
            index
        );

        expect(result.affectedIdentities).toContain("child-multiline_card");
        expect(result.candidateRootUuids).toContain("child");
    });

    test("inherited tag property changes target cards using that tag", async () => {
        const tagPage = makeBlock(800, "topic-tag", undefined, {name: "topic"});
        index.replaceAll(
            "Graph",
            [
                makeRecord("root-cloze", "root", {
                    type: "cloze",
                    tagEntityKeys: [entityIdKey(800)]
                })
            ],
            []
        );

        const result = await resolveTargetedChanges(
            makeBatch([tagPage], {
                outlinerOps: ["set-block-property"],
                txAttributes: [":user.property/deck"],
                changedEntities: [{id: 800, uuid: "topic-tag", pageId: 500, kind: "page"}]
            }),
            index
        );

        expect(result.affectedIdentities).toContain("root-cloze");
        expect(result.candidateRootUuids).toContain("root");
    });

    test("block references and embeds target transitive dependents", async () => {
        const target = makeBlock(1, "target");
        const referenceA = makeBlock(2, "reference-a");
        const referenceB = makeBlock(3, "reference-b");
        index.replaceAll(
            "Graph",
            [
                makeRecord("root-cloze", "root", {
                    type: "cloze",
                    directBlockUuids: ["root", "reference-b"]
                })
            ],
            []
        );
        vi.mocked(LogseqProxy.DB.datascriptQuery)
            .mockResolvedValueOnce([[referenceA]])
            .mockResolvedValueOnce([[referenceB]])
            .mockResolvedValueOnce([]);

        const result = await resolveTargetedChanges(makeBatch([target]), index);

        expect(result.affectedIdentities).toContain("root-cloze");
        expect(result.candidateRootUuids).toContain("root");
    });

    test("page references and page embeds target their rendering notes", async () => {
        const referencedPage = makeBlock(700, "referenced-page", undefined, {
            name: "Referenced Page"
        });
        const referencingBlock = makeBlock(701, "referencing-block");
        index.replaceAll(
            "Graph",
            [
                makeRecord("root-cloze", "root", {
                    type: "cloze",
                    directBlockUuids: ["root", "referencing-block"],
                    pageEntityKeys: []
                })
            ],
            []
        );
        vi.mocked(LogseqProxy.DB.datascriptQuery)
            .mockResolvedValueOnce([[referencingBlock]])
            .mockResolvedValueOnce([]);

        const result = await resolveTargetedChanges(
            makeBatch([referencedPage], {
                outlinerOps: ["rename-page"],
                changedEntities: [{id: 700, uuid: "referenced-page", pageId: 500, kind: "page"}]
            }),
            index
        );

        expect(result.affectedIdentities).toContain("root-cloze");
        expect(result.candidateRootUuids).toContain("root");
    });

    test("page rename or move and namespaces target page dependents", async () => {
        const namespacePage = makeBlock(900, "namespace", undefined, {name: "Renamed"});
        index.replaceAll(
            "Graph",
            [
                makeRecord("root-cloze", "root", {
                    type: "cloze",
                    pageEntityKeys: [entityIdKey(500), entityIdKey(900)]
                })
            ],
            []
        );

        const result = await resolveTargetedChanges(
            makeBatch([namespacePage], {
                outlinerOps: ["rename-page"],
                changedEntities: [{id: 900, uuid: "namespace", pageId: 500, kind: "page"}]
            }),
            index
        );

        expect(result.affectedIdentities).toContain("root-cloze");
        expect(result.candidateRootUuids).toContain("root");
    });

    test("known card deletion resolves the exact indexed identity", async () => {
        const changedParent = makeBlock(10, "parent");
        index.replaceAll("Graph", [makeRecord("deleted-cloze", "deleted", {type: "cloze"})], []);

        const result = await resolveTargetedChanges(
            makeBatch([changedParent], {
                outlinerOps: ["delete-blocks"],
                deletedBlockUuids: ["deleted"]
            }),
            index
        );

        expect(result.explicitlyDeletedRootUuids).toEqual(new Set(["deleted"]));
        expect(result.affectedIdentities).toContain("deleted-cloze");
        expect(result.candidateRootUuids).toContain("deleted");
    });
});
