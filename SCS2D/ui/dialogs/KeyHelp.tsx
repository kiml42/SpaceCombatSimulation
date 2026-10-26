import { styled } from "@linaria/react";
import { useEffect, useRef } from "react";

const Dialog = styled.dialog`
    max-width: min(42rem, 92vw);
    max-height: 85vh;
    overflow: auto;
    padding: 0.9rem 1.1rem;
    border: 1px solid var(--colour-control-border);
    border-radius: 6px;
    background: var(--colour-background);
    color: var(--colour-text);

    &::backdrop {
        background: rgb(0 0 0 / 55%);
    }

    h2 {
        margin: 0 0 0.6rem;
        color: var(--colour-heading);
        font-size: var(--font-size-body);
    }

    table {
        width: 100%;
        border-collapse: collapse;
    }

    td {
        padding: 0.2rem 0;
        border-top: 1px solid var(--colour-border);
        vertical-align: top;
    }

    td:first-child {
        padding-right: 1.2rem;
        color: var(--colour-heading);
        white-space: nowrap;
    }

    p {
        margin: 0.7rem 0 0;
        color: var(--colour-muted);
    }
`;

const Close = styled.button`
    float: right;
`;

/** One row of the table: what to press, and what it does. */
export interface KeyRow {
    readonly keys: string;
    readonly does: string;
}

export interface KeyHelpProps {
    readonly rows: readonly KeyRow[];
    readonly notes?: readonly string[];
}

/**
 * A page's keys and mouse behind a button: a table of what to press and what it does, opened over the
 * page. `?` opens it too, unless something is being typed into.
 */
export function KeyHelp({ rows, notes = [] }: KeyHelpProps) {
    const dialog = useRef<HTMLDialogElement>(null);
    useEffect(() => {
        const open = (event: KeyboardEvent): void => {
            const typing =
                document.activeElement instanceof HTMLInputElement ||
                document.activeElement instanceof HTMLTextAreaElement ||
                document.activeElement instanceof HTMLSelectElement;
            if (event.key === "?" && !typing && dialog.current?.open === false) dialog.current.showModal();
        };
        window.addEventListener("keydown", open);
        return () => window.removeEventListener("keydown", open);
    }, []);

    return (
        <>
            <button title="What each key and mouse action does (?)" onClick={() => dialog.current?.showModal()}>
                Keys
            </button>
            <Dialog
                ref={dialog}
                aria-label="Keys and mouse"
                // A click on the backdrop lands on the dialog itself, outside its box.
                onClick={(event) => event.target === event.currentTarget && dialog.current?.close()}
                // Keys pressed while it is open are for it, not the page under it; Escape still closes it.
                onKeyDown={(event) => event.stopPropagation()}
            >
                <Close onClick={() => dialog.current?.close()}>Close</Close>
                <h2>Keys and mouse</h2>
                <table>
                    <tbody>
                        {rows.map((row) => (
                            <tr key={row.keys}>
                                <td>{row.keys}</td>
                                <td>{row.does}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                {notes.map((note) => (
                    <p key={note}>{note}</p>
                ))}
            </Dialog>
        </>
    );
}
