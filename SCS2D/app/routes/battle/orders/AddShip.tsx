import { styled } from "@linaria/react";
import { useMemo, useRef, useState } from "react";
import { useLibrary } from "~/features/storage/useLibrary";
import type { BattleView } from "~/host/battleView";
import { choices } from "~/host/designChoices";
import { teamName } from "~/render/teams";

const SIDES = [0, 1, 2, 3];

const Designs = styled.select`
    max-width: 9rem;
`;

/**
 * Adding a ship mid-battle, a tool for trying things out: a design from the library and the side it
 * joins, then a press where it goes and a drag for how fast. The list shows what is being placed until
 * it is placed or given up (Esc).
 */
export function AddShip({ view }: { readonly view: BattleView | null }) {
    const { ships } = useLibrary();
    const designs = useMemo(() => choices(ships), [ships]);
    const [placing, setPlacing] = useState("");
    const side = useRef(0);

    return (
        <>
            <Designs
                id="addShip"
                aria-label="Add ship"
                title="Add a ship to the battle: choose it, then press where it goes and drag for how fast (Esc gives it up)"
                value={placing}
                onChange={(event) => {
                    const choice = event.target.value === "" ? undefined : designs[Number(event.target.value)];
                    setPlacing(event.target.value);
                    // So Space and the keys go on to the battle.
                    event.target.blur();
                    view?.place(
                        choice === undefined
                            ? null
                            : { blueprint: choice.blueprint, team: () => side.current, ended: () => setPlacing("") },
                    );
                }}
            >
                <option value="">Add ship…</option>
                {designs.map((choice, k) => (
                    <option key={choice.label} value={k}>
                        {choice.label}
                    </option>
                ))}
            </Designs>
            <select
                id="addSide"
                aria-label="Side it joins"
                title="The side a ship added joins"
                defaultValue={0}
                onChange={(event) => (side.current = Number(event.target.value))}
            >
                {SIDES.map((team) => (
                    <option key={team} value={team}>
                        {teamName(team)}
                    </option>
                ))}
            </select>
        </>
    );
}
