import { styled } from "@linaria/react";
import { useRef, useState } from "react";
import { BattleCanvas } from "~/features/battle/BattleCanvas";
import { useSampled } from "~/features/battle/useSampled";
import { useViewSettings } from "~/features/storage/useViewSettings";
import type { BattleView } from "~/host/battleView";
import type { ViewSettings } from "~/host/viewSettings";
import { gridStep } from "~/render/camera";
import { customBattle, type BattleSetup, type CustomBattle } from "~/scenarios/customBattle";
import { SCENES } from "~/scenarios/scenes";
import type { Battle } from "~/scenarios/types";
import type { Snapshot } from "~/sim/index";
import { CustomPanel } from "./custom/CustomPanel";
import { DEFAULT_FIELDS, setupOf, type SetupFields, type Slot } from "./custom/customSetup";
import { Scrub } from "./Scrub";

/** The old viewer's own, so a speed kept there is kept here. */
const PAGE = "viewer";
const DEFAULTS: ViewSettings = { arcs: "none", teamShots: false, strips: true, speed: 1 };
const SPEEDS = [0.25, 0.5, 1, 2, 4, 8, 16];
/** The scene list's last entry: a battle set up in the panel rather than in code. */
const CUSTOM = SCENES.length;

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

const Body = styled.div`
    display: flex;
    flex: 1;
    min-height: 0;
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
    const battle = useRef<Battle | null>(null);
    // Blank: the fleets are the first thing chosen.
    const [slots, setSlots] = useState<readonly Slot[]>([]);
    const [fields, setFields] = useState<SetupFields>(DEFAULT_FIELDS);

    /** The scene built afresh, running or held as the battle before it was. */
    const show = (next: BattleView | null, index = scene, run = running, setup?: BattleSetup): void => {
        if (next === null) return;
        battle.current = index === CUSTOM ? customBattle(setup ?? setupOf(slots, fields)) : SCENES[index]!.create();
        next.show(battle.current, run, true);
    };
    // Set up paused at its first step, so the opening positions can be seen as they are chosen, and started with Fight.
    const openCustom = (): void => {
        setScene(CUSTOM);
        show(view, CUSTOM, false);
    };
    const changeSetup = (nextSlots: readonly Slot[], nextFields: SetupFields): void => {
        setSlots(nextSlots);
        setFields(nextFields);
        show(view, CUSTOM, false, setupOf(nextSlots, nextFields));
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
                <button onClick={() => show(view, scene, scene !== CUSTOM && running)}>Reset</button>
                <select
                    aria-label="Scenario"
                    value={scene}
                    onChange={(event) => {
                        const index = Number(event.target.value);
                        if (index === CUSTOM) return openCustom();
                        setScene(index);
                        show(view, index);
                    }}
                >
                    {SCENES.map((entry, index) => (
                        <option key={entry.name} value={index}>
                            {entry.name}
                        </option>
                    ))}
                    <option value={CUSTOM}>Custom battle</option>
                </select>
                <button title="Set up a battle between fleets" onClick={openCustom}>
                    Custom
                </button>
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
            <Body>
                <BattleCanvas
                    onView={onView}
                    onDrawn={(at) => (shown.current = at)}
                    onRunningChanged={setRunning}
                    onRewound={(rewound) => (battle.current = rewound)}
                />
                {scene === CUSTOM && (
                    <CustomPanel
                        slots={slots}
                        fields={fields}
                        onChange={changeSetup}
                        onFight={() => show(view, CUSTOM, true)}
                        current={() => (scene === CUSTOM ? (battle.current as CustomBattle | null) : null)}
                        orders={() => view?.orders ?? []}
                    />
                )}
            </Body>
        </Main>
    );
}
