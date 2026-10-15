import {describe, expect, test} from "vitest";
import {
    applyPopupSurfaceTheme,
    createOpaqueSurfaceStyle,
    normalizeResolvedThemeCssValue,
    POPUP_SURFACE_BACKGROUND_VARIABLE
} from "../../../../src/ui/styles/opaqueSurface";
import {getLogseqThemeFallbacks} from "../../../../src/ui/styles/themeFallbacks";

describe("opaque popup surfaces", () => {
    test("layers theme colors over an opaque canvas background", () => {
        expect(
            createOpaqueSurfaceStyle(
                "--ls-popover-background-color",
                "--ls-primary-background-color"
            )
        ).toEqual({
            backgroundColor: "Canvas",
            backgroundImage:
                "linear-gradient(var(--logseq-anki-popup-background-color, var(--ls-popover-background-color, var(--ls-primary-background-color, transparent))), var(--logseq-anki-popup-background-color, var(--ls-popover-background-color, var(--ls-primary-background-color, transparent))))"
        });
    });

    test("uses black popup surfaces only in dark mode", () => {
        const style = document.createElement("div").style;

        applyPopupSurfaceTheme(style, "dark");
        expect(style.getPropertyValue(POPUP_SURFACE_BACKGROUND_VARIABLE)).toBe("#000000");

        applyPopupSurfaceTheme(style, "light");
        expect(style.getPropertyValue(POPUP_SURFACE_BACKGROUND_VARIABLE)).toBe("");
    });

    test.each([
        undefined,
        null,
        "",
        "  ",
        "undefined",
        "NULL"
    ])("rejects unresolved theme value %s", (value) => {
        expect(normalizeResolvedThemeCssValue(value)).toBeNull();
    });

    test("preserves valid theme values", () => {
        expect(normalizeResolvedThemeCssValue("  rgb(20 30 40 / 0.8)  ")).toBe(
            "rgb(20 30 40 / 0.8)"
        );
    });

    test("uses Logseq's bundled light surfaces when resolved values are unavailable", () => {
        expect(getLogseqThemeFallbacks("light")).toMatchObject({
            "--ls-primary-background-color": "#ffffff",
            "--ls-secondary-background-color": "#f7f7f7",
            "--ls-popover-background-color": "#ffffff",
            "--ls-primary-text-color": "#433f38"
        });
    });

    test("uses Logseq's bundled dark surfaces when resolved values are unavailable", () => {
        expect(getLogseqThemeFallbacks("dark")).toMatchObject({
            "--ls-primary-background-color": "#002b36",
            "--ls-secondary-background-color": "#023643",
            "--ls-popover-background-color": "#002b36",
            "--ls-primary-text-color": "#a4b5b6"
        });
    });
});
