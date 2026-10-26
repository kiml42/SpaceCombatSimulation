import { styled } from "@linaria/react";
import { useRef, useState } from "react";
import { BattleCanvas } from "~/features/battle/BattleCanvas";
import { useSampled } from "~/features/battle/useSampled";
import { useViewSettings } from "~/features/storage/useViewSettings";
import type { BattleView } from "~/host/battleView";
import type { ViewSettings } from "~/host/viewSettings";
import { gridStep } from "~/render/camera";
import { SCENES } from "~/scenarios/scenes";
import type { Snapshot } from "~/sim/index";
import { Scrub } from "./Scrub";

/** The old viewer's own, so a speed kept there is kept here. */
const PAGE = "viewer";
const DEFAULTS: ViewSettings = { arcs: "none", teamShots: false, strips: true, speed: 1 };
const SPEEDS = [0.25, 0.5, 1, 2, 4, 8, 16];

const Main = styled.main`
    display: flex;
    flex-direction: column;
`;

const Controls = styled.div`
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: center;
    padding: 0.6rem 0.9rem;
    border-bottom: 1px solid var(--colour-border);

    label {
        display: flex;
        gap: 0.4rem;
        align-items: center;
        color: var(--colour-muted);
    }
`;

const Readout = styled.output`
    margin-left: auto;
    color: var(--colour-muted);
`;

/** A battle chosen from the scenes, run on the wall clock, with the controls to pause, step, wind and speed it. */
export function BattlePage() {
    const [view, setView] = useState<BattleView | null>(null);
    const [scene, setScene] = useState(0);
    const [running, setRunning] = useState(true);
    const [settings, keep] = useViewSettings(PAGE, DEFAULTS);
    const shown = useRef<Snapshot | null>(null);

    /** The scene built afresh, running or held as the battle before it was. */
    const show = (next: BattleView | null, index = scene, run = running): void => {
        next?.show(SCENES[index]!.create(), run, true);
    };
    const onView = (next: BattleView | null): void => {
        setView(next);
        if (next === null) return;
        next.keepView(PAGE);
        next.setSpeed(settings.speed);
        show(next, scene, true);
    };

    const readout = useSampled(() => {
        const at = shown.current;
        if (at === null || view === null) return "";
        return `t ${at.time.toFixed(1)} s · step ${at.tick} · grid ${gridStep(view.camera.scale)} m`;
    });

    return (
        <Main>
            <Controls>
                <button onClick={() => view?.setRunning(!running)}>{running ? "Pause" : "Play"}</button>
                <button onClick={() => view?.step()}>Step</button>
                <button onClick={() => show(view)}>Reset</button>
                <select
                    aria-label="Scenario"
                    value={scene}
                    onChange={(event) => {
                        const index = Number(event.target.value);
                        setScene(index);
                        show(view, index);
                    }}
                >
                    {SCENES.map((entry, index) => (
                        <option key={entry.name} value={index}>
                            {entry.name}
                        </option>
                    ))}
                </select>
                <button onClick={() => view?.fit()}>Fit</button>
                <Scrub view={view} />
                <label>
                    speed
                    <select
                        value={settings.speed}
                        onChange={(event) => {
                            const speed = Number(event.target.value);
                            keep({ speed });
                            view?.setSpeed(speed);
                        }}
                    >
                        {SPEEDS.map((speed) => (
                            <option key={speed} value={speed}>
                                {speed}x
                            </option>
                        ))}
                    </select>
                </label>
                <Readout aria-label="Battle time">{readout}</Readout>
            </Controls>
            <BattleCanvas onView={onView} onDrawn={(at) => (shown.current = at)} onRunningChanged={setRunning} />
        </Main>
    );
}
