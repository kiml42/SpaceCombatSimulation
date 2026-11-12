import { styled } from "@linaria/react";
import { useEffect, useRef } from "react";
import { Button } from "~/ui/buttons/Button";

const Dialog = styled.dialog`
    max-width: min(30rem, 92vw);
    padding: 1rem 1.2rem;
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
        font-size: 1rem;
    }

    p {
        margin: 0 0 1rem;
    }
`;

const Actions = styled.div`
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    justify-content: flex-end;
`;

export interface AbandonDialogProps {
    readonly open: boolean;
    /** The skirmish given up, as the player knows it. */
    readonly title: string;
    readonly status: string;
    readonly onExport: () => void;
    readonly onAbandon: () => void;
    readonly onCancel: () => void;
}

/** Asks before a skirmish is given up for a new one, offering to save it to a file first. */
export function AbandonDialog({ open, title, status, onExport, onAbandon, onCancel }: AbandonDialogProps) {
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
            aria-labelledby="abandonTitle"
            // Escape closes it without asking the parent.
            onCancel={(event) => {
                event.preventDefault();
                onCancel();
            }}
            onKeyDown={(event) => event.stopPropagation()}
        >
            <h2 id="abandonTitle">Start a new skirmish?</h2>
            <p>
                Only one skirmish is kept, so <strong>{title}</strong> ({status}) will be given up. Export it first to carry on with it
                later.
            </p>
            <Actions>
                <Button onClick={onCancel}>Cancel</Button>
                <Button id="abandonConfirm" onClick={onAbandon}>
                    Start new
                </Button>
                <Button
                    id="abandonExport"
                    variant="primary"
                    onClick={() => {
                        onExport();
                        onAbandon();
                    }}
                >
                    Export, then start new
                </Button>
            </Actions>
        </Dialog>
    );
}
