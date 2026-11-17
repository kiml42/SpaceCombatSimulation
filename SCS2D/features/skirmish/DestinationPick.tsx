import { styled } from "@linaria/react";
import type { SkirmishSettings } from "~/scenarios/skirmish";
import { destinationById } from "~/skirmish/destinations";
import { PickOverlay } from "./PickOverlay";

const Row = styled.div`
    display: flex;
    flex-wrap: wrap;
    gap: 0.7rem;
    margin: 0 0 0.8rem;
`;

/** A way to go, drawn as a card is, so a choice of them reads as one. */
const Way = styled.button`
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    width: 13rem;
    min-height: 11rem;
    padding: 0.8rem 0.8rem 0.9rem;
    border: 0.15rem solid var(--colour-control-border);
    border-radius: 0.6rem;
    background: var(--colour-surface);
    box-shadow: 0 0.15rem 0.4rem #0008;
    color: var(--colour-text);
    font: inherit;
    text-align: center;
    cursor: pointer;
    transition: transform 0.1s;

    &:hover {
        border-color: var(--colour-primary-border);
        transform: translateY(-4px);
    }

    &:focus-visible {
        outline: 2px solid var(--colour-primary-border);
        outline-offset: 3px;
    }

    strong {
        padding-bottom: 0.4rem;
        border-bottom: 1px solid var(--colour-border);
        color: var(--colour-heading);
        font-size: 1.05rem;
    }

    .change {
        color: var(--colour-heading);
    }

    .means {
        color: var(--colour-muted);
        font-size: var(--font-size-small);
    }
`;

/** Where the next round is fought, picked over the battle just won, paused. */
export function DestinationPick({
    ways,
    settings,
    onPick,
    onLater,
}: {
    readonly ways: readonly string[];
    /** The round's settings as they stand, which each way changes. */
    readonly settings: SkirmishSettings;
    readonly onPick: (id: string) => void;
    readonly onLater: () => void;
}) {
    return (
        <PickOverlay
            id="wayPick"
            title="Where next?"
            text="Round won. Pick where the next round is fought; the enemy then evolves its answer there."
            onLater={onLater}
        >
            <Row role="group" aria-label="Pick where the next round is fought">
                {ways.map((id) => {
                    const way = destinationById(id);
                    return (
                        way !== null && (
                            <Way key={id} type="button" data-way={id} onClick={() => onPick(id)}>
                                <strong>{way.name}</strong>
                                <span className="change">{way.change(settings)}</span>
                                <span className="means">{way.means}</span>
                            </Way>
                        )
                    );
                })}
            </Row>
        </PickOverlay>
    );
}
