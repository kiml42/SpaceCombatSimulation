import { styled } from "@linaria/react";
import { useMemo, useState } from "react";
import { useLibrary } from "~/features/storage/useLibrary";
import { ANYWHERE, type BattleView, type Verb } from "~/host/battleView";
import { choices, remodels, type Remodel } from "~/host/designChoices";
import { viewOf } from "~/render/picking";
import type { Snapshot } from "~/sim/index";
import { OrderCancelCondition } from "~/sim/ships";
import type { OrderState } from "./orderState";

// Over the battle rather than beside it, so picking a ship out never resizes the view under the pointer.
const Bar = styled.div`
    position: absolute;
    right: 0;
    bottom: 0;
    left: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: center;
    padding: 0.4rem 0.9rem;
    border-top: 1px solid var(--colour-border);
    background: #0b0f16d9;

    button[aria-pressed="true"] {
        border-color: var(--colour-link);
        background: var(--colour-surface-hover);
    }

    select {
        max-width: 12rem;
    }

    input {
        width: 5rem;
    }

    label {
        display: flex;
        gap: 0.3rem;
        align-items: center;
        color: var(--colour-muted);
    }
`;

const Warn = styled.span`
    color: var(--colour-warning);
`;

const Queue = styled.ol`
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem 0.9rem;
    margin: 0;
    padding: 0;
    list-style-position: inside;

    button {
        padding: 0 0.3rem;
    }
`;

const VERBS: readonly { readonly verb: Verb; readonly label: string; readonly title: string }[] = [
    { verb: "attack", label: "Attack", title: "Attack the next ship clicked (K); Ctrl to add to its orders" },
    { verb: "defend", label: "Defend", title: "Defend the next friend clicked (D)" },
    { verb: "ram", label: "Ram", title: "Ram the next ship clicked (R)" },
    { verb: "dock", label: "Dock", title: "Dock with the next friend clicked, and take on all it can give (H)" },
    {
        verb: "scavenge",
        label: "Scavenge",
        title: "Fill its claw from the next ship or asteroid clicked, friend or foe (G); right-click an asteroid for the same",
    },
    { verb: "deliver", label: "Deliver", title: "Give the next friend clicked all it can spare, through its port (U)" },
    {
        verb: "flee",
        label: "Flee",
        title: "Run from the next enemy clicked, or hide behind the next friend or wreck; Enter runs from every enemy. Until told otherwise (W)",
    },
];

const FINISHES: readonly [OrderCancelCondition, string][] = [
    [OrderCancelCondition.CompleteDisable, "until disabled"],
    [OrderCancelCondition.CompletelyDead, "until destroyed"],
    [OrderCancelCondition.Disarm, "until disarmed"],
    [OrderCancelCondition.NoEngines, "until its engines are out"],
    [OrderCancelCondition.DisarmOrNoEngines, "until disarmed or engines out"],
];

/** What a box says, if it says something that may be told: empty or out of range is doctrine's. */
function told(text: string, positive: boolean): number | undefined {
    const value = text.trim() === "" ? NaN : Number(text);
    return Number.isFinite(value) && (positive ? value > 0 : value >= 0) ? value : undefined;
}

export interface OrderBarProps {
    readonly view: BattleView;
    readonly state: OrderState;
    readonly shown: () => Snapshot | null;
    readonly doctrineOpen: boolean;
    readonly onDoctrine: () => void;
}

/**
 * The orders for the picked ships: a button a verb, each arming the next click on a ship, what an attack
 * finishes on, how far off and how fast to hold, Stop, the doctrine, a remodel, and for one ship what it
 * has been told, each order with a ✕ to take it back.
 */
