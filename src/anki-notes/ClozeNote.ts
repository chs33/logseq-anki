import {Note} from "./Note";
import "@logseq/libs";
import type {BlockUUID} from "@logseq/libs/dist/LSPlugin.user";
import _ from "lodash";
import {LOGSEQ_CLOZE_NOTE_BLOCK_REGEXP, LOGSEQ_PLUGIN_CLOZE_REGEXP} from "../constants";
import createBlockUuidFilterClause from "../logseq/createBlockUuidFilterClause";
import type {DependencyEntity} from "../logseq/getLogseqContentDirectDependencies";
import getUUIDFromBlock from "../logseq/getUUIDFromBlock";
import {LogseqContentPreprocessor} from "../logseq/LogseqContentPreprocessor";
import {LogseqPropertiesHelper} from "../logseq/LogseqPropertiesHelper";
import {LogseqProxy} from "../logseq/LogseqProxy";
import {type HTMLFile, LogseqToHtmlConverterProxy} from "../logseq/LogseqToHtmlConverter";
import {WindowParentBridge} from "../logseq/WindowParentBridge";
import {escapeClozesAndMacroDelimiters, safeReplace, string_to_arr} from "../utils/utils";
import {appendExtraToHtmlFile} from "./NoteUtils";

export type LogseqPluginClozeSource = {
    content: string;
    lineBreakAfter: boolean;
    lineBreakHasLeadingWhitespace: boolean;
};

export const shouldInsertSourceLineBreakAfterLogseqCloze = (
    sourceCloze: LogseqPluginClozeSource | undefined,
    renderClozeMarcosInLogseq: boolean
): sourceCloze is LogseqPluginClozeSource => {
    return Boolean(
        sourceCloze?.lineBreakAfter &&
            !(renderClozeMarcosInLogseq && sourceCloze.lineBreakHasLeadingWhitespace)
    );
};

export const getLogseqPluginClozesFromContent = (
    content: string,
    clozeLimit?: number
): LogseqPluginClozeSource[] => {
    const clozes: LogseqPluginClozeSource[] = [];
    const clozeRegexp = new RegExp(LOGSEQ_PLUGIN_CLOZE_REGEXP.source, "g");

    for (const match of content.matchAll(clozeRegexp)) {
        const matchIndex = match.index ?? 0;
        const contentAfterCloze = content.slice(matchIndex + match[0].length);
        const lineBreakMatch = contentAfterCloze.match(/^([ \t]*)\r?\n/);
        clozes.push({
            content: match[2] ?? "",
            lineBreakAfter: Boolean(lineBreakMatch),
            lineBreakHasLeadingWhitespace: Boolean(lineBreakMatch?.[1])
        });
        if (clozeLimit != null && clozes.length >= clozeLimit) break;
    }

    return clozes;
};

export const getInlineHTMLForLogseqRenderedCloze = (html: string): string => {
    const template = document.createElement("template");
    template.innerHTML = html.trim();

    const meaningfulNodes = Array.from(template.content.childNodes).filter(
        (node) => node.nodeType !== Node.TEXT_NODE || node.textContent?.trim()
    );

    if (meaningfulNodes.length !== 1) return html;

    const onlyNode = meaningfulNodes[0];
    if (onlyNode.nodeType !== Node.ELEMENT_NODE) return html;

    const onlyElement = onlyNode as HTMLElement;
    if (onlyElement.tagName === "P") return onlyElement.innerHTML;
    if (onlyElement.tagName === "SPAN" && onlyElement.attributes.length === 0) {
        return onlyElement.innerHTML;
    }
    return html;
};

const getNextMeaningfulSibling = (node: ChildNode): ChildNode | null => {
    let nextSibling = node.nextSibling;
    while (nextSibling?.nodeType === Node.TEXT_NODE && nextSibling.textContent?.trim() === "") {
        nextSibling = nextSibling.nextSibling;
    }

    return nextSibling;
};

const getExistingLineBreakAfter = (node: ChildNode): ChildNode | null => {
    let nextSibling = node.nextSibling;
    let newlineTextNode: ChildNode | null = null;

    while (nextSibling?.nodeType === Node.TEXT_NODE) {
        const textContent = nextSibling.textContent ?? "";
        if (/\r?\n/.test(textContent)) newlineTextNode = nextSibling;
        if (textContent.trim() !== "") return null;
        nextSibling = nextSibling.nextSibling;
    }

    if ((nextSibling as Element | null)?.tagName === "BR") return nextSibling;
    return newlineTextNode;
};

