import type {BlockEntity, IDatom} from "@logseq/libs/dist/LSPlugin";

export interface LogseqDBChangeEvent {
    blocks: BlockEntity[];
    txData: IDatom[];
    txMeta?: {
        outlinerOp?: string;
        [key: string]: unknown;
    };
    /** Present in the Logseq 2.0.2 DB bridge, despite not being declared by SDK 0.3.3. */
    deletedBlockUuids?: string[] | Set<string>;
}

export type TargetedEventClassification = "targeted" | "unsupported" | "ambiguous";

export interface ChangedEntitySummary {
    uuid: string;
    id: number;
    pageId?: number;
    kind: "block" | "page";
}

export interface ClassifiedDBChange {
    classification: TargetedEventClassification;
    reason: string;
    blocks: BlockEntity[];
    deletedBlockUuids: string[];
    txAttributes: string[];
    outlinerOps: string[];
    changedEntities: ChangedEntitySummary[];
}

export interface TargetedChangeBatch extends ClassifiedDBChange {
    eventCount: number;
}

export interface TargetedSyncDiagnostics {
    schemaVersion: 1;
    classification: TargetedEventClassification;
    reason: string;
    changedEntities: ChangedEntitySummary[];
    deletedBlockUuids: string[];
    txAttributes: string[];
    outlinerOps: string[];
    eventCount: number;
    affectedCardCount: number;
    startedAt: string;
    completedAt: string;
    durationMs: number;
    fullSyncRequired: boolean;
}

export interface TargetedNoteRecord {
    identity: string;
    rootUuid: string;
    type: string;
    pageId: number;
    directBlockUuids: string[];
    ancestorBlockUuids: string[];
    pageEntityKeys: string[];
    tagEntityKeys: string[];
}

export interface TargetedEntitySnapshot {
    uuid: string;
    id: number;
    title: string;
    order: string;
    parentId: number | null;
    pageId: number | null;
    semanticProperties: Record<string, unknown>;
    tagIds: number[];
    kind: "block" | "page";
}

export interface TargetedResolution {
    classification: TargetedEventClassification;
    reason: string;
    affectedIdentities: Set<string>;
    candidateRootUuids: Set<string>;
    explicitlyDeletedRootUuids: Set<string>;
}
