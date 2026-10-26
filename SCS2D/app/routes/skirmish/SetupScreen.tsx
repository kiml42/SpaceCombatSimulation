import { styled } from "@linaria/react";
import { useEffect, useEffectEvent, useState } from "react";
import { SettingFields } from "~/features/settings/SettingFields";
import { useStorage } from "~/features/storage/StorageContext";
import { useLibrary } from "~/features/storage/useLibrary";
import { kg } from "~/editor/budget";
import { buildTime } from "~/editor/stats";
import { DEFAULT_SKIRMISH_SETTINGS, parseSkirmishSettings, type SkirmishSettings } from "~/scenarios/skirmish";
import type { Budget, Fleet } from "~/sim/index";
import { Button } from "~/ui/buttons/Button";
import { Figures } from "../ship/ShipReport";
import { readSettings, SETTINGS_KEY, SETUP_FIELDS, settingsTexts } from "./skirmishFields";
import { EMPTY, FleetChoices } from "./FleetChoices";

const Screen = styled.section`
    flex: 1.4;
    min-width: 0;
    padding: 0.7rem 0.9rem 2rem;
    overflow-y: auto;
    border-right: 1px solid var(--colour-border);

    h2 {
        display: inline-block;
        margin: 0.8rem 0 0.4rem;
        color: var(--colour-muted);
        font-size: var(--font-size-small);
        font-weight: 400;
        letter-spacing: 0.08em;
        text-transform: uppercase;
    }

    select {
        width: 100%;
        margin-bottom: 0.3rem;
    }

    summary {
        cursor: pointer;
    }

    p {
        margin: 0.3rem 0 0;
        color: var(--colour-faint);
    }

    @media (width <= 800px) {
        border-right: none;
        border-bottom: 1px solid var(--colour-border);
    }
`;

const Cards = styled.div`
    column-gap: 1.6rem;
    columns: 16rem;

    > details {
        padding-bottom: 0.6rem;
        break-inside: avoid;
    }
`;

const Buttons = styled.div`
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    margin: 0.5rem 0;

    > button {
        flex: 1;
    }
`;

const Budget = styled.label`
    display: grid;
    grid-template-columns: 7.5rem 1fr;
    gap: 0.3rem;
    align-items: center;
    margin-bottom: 0.25rem;
    color: var(--colour-muted);
`;

/** The budget boxes in tonnes and hours, as a big fleet's bill reads. */
const UNITS: Record<keyof Budget, number> = { metal: 1000, fuel: 1000, build: 3600 };
const BUDGET_ROWS: readonly { key: keyof Budget; label: string; title: string }[] = [
    { key: "metal", label: "metal t", title: "Hull, fittings and the metal in its holds" },
    { key: "fuel", label: "fuel t", title: "The fuel in its tanks as it sets out" },
    { key: "build", label: "build h", title: "How long one robot would take to build every module" },
];
const shownCost = (cost: Budget | null, key: keyof Budget): string =>
    cost === null ? "" : String(Math.round((cost[key] / UNITS[key]) * 100) / 100);

/** The settings kept from the last skirmish set up, or the defaults. */
export function keptSettings(storage: Pick<Storage, "getItem">): SkirmishSettings {
    try {
        const raw = storage.getItem(SETTINGS_KEY);
        return raw === null ? DEFAULT_SKIRMISH_SETTINGS : parseSkirmishSettings(JSON.parse(raw));
    } catch {
        return DEFAULT_SKIRMISH_SETTINGS;
    }
}

export interface SetupScreenProps {
    /** The enemy chosen and what it costs, or null where it would not fly; shown alone beside the setup. */
    readonly onEnemy: (enemy: Fleet | null) => void;
    /** What the enemy costs, exactly, behind boxes showing it rounded; null where it would not fly. */
    readonly enemyCost: Budget | null;
    readonly read: (value: string) => Fleet | null;
    readonly onStart: (
        enemyValue: string,
        playerValue: string,
        settings: SkirmishSettings,
        budget: (cost: Budget) => Budget,
        name: string,
    ) => void;
}

