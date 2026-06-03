import {beforeEach, describe, expect, test, vi} from "vitest";

const listFilesOfCurrentGraphMock = vi.hoisted(() => vi.fn());
const getBlockHashMock = vi.hoisted(() => vi.fn());
const getPageHashMock = vi.hoisted(() => vi.fn());
const syncCompleteListeners = vi.hoisted(() => [] as Array<() => void>);

vi.mock("../../../../src/logseq/LogseqProxy", () => ({
    LogseqProxy: {
        Assets: {
            listFilesOfCurrentGraph: listFilesOfCurrentGraphMock
        },
        Editor: {
            getBlock: vi.fn(async (uuid: string) => ({
                uuid,
                content: "content",
                format: "markdown",
                page: {id: 42},
                properties: {},
                updatedAt: 1
            })),
            getPage: vi.fn(async (id: number) => ({
                id,
                originalName: "Page",
                properties: {},
                updatedAt: 1
            })),
            getParentNamespacePages: vi.fn(async () => [])
        },
        Settings: {
            getPluginSettings: vi.fn(() => ({
                includeParentContent: false
            }))
        }
    }
}));

vi.mock("../../../../src/logseq/WindowParentBridge", () => ({
    WindowParentBridge: {
        addEventListener: vi.fn((eventName: string, listener: () => void) => {
            if (eventName === "syncLogseqToAnkiComplete") {
                syncCompleteListeners.push(listener);
            }
        })
    }
}));

vi.mock("../../../../src/sync/cache/BlockAndPageHashCache", () => ({
    getBlockHash: getBlockHashMock,
    getPageHash: getPageHashMock
}));

import NoteHashCalculator from "../../../../src/sync/cache/NoteHashCalculator";

function createNote() {
    return {
        uuid: "note-uuid",
        pageId: 42,
        getBlockDependencies: () => [{type: "Block", value: "note-uuid"}]
    };
}

function createAnkiFields(assetPath: string) {
    return ["html", new Set([assetPath]), "Deck", "Breadcrumb", []] as any;
}

describe("NoteHashCalculator asset modified-time cache", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        NoteHashCalculator.clearAssetModifiedTimeMapCache();
        getBlockHashMock.mockResolvedValue(123);
        getPageHashMock.mockResolvedValue(456);
        listFilesOfCurrentGraphMock.mockResolvedValue([
            {path: "/graph/assets/image.png", modifiedTime: 1000}
        ]);
    });

    test("loads graph asset modified times once until sync completion clears the cache", async () => {
        await NoteHashCalculator.getHash(
            createNote() as any,
            createAnkiFields("../assets/image.png")
        );
        await NoteHashCalculator.getHash(
            createNote() as any,
            createAnkiFields("../assets/image.png")
        );

        expect(listFilesOfCurrentGraphMock).toHaveBeenCalledTimes(1);

        for (const listener of syncCompleteListeners) {
            listener();
        }

        await NoteHashCalculator.getHash(
            createNote() as any,
            createAnkiFields("../assets/image.png")
        );

        expect(listFilesOfCurrentGraphMock).toHaveBeenCalledTimes(2);
    });
});