const removeDuplicateLineBreaksAfter = (lineBreak: ChildNode) => {
    let nextSibling = getNextMeaningfulSibling(lineBreak);

    while ((nextSibling as Element | null)?.tagName === "BR") {
        const duplicateLineBreak = nextSibling;
        nextSibling = getNextMeaningfulSibling(duplicateLineBreak);
        duplicateLineBreak.remove();
    }
};

export const getLogseqClozeLineBreakAnchor = (renderedCloze: HTMLElement): HTMLElement => {
    const macroParent = renderedCloze.parentElement;
    return macroParent?.classList.contains("macro") ? macroParent : renderedCloze;
};

const getLogseqClozeLineBreakSearchAnchors = (renderedCloze: HTMLElement): HTMLElement[] => {
    const anchors = [renderedCloze];
    let currentElement = renderedCloze.parentElement;

    while (
        currentElement &&
        !currentElement.matches(".block-content, .block-content-inner, .ls-block")
    ) {
        anchors.push(currentElement);
        currentElement = currentElement.parentElement;
    }

    return anchors;
};

export const insertLineBreakAfterLogseqCloze = (
    renderedCloze: HTMLElement,
    createLineBreak: () => HTMLBRElement = () => document.createElement("br")
) => {
    const lineBreakAnchor = getLogseqClozeLineBreakAnchor(renderedCloze);
    for (const anchor of getLogseqClozeLineBreakSearchAnchors(renderedCloze)) {
        const existingLineBreak = getExistingLineBreakAfter(anchor);
        if (existingLineBreak) {
            removeDuplicateLineBreaksAfter(existingLineBreak);
            return;
        }
    }

    lineBreakAnchor.after(createLineBreak());
};

export class ClozeNote extends Note {
    public type = "cloze";
    public children: any[];

    public constructor(
        uuid: string,
        content: string,
        format: string,
        properties: any,
        pageId: number,
        tags: string[] = [],
        children: any[] = []
    ) {
        super(uuid, content, format, properties, pageId, tags);
        this.children = children;
    }