/** Choose an enemy, a budget, the settings and a fleet to start from, and start a skirmish. */
export function SetupScreen({ onEnemy, enemyCost, read, onStart }: SetupScreenProps) {
    const storage = useStorage();
    const { ships, fleets } = useLibrary();
    const [texts, setTexts] = useState(() => settingsTexts(keptSettings(storage)));
    const firstEnemy = `fleet:${fleets.list()[0]?.name ?? ""}`;
    const [enemy, setEnemy] = useState(firstEnemy);
    const [player, setPlayer] = useState(EMPTY);
    const [name, setName] = useState("");
    // Each box's text, and what was put in it from the enemy's cost: a box still showing that follows the enemy.
    const [budget, setBudget] = useState<Record<keyof Budget, string>>({ metal: "", fuel: "", build: "" });
    const [followed, setFollowed] = useState<Record<keyof Budget, string>>({ metal: "", fuel: "", build: "" });
    const [costShown, setCostShown] = useState<Budget | null | undefined>(undefined);
    // The enemy first chosen, shown alone as the screen opens.
    const shown = useEffectEvent(() => onEnemy(read(enemy)));
    useEffect(() => shown(), []);

    // The enemy's cost has changed: every box still following it, or blank, takes the new one.
    if (costShown !== enemyCost) {
        setCostShown(enemyCost);
        const nextBudget = { ...budget };
        const nextFollowed = { ...followed };
        for (const { key } of BUDGET_ROWS) {
            if (budget[key].trim() !== "" && budget[key] !== followed[key]) continue;
            nextBudget[key] = shownCost(enemyCost, key);
            nextFollowed[key] = nextBudget[key];
        }
        setBudget(nextBudget);
        setFollowed(nextFollowed);
    }

    const keep = (next: Record<string, string>): void => {
        setTexts(next);
        try {
            storage.setItem(SETTINGS_KEY, JSON.stringify(readSettings(next)));
        } catch {
            // Storage full or refused: they last as long as the page.
        }
    };
    const matchEnemy = (): void => {
        const all = { metal: shownCost(enemyCost, "metal"), fuel: shownCost(enemyCost, "fuel"), build: shownCost(enemyCost, "build") };
        setBudget(all);
        setFollowed(all);
    };
    /** The budget the boxes say: one left as the enemy's cost is that cost exactly, and one blank or unreadable too. */
    const readBudget = (cost: Budget): Budget => {
        const out = { ...cost };
        for (const { key } of BUDGET_ROWS) {
            const raw = budget[key].trim();
            const n = raw === "" ? NaN : Number(raw);
            if (raw !== followed[key] && Number.isFinite(n)) out[key] = Math.max(0, n) * UNITS[key];
        }
        return out;
    };

    const card = (key: string, title: string, groups: readonly string[], note: string, open = true) => (
        <details open={open} data-key={key}>
            <summary>
                <h2>{title}</h2>
            </summary>
            {groups.map((group) => (
                <SettingFields
                    key={group}
                    fields={SETUP_FIELDS}
                    group={group}
                    values={texts}
                    onChange={(name, text) => keep({ ...texts, [name]: text })}
                />
            ))}
            <p>{note}</p>
        </details>
    );

    return (
        <Screen id="setupScreen">
            <Cards>
                <details open data-key="skirmish">
                    <summary>
                        <h2>New skirmish</h2>
                    </summary>
                    <p>Pick an enemy and a budget, then build a fleet within it that beats it.</p>
                    <Budget title="What the skirmish is called, which its exported files are named for">
                        name
                        <input
                            id="skirmishNameNew"
                            type="text"
                            placeholder="skirmish"
                            value={name}
                            onChange={(event) => setName(event.target.value)}
                        />
                    </Budget>
                    <h2>Enemy</h2>
                    <FleetChoices
                        id="enemy"
                        label="Enemy"
                        ships={ships}
                        fleets={fleets}
                        value={enemy}
                        onChange={(value) => {
                            setEnemy(value);
                            onEnemy(read(value));
                        }}
                    />
                    <Figures id="enemyBill">
                        {enemyCost !== null && (
                            <tbody>
                                <tr>
                                    <th>metal</th>
                                    <td>{kg(enemyCost.metal)}</td>
                                </tr>
                                <tr>
                                    <th>fuel</th>
                                    <td>{kg(enemyCost.fuel)}</td>
                                </tr>
                                <tr>
                                    <th>build</th>
                                    <td>{buildTime(enemyCost.build)}</td>
                                </tr>
                            </tbody>
                        )}
                    </Figures>
                    <h2>Your budget</h2>
                    {BUDGET_ROWS.map(({ key, label, title }) => (
                        <Budget key={key} title={title}>
                            {label}
                            <input
                                id={`${key}Budget`}
                                type="number"
                                min={0}
                                step="any"
                                value={budget[key]}
                                onChange={(event) => setBudget({ ...budget, [key]: event.target.value })}
                            />
                        </Budget>
                    ))}
                    <Buttons>
                        <Button id="matchEnemy" title="Set the budget to what the enemy cost" onClick={matchEnemy}>
                            Match the enemy
                        </Button>
                    </Buttons>
                    <SettingFields
                        fields={SETUP_FIELDS}
                        group="limits"
                        values={texts}
                        onChange={(name, text) => keep({ ...texts, [name]: text })}
                    />
                    <h2>Your fleet</h2>
                    <FleetChoices
                        id="startFleet"
                        label="Your fleet"
                        ships={ships}
                        fleets={fleets}
                        value={player}
                        onChange={setPlayer}
                        empty
                    />
                    <Buttons>
                        <Button id="start" variant="primary" onClick={() => onStart(enemy, player, readSettings(texts), readBudget, name)}>
                            Start
                        </Button>
                        <Button
                            id="resetSettings"
                            title="Put every setting back to its default, and the budget to what the enemy cost; the enemy and your fleet stay as chosen"
                            onClick={() => {
                                keep(settingsTexts(DEFAULT_SKIRMISH_SETTINGS));
                                matchEnemy();
                            }}
                        >
                            Reset to defaults
                        </Button>
                    </Buttons>
                    <p>The settings are kept with the skirmish, so one already going is played out under those it started with.</p>
                </details>
                {card(
                    "round",
                    "The round",
                    ["round"],
                    "How a round is set out, and when a battle is over. A draw is a loss for you. A ± draws each round's figure afresh, the same for every try of it, so neither side can count on one opening.",
                )}
                {card(
                    "asteroids",
                    "Asteroids",
                    ["map"],
                    "What each round is fought among, drawn afresh for it from its seed: the same for every try of it, and where the enemy is bred to answer it. A ± draws each round's figure from the range. No majors and no minors is none.",
                    false,
                )}
                {card(
                    "answer",
                    "The enemy's answer",
                    ["answer"],
                    "Win a round and the enemy is bred against your fleet until one of its mutants beats it, on the next round's seed, a new one, and the others.",
                )}
                {card(
                    "shipMutations",
                    "Ship mutations",
                    ["build", "kinds"],
                    "How often each sort of number in a ship's build changes, against each other and the doctrine weights; and the relative odds of each kind, when a module is added or refitted into something else. Hover one for what it is.",
                )}
                {card(
                    "fleetMutations",
                    "Fleet mutations",
                    ["fleet"],
                    "Relative odds of each change to the enemy fleet; hover one for what it does.",
                )}
                {card(
                    "doctrineMutations",
                    "Doctrine mutations",
                    ["doctrine"],
                    "How often each part of a ship's doctrine changes, against a number in its build at 1.",
                )}
            </Cards>
        </Screen>
    );
}
