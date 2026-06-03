import {describe, expect, test} from "vitest";
import {formatSyncDuration} from "../../../../src/ui/pages/syncResultFormatting";

describe("formatSyncDuration", () => {
    test("formats millisecond durations", () => {
        expect(formatSyncDuration(123)).toBe("123ms");
    });

    test("formats second durations", () => {
        expect(formatSyncDuration(1400)).toBe("1.4s");
    });

    test("formats minute durations", () => {
        expect(formatSyncDuration(123000)).toBe("2m 03s");
    });
});
