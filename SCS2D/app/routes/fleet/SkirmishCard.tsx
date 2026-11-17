import { styled } from "@linaria/react";
import { BudgetTable } from "~/features/skirmish/BudgetTable";
import { CardHand } from "~/features/skirmish/Cards";
import { canFight, fleetFault, overLimit, type Skirmish } from "~/scenarios/skirmish";

const Note = styled.p`
    margin: 0.4rem 0 0;
    color: var(--colour-warning);
`;

/** Why the fleet cannot go back to the skirmish, or null if it can. */
export function skirmishBlock(skirmish: Skirmish, flies: boolean): string | null {
    if (skirmish.hand !== undefined) return "Pick your upgrade card back in Skirmish to fight again.";
    if (!flies || fleetFault(skirmish.player) !== null) return "Fix the problems listed to fight.";
    if (canFight(skirmish)) return null;
    const limit = overLimit(skirmish);
    return limit !== null ? `The fleet has ${limit}.` : "Over budget: cut it down to fight.";
}

/** What stops the fleet going back to the skirmish: as `skirmishBlock`, but a hand dealt is picked there, so it does not. */
export function backBlock(skirmish: Skirmish, flies: boolean): string | null {
    return skirmish.hand !== undefined ? null : skirmishBlock(skirmish, flies);
}

/** A sidebar's heading: which skirmish round, or which fleet, the work is for. */
export const SidebarTitle = styled.h2`
    && {
        margin: 0 0 0.6rem;
        color: var(--colour-heading);
        font-size: 1.05rem;
        font-weight: 600;
        letter-spacing: normal;
        text-transform: none;
    }
`;

/** The sidebar's heading in a skirmish: which round the fleet is being made for. */
export function SkirmishTitle({ skirmish }: { readonly skirmish: Skirmish }) {
    return <SidebarTitle id="skirmishTitle">{`Skirmish — round ${skirmish.round}`}</SidebarTitle>;
}

/** What the fleet costs against the skirmish's budget, and what stops it fighting, if anything does. */
export function SkirmishBudget({
    skirmish,
    flies,
    enemy = true,
}: {
    readonly skirmish: Skirmish;
    readonly flies: boolean;
    /** The enemy's column, for comparing fleets; the ship editor leaves it out. */
    readonly enemy?: boolean;
}) {
    const block = skirmishBlock(skirmish, flies);
    return (
        <section id="skirmish">
            <h2>Budget</h2>
            <BudgetTable id="skirmishBudget" skirmish={skirmish} enemy={enemy} />
            {/* An empty fleet is the problems list's to say. */}
            {block !== null && skirmish.player.ships.length > 0 && <Note id="skirmishNote">{block}</Note>}
        </section>
    );
}

/** The upgrade cards held; one dealt is picked back in Skirmish, over the battle that earned it. */
export function SkirmishCards({ skirmish }: { readonly skirmish: Skirmish }) {
    return (
        <section id="upgradeCards">
            <h2>Upgrade cards</h2>
            <CardHand id="heldCards" ids={skirmish.cards ?? []} empty="None yet" />
        </section>
    );
}
