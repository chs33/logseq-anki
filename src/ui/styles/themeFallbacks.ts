export type LogseqThemeMode = "light" | "dark";

const LIGHT_THEME_FALLBACKS: Readonly<Record<string, string>> = {
    "--ls-primary-background-color": "#ffffff",
    "--ls-secondary-background-color": "#f7f7f7",
    "--ls-tertiary-background-color": "#eaeaea",
    "--ls-quaternary-background-color": "#dcdcdc",
    "--ls-border-color": "#cccccc",
    "--ls-secondary-border-color": "#e2e2e2",
    "--ls-tertiary-border-color": "rgb(199 199 199 / 0.3)",
    "--ls-primary-text-color": "#433f38",
    "--ls-secondary-text-color": "#161e2e",
    "--ls-block-highlight-color": "#c0e6fd",
    "--ls-menu-hover-color": "#dcdcdc",
    "--ls-button-background": "hsl(200 98% 35%)",
    "--ls-popover-background-color": "#ffffff",
    "--ls-popover-text-color": "#433f38"
};

const DARK_THEME_FALLBACKS: Readonly<Record<string, string>> = {
    "--ls-primary-background-color": "#002b36",
    "--ls-secondary-background-color": "#023643",
    "--ls-tertiary-background-color": "#08404f",
    "--ls-quaternary-background-color": "#094b5a",
    "--ls-border-color": "#0e5263",
    "--ls-secondary-border-color": "#126277",
    "--ls-tertiary-border-color": "rgb(0 2 0 / 0.1)",
    "--ls-primary-text-color": "#a4b5b6",
    "--ls-secondary-text-color": "#dfdfdf",
    "--ls-block-highlight-color": "#0a3d4b",
    "--ls-menu-hover-color": "#023643",
    "--ls-button-background": "hsl(200 98% 35%)",
    "--ls-popover-background-color": "#002b36",
    "--ls-popover-text-color": "#a4b5b6"
};

/**
 * Logseq 2 can temporarily omit resolved CSS variables while loading or switching themes.
 * These values mirror its bundled default Logseq light and dark themes, so the plugin UI
 * remains readable and opaque until the active theme values become available.
 */
export function getLogseqThemeFallbacks(mode: LogseqThemeMode): Record<string, string> {
    return {...(mode === "dark" ? DARK_THEME_FALLBACKS : LIGHT_THEME_FALLBACKS)};
}
