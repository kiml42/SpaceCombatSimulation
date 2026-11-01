import { styled } from "@linaria/react";
import { useState } from "react";
import { useSampled } from "~/features/battle/useSampled";
import { sidesOf, teamColour, teamName } from "~/render/teams";
import { tally, winner, type CustomBattle } from "~/scenarios/customBattle";

const Side = styled.div`
    display: flex;
    gap: 0.4rem;
    align-items: center;
    margin-top: 0.4rem;
    color: var(--colour-heading);

    span:first-child {
        width: 0.8rem;
        height: 0.8rem;
        border-radius: 2px;
    }
`;

const Stats = styled.div`
    padding-left: 1.2rem;
    color: var(--colour-muted);
`;

const Outcome = styled.p`
    margin: 0.6rem 0 0;
    color: var(--colour-warning);
`;

const None = styled.p`
    margin: 0.2rem 0;
    color: var(--colour-faint);
`;

/** How each side of a custom battle is doing, and who won, named once and then left while the battle goes on. */
export function Sides({ current }: { readonly current: () => CustomBattle | null }) {
    // Read again a few times a second: the table is to read, not an animation.
    useSampled(() => current()?.world.tick ?? -1);
    const battle = current();
    const [result, setResult] = useState<{ readonly of: CustomBattle; readonly text: string } | null>(null);

    const now = battle === null ? [] : tally(battle, battle.start.length);
    const sides = sidesOf(battle?.liveries);
    const won = battle === null || battle.start.length < 2 ? null : winner(now);
    if (battle !== null && won !== null && result?.of !== battle) {
        const time = (battle.world.tick * battle.world.dt).toFixed(1);
        // The sides' colours by name, as the footer calls them; grey beyond the fourth.
        const colour = won < 4 ? teamName(won, sides).toLowerCase() : "grey";
        const who = won < 0 ? "No side can fight on" : `${battle.setup.fleets[won]?.name ?? ""} (${colour}) wins`;
        setResult({ of: battle, text: `${who} at ${time} s.` });
    }

    if (battle === null || battle.start.length === 0) return <None id="sides">No fleets yet.</None>;
    return (
        <section id="sides" aria-label="Sides">
            {battle.start.map((start, i) => {
                const side = now[i]!;
                const lost = start.mass > 0 ? (1 - side.mass / start.mass) * 100 : 0;
                return (
                    <div key={i}>
                        <Side>
                            <span style={{ background: teamColour(i, sides) }} />
                            <span>{battle.setup.fleets[i]?.name ?? `Side ${i + 1}`}</span>
                        </Side>
                        <Stats>
                            {side.ships}/{start.ships} ships · {side.armed} armed · {side.mobile} mobile · {Math.round(lost)}% of mass lost
                        </Stats>
                    </div>
                );
            })}
            {result?.of === battle && (
                <Outcome id="outcome" role="status">
                    {result.text}
                </Outcome>
            )}
        </section>
    );
}
