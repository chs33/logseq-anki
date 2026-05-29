import {describe, expect, test} from "vitest";
import {LOGSEQ_CLOZE_NOTE_BLOCK_REGEXP} from "../../../src/constants";

describe("ClozeNote syntax detection", () => {
    test.each([
        "{{c1 A}}",
        "{{c9 B}}",
        "{{cloze1 C}}",
        "{{cloze9 D}}",
        "{{cloze E}}",
        "{{c1::F}}",
        "{{c10::G}}"
    ])("detects %s as a cloze note block", (content) => {
        expect(LOGSEQ_CLOZE_NOTE_BLOCK_REGEXP.test(content)).toBe(true);
    });
});
