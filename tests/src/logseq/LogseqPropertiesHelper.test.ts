import type {BlockEntity, PageEntity} from "@logseq/libs/dist/LSPlugin";
import {afterEach, describe, expect, it, vi} from "vitest";
import {LogseqPropertiesHelper} from "../../../src/logseq/LogseqPropertiesHelper";
import {LogseqProxy} from "../../../src/logseq/LogseqProxy";

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe("LogseqPropertiesHelper.addStripedPropertyPrefixes", () => {
    it("should strip :user.property/name-suffix format to just name (inclusive - keeps original keys)", () => {
        const input = {
            ":user.property/deck-bavZ5684": "test-deck",
            ":user.property/tags-xyz123": "a,b",
            ":user.property/occlusion-abc": "true"
        };

        const result = LogseqPropertiesHelper.addStripedPropertyPrefixes(input);

        expect(result).toEqual({
            ":user.property/deck-bavZ5684": "test-deck",
            ":user.property/tags-xyz123": "a,b",
            ":user.property/occlusion-abc": "true",
            deck: "test-deck",
            tags: "a,b",
            occlusion: "true"
        });
    });

    it("should skip :block/tags", () => {
        const input = {
            ":block/content": "test content",
            ":block/tags": ["Card", "Test"]
        };

        const result = LogseqPropertiesHelper.addStripedPropertyPrefixes(input);

        expect(result).toEqual({
            ":block/content": "test content",
            ":block/tags": ["Card", "Test"],
            content: "test content"
        });
    });

    it("should handle properties without dash suffix (inclusive - keeps original keys)", () => {
        const input = {
            ":user.property/customProp": "value"
        };

        const result = LogseqPropertiesHelper.addStripedPropertyPrefixes(input);

        expect(result).toEqual({
            ":user.property/customProp": "value",
            customProp: "value"
        });
    });

    it("should transform full property object (inclusive - keeps original keys, skips :block/tags)", () => {
        const rawProperties = {
            ":logseq.property.embedding/hnsw-label-updated-at": 0,
            ":block/tags": ["Card", "Test"],
            ":plugin.property.rw1zys138/tags": "a,b",
            ":user.property/deck-bavZ5684": "Testx",
            ":user.property/extra-abc123": "Some extra value"
        };

        const result = LogseqPropertiesHelper.addStripedPropertyPrefixes(rawProperties);

        expect(result).toEqual({
            ":logseq.property.embedding/hnsw-label-updated-at": 0,
            ":block/tags": ["Card", "Test"],
            ":plugin.property.rw1zys138/tags": "a,b",
            ":user.property/deck-bavZ5684": "Testx",
            ":user.property/extra-abc123": "Some extra value",
            "hnsw-label-updated-at": 0,
            tags: "a,b",
            deck: "Testx",
            extra: "Some extra value"
        });
    });

    it("should handle object values without stringifying them (inclusive - keeps original keys)", () => {
        const input = {
            ":user.property/metadata-xyz": {key: "value", nested: {data: 123}},
            ":user.property/simple-abc": "text"
        };

        const result = LogseqPropertiesHelper.addStripedPropertyPrefixes(input);

        expect(result).toEqual({
            ":user.property/metadata-xyz": {key: "value", nested: {data: 123}},
            ":user.property/simple-abc": "text",
            metadata: {key: "value", nested: {data: 123}},
            simple: "text"
        });
    });

    it("should preserve array values that are not tags (inclusive - keeps original keys)", () => {
        const input = {
            ":user.property/items-xyz": ["item1", "item2", "item3"]
        };

        const result = LogseqPropertiesHelper.addStripedPropertyPrefixes(input);

        expect(result).toEqual({
            ":user.property/items-xyz": ["item1", "item2", "item3"],
            items: ["item1", "item2", "item3"]
        });
    });

    it("should handle mixed property types including arrays and objects (inclusive - keeps original keys)", () => {
        const input = {
            ":user.property/list-xyz": ["a", "b", "c"],
            ":user.property/obj-abc": {key: "value"},
            ":user.property/text-def": "simple"
        };

        const result = LogseqPropertiesHelper.addStripedPropertyPrefixes(input);

        expect(result).toEqual({
            ":user.property/list-xyz": ["a", "b", "c"],
            ":user.property/obj-abc": {key: "value"},
            ":user.property/text-def": "simple",
            list: ["a", "b", "c"],
            obj: {key: "value"},
            text: "simple"
        });
    });
});

