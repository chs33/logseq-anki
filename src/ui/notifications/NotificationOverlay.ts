import {createOpaqueSurfaceCssDeclarations} from "../styles/opaqueSurface";

/**
 * Logseq 2.0 replaced its legacy `div.notifications` element with a toast
 * portal. Custom plugin notifications therefore need their own stable mount
 * point instead of depending on Logseq's internal notification markup.
 */
export const NOTIFICATION_MOUNT_PATH = "body";

export const NOTIFICATION_OVERLAY_STYLE = [
    "position: fixed",
    "top: 1rem",
    "right: 1rem",
    "z-index: 10000",
    "width: min(24rem, calc(100vw - 2rem))",
    "pointer-events: none"
].join(";");

export const NOTIFICATION_CARD_STYLE = [
    "box-sizing: border-box",
    "width: 100%",
    "padding: 1rem",
    "border: 1px solid var(--ls-border-color, color-mix(in srgb, CanvasText 20%, transparent))",
    "border-radius: 0.5rem",
    ...createOpaqueSurfaceCssDeclarations(
        "--ls-popover-background-color",
        "--ls-primary-background-color"
    ),
    "color: var(--ls-primary-text-color, CanvasText)",
    "box-shadow: 0 10px 25px rgb(0 0 0 / 0.2)",
    "pointer-events: auto"
].join(";");
