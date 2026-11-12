import { styled } from "@linaria/react";
import { useState } from "react";
import type { BattleView, Look } from "~/host/battleView";
import type { Arcs } from "~/render/canvas2d";

const Fields = styled.div`
    display: grid;
    gap: 0.4rem;

    label {
        display: flex;
        gap: 0.5rem;
        align-items: center;
    }
`;

const ARCS: readonly (readonly [Arcs, string])[] = [
    ["none", "none"],
    ["firing", "where each gun can point"],
    ["trigger", "where each will fire"],
];

/** A battle view's arcs, shot colours and fleet strips, as its page's menu sets them. */
export function LookFields({ view }: { readonly view: BattleView }) {
    const [look, setLook] = useState<Look>(() => view.look);
    const change = (next: Partial<Look>): void => {
        view.setLook(next);
        setLook(view.look);
    };
    return (
        <Fields>
            <label>
                Firing arcs (Ctrl+A)
                <select id="lookArcs" value={look.arcs} onChange={(event) => change({ arcs: event.target.value as Arcs })}>
                    {ARCS.map(([value, label]) => (
                        <option key={value} value={value}>
                            {label}
                        </option>
                    ))}
                </select>
            </label>
            <label>
                <input
                    id="lookTeamShots"
                    type="checkbox"
                    checked={look.teamShots}
                    onChange={(event) => change({ teamShots: event.target.checked })}
                />
                Shots in their side&apos;s colours (C)
            </label>
            <label>
                <input
                    id="lookStrips"
                    type="checkbox"
                    checked={look.strips}
                    onChange={(event) => change({ strips: event.target.checked })}
                />
                Each side&apos;s ships down the edges (T)
            </label>
        </Fields>
    );
}