describe("LogseqPropertiesHelper.handleTagProperty", () => {
    const createMockEntity = (tags?: Array<{id: number; name: string}>): BlockEntity => {
        return {
            uuid: "test-uuid",
            tags: tags
        } as unknown as BlockEntity;
    };

    it("should merge tags from user properties and block tags", () => {
        const entity = createMockEntity([
            {id: 1, name: "Card"},
            {id: 2, name: "Test"}
        ]);
        const input = {
            ":block/tags": ["Card", "Test"],
            tags: "a,b"
        };

        const result = LogseqPropertiesHelper.handleTagProperty(entity, input);

        expect(result.tags).toEqual(["a", "b", "Card", "Test"]);
        expect(result[":block/tags"]).toBeUndefined();
        expect(result.tagIds).toEqual([1, 2]);
    });

    it("should handle block tags only", () => {
        const entity = createMockEntity([
            {id: 1, name: "Card"},
            {id: 2, name: "Test"}
        ]);
        const input = {
            ":block/tags": ["Card", "Test"]
        };

        const result = LogseqPropertiesHelper.handleTagProperty(entity, input);

        expect(result.tags).toEqual(["Card", "Test"]);
        expect(result[":block/tags"]).toBeUndefined();
        expect(result.tagIds).toEqual([1, 2]);
    });

    it("should handle user tags only (string)", () => {
        const entity = createMockEntity(); // No entity tags
        const input = {
            tags: "a,b,c"
        };

        const result = LogseqPropertiesHelper.handleTagProperty(entity, input);

        expect(result.tags).toEqual(["a", "b", "c"]);
        expect(result.tagIds).toEqual([]);
    });

    it("should handle user tags only (array)", () => {
        const entity = createMockEntity(); // No entity tags
        const input = {
            tags: ["a", "b", "c"]
        };

        const result = LogseqPropertiesHelper.handleTagProperty(entity, input);

        expect(result.tags).toEqual(["a", "b", "c"]);
        expect(result.tagIds).toEqual([]);
    });

    it("should return null for null input", () => {
        const entity = createMockEntity();
        const result = LogseqPropertiesHelper.handleTagProperty(entity, null as any);
        expect(result).toBeNull();
    });

    it("should handle empty block tags array with user tags", () => {
        const entity = createMockEntity(); // No entity tags
        const input = {
            ":block/tags": [],
            tags: "a,b"
        };

        const result = LogseqPropertiesHelper.handleTagProperty(entity, input);

        expect(result.tags).toEqual(["a", "b"]);
        expect(result[":block/tags"]).toBeUndefined();
        expect(result.tagIds).toEqual([]);
    });

    it("should handle entity without tags property but with block tags in properties", () => {
        const entity = {uuid: "test-uuid"} as unknown as BlockEntity;
        const input = {
            ":block/tags": ["Card"],
            tags: "a,b"
        };

        const result = LogseqPropertiesHelper.handleTagProperty(entity, input);

        expect(result.tags).toEqual(["a", "b", "Card"]);
        expect(result.tagIds).toEqual([]);
    });
});

