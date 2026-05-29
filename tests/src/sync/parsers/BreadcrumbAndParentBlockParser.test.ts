import {describe, expect, test, vi} from "vitest";

const logseqProxyMock = vi.hoisted(() => ({
    page: {id: 1, name: "Child"},
    parentPages: [
        {id: 2, name: "Parent"},
        {id: 3, name: "Grand"}
    ],
    getPluginSettings: vi.fn(() => ({
        breadcrumbDisplayOptions: ["Page name", "Page namespace"]
    })),
    getPage: vi.fn(async () => logseqProxyMock.page),
    getParentNamespacePages: vi.fn(async () => logseqProxyMock.parentPages)
}));

vi.mock("../../../../src/logseq/LogseqProxy", () => ({
    LogseqProxy: {
        Settings: {
            getPluginSettings: logseqProxyMock.getPluginSettings
        },
        Editor: {
            getPage: logseqProxyMock.getPage,
            getParentNamespacePages: logseqProxyMock.getParentNamespacePages
        }
    }
}));

vi.mock("../../../../src/logseq/getNameFromPage", () => ({
    default: (page: {name?: string}) => page.name
}));

import {BreadcrumbAndParentBlockParser} from "../../../../src/sync/parsers/BreadcrumbAndParentBlockParser";

describe("BreadcrumbAndParentBlockParser", () => {
    test("does not mutate cached namespace parent pages while building full page names", async () => {
        const originalParentOrder = logseqProxyMock.parentPages.map((page) => page.name);

        const breadcrumb = await BreadcrumbAndParentBlockParser.parse(
            {pageId: 1} as any,
            "Graph",
            new Set()
        );

        expect(breadcrumb).toContain("Grand/Parent/Child");
        expect(logseqProxyMock.parentPages.map((page) => page.name)).toEqual(originalParentOrder);
    });
});
