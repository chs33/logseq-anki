import {afterEach, beforeEach, describe, expect, test, vi} from "vitest";

const logseqProxyMock = vi.hoisted(() => ({
    settings: {} as any
}));

vi.mock("../../../src/logseq/LogseqProxy", () => ({
    LogseqProxy: {
        Settings: {
            getPluginSettings: vi.fn(() => logseqProxyMock.settings)
        }
    }
}));

import * as AnkiConnect from "../../../src/anki-connect/AnkiConnect";

class MockXMLHttpRequest {
    static instances: MockXMLHttpRequest[] = [];

    responseText = JSON.stringify({result: 6, error: null});
    requestHeaders: Record<string, string> = {};
    private listeners: Record<string, Array<() => void>> = {};

    constructor() {
        MockXMLHttpRequest.instances.push(this);
    }

    addEventListener(eventName: string, listener: () => void): void {
        this.listeners[eventName] = [...(this.listeners[eventName] ?? []), listener];
    }

    open(): void {}

    setRequestHeader(name: string, value: string): void {
        this.requestHeaders[name] = value;
    }

    send(): void {
        for (const listener of this.listeners.load ?? []) {
            listener();
        }
    }
}

describe("AnkiConnect.invoke", () => {
    beforeEach(() => {
        MockXMLHttpRequest.instances = [];
        vi.stubGlobal("XMLHttpRequest", MockXMLHttpRequest);
        logseqProxyMock.settings = {};
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    test("does not set a JSON content type header that triggers CORS preflight", async () => {
        await AnkiConnect.invoke("version");

        expect(MockXMLHttpRequest.instances).toHaveLength(1);
        expect(MockXMLHttpRequest.instances[0].requestHeaders).not.toHaveProperty("Content-Type");
    });
});