describe("LogseqPropertiesHelper.addStripedPropertyPrefixes + handleTagProperty integration", () => {
    const createMockEntity = (tags?: Array<{id: number; name: string}>): BlockEntity => {
        return {
            uuid: "test-uuid",
            tags: tags
        } as unknown as BlockEntity;
    };

    it("should add stripped prefixes first, then handle tags", () => {
        const entity = createMockEntity([
            {id: 1, name: "Card"},
            {id: 2, name: "Test"}
        ]);
        const rawProperties = {
            ":block/tags": ["Card", "Test"],
            ":user.property/tags-xyz": "a,b"
        };

        const stripped = LogseqPropertiesHelper.addStripedPropertyPrefixes(rawProperties);
        // handleTagProperty then merges :block/tags with tags
        const result = LogseqPropertiesHelper.handleTagProperty(entity, stripped);

        expect(result.tags).toEqual(["a", "b", "Card", "Test"]);
        expect(result[":block/tags"]).toBeUndefined();
        expect(result.tagIds).toEqual([1, 2]);
    });

    it("should handle full property object", () => {
        const entity = createMockEntity([
            {id: 1, name: "Card"},
            {id: 2, name: "Test"}
        ]);
        const rawProperties = {
            ":logseq.property.embedding/hnsw-label-updated-at": 0,
            ":block/tags": ["Card", "Test"],
            ":plugin.property.rw1zys138/tags": "a,b",
            ":user.property/deck-bavZ5684": "Testx",
            ":user.property/extra-abc123": "Some extra value"
        };

        const stripped = LogseqPropertiesHelper.addStripedPropertyPrefixes(rawProperties);
        const result = LogseqPropertiesHelper.handleTagProperty(entity, stripped);

        expect(result["hnsw-label-updated-at"]).toBe(0);
        expect(result.tags).toEqual(["a", "b", "Card", "Test"]);
        expect(result.deck).toBe("Testx");
        expect(result.extra).toBe("Some extra value");
        expect(result.tagIds).toEqual([1, 2]);
    });
});

