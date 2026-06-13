import {describe, expect, test} from "vitest";
import {LogseqAppInfoFetcher} from "../../../src/logseq/LogseqAppInfoFetcher";

describe("LogseqAppInfoFetcher", () => {
    test("strips the internal DB graph prefix from Logseq deep-link graph names", () => {
        expect(
            LogseqAppInfoFetcher.getGraphNameForLogseqLinks(
                {name: "logseq_db_logseq-notes", path: "/Users/me/logseq/graphs/logseq-notes"},
                true
            )
        ).toBe("logseq-notes");
    });

    test("keeps prefixed graph names unchanged for non-DB graphs", () => {
        expect(
            LogseqAppInfoFetcher.getGraphNameForLogseqLinks(
                {name: "logseq_db_logseq-notes", path: "/Users/me/logseq/graphs/logseq-notes"},
                false
            )
        ).toBe("logseq_db_logseq-notes");
    });

    test("falls back to the graph directory when the API name is missing", () => {
        expect(
            LogseqAppInfoFetcher.getGraphNameForLogseqLinks(
                {name: "", path: "C:\\Users\\me\\logseq\\graphs\\Research\\db.sqlite"},
                true
            )
        ).toBe("Research");
    });
});
