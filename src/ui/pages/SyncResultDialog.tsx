import _ from "lodash";
import {ANKI_ICON} from "../../constants";
import {createLogger, LoggerCategory} from "../../logger";
import type {SyncResult} from "../../sync/types";
import {Modal, ModalHeader, useModal} from "../";
import React, {useState} from "../React";
import {UI} from "../UI";
import {CreateLineDisplay, UpdateLineDisplay} from "./SyncSelectionDialog";
import {formatSyncCompletedAt, formatSyncDuration, formatSyncMode} from "./syncResultFormatting";

const logger = createLogger(LoggerCategory.UI);

const showErrorDetailsButtonStyle = {
    background: "transparent",
    border: "none",
    color: "var(--ls-link-text-color)",
    cursor: "pointer",
    fontSize: "14px",
    marginLeft: "5px",
    padding: 0
};

export const SyncResultDialogComponent: React.FC<{
    syncResult: SyncResult;
    resolve: (value: any) => void;
    reject: (error: any) => void;
    modalContext?: {modalId: string | null};
}> = ({syncResult, resolve, modalContext}) => {
    const {
        toCreateNotes: createdNotes,
        toUpdateNotes: updatedNotes,
        toDeleteNotes: deletedNotes,
        failedCreated,
        failedUpdated,
        failedDeleted
    } = syncResult;

    const {open, setOpen} = useModal(resolve, {
        onClose: () => UI.hideModal(modalContext?.modalId),
        enableEscapeKey: true,
        defaultResult: null,
        modalId: modalContext?.modalId
    });

    const [graphName, setGraphName] = useState("");
    React.useEffect(() => {
        const getGraphName = async () => {
            const graphName = _.get(await logseq.App.getCurrentGraph(), "name") || "Default";
            setGraphName(graphName);
        };
        getGraphName().then();
    }, []);

    return (
        <Modal
            open={open}
            setOpen={setOpen}
            onClose={() => UI.hideModal(modalContext?.modalId)}
            hasCloseButton={false}>
            <div style={{margin: "0rem"}}>
                <ModalHeader
                    title="Sync Result Details"
                    icon={ANKI_ICON}
                    onClose={() => setOpen(false)}
                    showCloseButton={true}
                />
                <div
                    className="sm:flex sm:items-start"
                    style={{maxHeight: "60vh", overflowY: "auto", overflowX: "hidden"}}>
                    <div
                        className="mt-3 sm:mt-0 ml-4 mr-4 flex"
                        style={{width: "100%", flexDirection: "column"}}>
                        <div
                            className="p-4"
                            style={{
                                backgroundColor: "var(--ls-tertiary-background-color)",
                                borderRadius: "0.25rem",
                                marginTop: "0.5rem",
                                marginBottom: "0.5rem",
                                padding: "0.5rem",
                                userSelect: "none",
                                zIndex: 1
                            }}>
                            <div
                                style={{
                                    fontSize: "14px",
                                    fontWeight: 600,
                                    marginBottom: "0.35rem"
                                }}>
                                Summary
                            </div>
                            <div
                                style={{
                                    display: "grid",
                                    gridTemplateColumns: "max-content minmax(0, 1fr)",
                                    columnGap: "0.75rem",
                                    rowGap: "0.25rem",
                                    fontSize: "14px"
                                }}>
                                <span style={{color: "var(--ls-secondary-text-color)"}}>Mode</span>
                                <span>{formatSyncMode(syncResult.mode)}</span>
                                <span style={{color: "var(--ls-secondary-text-color)"}}>
                                    Time spent
                                </span>
                                <span>{formatSyncDuration(syncResult.durationMs)}</span>
                                <span style={{color: "var(--ls-secondary-text-color)"}}>
                                    Completed
                                </span>
                                <span>{formatSyncCompletedAt(syncResult.completedAt)}</span>
                            </div>
                        </div>
                        <div
                            className="p-4"
                            style={{
                                backgroundColor: "var(--ls-tertiary-background-color)",
                                borderRadius: "0.25rem",
                                cursor: "pointer",
                                marginTop: "0.5rem",
                                marginBottom: "0.5rem",
                                padding: "0.25rem 0.5rem",
                                userSelect: "none",
                                zIndex: 1
                            }}>
                            Created
                        </div>
                        {createdNotes.length <= 0 && (
                            <span style={{fontSize: "14px"}}>No notes were created.</span>
                        )}
                        {createdNotes.map((note) =>
                            failedCreated[note.uuid + "-" + note.type] ? null : (
                                <span
                                    className="inline-flex items-center"
                                    key={note.uuid + note.type}>
                                    <span
                                        style={{
                                            fontSize: "14px",
                                            color: "var(--amplify-colors-font-success)",
                                            userSelect: "none"
                                        }}
                                        title={"Synced Successfully"}>
                                        ✓
                                    </span>
                                    <UpdateLineDisplay note={note} graphName={graphName} />{" "}
                                    {/* Use update line display for created notes */}
                                </span>
                            )
                        )}
                        {Object.keys(failedCreated).map((noteUuidTypeStr) => {
                            const uuid = noteUuidTypeStr.substring(
                                0,
                                noteUuidTypeStr.lastIndexOf("-")
                            );
                            const type = noteUuidTypeStr.substring(
                                noteUuidTypeStr.lastIndexOf("-") + 1
                            );
                            return (
                                <span className="inline-flex items-center" key={uuid + type}>
                                    <span
                                        style={{
                                            fontSize: "14px",
                                            color: "var(--amplify-colors-font-error)",
                                            userSelect: "none"
                                        }}
                                        title={"Sync Failed"}>
                                        ⚠
                                    </span>
                                    <CreateLineDisplay note={{uuid, type}} graphName={graphName} />
                                    <button
                                        type="button"
                                        style={showErrorDetailsButtonStyle}
                                        onClick={() => {
                                            const error = failedCreated[noteUuidTypeStr];
                                            logger.info(
                                                `Error object for ${noteUuidTypeStr}:`,
                                                error
                                            );
                                            const errorMessage = `Error: ${error?.message}\n\nStack trace:\n${error?.stack}`;
                                            logseq.UI.showMsg(errorMessage, "warning", {
                                                timeout: 0
                                            });
                                        }}>
                                        (show error details)
                                    </button>
                                </span>
                            );
                        })}
                        <div
                            className="p-4"
                            style={{
                                backgroundColor: "var(--ls-tertiary-background-color)",
                                borderRadius: "0.25rem",
                                cursor: "pointer",
                                marginTop: "0.5rem",
                                marginBottom: "0.5rem",
                                padding: "0.25rem 0.5rem",
                                userSelect: "none",
                                zIndex: 1
                            }}>
                            Deleted
                        </div>
                        <span style={{fontSize: "14px"}}>
                            {deletedNotes.length > 0
                                ? `The ${deletedNotes.length} notes were deleted successfully`
                                : `No notes were deleted.`}
                            {Object.keys(failedDeleted).length > 0 ? (
                                <span>
                                    The ${Object.keys(failedDeleted).length} notes failed to delete
                                    <button
                                        type="button"
                                        style={showErrorDetailsButtonStyle}
                                        onClick={() => {
                                            logger.info(
                                                `Error object for all failed deletes:`,
                                                failedDeleted
                                            );
                                            const errorMessage = `${JSON.stringify(failedDeleted)}`;
                                            logseq.UI.showMsg(errorMessage, "warning", {
                                                timeout: 0
                                            });
                                        }}>
                                        (show error details)
                                    </button>
                                </span>
                            ) : (
                                ``
                            )}
                        </span>
                        <div
                            className="p-4"
                            style={{
                                backgroundColor: "var(--ls-tertiary-background-color)",
                                borderRadius: "0.25rem",
                                cursor: "pointer",
                                marginTop: "0.5rem",
                                marginBottom: "0.5rem",
                                padding: "0.25rem 0.5rem",
                                userSelect: "none",
                                zIndex: 1
                            }}>
                            Updated
                        </div>
                        {updatedNotes.length <= 0 && (
                            <span style={{fontSize: "14px"}}>No notes were updated.</span>
                        )}
                        {updatedNotes.map((note) =>
                            failedUpdated[note.uuid + "-" + note.type] ? null : (
                                <span
                                    className="inline-flex items-center"
                                    key={note.uuid + note.type}>
                                    <span
                                        style={{
                                            fontSize: "14px",
                                            color: "var(--amplify-colors-font-success)",
                                            userSelect: "none"
                                        }}
                                        title={"Synced Successfully"}>
                                        ✓
                                    </span>
                                    <UpdateLineDisplay note={note} graphName={graphName} />
                                </span>
                            )
                        )}
                        {Object.keys(failedUpdated).map((noteUuidTypeStr) => {
                            const uuid = noteUuidTypeStr.substring(
                                0,
                                noteUuidTypeStr.lastIndexOf("-")
                            );
                            const type = noteUuidTypeStr.substring(
                                noteUuidTypeStr.lastIndexOf("-") + 1
                            );
                            return (
                                <span className="inline-flex items-center" key={uuid + type}>
                                    <span
                                        style={{
                                            fontSize: "14px",
                                            color: "var(--amplify-colors-font-error)",
                                            userSelect: "none"
                                        }}
                                        title={"Sync Failed"}>
                                        ⚠
                                    </span>
                                    <UpdateLineDisplay note={{uuid, type}} graphName={graphName} />
                                    <button
                                        type="button"
                                        style={showErrorDetailsButtonStyle}
                                        onClick={() => {
                                            const error = failedUpdated[noteUuidTypeStr];
                                            logger.info(
                                                `Error object for ${noteUuidTypeStr}:`,
                                                error
                                            );
                                            const errorMessage = `Error: ${error?.message}\n\nStack trace:\n${error?.stack}`;
                                            logseq.UI.showMsg(errorMessage, "warning", {
                                                timeout: 0
                                            });
                                        }}>
                                        (show error details)
                                    </button>
                                </span>
                            );
                        })}
                    </div>
                </div>
            </div>
        </Modal>
    );
};
