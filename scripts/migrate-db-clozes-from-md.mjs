#!/usr/bin/env node

import {readdir, readFile, stat, writeFile} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const OLD_CLOZE_REGEXP =
    /\{\{(?:c[1-9]\d*::|(?:c[1-9]|cloze[1-9]?)\s+)([\s\S]*?)\}\}/g;
const UUID_PROPERTY_REGEXP =
    /^\s*(?:id|uuid)::\s*([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\s*$/i;
const PROPERTY_LINE_REGEXP = /^\s*[\w.?/:-]+::.*$/;
const BLOCK_LINE_REGEXP = /^(\s*)([-*+])\s+(.*)$/;
const DEFAULT_API_SERVER = "http://127.0.0.1:12315";

function parseArgs(argv) {
    const options = {
        api: process.env.LOGSEQ_API_SERVER || DEFAULT_API_SERVER,
        dbWorker: process.env.LOGSEQ_DB_WORKER || "",
        token: process.env.LOGSEQ_API_TOKEN || "",
        apply: false,
        confirmBackup: false,
        forceMismatches: false,
        report: "logseq-db-cloze-migration-report.json",
        limit: Number.POSITIVE_INFINITY,
        timeoutMs: 5000
    };

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--old-graph") options.oldGraph = argv[++i];
        else if (arg === "--api") options.api = argv[++i];
        else if (arg === "--db-worker") options.dbWorker = argv[++i];
        else if (arg === "--token") options.token = argv[++i];
        else if (arg === "--report") options.report = argv[++i];
        else if (arg === "--limit") options.limit = Number(argv[++i]);
        else if (arg === "--timeout-ms") options.timeoutMs = Number(argv[++i]);
        else if (arg === "--apply") options.apply = true;
        else if (arg === "--confirm-backup") options.confirmBackup = true;
        else if (arg === "--force-mismatches") options.forceMismatches = true;
        else if (arg === "--help" || arg === "-h") {
            printHelp();
            process.exit(0);
        } else {
            throw new Error(`Unknown argument: ${arg}`);
        }
    }

    if (!options.oldGraph) {
        throw new Error("Missing --old-graph /path/to/old/file-graph");
    }
    if (options.apply && !options.confirmBackup) {
        throw new Error("Refusing --apply without --confirm-backup");
    }
    if (!Number.isFinite(options.limit) && options.limit !== Number.POSITIVE_INFINITY) {
        throw new Error("--limit must be a number");
    }

    return options;
}

function printHelp() {
    console.log(`Restore stripped cloze markers in a Logseq DB graph from an old markdown graph.

Dry run:
  node scripts/migrate-db-clozes-from-md.mjs --old-graph /path/to/old-graph

Apply safe matches after backing up:
  node scripts/migrate-db-clozes-from-md.mjs --old-graph /path/to/old-graph --apply --confirm-backup

Options:
  --api URL              Logseq HTTP API server. Default: ${DEFAULT_API_SERVER}
  --db-worker URL        Logseq DB worker URL. Auto-detected from ~/logseq/server-list when possible.
  --token TOKEN          Logseq HTTP API token. Can also use LOGSEQ_API_TOKEN.
  --report PATH          JSON report path. Default: logseq-db-cloze-migration-report.json
  --limit N              Process at most N old cloze blocks.
  --timeout-ms N         Per-request Logseq API timeout. Default: 5000.
  --force-mismatches     With --apply, also update content-mismatch rows.
`);
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    const oldGraphRoot = path.resolve(options.oldGraph);
    const clozeBlocks = await collectOldClozeBlocks(oldGraphRoot);
    const limitedBlocks = clozeBlocks.slice(0, options.limit);

    console.log(`Found ${clozeBlocks.length} old markdown blocks with cloze syntax.`);
    if (limitedBlocks.length !== clozeBlocks.length) {
        console.log(`Processing first ${limitedBlocks.length} because --limit was set.`);
    }

    await assertLogseqReachable(options);
    const currentBlocksByUuid = await fetchCurrentBlocksByUuid(options);
    const dbWorker = options.apply ? await resolveDbWorker(options) : null;

    const report = [];
    let updated = 0;
    for (const [index, oldBlock] of limitedBlocks.entries()) {
        let row;
        try {
            const currentBlock = currentBlocksByUuid.get(oldBlock.uuid) || null;
            row = buildReportRow(oldBlock, currentBlock);
        } catch (error) {
            row = {
                uuid: oldBlock.uuid,
                file: oldBlock.file,
                status: "api-error",
                error: error instanceof Error ? error.message : String(error),
                proposedContent: oldBlock.proposedContent,
                applied: false
            };
        }

        if (options.apply && shouldApply(row, options)) {
            try {
                await updateCurrentBlock(options, dbWorker, oldBlock.uuid, oldBlock.proposedContent);
                row.applied = true;
                updated++;
            } catch (error) {
                row.status = "apply-error";
                row.error = error instanceof Error ? error.message : String(error);
            }
        }

        report.push(row);
    }

    await writeFile(path.resolve(options.report), `${JSON.stringify(report, null, 2)}\n`);
    printSummary(report, updated, options);
}

async function updateCurrentBlock(options, dbWorker, blockUuid, content) {
    if (dbWorker) {
        await saveBlockViaDbWorker(options, dbWorker, blockUuid, content);
        return;
    }

    await callLogseq(options, "logseq.Editor.updateBlock", [blockUuid, content]);
}

async function resolveDbWorker(options) {
    const candidates = [];
    if (options.dbWorker) candidates.push(options.dbWorker);
    candidates.push(...(await readDbWorkerUrlsFromServerList()));

    for (const candidate of candidates) {
        const url = normalizeUrl(candidate);
        try {
            const health = await fetchJson(`${url}/healthz`, options.timeoutMs);
            if (health?.status === "ready" && health?.repo) {
                console.log(`Using Logseq DB worker ${url} for block updates.`);
                return {url, repo: health.repo};
            }
        } catch {
            // Try the next candidate.
        }
    }

    console.log("No Logseq DB worker detected; falling back to logseq.Editor.updateBlock.");
    return null;
}

async function readDbWorkerUrlsFromServerList() {
    const serverListPath = path.join(os.homedir(), "logseq", "server-list");
    let content;
    try {
        content = await readFile(serverListPath, "utf8");
    } catch {
        return [];
    }

    return content
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
            const [, port] = line.split(/\s+/);
            return port ? `http://127.0.0.1:${port}` : "";
        })
        .filter(Boolean);
}

