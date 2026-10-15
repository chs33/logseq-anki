import {describe, expect, test} from "vitest";
import createBlockUuidFilterClause from "../../../src/logseq/createBlockUuidFilterClause";

describe("createBlockUuidFilterClause", () => {
    test("leaves Full Sync discovery unrestricted", () => {
        expect(createBlockUuidFilterClause()).toBe("");
    });

    test("binds targeted discovery to stable block UUIDs", () => {
        const clause = createBlockUuidFilterClause(
            new Set([
                "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
                "bbbbbbbb-bbbb-4bbb-9bbb-bbbbbbbbbbbb"
            ])
        );

        expect(clause).toContain("[?b :block/uuid ?candidate-uuid]");
        expect(clause).toContain('#uuid "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"');
        expect(clause).toContain('#uuid "bbbbbbbb-bbbb-4bbb-9bbb-bbbbbbbbbbbb"');
    });

    test("accepts Logseq synthetic journal page UUIDs", () => {
        const journalPageUuid = "00000001-2026-1015-0000-000000000000";

        const clause = createBlockUuidFilterClause(new Set([journalPageUuid]));

        expect(clause).toContain(`#uuid "${journalPageUuid}"`);
    });

    test("rejects unstable or malformed candidate identities", () => {
        expect(() => createBlockUuidFilterClause(new Set(["visible-sibling-index-3"]))).toThrow(
            "invalid Logseq block UUID"
        );

        expect(() =>
            createBlockUuidFilterClause(
                new Set(['00000001-2026-1015-0000-000000000000" ] [(identity)'])
            )
        ).toThrow("invalid Logseq block UUID");
    });
});