describe("LogseqPropertiesHelper entity property processing", () => {
    const processBlock = async (
        block: BlockEntity,
        isDbGraph: boolean,
        includeChildren = false
    ): Promise<void> =>
        await (
            LogseqPropertiesHelper as unknown as {
                processBlock: (
                    block: BlockEntity,
                    isDbGraph: boolean,
                    includeChildren?: boolean
                ) => Promise<void>;
            }
        ).processBlock(block, isDbGraph, includeChildren);

    it("keeps normalized block tags when the DB entity contains raw tag objects", async () => {
        const block = {
            uuid: "test-uuid",
            content: "Test content",
            properties: {
                deck: "Existing deck",
                tags: [{id: 3523, name: "card-group"}],
                tagIds: [{id: 3523}]
            },
            tags: [{id: 3523, name: "card-group"}]
        } as unknown as BlockEntity;

        vi.stubGlobal("logseq", {
            Editor: {
                getBlockProperties: vi.fn().mockResolvedValue({
                    ":block/tags": ["card-group"],
                    deck: "Fetched deck"
                })
            }
        });
        vi.spyOn(LogseqProxy.Settings, "getPluginSettings").mockReturnValue({
            inheritPropertiesFromTags: false
        } as ReturnType<typeof LogseqProxy.Settings.getPluginSettings>);

        await processBlock(block, false);

        expect(block.properties.tags).toEqual(["card-group"]);
        expect(block.properties.tagIds).toEqual([3523]);
        expect(block.properties.deck).toBe("Existing deck");
    });

    it("skips the property API for property-free DB blocks and their children", async () => {
        const getBlockProperties = vi.fn();
        const block = {
            uuid: "root-uuid",
            content: "Root",
            properties: {},
            tags: [],
            children: [
                {
                    uuid: "child-uuid",
                    content: "Child",
                    properties: {},
                    tags: [],
                    children: []
                }
            ]
        } as unknown as BlockEntity;

        vi.stubGlobal("logseq", {Editor: {getBlockProperties}});
        vi.spyOn(LogseqProxy.Settings, "getPluginSettings").mockReturnValue({
            inheritPropertiesFromTags: false
        } as ReturnType<typeof LogseqProxy.Settings.getPluginSettings>);

        await processBlock(block, true, true);

        expect(getBlockProperties).not.toHaveBeenCalled();
        expect(block.properties).toEqual({});
        expect((block.children[0] as BlockEntity).properties).toEqual({});
        expect(block.content.match(/^uuid:: root-uuid$/gm)).toHaveLength(1);
        expect(
            (block.children[0] as BlockEntity).content.match(/^uuid:: child-uuid$/gm)
        ).toHaveLength(1);
    });

    it.each([
        ["tagged", {tags: [{id: 7, name: "card"}]}],
        ["aliased", {alias: [{id: 8}]}],
        ["user-property", {":user.property/deck-suffix": {id: 9}}],
        ["plugin-property", {":plugin.property.test/extra": "value"}],
        ["Logseq-property", {":logseq.property/heading": 2}]
    ])("hydrates %s DB blocks through the property API", async (_caseName, extraBlockFields) => {
        const getBlockProperties = vi.fn().mockResolvedValue({deck: "Fetched deck"});
        const block = {
            uuid: "test-uuid",
            content: "Test content",
            properties: {},
            tags: [],
            children: [],
            ...extraBlockFields
        } as unknown as BlockEntity;

        vi.stubGlobal("logseq", {Editor: {getBlockProperties}});
        vi.spyOn(LogseqProxy.Settings, "getPluginSettings").mockReturnValue({
            inheritPropertiesFromTags: false
        } as ReturnType<typeof LogseqProxy.Settings.getPluginSettings>);

        await processBlock(block, true);

        expect(getBlockProperties).toHaveBeenCalledOnce();
        expect(getBlockProperties).toHaveBeenCalledWith("test-uuid");
        expect(block.properties.deck).toBe("Fetched deck");
    });

    it("keeps normalized page tags when the DB entity contains raw tag objects", async () => {
        const page = {
            id: 42,
            properties: {
                deck: "Existing deck",
                tags: [{id: 7, name: "Page"}],
                tagIds: [{id: 7}]
            },
            tags: [{id: 7, name: "Page"}]
        } as unknown as PageEntity;

        vi.stubGlobal("logseq", {
            Editor: {
                getPageProperties: vi.fn().mockResolvedValue({
                    ":block/tags": ["Page"],
                    deck: "Fetched deck"
                })
            }
        });
        vi.spyOn(LogseqProxy.Settings, "getPluginSettings").mockReturnValue({
            inheritPropertiesFromTags: false
        } as ReturnType<typeof LogseqProxy.Settings.getPluginSettings>);

        await (
            LogseqPropertiesHelper as unknown as {
                processPage: (page: PageEntity, isDbGraph: boolean) => Promise<void>;
            }
        ).processPage(page, true);

        expect(page.properties.tags).toEqual(["Page"]);
        expect(page.properties.tagIds).toEqual([7]);
        expect(page.properties.deck).toBe("Existing deck");
    });
});

