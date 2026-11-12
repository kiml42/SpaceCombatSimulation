import { styled } from "@linaria/react";
import { useEffect, useRef, useState } from "react";
import { useSampled } from "~/features/battle/useSampled";
import { EFFECTS_SCENES, STEP } from "~/host/effectsScene";
import { effectsView, type EffectsView } from "~/host/effectsView";
import { BUILDER_LIGHT, DEFAULT_LIGHT, type Light } from "~/render/light";
import { LIGHTS } from "~/scenarios/lights";
import { Playback } from "~/features/battle/Playback";
import { PauseMenu } from "~/features/menu/PauseMenu";
import { Button } from "~/ui/buttons/Button";

const SPEEDS = [1, 0.25, 0.1, 0.03];
const KEYS = [
    { keys: "Space", does: "Play, or pause" },
    { keys: ", and .", does: "Step back and on, paused" },
    { keys: "Drag", does: "Pan" },
    { keys: "Scroll", does: "Zoom" },
];
/** No light at all: what is seen is only what the scene's own lights show. */
const DARK: Light = { from: 0, colour: "#000000", ambient: 0 };
const LIGHT_CHOICES: readonly (readonly [string, Light])[] = [
    ["battle default", DEFAULT_LIGHT],
    ["builder", BUILDER_LIGHT],
    ...Object.entries(LIGHTS),
    ["dark", DARK],
];

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

const About = styled.p`
    margin: 0;
    padding: 0.4rem 0.9rem;
    border-bottom: 1px solid var(--colour-border);
    color: var(--colour-muted);
`;

const Stage = styled.div`
    position: relative;
    display: flex;
    flex: 1;
    min-height: 0;
`;

const Canvas = styled.canvas`
    display: block;
    flex: 1;
    min-width: 0;
    touch-action: none;
`;

/**
 * The battle's effects on their own — hits, bursts, muzzle flashes, beams,
 * plumes, burns, leaks and tracers — drawn by the battle's renderer, looped,
 * slowed and scrubbed, for looking at how they are drawn now.
 */
export function EffectsPage() {
    const canvas = useRef<HTMLCanvasElement>(null);
    const [view, setView] = useState<EffectsView | null>(null);
    const [scene, setScene] = useState(0);
    const [playing, setPlaying] = useState(true);
    const [speed, setSpeed] = useState(0.25);
    const [light, setLight] = useState(0);
    const time = useSampled(() => view?.time ?? 0);

    useEffect(() => {
        const made = effectsView(canvas.current!);
        setView(made);
        return () => {
            made.dispose();
            setView(null);
        };
    }, []);
    useEffect(() => {
        if (view === null) return;
        // As the battle's: Space plays and pauses, `.` steps on and `,` back, a step at a time.
        const onKey = (event: KeyboardEvent): void => {
            const focus = document.activeElement;
            if ((focus instanceof HTMLInputElement && focus.type !== "range") || focus instanceof HTMLTextAreaElement) return;
            if (event.key === " ") {
                event.preventDefault();
                setPlaying((was) => !was);
            } else if (event.key === "." || event.key === ",") {
                setPlaying(false);
                const loop = view.loop;
                view.seek((view.time + (event.key === "." ? STEP : loop - STEP)) % loop);
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [view]);
    useEffect(() => view?.show(scene), [view, scene]);
    useEffect(() => view?.setPlaying(playing), [view, playing]);
    useEffect(() => view?.setSpeed(speed), [view, speed]);
    useEffect(() => view?.setLight(LIGHT_CHOICES[light]![1]), [view, light]);

    const loop = EFFECTS_SCENES[scene]!.loop;
    return (
        <Main>
            <Controls>
                <PauseMenu
                    title="Paused"
                    pause={() => {
                        const was = playing;
                        setPlaying(false);
                        return () => setPlaying(was);
                    }}
                    keys={KEYS}
                />
                <select id="effect" aria-label="Effect" value={scene} onChange={(event) => setScene(Number(event.target.value))}>
                    {EFFECTS_SCENES.map((each, k) => (
                        <option key={each.name} value={k}>
                            {each.name}
                        </option>
                    ))}
                </select>
                <Button id="play" onClick={() => setPlaying(!playing)}>
                    {playing ? "Pause" : "Play"}
                </Button>
                <Playback>
                    <label>
                        t
                        <input
                            id="time"
                            type="range"
                            min={0}
                            max={loop}
                            step={1 / 600}
                            value={Math.min(time, loop)}
                            onChange={(event) => {
                                setPlaying(false);
                                view?.seek(Number(event.target.value));
                            }}
                        />
                        <output>{time.toFixed(3)} s</output>
                    </label>
                    <label>
                        speed
                        <select id="speed" value={speed} onChange={(event) => setSpeed(Number(event.target.value))}>
                            {SPEEDS.map((each) => (
                                <option key={each} value={each}>
                                    {each}x
                                </option>
                            ))}
                        </select>
                    </label>
                </Playback>
                <label>
                    light
                    <select id="light" value={light} onChange={(event) => setLight(Number(event.target.value))}>
                        {LIGHT_CHOICES.map(([name], k) => (
                            <option key={name} value={k}>
                                {name}
                            </option>
                        ))}
                    </select>
                </label>
                <Button onClick={() => view?.fit()}>Fit</Button>
            </Controls>
            <About>{EFFECTS_SCENES[scene]!.about} Space plays and pauses, , and . step back and on, scroll zooms, drag pans.</About>
            <Stage>
                <Canvas ref={canvas} aria-label="Effects" />
            </Stage>
        </Main>
    );
}
