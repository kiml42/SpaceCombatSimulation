import { CardPick } from "./Cards";
import { PickOverlay } from "./PickOverlay";

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
        <PickOverlay
            id="earnedCard"
            title="Upgrade card earned"
            text={`${WORDS[of] ?? of} different ${of === 1 ? "fleet has" : "fleets have"} lost this round, so you get an upgrade card. Pick one to take into your next fight.`}
            onLater={onLater}
        >
            <CardPick hand={hand} onPick={onPick} />
        </PickOverlay>
    );
}