describe("LogseqPropertiesHelper DB graph DataScript compatibility", () => {
    const helper = LogseqPropertiesHelper as unknown as {
        buildDbGraphBlockByUuidQuery: (uuid: string, includeChildren?: boolean) => string;
        buildDbGraphBlockByEntityIdQuery: (entityId: number, includeChildren?: boolean) => string;
        getDbGraphBlockFromDatascript: (
            srcBlock: string | number,
            includeChildren?: boolean
        ) => Promise<BlockEntity | null>;
        normalizeDatascriptBlock: (block: Record<string, any>) => BlockEntity | null;
    };

    it.each([
        () => helper.buildDbGraphBlockByUuidQuery("00000000-0000-0000-0000-000000000001"),
        () => helper.buildDbGraphBlockByEntityIdQuery(42)
    ])("does not pull the Logseq 2.0 :block/left scalar as a reference", (buildQuery) => {
        expect(buildQuery()).not.toContain("{:block/left");
    });

    it("requests the complete child tree in the root query only when requested", () => {
        const uuid = "00000000-0000-0000-0000-000000000001";

        expect(helper.buildDbGraphBlockByUuidQuery(uuid, false)).not.toContain(":block/_parent");
        expect(helper.buildDbGraphBlockByUuidQuery(uuid, true)).toContain(
            "{[:block/_parent :as :block/children] ...}"
        );
    });

    it("preserves the Logseq 2.0 block order returned by the wildcard pull", () => {
        const block = helper.normalizeDatascriptBlock({
            id: 42,
            uuid: "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA",
            title: "Card content",
            order: "a0"
        });

        expect(block?.order).toBe("a0");
    });

    it("preserves a scalar legacy left value without converting it to an empty entity", () => {
        const block = helper.normalizeDatascriptBlock({
            id: 42,
            uuid: "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA",
            title: "Card content",
            left: 41
        });

        expect(block?.left).toBe(41);
    });

    it("normalizes and orders every level of a recursively pulled child tree", () => {
        const block = helper.normalizeDatascriptBlock({
            id: 1,
            uuid: "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA",
            title: "Root",
            children: [
                {
                    id: 3,
                    uuid: "CCCCCCCC-CCCC-CCCC-CCCC-CCCCCCCCCCCC",
                    title: "Second",
                    order: "b"
                },
                {
                    id: 2,
                    uuid: "BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB",
                    title: "First",
                    order: "a",
                    children: [
                        {
                            id: 4,
                            uuid: "DDDDDDDD-DDDD-DDDD-DDDD-DDDDDDDDDDDD",
                            title: "Nested",
                            order: "a"
                        }
                    ]
                }
            ]
        });

        expect(block?.children.map((child) => child.uuid)).toEqual([
            "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
            "cccccccc-cccc-cccc-cccc-cccccccccccc"
        ]);
        expect((block?.children[0] as BlockEntity).children[0].uuid).toBe(
            "dddddddd-dddd-dddd-dddd-dddddddddddd"
        );
    });

    it("hydrates a recursive child tree with one DataScript request", async () => {
        const datascriptQuery = vi.fn().mockResolvedValue([
            [
                {
                    id: 1,
                    uuid: "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA",
                    title: "Root",
                    children: [
                        {
                            id: 2,
                            uuid: "BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB",
                            title: "Child",
                            order: "a"
                        }
                    ]
                }
            ]
        ]);
        vi.stubGlobal("logseq", {DB: {datascriptQuery}});

        const block = await helper.getDbGraphBlockFromDatascript(
            "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
            true
        );

        expect(datascriptQuery).toHaveBeenCalledOnce();
        expect(datascriptQuery.mock.calls[0][0]).toContain(
            "{[:block/_parent :as :block/children] ...}"
        );
        expect(block?.children).toHaveLength(1);
        expect(block?.children[0].uuid).toBe("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
    });

    it("uses the DataScript fallback directly when DB graph children are requested", async () => {
        const block = {
            id: 42,
            uuid: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
            content: "Card content",
            properties: {},
            children: []
        } as unknown as BlockEntity;
        const checkCurrentIsDbGraph = vi
            .spyOn(helper as any, "checkCurrentIsDbGraph")
            .mockResolvedValue(true);
        const getDbGraphBlockFromDatascript = vi
            .spyOn(helper as any, "getDbGraphBlockFromDatascript")
            .mockResolvedValue(block);
        const getBlockWithTimeout = vi
            .spyOn(helper as any, "getBlockWithTimeout")
            .mockResolvedValue(null);
        const processBlock = vi.spyOn(helper as any, "processBlock").mockResolvedValue(undefined);

        const result = await LogseqPropertiesHelper.getBlock(block.uuid, {
            includeChildren: true
        });

        expect(result).toBe(block);
        expect(checkCurrentIsDbGraph).toHaveBeenCalledOnce();
        expect(getDbGraphBlockFromDatascript).toHaveBeenCalledWith(block.uuid, true);
        expect(getBlockWithTimeout).not.toHaveBeenCalled();
        expect(processBlock).toHaveBeenCalledWith(block, true, true);
    });
});
