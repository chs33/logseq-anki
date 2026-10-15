import type {LogseqThemeMode} from "./themeFallbacks";

export type OpaqueSurfaceStyle = {
    backgroundColor: string;
    backgroundImage: string;
};

export const POPUP_SURFACE_BACKGROUND_VARIABLE = "--logseq-anki-popup-background-color";

const createThemeColorExpression = (themeVariables: readonly string[]): string => {
    const logseqThemeColor = themeVariables.reduceRight(
        (fallback, variableName) => `var(${variableName}, ${fallback})`,
        "transparent"
    );
    return `var(${POPUP_SURFACE_BACKGROUND_VARIABLE}, ${logseqThemeColor})`;
};

export function applyPopupSurfaceTheme(
    style: CSSStyleDeclaration,
    mode: LogseqThemeMode | null
): void {
    if (mode === "dark") {
        style.setProperty(POPUP_SURFACE_BACKGROUND_VARIABLE, "#000000");
        return;
    }

    style.removeProperty(POPUP_SURFACE_BACKGROUND_VARIABLE);
}

/**
 * Creates an opaque popup surface even when a Logseq theme intentionally uses
 * a transparent or partially transparent background color.
 */
export function createOpaqueSurfaceStyle(...themeVariables: string[]): OpaqueSurfaceStyle {
    const themeColor = createThemeColorExpression(themeVariables);
    return {
        backgroundColor: "Canvas",
        backgroundImage: `linear-gradient(${themeColor}, ${themeColor})`
    };
}

export function createOpaqueSurfaceCssDeclarations(...themeVariables: string[]): string[] {
    const style = createOpaqueSurfaceStyle(...themeVariables);
    return [
        `background-color: ${style.backgroundColor}`,
        `background-image: ${style.backgroundImage}`
    ];
}

/** Prevent unresolved Logseq theme values from shadowing CSS fallbacks. */
export function normalizeResolvedThemeCssValue(value: unknown): string | null {
    if (typeof value !== "string") return null;

    const normalizedValue = value.trim();
    if (
        normalizedValue.length === 0 ||
        normalizedValue.toLowerCase() === "undefined" ||
        normalizedValue.toLowerCase() === "null"
    ) {
        return null;
    }
    return normalizedValue;
}
