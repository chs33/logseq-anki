import path from "path-browserify";
import type {LazyAnkiNoteManager} from "../../anki-connect/LazyAnkiNoteManager";
import type {Note} from "../../anki-notes/Note";
import {createLogger, LoggerCategory} from "../../logger";
import {LogseqProxy} from "../../logseq/LogseqProxy";
import {WindowParentBridge} from "../../logseq/WindowParentBridge";
import type {ProgressNotification} from "../../ui";
import {NoteHashCalculator} from "../cache";
import {parseNote} from "../parsers/NoteParser";

const logger = createLogger(LoggerCategory.SyncInternal);

export interface UpdateNotesTaskOptions {
    skipUnchangedNotes?: boolean;
}

type UpdateNoteOutcome = "queued" | "skipped";

export class UpdateNotesTask {
    async execute(
        notes: Note[],
        modelName: string,
        graphName: string,
        graphPath: string,
        ankiNoteManager: LazyAnkiNoteManager,
        progressNotification: ProgressNotification,
        options: UpdateNotesTaskOptions = {}
    ): Promise<{succeeded: Note[]; skipped: Note[]; failed: {[key: string]: Error}}> {
        const failedUpdated: {[key: string]: Error} = {};
        const skipped: Note[] = [];

        for (const note of notes) {
            try {
                const outcome = await this.updateNote(
                    note,
                    modelName,
                    graphName,
                    graphPath,
                    ankiNoteManager,
                    options
                );
                if (outcome === "skipped") skipped.push(note);
            } catch (e) {
                logger.error(e);
                failedUpdated[`${note.uuid}-${note.type}`] = e;
            }
            progressNotification.increment();
        }

        const updateResult = await ankiNoteManager.executeUpdateNotes();
        for (const failure of updateResult.failedNotes) {
            logger.error(failure.error);
            failedUpdated[failure.identifier] = failure.error;
        }

        const successfulNoteIds = new Set(updateResult.successfulNotes);
        const succeeded = notes.filter(
            (n) =>
                successfulNoteIds.has(`${n.uuid}-${n.type}`) &&
                !failedUpdated[`${n.uuid}-${n.type}`]
        );
        return {succeeded, skipped, failed: failedUpdated};
    }

    private async updateNote(
        note: Note,
        modelName: string,
        graphName: string,
        graphPath: string,
        ankiNoteManager: LazyAnkiNoteManager,
        options: UpdateNotesTaskOptions
    ): Promise<UpdateNoteOutcome> {
        const ankiId = note.getAnkiId();
        const ankiNodeInfo = ankiNoteManager.noteInfoMap.get(ankiId);

        const oldConfig = this.parseConfig(ankiNodeInfo.fields.Config.value);
        const oldAssets = this.getConfigAssets(oldConfig);
        const [oldHtml, oldDeck, oldBreadcrumb, oldTags] = [
            ankiNodeInfo.fields.Text.value,
            ankiNodeInfo.deck,
            ankiNodeInfo.fields.Breadcrumb.value,
            ankiNodeInfo.tags
        ];

        const dependencyHash = await NoteHashCalculator.getHash(note, [
            oldHtml,
            new Set(oldAssets),
            oldDeck,
            oldBreadcrumb,
            oldTags
        ]);

        const shouldSkipUnchangedNotes =
            options.skipUnchangedNotes ??
            LogseqProxy.Settings.getPluginSettings().skipOnDependencyHashMatch === true;
        const isDependencyHashMatch = oldConfig.dependencyHash === dependencyHash;

        if (shouldSkipUnchangedNotes && isDependencyHashMatch) {
            await this.restoreMissingStoredAssets(oldAssets, ankiNoteManager);
            logger.info(`dependencyHash match for note with id ${note.uuid}-${note.type}`);
            return "skipped";
        }

        for (const asset of oldAssets) {
            const name = path.basename(asset);
            const url = await WindowParentBridge.makeAssetUrl(asset);
            ankiNoteManager.storeAsset(name, url);
        }

        const [html, assets, deck, breadcrumb, tags] = await parseNote(note, graphName);
        const updatedDependencyHash = await NoteHashCalculator.getHash(note, [
            html,
            assets,
            deck,
            breadcrumb,
            tags
        ]);

        assets.forEach((asset) => {
            // Normalize asset path by removing leading ../ or ./ since assets are relative to graph root
            const normalizedAsset = asset.replace(/^(\.\.\/)+(\.\/)*|^(\.\/)+/, "");
            ankiNoteManager.storeAsset(path.basename(asset), path.join(graphPath, normalizedAsset));
        });

        logger.info(`dependencyHash mismatch for note with id ${note.uuid}-${note.type}`);

        ankiNoteManager.updateNote(
            ankiId,
            deck,
            modelName,
            {
                "uuid-type": `${note.uuid}-${note.type}`,
                "Logseq Block UUID": note.uuid,
                "Logseq Page Id": note.pageId.toString(),
                Text: html,
                Breadcrumb: breadcrumb,
                Config: JSON.stringify({
                    dependencyHash: updatedDependencyHash,
                    assets: [...assets]
                })
            },
            tags
        );
        return "queued";
    }

    private parseConfig(configString: string): any {
        try {
            return JSON.parse(configString);
        } catch (_e) {
            return {};
        }
    }

    private getConfigAssets(config: any): string[] {
        if (Array.isArray(config.assets)) return config.assets;
        if (config.assets instanceof Set) return Array.from(config.assets);
        return [];
    }

    private async restoreMissingStoredAssets(
        assets: string[],
        ankiNoteManager: LazyAnkiNoteManager
    ): Promise<void> {
        for (const asset of assets) {
            const name = path.basename(asset);
            if (await ankiNoteManager.hasMedia(name)) continue;

            const url = await WindowParentBridge.makeAssetUrl(asset);
            ankiNoteManager.storeAsset(name, url);
        }
    }
}
