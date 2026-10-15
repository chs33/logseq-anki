import {beforeAll, beforeEach, describe, expect, test, vi} from "vitest";

const state = vi.hoisted(() => ({
    block: {} as Record<string, any>,
    syncCompleteListeners: [] as Array<() => void>
}));

vi.mock("../../../../src/logseq/LogseqProxy", () => ({
    LogseqProxy: {
        Editor: {
            getBlock: vi.fn(async () => state.block),
            getPage: vi.fn(async () => ({id: 7, updatedAt: 100}))
        }
    }
}));

vi.mock("../../../../src/logseq/getLogseqContentDirectDependencies", () => ({
    default: vi.fn(async () => [])
}));

vi.mock("../../../../src/logseq/WindowParentBridge", () => ({
    WindowParentBridge: {
        addEventListener: vi.fn((eventName: string, listener: () => void) => {
            if (eventName === "syncLogseqToAnkiComplete") {
                state.syncCompleteListeners.push(listener);
            }
        })
    }
}));

import {
    getBlockHash,
    init as initBlockAndPageHashCache
} from "../../../../src/sync/cache/BlockAndPageHashCache";

const blockUuid = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

function clearHashCache(): void {
    for (const listener of state.syncCompleteListeners) listener();
}

function setBlock(
    order: string | undefined,
    left: number | {id: number},
    content = "Card content",
    updatedAt = 200
): void {
    state.block = {
        uuid: blockUuid,
        content,
        format: "markdown",
        properties: {},
        updatedAt,
        parent: {id: 6},
        page: {id: 7},
        order,
        left
    };
}

describe("BlockAndPageHashCache semantic hashing", () => {
    beforeAll(() => {
        initBlockAndPageHashCache();
    });

    beforeEach(() => {
        clearHashCache();
    });

    test("ignores Logseq 2.0 sibling order for an independent card", async () => {
        setBlock("a0", {id: 10});
        const firstHash = await getBlockHash(blockUuid);

        setBlock("a1", {id: 10});
        clearHashCache();
        const secondHash = await getBlockHash(blockUuid);

        expect(secondHash).toBe(firstHash);
    });

    test("ignores legacy left changes when the Logseq 2.0 order is present", async () => {
        setBlock("a0", {id: 10});
        const firstHash = await getBlockHash(blockUuid);

        setBlock("a0", {id: 11});
        clearHashCache();
        const secondHash = await getBlockHash(blockUuid);

        expect(secondHash).toBe(firstHash);
    });

    test("ignores legacy sibling position for an independent card", async () => {
        setBlock(undefined, {id: 10});
        const firstHash = await getBlockHash(blockUuid);

        setBlock(undefined, {id: 11});
        clearHashCache();
        const secondHash = await getBlockHash(blockUuid);

        expect(secondHash).toBe(firstHash);
    });

    test("detects equal-length content edits without relying on updatedAt", async () => {
        setBlock("a0", {id: 10}, "Card alpha", 200);
        const firstHash = await getBlockHash(blockUuid);

        setBlock("a0", {id: 10}, "Card bravo", 200);
        clearHashCache();
        const secondHash = await getBlockHash(blockUuid);

        expect(secondHash).not.toBe(firstHash);
    });

    test("ignores updatedAt-only changes", async () => {
        setBlock("a0", {id: 10}, "Card content", 200);
        const firstHash = await getBlockHash(blockUuid);

        setBlock("a0", {id: 10}, "Card content", 300);
        clearHashCache();
        const secondHash = await getBlockHash(blockUuid);

        expect(secondHash).toBe(firstHash);
    });
});