function normalizeUrl(url) {
    return url.replace(/\/$/, "");
}

async function fetchJson(url, timeoutMs) {
    const response = await fetch(url, {signal: AbortSignal.timeout(timeoutMs)});
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
    return data;
}

async function saveBlockViaDbWorker(options, dbWorker, blockUuid, content) {
    const response = await fetch(`${dbWorker.url}/v1/invoke`, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
            method: "thread-api/apply-outliner-ops",
            argsTransit: buildSaveBlockArgsTransit(dbWorker.repo, blockUuid, content)
        }),
        signal: AbortSignal.timeout(options.timeoutMs)
    });

    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    if (!response.ok || data?.ok === false) {
        throw new Error(data?.error?.message || data?.error || `HTTP ${response.status} ${response.statusText}`);
    }
}

function buildSaveBlockArgsTransit(repo, blockUuid, content) {
    return JSON.stringify([
        repo,
        [
            [
                transitKeyword("save-block"),
                [
                    transitMap({
                        "block/uuid": transitUuid(blockUuid),
                        "block/title": content
                    }),
                    transitMap()
                ]
            ]
        ],
        transitMap()
    ]);
}

function transitKeyword(value) {
    return `~:${value.replace(/^:/, "")}`;
}

function transitUuid(value) {
    return `~u${value}`;
}

function transitMap(entries = {}) {
    const result = ["^ "];
    for (const [key, value] of Object.entries(entries)) {
        result.push(transitKeyword(key), value);
    }
    return result;
}