    public static initLogseqOperations = () => {
        // Init logseq operations at start of the program
        logseq.Editor.registerSlashCommand("Replace Cloze", [
            ["editor/input", `replacecloze:: " '' "`, {"backward-pos": 3}],
            ["editor/clear-current-slash"]
        ]);
        logseq.provideStyle(`
            .page-reference[data-ref=type-in], a[data-ref=type-in] {
                opacity: .3;
            }
        `);
        LogseqProxy.Editor.createTagSilentlyIfNotExists("type-in");
        LogseqProxy.App.checkCurrentIsDbGraph().then((isDbGraph) => {
            if (!isDbGraph) {
                LogseqProxy.Editor.registerProperty("replacecloze", {
                    type: "default",
                    cardinality: "one",
                    hide: false
                });
            }
        });
        const {hideClozeMarcosUntilHoverInLogseq, renderClozeMarcosInLogseq} =
            LogseqProxy.Settings.getPluginSettings();
        logseq.provideStyle(`
            span[title="Unsupported macro name: c1"],
            span[title="Unsupported macro name: c2"],
            span[title="Unsupported macro name: c3"],
            span[title="Unsupported macro name: c4"],
            span[title="Unsupported macro name: c5"],
            span[title="Unsupported macro name: c6"],
            span[title="Unsupported macro name: c7"],
            span[title="Unsupported macro name: c8"],
            span[title="Unsupported macro name: c9"],
            span[title="Unsupported macro name: cloze1"],
            span[title="Unsupported macro name: cloze2"],
            span[title="Unsupported macro name: cloze3"],
            span[title="Unsupported macro name: cloze4"],
            span[title="Unsupported macro name: cloze5"],
            span[title="Unsupported macro name: cloze6"],
            span[title="Unsupported macro name: cloze7"],
            span[title="Unsupported macro name: cloze8"],
            span[title="Unsupported macro name: cloze9"] {
                visibility: hidden !important;
            }
            .anki-cloze {
                background: unset;
                color: inherit;
            }
        `);
        if (!renderClozeMarcosInLogseq) {
            logseq.provideStyle(`
                .anki-cloze {
                    white-space: pre-wrap;
                }
            `);
        }
        if (hideClozeMarcosUntilHoverInLogseq) {
            logseq.provideStyle(`
                .anki-cloze {
                    background: unset !important;
                    color: transparent !important;
                    text-decoration: underline 1px dashed var(--ls-primary-text-color) !important;
                    text-underline-position: under !important;
                }
                .anki-cloze:hover {
                    background: unset !important;
                    color: var(--ls-primary-text-color) !important;
                }
            `);
        } else {
            logseq.provideStyle(`
                .anki-cloze {
                    background: unset !important;
                }
            `);
        }
        const setupAnkiClozeObserverAndRenderThemInLogseqWhenObserved = () => {
            const blockUUIDAttributes = [
                "blockid",
                "data-block-id",
                "data-block-uuid",
                "data-uuid"
            ];
            const blockUUIDSelector = blockUUIDAttributes.map((attr) => `[${attr}]`).join(", ");
            const blockSelector = [".ls-block", blockUUIDSelector].join(", ");

            const getBlockElement = (element: Element): Element => {
                return element.closest(".ls-block") || element.closest(blockSelector) || element;
            };

            const getBlockUUIDFromAttributes = (element: Element | null): string | null => {
                if (!element) return null;

                for (const attribute of blockUUIDAttributes) {
                    const value = element.getAttribute(attribute);
                    if (value) return value;
                }

                return null;
            };

            const getBlockUUIDFromElement = (element: Element): string | null => {
                const blockUUID =
                    getBlockUUIDFromAttributes(element) ||
                    getBlockUUIDFromAttributes(element.querySelector(blockUUIDSelector));
                if (blockUUID) return blockUUID;

                let currentElement = element.parentElement;
                while (currentElement) {
                    const parentBlockUUID = getBlockUUIDFromAttributes(currentElement);
                    if (parentBlockUUID) return parentBlockUUID;
                    currentElement = currentElement.parentElement;
                }

                return null;
            };

            const getQueryableAddedNode = (node: Node): ParentNode | null => {
                if (node.nodeType === 1 || node.nodeType === 11) return node as ParentNode;
                return null;
            };

            const getSourceClozesFromBlock = async (
                blockElement: Element,
                clozeCount: number
            ): Promise<LogseqPluginClozeSource[]> => {
                const blockUUID = getBlockUUIDFromElement(blockElement);
                if (!blockUUID) return [];

                const block = await LogseqPropertiesHelper.getBlock(blockUUID);
                const sourceContent = (block as {title?: string} | null)?.title || block?.content;
                if (!sourceContent) return [];

                return getLogseqPluginClozesFromContent(sourceContent, clozeCount);
            };

            const displayAnkiCloze = async (elem: ParentNode) => {
                const firstCloze = elem.querySelector('span[title^="Unsupported macro name: c"]');
                if (!firstCloze) return;

                const blockElements = new Set<Element>();
                const observedClozes = elem.querySelectorAll(
                    'span[title^="Unsupported macro name: c"]'
                );
                observedClozes.forEach((cloze) => {
                    blockElements.add(getBlockElement(cloze));
                });

                for (const blockElement of blockElements) {
                    const clozes = Array.from(
                        blockElement.querySelectorAll('span[title^="Unsupported macro name: c"]')
                    );
                    const sourceClozes = await getSourceClozesFromBlock(
                        blockElement,
                        clozes.length
                    );
                    for (const [clozeIndex, cloze] of clozes.entries()) {
                        if (/c(loze)?[1-9]$/.test((cloze as Element & {title}).title)) {
                            const sourceCloze = sourceClozes[clozeIndex];
                            let content =
                                sourceCloze?.content ??
                                cloze.innerHTML.replace(LOGSEQ_PLUGIN_CLOZE_REGEXP, "$2");
                            if (renderClozeMarcosInLogseq) {
                                const renderedMarkdown =
                                    await LogseqToHtmlConverterProxy.convertToHTMLFile(
                                        content,
                                        "markdown",
                                        {displayTags: true, processRefEmbeds: false}
                                    );
                                content = getInlineHTMLForLogseqRenderedCloze(
                                    renderedMarkdown.html
                                );
                            }
                            // if parent element has class macro
                            if (cloze.parentElement.classList.contains("macro"))
                                cloze.parentElement.style.display = "initial";
                            const renderedCloze = WindowParentBridge.createElement("span");
                            renderedCloze.className = "anki-cloze";
                            renderedCloze.title = cloze.innerHTML;
                            if (renderClozeMarcosInLogseq || !sourceCloze) {
                                renderedCloze.innerHTML = content;
                            } else {
                                renderedCloze.textContent = content;
                            }
                            cloze.replaceWith(renderedCloze);
                            if (
                                shouldInsertSourceLineBreakAfterLogseqCloze(
                                    sourceCloze,
                                    renderClozeMarcosInLogseq
                                )
                            ) {
                                insertLineBreakAfterLogseqCloze(renderedCloze, () =>
                                    WindowParentBridge.createElement("br")
                                );
                            }
                        }
                    }
                }
            };
            const observer = new MutationObserver((mutations) => {
                if (mutations.length <= 8) {
                    for (const mutation of mutations) {
                        mutation.addedNodes.forEach((addedNode) => {
                            if (!addedNode.childNodes.length) return;
                            const queryableNode = getQueryableAddedNode(addedNode);
                            if (!queryableNode) return;
                            void displayAnkiCloze(queryableNode);
                        });
                    }
                } else void displayAnkiCloze(WindowParentBridge.getBody() as Element);
            });
            observer.observe(WindowParentBridge.getDocument(), {
                subtree: true,
                childList: true
            });
            void displayAnkiCloze(WindowParentBridge.getBody() as Element);
        };
        setupAnkiClozeObserverAndRenderThemInLogseqWhenObserved();
    };

