import { styled } from "@linaria/react";
import { Button } from "~/ui/buttons/Button";
import { CardPick } from "./Cards";

const Box = styled.div`
    position: absolute;
    top: 50%;
    left: 50%;
    z-index: 2;
    width: max-content;
    max-width: calc(100% - 2rem);
    padding: 1rem 1.2rem 0.9rem;
    border: 1px solid var(--colour-control-border);
    border-radius: 6px;
    background: rgb(11 15 22 / 92%);
    box-shadow: 0 0.4rem 1.5rem #000a;
    text-align: center;
    transform: translate(-50%, -50%);

    h2 {
        margin: 0 0 0.3rem;
        color: var(--colour-heading);
        font-size: 1.1rem;
    }

    p {
        max-width: 34rem;
        margin: 0 auto 0.8rem;
        color: var(--colour-muted);
    }

    [role="group"] {
        justify-content: center;
    }
`;

const WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];

/** `of` losses with different fleets have dealt a hand: pick one, over the battle that earned it, paused. */
export function EarnedCard({
    hand,
    of,
    onPick,
    onLater,
}: {
    readonly hand: readonly string[];
    /** How many different fleets had to lose for it. */
    readonly of: number;
    readonly onPick: (id: string) => void;
    readonly onLater: () => void;
}) {
    return (
        <Box id="earnedCard" role="dialog" aria-labelledby="earnedCardTitle">
            <h2 id="earnedCardTitle">Upgrade card earned</h2>
            <p>
                {`${WORDS[of] ?? of} different ${of === 1 ? "fleet has" : "fleets have"} lost this round, so you get an upgrade card. Pick one to take into your next fight.`}
            </p>
            <CardPick hand={hand} onPick={onPick} />
            <Button id="earnedCardLater" onClick={onLater}>
                Continue watching
            </Button>
        </Box>
    );
}