async function fetchCurrentBlocksByUuid(options) {
    const query = `[:find (pull ?b [:block/uuid :block/title :block/content])
        :where
        [?b :block/uuid]]`;
    const rows = await callLogseq(options, "logseq.DB.datascriptQuery", [query]);
    const blocksByUuid = new Map();

    for (const [block] of rows || []) {
        if (!block?.uuid) continue;
        blocksByUuid.set(String(block.uuid).toLowerCase(), {
            ...block,
            content: block.content ?? block.title ?? ""
        });
    }

    console.log(`Loaded ${blocksByUuid.size} current DB blocks from Logseq.`);
    return blocksByUuid;
}

async function assertLogseqReachable(options) {
    try {
        await callLogseq(options, "logseq.App.getCurrentGraph", []);
    } catch (error) {
        throw new Error(
            `Could not reach Logseq API at ${options.api}. Enable Logseq HTTP API, check the port/token, then rerun. ${error.message}`
        );
    }
}

async function callLogseq(options, method, args) {
    const response = await fetch(`${options.api.replace(/\/$/, "")}/api`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${options.token}`
        },
        body: JSON.stringify({method, args}),
        signal: AbortSignal.timeout(options.timeoutMs)
    });

    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    if (!response.ok || data?.error) {
        throw new Error(data?.error || `HTTP ${response.status} ${response.statusText}`);
    }
    return data;
}

async function collectOldClozeBlocks(oldGraphRoot) {
    const files = await listMarkdownFiles(oldGraphRoot);
    const blocksByUuid = new Map();

    for (const file of files) {
        const blocks = parseLogseqMarkdownBlocks(await readFile(file, "utf8"));
        for (const block of blocks) {
            const uuid = extractUuid(block.rawContent);
            if (!uuid) continue;

            const proposedContent = normalizeOldMarkdownContent(
                stripPropertyLines(block.rawContent)
            ).trim();
            if (!OLD_CLOZE_REGEXP.test(proposedContent)) continue;
            OLD_CLOZE_REGEXP.lastIndex = 0;

            blocksByUuid.set(uuid.toLowerCase(), {
                uuid: uuid.toLowerCase(),
                file,
                proposedContent,
                visibleContent: stripClozeMarkers(proposedContent),
                deletedClozeContent: deleteClozeSegments(proposedContent)
            });
        }
    }

    return Array.from(blocksByUuid.values()).sort((a, b) => a.uuid.localeCompare(b.uuid));
}

async function listMarkdownFiles(oldGraphRoot) {
    const candidates = await getContentDirectories(oldGraphRoot);
    const files = [];

    for (const candidate of candidates) {
        await collectFiles(candidate, files);
    }

    return files.filter((file) => /\.(md|markdown|org)$/i.test(file));
}

async function getContentDirectories(inputPath) {
    const inputStats = await stat(inputPath);
    if (!inputStats.isDirectory()) return [inputPath];

    const basename = path.basename(inputPath);
    if (basename === "pages" || basename === "journals") {
        const graphRoot = path.dirname(inputPath);
        return [
            inputPath,
            path.join(graphRoot, basename === "pages" ? "journals" : "pages")
        ];
    }

    const children = await readdir(inputPath, {withFileTypes: true});
    const hasPages = children.some((entry) => entry.isDirectory() && entry.name === "pages");
    const hasJournals = children.some((entry) => entry.isDirectory() && entry.name === "journals");
    if (hasPages || hasJournals) {
        return ["pages", "journals"].map((dir) => path.join(inputPath, dir));
    }

    return [inputPath];
}

async function collectFiles(dir, files) {
    let entries;
    try {
        entries = await readdir(dir, {withFileTypes: true});
    } catch {
        return;
    }

    for (const entry of entries) {
        const child = path.join(dir, entry.name);
        if (entry.isDirectory()) await collectFiles(child, files);
        else if (entry.isFile()) files.push(child);
    }
}

function parseLogseqMarkdownBlocks(content) {
    const blocks = [];
    const stack = [];

    for (const line of content.split(/\r?\n/)) {
        const blockMatch = BLOCK_LINE_REGEXP.exec(line);
        if (blockMatch) {
            const indent = measureIndent(blockMatch[1]);
            while (stack.length > 0 && stack[stack.length - 1].indent >= indent) stack.pop();

            const block = {indent, contentLines: [blockMatch[3]]};
            blocks.push(block);
            stack.push(block);
            continue;
        }

        if (stack.length > 0) {
            stack[stack.length - 1].contentLines.push(line.replace(/^\s{2,}/, ""));
        }
    }

    return blocks.map((block) => ({rawContent: block.contentLines.join("\n").trim()}));
}

function measureIndent(indent) {
    return indent.replace(/\t/g, "    ").length;
}

function extractUuid(content) {
    for (const line of content.split("\n")) {
        const match = UUID_PROPERTY_REGEXP.exec(line);
        if (match) return match[1];
    }
    return null;
}

function stripPropertyLines(content) {
    return content
        .split("\n")
        .filter((line) => !PROPERTY_LINE_REGEXP.test(line))
        .join("\n")
        .trim();
}

function stripClozeMarkers(content) {
    OLD_CLOZE_REGEXP.lastIndex = 0;
    return content.replace(OLD_CLOZE_REGEXP, (_match, clozeContent) =>
        stripClozeHint(clozeContent)
    );
}

function stripClozeHint(clozeContent) {
    return clozeContent.replace(/(.*?)(\\\\|::).*$/s, "$1").trim();
}

function deleteClozeSegments(content) {
    OLD_CLOZE_REGEXP.lastIndex = 0;
    return content.replace(OLD_CLOZE_REGEXP, "");
}

function buildReportRow(oldBlock, currentBlock) {
    if (!currentBlock) {
        return {
            uuid: oldBlock.uuid,
            file: oldBlock.file,
            status: "not-found",
            proposedContent: oldBlock.proposedContent
        };
    }

    const currentContent = stripPropertyLines(currentBlock.content || "").trim();
    const currentHasCloze = OLD_CLOZE_REGEXP.test(currentContent);
    OLD_CLOZE_REGEXP.lastIndex = 0;

    const status = getRowStatus(oldBlock, currentContent, currentHasCloze);
    return {
        uuid: oldBlock.uuid,
        file: oldBlock.file,
        status,
        currentContent,
        importedVisibleContent: oldBlock.visibleContent,
        importedDeletedClozeContent: oldBlock.deletedClozeContent,
        proposedContent: oldBlock.proposedContent,
        applied: false
    };
}

function getRowStatus(oldBlock, currentContent, currentHasCloze) {
    if (currentHasCloze) return "already-has-cloze";
    if (normalizeContent(currentContent) === normalizeContent(oldBlock.visibleContent)) {
        return "would-update";
    }
    if (normalizeContent(currentContent) === normalizeContent(oldBlock.deletedClozeContent)) {
        return "would-restore-deleted-cloze-text";
    }
    return "content-mismatch";
}

function normalizeContent(content) {
    return content.trim().replace(/\s+/g, " ");
}

function shouldApply(row, options) {
    return (
        row.status === "would-update" ||
        row.status === "would-restore-deleted-cloze-text" ||
        (options.forceMismatches && row.status === "content-mismatch")
    );
}

function normalizeOldMarkdownContent(content) {
    return content
        .split("\n")
        .map((line) => line.replace(/^\s*>\s?/, ""))
        .join("\n");
}

function printSummary(report, updated, options) {
    const counts = report.reduce((acc, row) => {
        acc[row.status] = (acc[row.status] || 0) + 1;
        return acc;
    }, {});

    console.log("Migration summary:");
    for (const [status, count] of Object.entries(counts).sort()) {
        console.log(`  ${status}: ${count}`);
    }
    console.log(`  applied: ${updated}`);
    console.log(`Report written to ${path.resolve(options.report)}`);

    if (!options.apply) {
        console.log("Dry run only. Rerun with --apply --confirm-backup to update safe matches.");
    }
}

main().catch((error) => {
    console.error(error.message);
    process.exit(1);
});
