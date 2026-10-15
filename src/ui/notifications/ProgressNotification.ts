import GRAPH_ICON from "../../../node_modules/@tabler/icons/icons/outline/hierarchy.svg?raw";
import {ANKI_ICON} from "../../constants";
import {LogseqProxy} from "../../logseq/LogseqProxy";
import {WindowParentBridge} from "../../logseq/WindowParentBridge";
import {
    NOTIFICATION_CARD_STYLE,
    NOTIFICATION_MOUNT_PATH,
    NOTIFICATION_OVERLAY_STYLE
} from "./NotificationOverlay";

export class ProgressNotification {
    max: number;
    current: number;
    progressBar: HTMLElement;
    silent: boolean;

    constructor(
        msg: string,
        max: number,
        icon: "anki" | "graph" = "graph",
        options: {silent?: boolean} = {}
    ) {
        this.max = max;
        this.current = 0;
        this.silent = options.silent ?? false;
        if (this.silent) return;

        logseq.provideUI({
            key: `logseq-anki-sync-progress-notification-${logseq.baseInfo.id}`,
            path: NOTIFICATION_MOUNT_PATH,
            template: `
                <div
                    class="logseq-anki-notification-overlay"
                    role="status"
                    aria-live="polite"
                    style="${NOTIFICATION_OVERLAY_STYLE}"
                >
                    <div class="logseq-anki-notification-card" style="${NOTIFICATION_CARD_STYLE}">
                        <div style="display: flex; align-items: flex-start; gap: 0.75rem;">
                            <div class="logseq-anki-progress-notification-icon" style="flex: 0 0 auto;">
                                ${icon === "anki" ? ANKI_ICON : GRAPH_ICON}
                            </div>
                            <div style="min-width: 0; flex: 1 1 auto;">
                                <div style="margin: 0; font-size: 0.875rem; font-weight: 500; line-height: 1.25rem;">
                                    <span id="logseq-anki-sync-progress-bar-msg">${msg}</span>
                                    <progress
                                        id="logseq-anki-sync-progress-bar-${logseq.baseInfo.id}"
                                        max="${this.max}"
                                    ></progress>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            `
        });
        logseq.provideStyle(`
        .logseq-anki-progress-notification-icon svg {
          width: 20px;
          height: 20px;
        }
        #logseq-anki-sync-progress-bar-${logseq.baseInfo.id} {
          display: block;
          width: 100%;
          height: 0.5rem;
          margin-top: 0.5rem;
          accent-color: var(--ls-link-text-color, #5b8def);
        }
        #logseq-anki-sync-progress-bar-${logseq.baseInfo.id}::-webkit-progress-bar {
          border-radius: 7px;
          background-color: var(--ls-secondary-background-color, rgb(127 127 127 / 0.2));
        }
        #logseq-anki-sync-progress-bar-${logseq.baseInfo.id}::-webkit-progress-value {
          border-radius: 7px;
          background-color: var(--ls-link-text-color, #5b8def);
        }
        `);
        LogseqProxy.App.registerPluginUnloadListener(() => {
            logseq.provideUI({
                key: `logseq-anki-sync-progress-notification-${logseq.baseInfo.id}`,
                template: ``
            });
        });
    }

    increment(amount = 1) {
        this.current += amount;
        if (this.silent) return;

        try {
            if (this.progressBar == null) {
                this.progressBar = WindowParentBridge.getElementById(
                    `logseq-anki-sync-progress-bar-${logseq.baseInfo.id}`
                );
            }
            this.progressBar.setAttribute("value", `${this.current}`);
        } catch (_e) {}
        if (this.current >= this.max)
            logseq.provideUI({
                key: `logseq-anki-sync-progress-notification-${logseq.baseInfo.id}`,
                template: ``
            }); // Remove notification
    }

    setIndeterminate() {
        if (this.silent) return;

        try {
            if (this.progressBar == null) {
                this.progressBar = WindowParentBridge.getElementById(
                    `logseq-anki-sync-progress-bar-${logseq.baseInfo.id}`
                );
            }
            this.progressBar.removeAttribute("value");
        } catch (_e) {}
    }

    updateMessage(msg: string) {
        if (this.silent) return;

        try {
            const msgElement = WindowParentBridge.getElementById(
                `logseq-anki-sync-progress-bar-msg`
            );
            msgElement.innerText = msg;
        } catch (_e) {}
    }
}
