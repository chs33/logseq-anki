import {afterEach, describe, expect, test, vi} from "vitest";
import {
    ClozeNote,
    getInlineHTMLForLogseqRenderedCloze,
    getLogseqPluginClozesFromContent,
    getUnsupportedLogseqClozes,
    insertLineBreakAfterLogseqCloze,
    shouldInsertSourceLineBreakAfterLogseqCloze
} from "../../../src/anki-notes/ClozeNote";
import {LOGSEQ_CLOZE_NOTE_BLOCK_REGEXP} from "../../../src/constants";
import {LogseqProxy} from "../../../src/logseq/LogseqProxy";
import {LogseqToHtmlConverter} from "../../../src/logseq/LogseqToHtmlConverter";

describe("ClozeNote syntax detection", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

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

    test("extracts cloze content with markdown and commas from raw block content", () => {
        const clozes = getLogseqPluginClozesFromContent(
            "cross connect - {{c1 refers to connect your trading server rack *directly* to the exchange's network through some fiber cable, which means the connection is private }}"
        );

        expect(clozes).toEqual([
            {
                content:
                    "refers to connect your trading server rack *directly* to the exchange's network through some fiber cable, which means the connection is private ",
                lineBreakAfter: false,
                lineBreakHasLeadingWhitespace: false
            }
        ]);
    });

    test("extracts multiple clozes containing bold markdown and commas", () => {
        const clozes = getLogseqPluginClozesFromContent(
            "git fetch updates your {{c1 **all**,  **remote tracking** branch changes, }} note it is not your {{c1 local branch}} block"
        );

        expect(clozes).toEqual([
            {
                content: "**all**,  **remote tracking** branch changes, ",
                lineBreakAfter: false,
                lineBreakHasLeadingWhitespace: false
            },
            {
                content: "local branch",
                lineBreakAfter: false,
                lineBreakHasLeadingWhitespace: false
            }
        ]);
    });

    test("extracts cloze content and source line breaks from a multiline block", () => {
        const clozes = getLogseqPluginClozesFromContent(
            "{{c1 MAHWAH}} - {{c2 ARCA, NYSE, CHICACO}} \n" +
                "{{c1 CARTRET}} - {{c2 NASDAQ, NASDAQ_BX}}\n" +
                "{{c1 NY4}} - {{c2 BATS, BATS_Y, CTS, UTP}}\n" +
                "{{c1 Aurora}} - {{c2 CME}}}"
        );

        expect(clozes).toEqual([
            {content: "MAHWAH", lineBreakAfter: false, lineBreakHasLeadingWhitespace: false},
            {
                content: "ARCA, NYSE, CHICACO",
                lineBreakAfter: true,
                lineBreakHasLeadingWhitespace: true
            },
            {content: "CARTRET", lineBreakAfter: false, lineBreakHasLeadingWhitespace: false},
            {
                content: "NASDAQ, NASDAQ_BX",
                lineBreakAfter: true,
                lineBreakHasLeadingWhitespace: false
            },
            {content: "NY4", lineBreakAfter: false, lineBreakHasLeadingWhitespace: false},
            {
                content: "BATS, BATS_Y, CTS, UTP",
                lineBreakAfter: true,
                lineBreakHasLeadingWhitespace: false
            },
            {content: "Aurora", lineBreakAfter: false, lineBreakHasLeadingWhitespace: false},
            {content: "CME", lineBreakAfter: false, lineBreakHasLeadingWhitespace: false}
        ]);
    });

    test("unwraps a single paragraph for Logseq inline cloze rendering", () => {
        expect(
            getInlineHTMLForLogseqRenderedCloze("<p>trading rack <i>directly</i> to ARCA, NYSE</p>")
        ).toBe("trading rack <i>directly</i> to ARCA, NYSE");
    });

    test("unwraps a single plain span for Logseq inline cloze rendering", () => {
        expect(
            getInlineHTMLForLogseqRenderedCloze(
                "\n      <span>trading rack <i>directly</i> to ARCA, NYSE</span>\n    "
            )
        ).toBe("trading rack <i>directly</i> to ARCA, NYSE");
    });

    test("keeps multi-block rendered HTML unchanged", () => {
        const html = "<p>first</p><p>second</p>";

        expect(getInlineHTMLForLogseqRenderedCloze(html)).toBe(html);
    });

    test("converts markdown cloze content to inline HTML for Logseq display", async () => {
        const htmlFile = await LogseqToHtmlConverter.convertToHTMLFile(
            "trading rack *directly* to ARCA, NYSE",
            "markdown",
            {displayTags: true, processRefEmbeds: false}
        );

        expect(getInlineHTMLForLogseqRenderedCloze(htmlFile.html)).toBe(
            "trading rack <i>directly</i> to ARCA, NYSE"
        );
    });

    test("renders bold markdown and punctuation as inline Logseq cloze HTML", async () => {
        const htmlFile = await LogseqToHtmlConverter.convertToHTMLFile(
            "**all**,  **remote tracking** branch changes, ",
            "markdown",
            {displayTags: true, processRefEmbeds: false}
        );

        expect(getInlineHTMLForLogseqRenderedCloze(htmlFile.html)).toBe(
            "<b>all</b>,  <b>remote tracking</b> branch changes,"
        );
    });

    test("finds an unsupported Logseq cloze when the cloze is the mutation root", () => {
        const unsupportedCloze = document.createElement("span");
        unsupportedCloze.title = "Unsupported macro name: c1";
        unsupportedCloze.innerHTML = "{{c1 **all**,  **remote tracking** branch changes, }}";

        expect(getUnsupportedLogseqClozes(unsupportedCloze)).toEqual([unsupportedCloze]);
    });

    test("finds unsupported Logseq clozes below a mutation root without duplicates", () => {
        const mutationRoot = document.createElement("div");
        mutationRoot.innerHTML =
            '<span title="Unsupported macro name: c1">first</span>' +
            '<span title="Unsupported macro name: c1">second</span>';

        expect(getUnsupportedLogseqClozes(mutationRoot)).toEqual(
            Array.from(mutationRoot.querySelectorAll("span"))
        );
    });

    test("does not insert a duplicate break after Logseq macro wrapper", () => {
        document.body.innerHTML =
            '<span class="macro"><span class="anki-cloze">ARCA</span></span> \n <br><span>CARTRET</span>';
        const renderedCloze = document.querySelector(".anki-cloze") as HTMLElement;

        insertLineBreakAfterLogseqCloze(renderedCloze);

        expect(document.body.querySelectorAll("br")).toHaveLength(1);
    });

    test("does not insert a duplicate break when Logseq kept a newline text node", () => {
        document.body.innerHTML =
            '<span class="macro"><span class="anki-cloze">ARCA</span></span> \n <span>CARTRET</span>';
        const renderedCloze = document.querySelector(".anki-cloze") as HTMLElement;

        insertLineBreakAfterLogseqCloze(renderedCloze);

        expect(document.body.querySelectorAll("br")).toHaveLength(0);
    });

    test("detects an existing break after an outer Logseq wrapper", () => {
        document.body.innerHTML =
            '<span class="macro-outer"><span class="macro"><span class="anki-cloze">ARCA</span></span></span><br><span>CARTRET</span>';
        const renderedCloze = document.querySelector(".anki-cloze") as HTMLElement;

        insertLineBreakAfterLogseqCloze(renderedCloze);

        expect(document.body.querySelectorAll("br")).toHaveLength(1);
    });

    test("collapses duplicate breaks after Logseq macro wrapper", () => {
        document.body.innerHTML =
            '<span class="macro"><span class="anki-cloze">ARCA</span></span> \n <br> \n <br><span>CARTRET</span>';
        const renderedCloze = document.querySelector(".anki-cloze") as HTMLElement;

        insertLineBreakAfterLogseqCloze(renderedCloze);

        expect(document.body.querySelectorAll("br")).toHaveLength(1);
    });

    test("does not insert a duplicate break inside Logseq macro wrapper", () => {
        document.body.innerHTML =
            '<span class="macro"><span class="anki-cloze">ARCA</span> \n <br></span><span>CARTRET</span>';
        const renderedCloze = document.querySelector(".anki-cloze") as HTMLElement;

        insertLineBreakAfterLogseqCloze(renderedCloze);

        expect(document.body.querySelectorAll("br")).toHaveLength(1);
    });

    test("inserts a missing source break after Logseq macro wrapper", () => {
        document.body.innerHTML =
            '<span class="macro"><span class="anki-cloze">ARCA</span></span><span>CARTRET</span>';
        const renderedCloze = document.querySelector(".anki-cloze") as HTMLElement;

        insertLineBreakAfterLogseqCloze(renderedCloze);

        expect(document.body.innerHTML).toBe(
            '<span class="macro"><span class="anki-cloze">ARCA</span></span><br><span>CARTRET</span>'
        );
    });

    test("source line break insertion is decided by source content before DOM deduplication", () => {
        const sourceCloze = {
            content: "BATS, BATS_Y, CTS, UTP",
            lineBreakAfter: true,
            lineBreakHasLeadingWhitespace: false
        };

        expect(shouldInsertSourceLineBreakAfterLogseqCloze(sourceCloze, true)).toBe(true);
        expect(shouldInsertSourceLineBreakAfterLogseqCloze(sourceCloze, false)).toBe(true);
    });

    test("does not insert source line breaks with leading whitespace in rendered mode", () => {
        const sourceCloze = {
            content: "ARCA, NYSE, CHICACO",
            lineBreakAfter: true,
            lineBreakHasLeadingWhitespace: true
        };

        expect(shouldInsertSourceLineBreakAfterLogseqCloze(sourceCloze, true)).toBe(false);
        expect(shouldInsertSourceLineBreakAfterLogseqCloze(sourceCloze, false)).toBe(true);
    });

    test("renders child blocks as answer-side context", async () => {
        vi.spyOn(LogseqProxy.App, "checkCurrentIsDbGraph").mockResolvedValue(false);
        vi.spyOn(LogseqProxy.Editor, "getBlock").mockResolvedValue({
            properties: {}
        } as any);

        const note = new ClozeNote(
            "parent-uuid",
            "{{c1 hidden answer}}",
            "markdown",
            {},
            1,
            [],
            [
                {
                    uuid: "child-uuid",
                    content: "Child detail",
                    format: "markdown",
                    properties: {},
                    children: [
                        {
                            uuid: "nested-child-uuid",
                            content: "Nested detail",
                            format: "markdown",
                            properties: {extra: "Nested extra"},
                            children: []
                        }
                    ]
                }
            ]
        );

        const htmlFile = await note.getClozedContentHTML();

        expect(htmlFile.html).toContain('class="extra extra-block"');
        expect(htmlFile.html).toContain('class="children-list left-border"');
        expect(htmlFile.html).toContain("Child detail");
        expect(htmlFile.html).toContain("Nested detail");
        expect(htmlFile.html).toContain("Nested extra");
    });

    test("includes child block UUIDs in cloze dependencies", () => {
        const note = new ClozeNote(
            "parent-uuid",
            "{{c1 hidden answer}}",
            "markdown",
            {},
            1,
            [],
            [
                {
                    uuid: "child-uuid",
                    content: "Child detail",
                    format: "markdown",
                    properties: {},
                    children: [
                        {
                            uuid: "nested-child-uuid",
                            content: "Nested detail",
                            format: "markdown",
                            properties: {},
                            children: []
                        }
                    ]
                }
            ]
        );

        expect(note.getBlockDependencies()).toEqual([
            {type: "Block", value: "parent-uuid"},
            {type: "Block", value: "child-uuid"},
            {type: "Block", value: "nested-child-uuid"}
        ]);
    });
});