    private async getChildrenListHTMLFile(childrenList: any[]): Promise<HTMLFile> {
        if (!Array.isArray(childrenList) || childrenList.length === 0)
            return {html: "", assets: new Set<string>(), tags: []};

        const childrenListAssets = new Set<string>();
        let childrenListHTML = `\n<ul class="children-list left-border">`;

        for (const child of childrenList) {
            childrenListHTML += `\n<li class="children ${_.get(child, "properties['logseq.orderListType']") === "number" ? "numbered" : ""}">`;

            const childFormat = _.get(child, "format", this.format);
            const childContent = escapeClozesAndMacroDelimiters(_.get(child, "content", ""));
            const childHTMLFile = await LogseqToHtmlConverterProxy.convertToHTMLFile(
                childContent,
                childFormat
            );
            const childHTMLFileWithExtra = await appendExtraToHtmlFile(
                childHTMLFile,
                _.get(child, "properties.extra"),
                childFormat
            );
            let childHTML = childHTMLFileWithExtra.html;
            childHTMLFileWithExtra.assets.forEach((asset) => childrenListAssets.add(asset));

            const nestedChildrenHTMLFile = await this.getChildrenListHTMLFile(
                _.get(child, "children", [])
            );
            childHTML += nestedChildrenHTMLFile.html;
            nestedChildrenHTMLFile.assets.forEach((asset) => childrenListAssets.add(asset));

            childrenListHTML += `${childHTML}</li>`;
        }

        childrenListHTML += `</ul>`;

        return {
            html: childrenListHTML,
            assets: childrenListAssets,
            tags: []
        };
    }

    private async appendChildrenToHtmlFile(htmlFile: HTMLFile): Promise<HTMLFile> {
        const childrenHTMLFile = await this.getChildrenListHTMLFile(this.children);
        if (!childrenHTMLFile.html) return htmlFile;

        const result = _.cloneDeep(htmlFile);
        childrenHTMLFile.assets.forEach((asset) => result.assets.add(asset));
        result.html += `\n<div class="extra extra-block">${childrenHTMLFile.html}</div>`;

        return result;
    }

