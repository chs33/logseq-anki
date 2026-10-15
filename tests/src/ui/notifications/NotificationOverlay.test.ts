import {afterEach, beforeEach, describe, expect, test, vi} from "vitest";
import {LogseqProxy} from "../../../../src/logseq/LogseqProxy";
import {WindowParentBridge} from "../../../../src/logseq/WindowParentBridge";
import {ActionNotification} from "../../../../src/ui/notifications/ActionNotification";
import {ProgressNotification} from "../../../../src/ui/notifications/ProgressNotification";

describe("plugin notification overlays", () => {
    const provideUI = vi.fn();
    const provideStyle = vi.fn();
    const provideModel = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal("logseq", {
            baseInfo: {id: "test-plugin"},
            provideUI,
            provideStyle,
            provideModel,
            UI: {showMsg: vi.fn()}
        });
        vi.spyOn(LogseqProxy.App, "registerPluginUnloadListener").mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    test("mounts progress UI on the stable document body", () => {
        new ProgressNotification("Scanning graph", 5);

        expect(provideUI).toHaveBeenCalledWith(
            expect.objectContaining({
                key: "logseq-anki-sync-progress-notification-test-plugin",
                path: "body",
                template: expect.stringContaining("logseq-anki-notification-overlay")
            })
        );
        expect(provideUI.mock.calls[0][0].template).toContain("position: fixed");
        expect(provideUI.mock.calls[0][0].template).toContain("background-color: Canvas");
        expect(provideUI.mock.calls[0][0].template).toContain("background-image: linear-gradient");
        expect(provideUI.mock.calls[0][0].template).not.toContain("ui__notifications-content");
    });

    test("updates and removes the progress overlay when complete", () => {
        const progressBar = {
            removeAttribute: vi.fn(),
            setAttribute: vi.fn()
        } as unknown as HTMLElement;
        vi.spyOn(WindowParentBridge, "getElementById").mockReturnValue(progressBar);
        const notification = new ProgressNotification("Syncing", 1, "anki");
        provideUI.mockClear();

        notification.increment();

        expect(progressBar.setAttribute).toHaveBeenCalledWith("value", "1");
        expect(provideUI).toHaveBeenCalledWith({
            key: "logseq-anki-sync-progress-notification-test-plugin",
            template: ""
        });
    });

    test("shows ongoing work without implying a frozen percentage", () => {
        const progressBar = {
            removeAttribute: vi.fn(),
            setAttribute: vi.fn()
        } as unknown as HTMLElement;
        vi.spyOn(WindowParentBridge, "getElementById").mockReturnValue(progressBar);
        const notification = new ProgressNotification("Scanning", 6);

        expect(provideUI.mock.calls[0][0].template).not.toContain('value="0"');

        notification.increment();
        notification.setIndeterminate();

        expect(progressBar.setAttribute).toHaveBeenCalledWith("value", "1");
        expect(progressBar.removeAttribute).toHaveBeenCalledWith("value");
    });

    test("mounts action notifications on the same stable host", async () => {
        let handlers: Record<string, () => void> = {};
        provideModel.mockImplementation((model) => {
            handlers = model;
        });

        const result = ActionNotification([{name: "Continue", func: vi.fn()}], "Ready");

        expect(provideUI).toHaveBeenCalledWith(
            expect.objectContaining({
                path: "body",
                template: expect.stringContaining("logseq-anki-notification-overlay")
            })
        );
        handlers.handleClose();
        await expect(result).resolves.toBeNull();
    });
});
