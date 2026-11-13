import { styled } from "@linaria/react";
import { useEffect, useRef } from "react";
import { Button } from "~/ui/buttons/Button";

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

    /* Doubled, to win over the setup screen's own headings, which it sits inside. */
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

export interface SkirmishHelpProps {
    readonly open: boolean;
    readonly onClose: () => void;
}

/** What a skirmish is and how to start one: the rest is explained as it comes up in play. */
export function SkirmishHelp({ open, onClose }: SkirmishHelpProps) {
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
            id="skirmishHelp"
            aria-labelledby="skirmishHelpTitle"
            onCancel={(event) => {
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
            <h2 id="skirmishHelpTitle">How a skirmish works</h2>
            <p>An arms race against an enemy that adapts: every time you beat it, it evolves to counter your fleet.</p>
            <ol>
                <li>
                    <strong>Pick an enemy and a battlefield.</strong> What the enemy costs to build is your budget.
                </li>
                <li>
                    <strong>Start, and build a fleet</strong> within that budget to beat it.
                </li>
            </ol>
            <p>You will pick up the rest as you play.</p>
            <Actions>
                <Button id="skirmishHelpClose" variant="primary" autoFocus onClick={onClose}>
                    Got it
                </Button>
            </Actions>
        </Dialog>
    );
}
