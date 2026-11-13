import { styled } from "@linaria/react";
import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { Button } from "~/ui/buttons/Button";
import { KeyTable, type KeyRow } from "~/ui/dialogs/KeyTable";

const Dialog = styled.dialog`
    width: min(24rem, 92vw);
    max-height: 85vh;
    overflow: auto;
    padding: 1rem 1.2rem;
    border: 1px solid var(--colour-control-border);
    border-radius: 6px;
    background: var(--colour-background);
    color: var(--colour-text);

    &[data-view="keys"] {
        width: min(42rem, 92vw);
    }

    &::backdrop {
        background: rgb(0 0 0 / 55%);
    }

    h2 {
        margin: 0 0 0.8rem;
        color: var(--colour-heading);
        font-size: 1rem;
    }

    h3 {
        margin: 0.4rem 0 0;
        color: var(--colour-muted);
        font-size: var(--font-size-small);
        font-weight: 600;
        letter-spacing: 0.12em;
        text-transform: uppercase;
    }

    p {
        margin: 0 0 1rem;
    }
`;

const Items = styled.div`
    display: grid;
    gap: 0.4rem;

    > button {
        width: 100%;
        padding: 0.45rem 0.8rem;
        text-align: left;
    }
`;

const Row = styled.div`
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    justify-content: flex-end;
    margin-top: 1rem;
`;

/** Something a page offers in its menu. */
export interface MenuAction {
    readonly id?: string;
    readonly label: string;
    readonly title?: string;
    readonly disabled?: boolean;
    /** Done once the menu has closed and the page carried on. */
    readonly onSelect: () => void;
}

/** Work that would be left behind on the way to the main menu, and how to keep it. */
export interface Unsaved {
    readonly what: string;
    readonly save: () => void;
}

export interface PauseMenuProps {
    /** "Paused" where opening it stops something, else the page's name. */
    readonly title: string;
    /** Stop the page while the menu is open, returning how to carry on as it was. */
    readonly pause?: () => () => void;
    readonly actions?: readonly MenuAction[];
    /** What the page shows, set from the menu. */
    readonly settings?: ReactNode;
    /** More of the page's own, after its actions: a list to choose from, where a button would not do. */
    readonly children?: ReactNode;
    readonly keys?: readonly KeyRow[];
    readonly notes?: readonly string[];
    /** Asked before leaving for the main menu; null when nothing would be lost. */
    readonly unsaved?: Unsaved | null;
}

type View = "main" | "keys" | "leaving";

const typing = (): boolean =>
    document.activeElement instanceof HTMLInputElement ||
    document.activeElement instanceof HTMLTextAreaElement ||
    document.activeElement instanceof HTMLSelectElement;

/**
 * A page's menu, behind a button and Escape: Escape opens it only once the
 * page has nothing left to cancel, which a page says by calling
 * `preventDefault` on the Escape it takes. `?` opens it at the keys.
 */
export function PauseMenu({ title, pause, actions = [], settings, keys, notes, unsaved = null, children }: PauseMenuProps) {
    const dialog = useRef<HTMLDialogElement>(null);
    const resume = useRef<(() => void) | null>(null);
    const [view, setView] = useState<View | null>(null);
    const navigate = useNavigate();

    const open = (at: View): void => {
        if (view !== null) return;
        resume.current = pause?.() ?? null;
        setView(at);
    };
    const openByKey = useEffectEvent(open);
    const close = (then?: () => void): void => {
        setView(null);
        const carryOn = resume.current;
        resume.current = null;
        carryOn?.();
        then?.();
    };

    useEffect(() => {
        const element = dialog.current;
        if (element === null) return;
        if (view !== null && !element.open) element.showModal();
        if (view === null && element.open) {
            element.close();
            // Focus goes back to the menu button, where Space would open it again rather than reach the page.
            if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        }
    }, [view]);

    useEffect(() => {
        const onKey = (event: KeyboardEvent): void => {
            if (typing()) return;
            if (event.key === "?") openByKey(keys === undefined ? "main" : "keys");
            // Once every other listener has had it, so one that took it can say so; and after the key is done,
            // or the browser hands this Escape to the menu just opened, and it closes again.
            else if (event.key === "Escape") setTimeout(() => !event.defaultPrevented && openByKey("main"));
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [keys]);

    /** Escape: back to the menu from what it opened, or out of it. */
    const back = (): void => {
        if (view === "main") close();
        else setView("main");
    };
    const leave = (): void => close(() => void navigate("/"));

    return (
        <>
            <Button id="menuButton" aria-label="Menu" title="Open the menu (Escape)" onClick={() => open("main")}>
                ◀ Menu
            </Button>
            <Dialog
                ref={dialog}
                aria-labelledby="menuTitle"
                data-view={view ?? undefined}
                // A click on the backdrop lands on the dialog itself, outside its box.
                onClick={(event) => {
                    const box = event.currentTarget.getBoundingClientRect();
                    const outside =
                        event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom;
                    if (event.target === event.currentTarget && outside) close();
                }}
                onCancel={(event) => {
                    event.preventDefault();
                    back();
                }}
                // Keys pressed while it is open are for it, not the page under it.
                onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.key !== "Escape") return;
                    event.preventDefault();
                    back();
                }}
            >
                {view === "main" && (
                    <>
                        <h2 id="menuTitle">{title}</h2>
                        <Items>
                            <Button id="resume" variant="primary" autoFocus onClick={() => close()}>
                                Resume
                            </Button>
                            {actions.map((action) => (
                                <Button
                                    key={action.label}
                                    id={action.id}
                                    title={action.title}
                                    disabled={action.disabled}
                                    onClick={() => close(action.onSelect)}
                                >
                                    {action.label}
                                </Button>
                            ))}
                            {children}
                            {settings !== undefined && (
                                <>
                                    <h3>View</h3>
                                    {settings}
                                </>
                            )}
                            {keys !== undefined && (
                                <Button id="menuKeys" onClick={() => setView("keys")}>
                                    Keys and mouse
                                </Button>
                            )}
                            <Button id="mainMenu" onClick={() => (unsaved === null ? leave() : setView("leaving"))}>
                                Main menu
                            </Button>
                        </Items>
                    </>
                )}
                {view === "keys" && keys !== undefined && (
                    <>
                        <h2 id="menuTitle">Keys and mouse</h2>
                        <KeyTable rows={keys} {...(notes === undefined ? {} : { notes })} />
                        <Row>
                            <Button autoFocus onClick={() => setView("main")}>
                                Back
                            </Button>
                        </Row>
                    </>
                )}
                {view === "leaving" && unsaved !== null && (
                    <>
                        <h2 id="menuTitle">Unsaved changes</h2>
                        <p>
                            <strong>{unsaved.what}</strong> has changes that are not saved.
                        </p>
                        <Row>
                            <Button onClick={() => setView("main")}>Cancel</Button>
                            <Button id="leaveUnsaved" onClick={leave}>
                                Leave without saving
                            </Button>
                            <Button
                                id="saveAndLeave"
                                variant="primary"
                                autoFocus
                                onClick={() => {
                                    unsaved.save();
                                    leave();
                                }}
                            >
                                Save and leave
                            </Button>
                        </Row>
                    </>
                )}
            </Dialog>
        </>
    );
}