    public async getClozedContentHTML(): Promise<HTMLFile> {
        let cloze_id = 1;
        let clozedContent: string = this.content;

        // --- Remove logseq properties and store it in removedLogseqProperties as it might cause problems during cloze creation ---
        const [contentWithoutProperties, , removedLogseqProperties] =
            LogseqContentPreprocessor.extractProperties(
                clozedContent,
                this.format as "markdown" | "org"
            );
        clozedContent = contentWithoutProperties;

        // --- Add anki cloze marco clozes ---
        clozedContent = safeReplace(
            clozedContent,
            /\{\{(c|cloze)([1-9]) (.*?)\}\}/g,
            (_match, _group1, group2, group3) => {
                cloze_id = Math.max(cloze_id, parseInt(group2, 10) + 1);
                group3 = group3.replace(
                    /(.*)(\\\\|::)(.*)/,
                    (_match, g1, _g2, g3) => `${g1.trim()}::${g3.trim()}`
                ); // Add support for logseq cloze cue
                return `{{c${parseInt(group2, 10)}::${group3}}}`;
            }
        );

        // --- Add replace clozes ---
        if (!(await LogseqProxy.App.checkCurrentIsDbGraph())) {
            const replaceclozeProp =
                this.properties?.replacecloze ?? this.properties?.[".replacecloze"];
            if (replaceclozeProp) {
                let replaceclozeArr: any;
                try {
                    if (typeof replaceclozeProp === "string" && replaceclozeProp.trim() !== "") {
                        replaceclozeArr = string_to_arr(
                            replaceclozeProp.replace(/(^\s*"|\s*"$)/g, "")
                        );
                    } else if (
                        typeof replaceclozeProp === "object" &&
                        replaceclozeProp.constructor === Array
                    ) {
                        replaceclozeArr = string_to_arr(replaceclozeProp.join(","));
                    } else replaceclozeArr = [];
                } catch (e) {
                    throw new Error(
                        `Error parsing replacecloze property: ${e instanceof Error ? e.message : String(e)}`,
                        {cause: e}
                    );
                }

                const replaceclozehintProp =
                    this.properties?.replaceclozehint ?? this.properties?.[".replaceclozehint"];
                let replaceclozeHintArr: any;
                if (
                    typeof replaceclozehintProp === "string" &&
                    replaceclozehintProp.trim() !== ""
                ) {
                    replaceclozeHintArr = replaceclozehintProp
                        .replace(/(^\s*"|\s*"$)/g, "")
                        .split(",");
                } else if (
                    typeof replaceclozehintProp === "object" &&
                    replaceclozehintProp.constructor === Array
                ) {
                    replaceclozeHintArr = replaceclozehintProp;
                } else replaceclozeHintArr = [];
                replaceclozeHintArr = replaceclozeHintArr.map((hint) => hint.trim());

                // Add the clozes while ensuring that adding cloze in math mode double braces doesn't break the cloze
                // This is done by adding extra space the braces between two double brace
                for (const [i, reg] of replaceclozeArr.entries()) {
                    if (typeof reg === "string")
                        clozedContent = clozedContent.replaceAll(
                            reg.replaceAll(`\\"`, `"`).replaceAll(`\\'`, `'`).trim(),
                            (match) => {
                                return `{{c${cloze_id}::${escapeClozesAndMacroDelimiters(match)}${
                                    replaceclozeHintArr[i] ? `::${replaceclozeHintArr[i]}` : ""
                                }\u{2063}}}`; // Add extra space between braces inside math
                            }
                        );
                    else
                        clozedContent = clozedContent.replace(reg, (match) => {
                            return `{{c${cloze_id}::${escapeClozesAndMacroDelimiters(match)}${
                                replaceclozeHintArr[i] ? `::${replaceclozeHintArr[i]}` : ""
                            }\u{2063}}}`; // Add extra space between braces inside math
                        });
                    cloze_id++;
                }
            }
        }

        // --- Add logseq clozes ---
        clozedContent = safeReplace(clozedContent, /\{\{cloze (.*?)\}\}/g, (_match, group1) => {
            group1 = group1.replace(
                /(.*)(\\\\|::)(.*)/,
                (_match, g1, _g2, g3) => `${g1.trim()}::${g3.trim()}`
            ); // Add support for logseq cloze cue
            return `{{c${cloze_id++}::${group1}}}`;
        });

        // --- Add org block clozes ---
        clozedContent = safeReplace(
            clozedContent,
            /#\+BEGIN_(CLOZE)( .*)?\n((.|\n)*?)#\+END_\1/gi,
            (_match, _g1, _g2, g3) => `{{c${cloze_id++}::${g3.trim()}}}`
        );

        // --- Add back the removed logseq properties ---
        clozedContent = removedLogseqProperties + clozedContent;

        const result = await LogseqToHtmlConverterProxy.convertToHTMLFile(
            clozedContent,
            this.format
        );
        const resultWithChildren = await this.appendChildrenToHtmlFile(result);

        // --- Add extra property content (non-indented) ---
        return appendExtraToHtmlFile(
            resultWithChildren,
            _.get(await LogseqProxy.Editor.getBlock(this.uuid), "properties.extra") as string,
            this.format,
            true
        );
    }

