import {describe, expect, test} from "vitest";
import {
    classifyLogseqDBChange,
    isIgnorableLogseqSystemViewChange,
    mergeClassifiedDBChanges,
    UnexpectedLogseqDBEventError
} from "../../../../src/sync/targeted/LogseqDBChangeClassifier";

const block = {
    id: 101,
    uuid: "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA",
    title: "Card",
    page: {id: 10}
};

describe("LogseqDBChangeClassifier", () => {
    const hiddenViewsPage = {
        id: 180,
        uuid: "00000004-1906-3437-5800-000000000000",
        name: "$$$views",
        title: "$$$views",
        "builtIn?": true,
        "hide?": true
    };
    const linkedReferencesView = {
        id: 15326,
        uuid: "00000006-5909-6900-2000-000000000000",
        title: "Linked references",
        page: {id: hiddenViewsPage.id},
        parent: {id: hiddenViewsPage.id},
        featureType: "linked-references",
        viewFor: {id: 6865}
    };

    test("ignores metadata-free changes confined to Logseq's hidden built-in views", () => {
        expect(
            isIgnorableLogseqSystemViewChange({
                blocks: [linkedReferencesView, hiddenViewsPage],
                txData: [],
                txMeta: {},
                deletedBlockUuids: new Set<string>()
            })
        ).toBe(true);
    });

    test.each([
        {
            blocks: [block],
            txData: []
        },
        {
            blocks: [linkedReferencesView, {...hiddenViewsPage, "builtIn?": false}],
            txData: []
        },
        {
            blocks: [linkedReferencesView, hiddenViewsPage, block],
            txData: []
        },
        {
            blocks: [linkedReferencesView, hiddenViewsPage],
            txData: [[15326, ":block/title", "Linked references", 9001, true]]
        }
    ])("does not ignore non-system or transaction-bearing changes %#", (event) => {
        expect(isIgnorableLogseqSystemViewChange(event)).toBe(false);
    });

    test("accepts the installed Logseq 2.0.2 outliner event shape", () => {
        const result = classifyLogseqDBChange({
            blocks: [block],
            txData: [],
            txMeta: {outlinerOp: "save-block"},
            deletedBlockUuids: new Set<string>()
        });

        expect(result).toMatchObject({
            classification: "targeted",
            outlinerOps: ["save-block"],
            changedEntities: [
                {
                    id: 101,
                    uuid: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                    pageId: 10,
                    kind: "block"
                }
            ]
        });
    });

    test("accepts known five-item DataScript datoms without an outliner operation", () => {
        const result = classifyLogseqDBChange({
            blocks: [block],
            txData: [[101, ":block/title", "Edited", 9001, true]]
        });

        expect(result.classification).toBe("targeted");
        expect(result.txAttributes).toEqual([":block/title"]);
    });

    test("targets complete user block snapshots when Logseq omits transaction metadata", () => {
        const result = classifyLogseqDBChange({
            blocks: [
                {
                    id: 15329,
                    uuid: "6ad3b707-8065-4c10-ae83-f0ca8791baf6",
                    title: "you see function definition, why it can still have default argument",
                    page: {id: 4727},
                    parent: {id: 4847},
                    properties: {}
                }
            ],
            txData: [],
            txMeta: {},
            deletedBlockUuids: new Set<string>()
        });

        expect(result).toMatchObject({
            classification: "targeted",
            reason: expect.stringContaining("without transaction metadata"),
            changedEntities: [
                {
                    id: 15329,
                    uuid: "6ad3b707-8065-4c10-ae83-f0ca8791baf6",
                    pageId: 4727,
                    kind: "block"
                }
            ]
        });
    });

    test("marks graph-wide operations unsupported", () => {
        const result = classifyLogseqDBChange({
            blocks: [block],
            txData: [],
            txMeta: {outlinerOp: "batch-import-edn"}
        });

        expect(result.classification).toBe("unsupported");
        expect(result.reason).toContain("graph-wide");
    });

    test("marks deletion without stable deleted UUIDs ambiguous", () => {
        const result = classifyLogseqDBChange({
            blocks: [block],
            txData: [],
            txMeta: {outlinerOp: "delete-blocks"}
        });

        expect(result.classification).toBe("ambiguous");
        expect(result.reason).toContain("stable deleted UUIDs");
    });

    test.each([
        [{blocks: [block], txData: "not-an-array"}, "txData"],
        [{blocks: [block], txData: [], txMeta: {outlinerOp: "future-op"}}, "future-op"],
        [
            {blocks: [block], txData: [[101, ":future/attribute", true, 9001, true]]},
            ":future/attribute"
        ],
        [{blocks: [], txData: [], txMeta: {outlinerOp: "save-block"}}, "no changed"]
    ])("fails loudly in tests for unexpected event shape %#", (event, expectedReason) => {
        expect(() => classifyLogseqDBChange(event, {strict: true})).toThrow(
            UnexpectedLogseqDBEventError
        );
        expect(() => classifyLogseqDBChange(event, {strict: true})).toThrow(expectedReason);
    });

    test("coalesces blocks, transaction attributes, operations, and deletions", () => {
        const first = classifyLogseqDBChange({
            blocks: [block],
            txData: [[101, ":block/title", "Edited", 1, true]],
            txMeta: {outlinerOp: "save-block"}
        });
        const secondBlock = {...block, id: 102, uuid: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"};
        const second = classifyLogseqDBChange({
            blocks: [secondBlock],
            txData: [[102, ":block/parent", 50, 2, true]],
            txMeta: {outlinerOp: "move-blocks"},
            deletedBlockUuids: ["CCCCCCCC-CCCC-CCCC-CCCC-CCCCCCCCCCCC"]
        });

        const merged = mergeClassifiedDBChanges([first, second]);

        expect(merged.eventCount).toBe(2);
        expect(merged.blocks).toHaveLength(2);
        expect(merged.txAttributes).toEqual([":block/parent", ":block/title"]);
        expect(merged.outlinerOps).toEqual(["save-block", "move-blocks"]);
        expect(merged.deletedBlockUuids).toEqual(["cccccccc-cccc-cccc-cccc-cccccccccccc"]);
    });
});
