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
    /** Losses in a row, each with a new fleet, before the player is dealt cards; 0 for never. */
    readonly cardAfter: number;
    /** Seconds a side may go without fighting before it is out. */
    readonly quietTime: number;
}

/** How a skirmish plays out, round by round, for a player who has not played one. */
export function SkirmishHelp({ open, onClose, cardAfter, quietTime }: SkirmishHelpProps) {
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
            <p>An arms race against an enemy that learns: every time you beat it, it evolves to beat you back.</p>
            <ol>
                <li>
                    <strong>Pick an enemy and a battlefield.</strong> What the enemy cost to build is your budget: metal, fuel and build
                    time.
                </li>
                <li>
                    <strong>Build a fleet within the budget</strong> in the fleet editor: design ships, or load ones you have saved.
                </li>
                <li>
                    <strong>Fight the round.</strong> Your ships fight by themselves, and you can give them orders. A side that goes{" "}
                    {quietTime} s without firing, hitting or closing in is out; a draw counts as a loss.
                </li>
                <li>
                    <strong>Lost? Change your fleet and try again.</strong> Each try of a round starts the same way, so you can work out
                    what beats it.
                    {cardAfter > 0 &&
                        ` After ${cardAfter} losses in a row, each with a fleet that has not lost the round before, you are dealt upgrade cards to stretch your budget.`}
                </li>
                <li>
                    <strong>Won? The enemy evolves.</strong> Pick where the next round is fought, then watch the enemy breed variations on
                    its fleet until one beats yours there. That one is your next opponent. If it struggles, it draws upgrade cards of its
                    own.
                </li>
                <li>
                    <strong>Keep going</strong> for as long as you can stay ahead. Your skirmish is saved as you play; carry on from the
                    main menu.
                </li>
            </ol>
            <p>The presets above set everything up; Customise and Evolution settings are there when you want more control.</p>
            <Actions>
                <Button id="skirmishHelpClose" variant="primary" autoFocus onClick={onClose}>
                    Got it
                </Button>
            </Actions>
        </Dialog>
    );
}
