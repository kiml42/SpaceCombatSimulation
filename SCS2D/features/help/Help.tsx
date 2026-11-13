import { styled } from "@linaria/react";
import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from "react";
import { useStorage } from "~/features/storage/StorageContext";
import { Button } from "~/ui/buttons/Button";

/** A page's help: what its ? button is called, and how to bring it up. */
export interface PageHelp {
    readonly label: string;
    readonly show: () => void;
}

const Dialog = styled.dialog`
    width: min(34rem, 92vw);
    max-height: 88vh;
    overflow: auto;
    padding: 1.1rem 1.4rem;
    border: 1px solid var(--colour-control-border);
    border-radius: 6px;
    background: var(--colour-background);
    color: var(--colour-text);

    &::backdrop {
        background: rgb(0 0 0 / 55%);
    }

    /* Doubled, to win over the headings of the page it sits inside. */
    && h2 {
        display: block;
        margin: 0 0 0.3rem;
        color: var(--colour-heading);
        font-size: 1.1rem;
        font-weight: 600;
        letter-spacing: normal;
        text-transform: none;
    }

    ol {
        display: grid;
        gap: 0.7rem;
        margin: 1rem 0;
        padding-left: 1.4rem;
    }

    li::marker {
        color: var(--colour-heading);
        font-weight: 600;
    }

    strong {
        color: var(--colour-heading);
    }

    p {
        margin: 0;
        color: var(--colour-muted);
    }
`;

const Actions = styled.div`
    display: flex;
    justify-content: flex-end;
    margin-top: 1rem;
`;

export interface HelpDialogProps {
    /** The dialog's id; its title and close button are this with `Title` and `Close` on the end. */
    readonly id: string;
    readonly title: string;
    readonly open: boolean;
    readonly onClose: () => void;
    readonly children: ReactNode;
}

/** What a player needs the first time on a page, closed by its button, Escape or a click outside. */
export function HelpDialog({ id, title, open, onClose, children }: HelpDialogProps) {
    const dialog = useRef<HTMLDialogElement>(null);
    useEffect(() => {
        const element = dialog.current;
        if (element === null) return;
        if (open && !element.open) element.showModal();
        if (!open && element.open) element.close();
    }, [open]);

    return (
        <Dialog
            ref={dialog}
            id={id}
            aria-labelledby={`${id}Title`}
            onCancel={(event) => {
                event.preventDefault();
                onClose();
            }}
            // Keys pressed while it is open are for it, so the Escape that closes it does not open the page's menu too.
            onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key !== "Escape") return;
                event.preventDefault();
                onClose();
            }}
            // A click on the backdrop lands on the dialog itself, outside its box.
            onClick={(event) => {
                const box = event.currentTarget.getBoundingClientRect();
                const outside =
                    event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom;
                if (event.target === event.currentTarget && outside) onClose();
            }}
        >
            <h2 id={`${id}Title`}>{title}</h2>
            {children}
            <Actions>
                <Button id={`${id}Close`} variant="primary" autoFocus onClick={onClose}>
                    Got it
                </Button>
            </Actions>
        </Dialog>
    );
}

/** The ? beside a page's menu button. */
export function HelpButton({ help }: { readonly help: PageHelp }) {
    return (
        <Button id="helpOpen" aria-label={help.label} title={`${help.label} (?)`} onClick={help.show}>
            ?
        </Button>
    );
}

export interface HelpOptions {
    /** Whether the page offers it now, and so whether ? brings it up. */
    readonly enabled?: boolean;
    /** Whether it opens by itself, the first time the page is like this. */
    readonly auto?: boolean;
}

/** A page's help: open by itself until it has been seen once, and on ? whenever the page offers it. */
export function useHelp(seenKey: string, { enabled = true, auto = true }: HelpOptions = {}) {
    const storage = useStorage();
    const [asked, setAsked] = useState(false);
    const [seen, setSeen] = useState(() => {
        try {
            return storage.getItem(seenKey) !== null;
        } catch {
            return true;
        }
    });
    const open = asked || (enabled && auto && !seen);

    const show = useEffectEvent(() => setAsked(true));
    useEffect(() => {
        if (!enabled) return;
        const onKey = (event: KeyboardEvent): void => {
            const focus = document.activeElement;
            const typing = focus instanceof HTMLInputElement || focus instanceof HTMLTextAreaElement || focus instanceof HTMLSelectElement;
            if (event.key === "?" && !typing) show();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [enabled]);

    const close = (): void => {
        setAsked(false);
        setSeen(true);
        try {
            storage.setItem(seenKey, "seen");
        } catch {
            // Not remembered: it opens again next time.
        }
    };
    return { open, show: () => setAsked(true), close };
}
