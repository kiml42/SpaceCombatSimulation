import { styled } from "@linaria/react";
import { useEffect, useRef } from "react";
import { drawArena } from "~/host/fleetPicture";
import { customBattle } from "~/scenarios/customBattle";
import { roundBattle, settingsOf, type Skirmish } from "~/scenarios/skirmish";

const Canvas = styled.canvas`
    flex: none;
    border: 1px solid var(--colour-border);
    border-radius: 4px;
    background: var(--colour-background);
`;

/** The round the enemy is answering, as it will be set out: a still, small, of where the next fight is. */
export function ArenaPicture({
    skirmish,
    width = 220,
    height = 120,
}: {
    readonly skirmish: Skirmish;
    readonly width?: number;
    readonly height?: number;
}) {
    const canvas = useRef<HTMLCanvasElement>(null);
    // Drawn again only when the round would be set out differently, not whenever the skirmish is saved.
    const { won, player, enemy } = skirmish;
    const settings = settingsOf(skirmish);
    useEffect(() => {
        if (canvas.current === null || won === undefined) return;
        try {
            drawArena(canvas.current, customBattle(roundBattle(player, enemy, won, settings)));
        } catch {
            // A fleet that cannot be laid out has no arena to show; the banner says the rest.
        }
    }, [won, player, enemy, settings]);
    return (
        <Canvas
            id="arenaPicture"
            ref={canvas}
            width={width}
            height={height}
            title="Where the next round is fought, as it will be set out"
        />
    );
}