    public static async getNotesFromLogseqBlocks(
        candidateRootUuids?: ReadonlySet<string>
    ): Promise<ClozeNote[]> {
        type DatascriptQueryResult = [] | [{uuid: BlockUUID; page: {id: number}}][];
        const candidateFilter = createBlockUuidFilterClause(candidateRootUuids);
        // Get blocks with Anki or Logseq cloze macro syntax
        const clozePattern = LOGSEQ_CLOZE_NOTE_BLOCK_REGEXP.source.replace(/\\/g, "\\\\");
        const macroCloze_blocks: DatascriptQueryResult = await LogseqProxy.DB.datascriptQuery(
            `
        [:find (pull ?b [:block/uuid :block/page])                                                                                                                    
         :where                                                                                                                                                       
         ${candidateFilter}
         [(re-pattern "${clozePattern}") ?regex]                                                                                                                      
         (or                                                                                                                                                          
           (and [?b :block/content ?content]                                                                                                                          
                [(re-find ?regex ?content)])                                                                                                                          
           (and [?b :block/title ?content]                                                                                                                            
                [(re-find ?regex ?content)]))]`,
            {suppressErrors: false}
        );
        // Get blocks with or replacecloze property and org mode cloze
        let replaceCloze_blocks: DatascriptQueryResult = [];
        let orgCloze_blocks: DatascriptQueryResult = [];
        if (!(await LogseqProxy.App.checkCurrentIsDbGraph())) {
            replaceCloze_blocks = await LogseqProxy.DB.datascriptQuery(
                `
                [:find (pull ?b [:block/uuid :block/page])
                :where
                  ${candidateFilter}
                  [?b :block/properties ?p]
                  [(get ?p :replacecloze)]
                ]`,
                {suppressErrors: false}
            );
            orgCloze_blocks = await LogseqProxy.DB.datascriptQuery(
                `
            [:find (pull ?b [:block/uuid :block/page])                                                                                                                
             :where                                                                                                                                                   
             ${candidateFilter}
             [(re-pattern "#\\\\+BEGIN_(CLOZE)( .*)?\\\\n((.|\\\\n)*?)#\\\\+END_\\\\1") ?regex]                                                                       
             (or                                                                                                                                                      
               (and [?b :block/content ?content]                                                                                                                      
                    [(re-find ?regex ?content)])                                                                                                                      
               (and [?b :block/title ?content]                                                                                                                        
                    [(re-find ?regex ?content)]))]`,
                {suppressErrors: false}
            );
        }

        const blocks = [
            ...(macroCloze_blocks || []),
            ...(replaceCloze_blocks || []),
            ...(orgCloze_blocks || [])
        ].filter((block) => {
            const uuid = getUUIDFromBlock(block[0]).toLowerCase();
            return candidateRootUuids == null || candidateRootUuids.has(uuid);
        });
        let notes = await Promise.all(
            blocks.map(async (b) => {
                const uuid = getUUIDFromBlock(b[0]);
                const pageId = b[0].page?.id;
                if (!pageId) return null;

                const block = await LogseqProxy.Editor.getBlock(uuid, {
                    includeChildren: true
                });
                if (block)
                    return new ClozeNote(
                        uuid,
                        block.content,
                        block.format,
                        block.properties || {},
                        pageId,
                        (block.properties?.tags ?? []) as string[],
                        block.children
                    );
                else {
                    return null;
                }
            })
        );
        notes = (await Note.removeUnwantedNotes(notes)) as ClozeNote[];
        return notes;
    }

    public getBlockDependencies(): DependencyEntity[] {
        function getChildrenUUID(children: any[]): BlockUUID[] {
            if (!Array.isArray(children)) return [];

            let result: BlockUUID[] = [];
            for (const child of children) {
                const uuid = getUUIDFromBlock(child);
                if (uuid) result.push(uuid as BlockUUID);
                result = result.concat(getChildrenUUID(child.children));
            }

            return result;
        }

        return [this.uuid, ...getChildrenUUID(this.children)].map(
            (block) => ({type: "Block", value: block}) as DependencyEntity
        );
    }
}
