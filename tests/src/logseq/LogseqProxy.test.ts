import type {BlockEntity} from "@logseq/libs/dist/LSPlugin";
import {afterEach, describe, expect, it, vi} from "vitest";
import {LogseqPropertiesHelperProxy} from "../../../src/logseq/LogseqPropertiesHelper";
import {LogseqProxy} from "../../../src/logseq/LogseqProxy";

afterEach(() => {
    vi.restoreAllMocks();
});

describe("LogseqProxy.Editor.getBlock", () => {
    it("reuses a child-inclusive block for a later root-only read", async () => {
        const uuid = "10000000-0000-0000-0000-000000000001";
        const block = {
            id: 1,
            uuid,
            content: "Root",
            properties: {deck: "Default"},
            children: [
                {
                    id: 2,
                    uuid: "10000000-0000-0000-0000-000000000002",
                    content: "Child",
                    properties: {},
                    children: []
                }
            ]
        } as unknown as BlockEntity;
        const getBlock = vi.spyOn(LogseqPropertiesHelperProxy, "getBlock").mockResolvedValue(block);

        const blockWithChildren = await LogseqProxy.Editor.getBlock(uuid, {
            includeChildren: true
        });
        const rootOnlyBlock = await LogseqProxy.Editor.getBlock(uuid);

        expect(getBlock).toHaveBeenCalledOnce();
        expect(blockWithChildren).toBe(block);
        expect(rootOnlyBlock).not.toBe(blockWithChildren);
        expect(rootOnlyBlock).toMatchObject({
            uuid,
            content: "Root",
            properties: {deck: "Default"},
            children: []
        });
        expect(blockWithChildren?.children).toHaveLength(1);
    });
});
