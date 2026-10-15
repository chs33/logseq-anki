import type {FC} from "../React";
// biome-ignore lint/style/useImportType: required for re-exported react
import React from "../React";
import {createOpaqueSurfaceStyle} from "../styles/opaqueSurface";
import {LogseqPopover} from "./LogseqPopover";

type MenuArr = {
    title: string;
    onClick: () => void;
}[];

export const LogseqDropdownMenu: FC<{menuArr: MenuArr; children: React.ReactNode}> = ({
    menuArr,
    children
}) => {
    return (
        <LogseqPopover
            content={
                <ul
                    className="menu-list"
                    style={{
                        ...createOpaqueSurfaceStyle(
                            "--ls-popover-background-color",
                            "--ls-primary-background-color"
                        ),
                        fontSize: "10px",
                        boxShadow:
                            "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)",
                        borderRadius: "0.25rem",
                        listStyle: "none",
                        overflow: "hidden",
                        margin: 0,
                        padding: 0,
                        width: "200px"
                    }}>
                    {menuArr.map((item) => (
                        // biome-ignore lint/a11y/useKeyWithClickEvents: legacy menu item behavior; unrelated to surface styling
                        <li
                            key={item.title}
                            onClick={item.onClick}
                            style={{padding: "5px", userSelect: "none", cursor: "pointer"}}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.backgroundColor =
                                    "var(--ls-quaternary-background-color, #ddd)";
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.backgroundColor = "transparent";
                            }}>
                            {item.title}
                        </li>
                    ))}
                </ul>
            }>
            {children}
        </LogseqPopover>
    );
};
