import BOOK_ICON from "@tabler/icons/outline/book.svg?raw";
import HEART_ICON from "@tabler/icons/outline/heart.svg?raw";
import LOGS_ICON from "@tabler/icons/outline/logs.svg?raw";
import PLAYER_PLAY_ICON from "@tabler/icons/outline/player-play.svg?raw";
import REFRESH_ICON from "@tabler/icons/outline/refresh.svg?raw";
import SETTINGS_ICON from "@tabler/icons/outline/settings.svg?raw";
import TOGGLE_LEFT_ICON from "@tabler/icons/outline/toggle-left.svg?raw";
import TOGGLE_RIGHT_ICON from "@tabler/icons/outline/toggle-right.svg?raw";
import FocusTrap from "focus-trap-react";
import {LogseqProxy} from "../../logseq/LogseqProxy";
import {WindowParentBridge} from "../../logseq/WindowParentBridge";
import {LogseqToAnkiSync} from "../../sync/syncLogseqToAnki";
import {showSyncResultDialog} from "../launchers/showSyncResultDialog";
import type {FC} from "../React";
// biome-ignore lint/correctness/noUnusedImports: required by the TypeScript JSX transform
import React, {useEffect, useState} from "../React";
import {UI} from "../UI";

const focusTrapOptions = {
    tabbableOptions: {
        displayCheck: "none" as const
    }
};

interface ToolbarMenuModalProps {
    triggerRect: DOMRect | null;
    parentWidth?: number;
    modalId: string;
}

