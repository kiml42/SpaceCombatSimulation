import { styled } from "@linaria/react";
import { useEffect, useState } from "react";
import { BattleCanvas } from "~/features/battle/BattleCanvas";
import type { BattleView } from "~/host/battleView";
import { SCENES } from "~/scenarios/scenes";

/** The scenes the menu shows in turn, by name: fleets in action, light enough not to slow the menu, each a minute. */
export const DEMO_SCENES = ["Beam Carrier", "Lance Duel", "Line Ahead", "Standoff", "Swarm"] as const;
export const DEMO_SECONDS = 60;

/** Dimmed, so it is behind the menu rather than competing with it. */
const Dim = styled.div`
    display: flex;
    height: 100%;
    opacity: 0.2;
`;

function reducedMotion(): boolean {
    return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** A battle playing behind the main menu, for looks: no keys, no fleet strips, nothing to click. */
export function DemoBattle() {
    const [view, setView] = useState<BattleView | null>(null);
    const [turn, setTurn] = useState(0);

    useEffect(() => {
        if (view === null) return;
        const scenes = DEMO_SCENES.map((name) => SCENES.find((scene) => scene.name === name)).filter((scene) => scene !== undefined);
        if (scenes.length === 0) return;
        view.setLook({ strips: false, arcs: "none" });
        view.show(scenes[turn % scenes.length]!.create(), true, false);
        const next = setTimeout(() => setTurn((at) => at + 1), DEMO_SECONDS * 1000);
        return () => clearTimeout(next);
    }, [view, turn]);

    if (reducedMotion()) return null;
    return (
        <Dim>
            <BattleCanvas keys={false} onView={setView} />
        </Dim>
    );
}
