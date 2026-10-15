import {describe, expect, test} from "vitest";
import type {PluginSettings} from "../../../../src/settings";
import getHashRelevantSettings from "../../../../src/sync/cache/getHashRelevantSettings";

describe("getHashRelevantSettings", () => {
    test("ignores persisted sync diagnostics without ignoring rendering settings", () => {
        const firstSettings = {
            defaultDeck: "Default",
            lastSyncDiagnostics: '{"completedAt":"first"}'
        } as PluginSettings;
        const secondSettings = {
            defaultDeck: "Default",
            lastSyncDiagnostics: '{"completedAt":"second"}'
        } as PluginSettings;

        expect(getHashRelevantSettings(firstSettings)).toEqual(
            getHashRelevantSettings(secondSettings)
        );
        expect(getHashRelevantSettings(firstSettings)).toEqual({defaultDeck: "Default"});
    });
});
