import { styled } from "@linaria/react";
import { useEffect, useRef } from "react";
import type { RosterLine } from "~/editor/fleetDocument";
import type { LibraryEntry } from "~/editor/library";
import { CARRIED, optionValue } from "./fleetOptions";

const Adding = styled.div`
    position: relative;
`;

const Pair = styled.div`
    display: flex;
    gap: 0.4rem;

    > button {
        flex: 1;
    }
`;

const Menu = styled.div`
    position: absolute;
    right: 0;
    left: 0;
    z-index: 1;
    max-height: 60vh;
    margin-top: 0.2rem;
    padding: 0.3rem 0;
    overflow-y: auto;
    border: 1px solid var(--colour-control-border);
    border-radius: 4px;
    background: var(--colour-background);

    h3 {
        margin: 0.3rem 0.6rem 0.1rem;
        color: var(--colour-muted);
        font-size: var(--font-size-small);
        font-weight: 400;
    }

    button {
        display: block;
        width: 100%;
        border: none;
        border-radius: 0;
        background: none;
        text-align: left;
    }

    button:hover,
    button:focus {
        background: var(--colour-surface-hover);
    }
`;

export interface AddShipMenuProps {
    readonly open: boolean;
    readonly onOpen: (open: boolean) => void;
    /** The fleet's own designs, flown or not. */
    readonly roster: readonly RosterLine[];
    readonly library: readonly LibraryEntry[];
    /** An option: a carried design (`fleet:` and its name) or a library entry. */
    readonly onAdd: (value: string) => void;
    readonly onAddFile: (file: File) => void;
}

/** Add a ship: one the fleet carries first, then the player's, then stock; or one from a file. */
export function AddShipMenu({ open, onOpen, roster, library, onAdd, onAddFile }: AddShipMenuProps) {
    const menu = useRef<HTMLDivElement>(null);
    const file = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (!open) return;
        menu.current?.querySelector("button")?.focus();
        const away = (event: PointerEvent): void => {
            if (!(event.target as HTMLElement).closest("#adding")) onOpen(false);
        };
        document.addEventListener("pointerdown", away);
        return () => document.removeEventListener("pointerdown", away);
    }, [open, onOpen]);

    const group = (title: string, items: readonly [string, string][]) =>
        items.length === 0 ? null : (
            <>
                <h3>{title}</h3>
                {items.map(([value, label]) => (
                    <button
                        key={value}
                        role="menuitem"
                        onClick={() => {
                            onOpen(false);
                            onAdd(value);
                        }}
                    >
                        {label}
                    </button>
                ))}
            </>
        );

    return (
        <Adding id="adding">
            <Pair>
                <button
                    id="addShip"
                    aria-haspopup="menu"
                    aria-expanded={open}
                    title="One of this fleet's designs, or a ship from the library; the fleet carries its own copy"
                    onClick={() => onOpen(!open)}
                >
                    Add ship ▾
                </button>
                <button id="addFromFile" title="Add a ship from a blueprint file" onClick={() => file.current?.click()}>
                    Add from file…
                </button>
            </Pair>
            {open && (
                <Menu ref={menu} id="addMenu" role="menu" aria-label="Add ship">
                    {group(
                        "In this fleet",
                        roster.map((line) => [CARRIED + line.name, line.name]),
                    )}
                    {group(
                        "Saved",
                        library.filter((entry) => !entry.stock).map((entry) => [optionValue(entry), entry.name]),
                    )}
                    {group(
                        "Stock",
                        library
                            .filter((entry) => entry.stock)
                            .map((entry) => [optionValue(entry), entry.name + (entry.saved ? " (stock)" : "")]),
                    )}
                </Menu>
            )}
            <input
                ref={file}
                id="addShipFile"
                type="file"
                accept="application/json,.json"
                hidden
                onChange={(event) => {
                    const chosen = event.target.files?.[0];
                    event.target.value = "";
                    if (chosen !== undefined) onAddFile(chosen);
                }}
            />
        </Adding>
    );
}