export function OrderBar({ view, state, shown, doctrineOpen, onDoctrine }: OrderBarProps) {
    const [finish, setFinish] = useState(OrderCancelCondition.CompleteDisable);
    const [distance, setDistance] = useState("");
    const [speed, setSpeed] = useState("");
    if (state.side === null) return null;

    const hold = (nextDistance: string, nextSpeed: string): void => {
        const d = told(nextDistance, false);
        const s = told(nextSpeed, true);
        view.hold({ ...(d === undefined ? {} : { distance: d }), ...(s === undefined ? {} : { speed: s }) });
    };
    // Only an attack or defence holds a distance, and a ram a speed too.
    const armed = state.armed;
    const optional = armed !== null && ANYWHERE.has(armed);

    return (
        <Bar id="orderBar" role="toolbar" aria-label="Orders">
            {VERBS.map(({ verb, label, title }) => (
                <span key={verb}>
                    <button title={title} aria-pressed={armed === verb} onClick={() => view.arm(armed === verb ? null : verb, finish)}>
                        {label}
                    </button>
                    {verb === "attack" && (
                        <>
                            {" "}
                            <select
                                id="cancelOn"
                                aria-label="What finishes an attack"
                                title="What finishes an attack given with the button"
                                value={finish}
                                onChange={(event) => setFinish(Number(event.target.value) as OrderCancelCondition)}
                            >
                                {FINISHES.map(([value, text]) => (
                                    <option key={value} value={value}>
                                        {text}
                                    </option>
                                ))}
                            </select>
                        </>
                    )}
                </span>
            ))}
            <label title="How far off every attack or defence given holds its target, metres from its skin; empty for doctrine's, as it changes">
                hold
                <input
                    id="holdDistance"
                    type="number"
                    min={0}
                    step={10}
                    placeholder="doctrine"
                    value={distance}
                    disabled={armed !== null && armed !== "attack" && armed !== "defend"}
                    onChange={(event) => {
                        setDistance(event.target.value);
                        hold(event.target.value, speed);
                    }}
                />
                m
            </label>
            <label title="How fast every attack, defence or ram given closes, metres a second; empty for doctrine's, as it changes">
                at
                <input
                    id="holdSpeed"
                    type="number"
                    min={0}
                    step={5}
                    placeholder={state.speed}
                    value={speed}
                    disabled={armed !== null && armed !== "attack" && armed !== "defend" && armed !== "ram"}
                    onChange={(event) => {
                        setSpeed(event.target.value);
                        hold(distance, event.target.value);
                    }}
                />
                m/s
            </label>
            <button
                id="stop"
                title="Clear their orders, back to doctrine (S)"
                onClick={() => state.picked.length > 0 && view.issue({ kind: "stop", ships: [...state.picked] })}
            >
                Stop
            </button>
            <button
                id="doctrine"
                title="How they fight, over what their blueprints say (P)"
                aria-pressed={doctrineOpen}
                onClick={onDoctrine}
            >
                Doctrine
            </button>
            {/* Put back to what they are whenever the picking changes. */}
            <RemodelPicker key={JSON.stringify([state.picked, state.designs, state.crewed])} view={view} state={state} shown={shown} />
            {armed !== null && <Warn>{`click a ship to ${armed} · Ctrl to queue · Esc${optional ? " · or" : ""}`}</Warn>}
            {optional && (
                <button
                    id="nearest"
                    title="Without a target: wherever its doctrine would choose (Enter); Ctrl to queue"
                    onClick={(event) => view.nearest(event.ctrlKey || event.metaKey || event.shiftKey)}
                >
                    Nearest (Enter)
                </button>
            )}
            {state.queue !== null && state.queue.orders.length > 0 && (
                <Queue id="queue" aria-label="Its orders">
                    {state.queue.orders.map((text, index) => (
                        <li key={`${index}:${text}`}>
                            {text}{" "}
                            <button
                                title="Take this order back"
                                aria-label={`Take back ${text}`}
                                onClick={() => view.issue({ kind: "drop", ship: state.queue!.ship, index })}
                            >
                                ✕
                            </button>
                        </li>
                    ))}
                </Queue>
            )}
        </Bar>
    );
}

/**
 * What the picked ships are built to, and what else they could be: a choice shown, not given, until
 * Remodel is pressed. Only ships with robots can rebuild themselves.
 */
function RemodelPicker({
    view,
    state,
    shown,
}: {
    readonly view: BattleView;
    readonly state: OrderState;
    readonly shown: () => Snapshot | null;
}) {
    const { ships: library } = useLibrary();
    const [chosen, setChosen] = useState("");
    const offered = useMemo<Remodel[]>(() => {
        const at = shown();
        if (!state.crewed || at === null) return [];
        return remodels(
            state.picked.map((i) => viewOf(at, i)).filter((ship) => ship !== null),
            choices(library),
        );
    }, [state, shown, library]);
    const current = state.designs.every((name) => name === state.designs[0]) ? (state.designs[0] ?? "") : "mixed designs";
    const fit = chosen === "" ? undefined : offered[Number(chosen)];

    return (
        <>
            <select
                id="remodelTo"
                aria-label="Remodel to"
                title="What they are built to; choose another and Remodel to refit them, their robots building it as they fight on"
                value={chosen}
                disabled={offered.length === 0}
                onChange={(event) => setChosen(event.target.value)}
            >
                <option value="">{current}</option>
                {offered.map(({ choice, kept, of, bay }, n) => (
                    <option key={choice.label} value={n}>
                        {`${choice.label} · keeps ${Math.round((100 * kept) / Math.max(1, of))}%${bay ? "" : " · ⚠ no robot bay"}`}
                    </option>
                ))}
            </select>
            {state.crewed && (
                <button
                    id="remodel"
                    title="Refit them to the design chosen"
                    disabled={fit === undefined}
                    onClick={() =>
                        fit !== undefined && view.issue({ kind: "remodel", ships: [...state.picked], blueprint: fit.choice.blueprint })
                    }
                >
                    Remodel
                </button>
            )}
            {fit !== undefined && !fit.bay && (
                <Warn>⚠ It has no robot bay: the old bays stay until the end, so the remodel can never be finished.</Warn>
            )}
        </>
    );
}