const LogseqAnkiSyncToolbarMenuComponent: FC<ToolbarMenuModalProps> = ({
    triggerRect,
    parentWidth,
    modalId
}) => {
    const [isVisible, setIsVisible] = useState(false);
    const [selectedIndex, setSelectedIndex] = useState(-1);
    const [autoSyncEnabled, setAutoSyncEnabled] = useState(
        LogseqProxy.Settings.getPluginSettings().autoSyncEnabled === true
    );

    useEffect(() => {
        setIsVisible(true);
    }, []);

    const close = () => {
        setIsVisible(false);
        setTimeout(() => UI.hideModal(modalId), 150);
    };

    const lastSyncResult = WindowParentBridge.getGlobalObject("lastSyncLogseqToAnkiResult");
    const lastChangedSyncResult = WindowParentBridge.getGlobalObject(
        "lastChangedSyncLogseqToAnkiResult"
    );
    const hasLastSync = lastSyncResult != null;
    const hasLastChangedSync = lastChangedSyncResult != null;

    const rightPos = triggerRect ? (parentWidth || window.innerWidth) - triggerRect.right : 20;
    const topPos = triggerRect ? triggerRect.bottom + 8 : 40;

    const toggleAutoSync = () => {
        const nextAutoSyncEnabled = !autoSyncEnabled;
        setAutoSyncEnabled(nextAutoSyncEnabled);
        logseq.updateSettings({autoSyncEnabled: nextAutoSyncEnabled});
        logseq.UI.showMsg(`Auto sync ${nextAutoSyncEnabled ? "enabled" : "disabled"}.`, "success");
    };

    const items = [
        {
            key: "start-sync",
            icon: PLAYER_PLAY_ICON,
            text: "Start Sync",
            color: "text-green-500",
            onClick: async () => {
                await new LogseqToAnkiSync().sync();
            }
        },
        {
            key: "force-regenerate",
            icon: REFRESH_ICON,
            text: "Force Regenerate All",
            color: "text-orange-500",
            onClick: async () => {
                await new LogseqToAnkiSync().sync({forceRegenerate: true});
            }
        },
        {
            key: "auto-sync",
            icon: autoSyncEnabled ? TOGGLE_RIGHT_ICON : TOGGLE_LEFT_ICON,
            text: `Auto Sync: ${autoSyncEnabled ? "On" : "Off"}`,
            color: autoSyncEnabled ? "text-green-500" : "opacity-70",
            checked: autoSyncEnabled,
            keepOpen: true,
            onClick: toggleAutoSync
        },
        {
            key: "last-sync-details",
            icon: LOGS_ICON,
            text: "Last Sync Details",
            disabled: !hasLastSync,
            onClick: () => {
                if (lastSyncResult) showSyncResultDialog(lastSyncResult as any);
            }
        },
        {
            key: "last-changed-sync-details",
            icon: LOGS_ICON,
            text: "Last Changed Sync Details",
            disabled: !hasLastChangedSync,
            onClick: () => {
                if (lastChangedSyncResult) showSyncResultDialog(lastChangedSyncResult as any);
            }
        },
        {key: "separator-main", separator: true},
        {
            key: "documentation",
            icon: BOOK_ICON,
            text: "Documentation",
            onClick: () =>
                window.open("https://debanjandhar12.github.io/logseq-anki-sync/docs/intro")
        },
        {
            key: "settings",
            icon: SETTINGS_ICON,
            text: "Settings",
            onClick: () => logseq.showSettingsUI()
        },
        {
            key: "donate",
            icon: HEART_ICON,
            text: "Donate",
            onClick: () => window.open("https://github.com/sponsors/debanjandhar12")
        }
    ];

    const selectableItems = items.filter((i) => !i.separator && !i.disabled);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "ArrowDown") {
                e.preventDefault();
                setSelectedIndex((prev) => (prev >= selectableItems.length - 1 ? 0 : prev + 1));
            } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSelectedIndex((prev) => (prev <= 0 ? selectableItems.length - 1 : prev - 1));
            } else if (
                e.key === "Enter" &&
                selectedIndex >= 0 &&
                selectedIndex < selectableItems.length
            ) {
                e.preventDefault();
                const selectedItem = selectableItems[selectedIndex];
                if (!selectedItem.keepOpen) close();
                selectedItem.onClick?.();
            } else if (e.key === "Escape") {
                e.preventDefault();
                close();
            }
        };

        const doc = WindowParentBridge.getDocument();
        doc.addEventListener("keydown", handleKeyDown, true);
        window.addEventListener("keydown", handleKeyDown, true);
        return () => {
            doc.removeEventListener("keydown", handleKeyDown, true);
            window.removeEventListener("keydown", handleKeyDown, true);
        };
    }, [selectableItems, selectedIndex]);

    const MenuItem = ({item, isSelected}: any) => {
        if (item.separator) {
            return (
                <hr
                    className="-mx-1 my-1 h-px bg-muted"
                    style={{backgroundColor: "var(--ls-border-color, #eee)", border: 0}}
                />
            );
        }
        return (
            <button
                type="button"
                aria-pressed={item.checked}
                tabIndex={item.disabled ? -1 : 0}
                className={`ui__dropdown-menu-item relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors ${item.disabled ? "pointer-events-none opacity-50" : ""}`}
                style={{
                    backgroundColor: isSelected
                        ? "var(--ls-quaternary-background-color, #ddd)"
                        : "transparent",
                    border: 0,
                    color: "inherit",
                    width: "100%"
                }}
                onClick={(e) => {
                    e.stopPropagation();
                    if (item.disabled) return;
                    if (!item.keepOpen) close();
                    item.onClick();
                }}
                onMouseEnter={() => {
                    if (!item.disabled) setSelectedIndex(selectableItems.indexOf(item));
                }}
                onMouseLeave={() => {
                    if (!item.disabled) setSelectedIndex(-1);
                }}>
                <span className="flex items-center w-full">
                    <span
                        className={`ui__icon ti flex items-center ${item.color || ""}`}
                        // biome-ignore lint/security/noDangerouslySetInnerHtml: icons are bundled static SVG strings
                        dangerouslySetInnerHTML={{__html: item.icon}}
                        style={{width: 18, height: 18}}
                    />
                    <span className="pl-2">{item.text}</span>
                </span>
            </button>
        );
    };

    return (
        <FocusTrap focusTrapOptions={focusTrapOptions}>
            <div style={{position: "fixed", inset: 0, zIndex: 9999}}>
                {/* Backdrop */}
                <button
                    type="button"
                    aria-label="Close toolbar menu"
                    tabIndex={-1}
                    style={{
                        position: "absolute",
                        inset: 0,
                        background: "transparent",
                        border: 0,
                        padding: 0
                    }}
                    onClick={(e) => {
                        e.stopPropagation();
                        close();
                    }}
                />

                {/* Menu */}
                <div
                    className={`ui__dropdown-menu-content z-50 min-w-[12rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md transition-all duration-150 ${isVisible ? "opacity-100 scale-100" : "opacity-0 scale-95"}`}
                    style={{
                        position: "absolute",
                        right: rightPos,
                        top: topPos,
                        backgroundColor: "var(--ls-primary-background-color, #fff)",
                        borderColor: "var(--ls-border-color, #eee)",
                        color: "var(--ls-primary-text-color, #000)",
                        transformOrigin: "top right"
                    }}>
                    {items.map((item) => (
                        <MenuItem
                            key={item.key}
                            item={item}
                            isSelected={
                                !item.separator &&
                                !item.disabled &&
                                selectableItems.indexOf(item) === selectedIndex
                            }
                        />
                    ))}
                </div>
            </div>
        </FocusTrap>
    );
};

export function showToolbarMenu(triggerRect: DOMRect | null, parentWidth?: number) {
    const modalId = `modal-toolbar-${Date.now()}`;
    UI.showModal(
        <LogseqAnkiSyncToolbarMenuComponent
            modalId={modalId}
            triggerRect={triggerRect}
            parentWidth={parentWidth}
        />,
        modalId
    );
}
