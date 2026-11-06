import { styled } from "@linaria/react";
import { BudgetTable } from "~/features/skirmish/BudgetTable";
import { CardHand, CardPick } from "~/features/skirmish/Cards";
import { canFight, fleetFault, overLimit, type Skirmish } from "~/scenarios/skirmish";

const Note = styled.p`
    margin: 0.4rem 0 0;
    color: var(--colour-warning);
`;

/** Why the fleet cannot go back to the skirmish, or null if it can. */
export function skirmishBlock(skirmish: Skirmish, flies: boolean): string | null {
    if (skirmish.hand !== undefined) return "Pick an upgrade card to fight again.";
    if (skirmish.player.ships.length === 0) return "Add a ship to fight with.";
    const fault = fleetFault(skirmish.player);
    if (fault !== null) return "Priced once every design would fly.";
    if (!flies) return "Fix the problems listed to fight.";
    if (canFight(skirmish)) return null;
    const limit = overLimit(skirmish);
    return limit !== null ? `The fleet has ${limit}.` : "Over budget: cut it down to fight.";
}

const Pick = styled.div`
    margin: 0.5rem 0;

    h3 {
        margin: 0 0 0.2rem;
        color: var(--colour-heading);
    }

    p {
        margin: 0 0 0.3rem;
        color: var(--colour-muted);
    }
`;

/**
 * The skirmish round this fleet is the player's in: what it costs against the
 * budget, the upgrade cards held, a hand to pick from, and whether it may fight.
 */
export function SkirmishCard({
    skirmish,
    flies,
    onPick,
}: {
    readonly skirmish: Skirmish;
    readonly flies: boolean;
    readonly onPick: (id: string) => void;
}) {
    const block = skirmishBlock(skirmish, flies);
    return (
        <section id="skirmish">
            <h2 id="skirmishTitle">{`Skirmish — round ${skirmish.round}`}</h2>
            {skirmish.hand !== undefined && (
                <Pick>
                    <h3>Pick an upgrade card</h3>
                    <p>You have lost this round with several fleets: take one of these for good.</p>
                    <CardPick hand={skirmish.hand} onPick={onPick} />
                </Pick>
            )}
            <BudgetTable id="skirmishBudget" skirmish={skirmish} />
            <CardHand id="heldCards" ids={skirmish.cards ?? []} caption="Your upgrade cards:" empty="No upgrade cards yet." />
            <Note id="skirmishNote">{block ?? `Against ${skirmish.enemy.name}.`}</Note>
        </section>
    );
}
