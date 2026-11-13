import { styled } from "@linaria/react";
import { useEffect, useEffectEvent, useState } from "react";
import { SettingFields } from "~/features/settings/SettingFields";
import { useStorage } from "~/features/storage/StorageContext";
import { useLibrary } from "~/features/storage/useLibrary";
import { kg } from "~/editor/budget";
import { buildTime } from "~/editor/stats";
import { DEFAULT_SKIRMISH_SETTINGS, parseSkirmishSettings, type SkirmishSettings } from "~/scenarios/skirmish";
import { fleetHulls, type Budget, type Fleet } from "~/sim/index";
import { Button } from "~/ui/buttons/Button";
import { Figures } from "../ship/ShipReport";
import { readSettings, SETTINGS_KEY, SETUP_FIELDS, settingsTexts } from "./skirmishFields";
import { EMPTY, FleetChoices } from "./FleetChoices";
import {
    BATTLEFIELD_PRESETS,
    ENEMY_PRESETS,
    withBattlefield,
    withEnemyPreset,
    type BattlefieldPreset,
    type EnemyPreset,
} from "./skirmishPresets";

const Screen = styled.section`
    flex: 1.4;
    min-width: 0;
    padding: 1rem 1.2rem 2rem;
    overflow-y: auto;
    border-right: 1px solid var(--colour-border);

    h1 {
        margin: 0;
        color: var(--colour-heading);
        font-size: 1.3rem;
        font-weight: 600;
    }

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
    }

    summary {
        cursor: pointer;
    }

    /* No more specific than a class, so the styled paragraphs below set their own margins. */
    :where(p) {
        margin: 0.3rem 0 0;
        color: var(--colour-muted);
    }

    @media (width <= 800px) {
        border-right: none;
        border-bottom: 1px solid var(--colour-border);
    }
`;

const Intro = styled.p`
    margin: 0.4rem 0 1.2rem;
`;

/** A section of the setup that opens to show more, set apart from the rest. */
const Section = styled.details`
    margin-top: 1rem;
    padding-top: 0.6rem;
    border-top: 1px solid var(--colour-border);

    > summary h2 {
        margin: 0;
        color: var(--colour-heading);
        font-weight: 600;
    }

    > p:first-of-type {
        margin-bottom: 0.6rem;
    }
`;

const Cards = styled.div`
    column-gap: 1.6rem;
    columns: 16rem;

    > details,
    > div {
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

const Field = styled.label`
    display: grid;
    grid-template-columns: 7.5rem 1fr;
    gap: 0.3rem;
    align-items: center;
    margin-bottom: 0.25rem;
    color: var(--colour-muted);
`;

/** What a choice above it means, under its box. */
const Hint = styled.p`
    margin: 0 0 0.7rem 7.8rem;
    font-size: var(--font-size-small);
`;

const Start = styled.div`
    margin: 1.2rem 0 0.4rem;

    > button {
        width: 100%;
        padding: 0.5rem;
        font-size: 1rem;
    }

    > p {
        margin-top: 0.4rem;
    }
`;

/** A way in for those who have a skirmish file, out of the way of those who do not. */
const Quiet = styled.button`
    padding: 0;
    border: none;
    background: none;
    color: var(--colour-link);
    text-decoration: underline;
    cursor: pointer;
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
    /** Ask for a skirmish file to load in place of this setup. */
    readonly onImport: () => void;
}

/** The enemy preset these settings and this enemy are, or undefined: custom. */
function enemyPresetOf(enemy: string, settings: SkirmishSettings): EnemyPreset | undefined {
    return ENEMY_PRESETS.find((preset) => preset.enemy === enemy && preset.maxShips === settings.maxShips);
}

/** The battlefield preset these settings are, or undefined: custom. */
function battlefieldOf(settings: SkirmishSettings): BattlefieldPreset | undefined {
    const now = JSON.stringify(settingsTexts(settings));
    return BATTLEFIELD_PRESETS.find((preset) => JSON.stringify(settingsTexts(withBattlefield(settings, preset))) === now);
}

/** A fleet's name, from its value in the list of fleets: "fleet:Line of Battle" is Line of Battle. */
const nameOf = (value: string): string => value.slice(value.indexOf(":") + 1);

/** What a skirmish set up so is called until the player names it: "Small ships in an asteroid field". */
function suggestedName(enemy: string, settings: SkirmishSettings): string {
    const against = enemyPresetOf(enemy, settings)?.name ?? nameOf(enemy);
    return `${against} in ${battlefieldOf(settings)?.place ?? "a battlefield of your own"}`;
}

/** The settings kept from the last skirmish set up, against the enemy they suit; on a first visit, the first presets. */
function opening(storage: Pick<Storage, "getItem">): { enemy: string; settings: SkirmishSettings } {
    const first = ENEMY_PRESETS[0]!;
    let stored: string | null = null;
    try {
        stored = storage.getItem(SETTINGS_KEY);
    } catch {
        // Unreadable: a first visit.
    }
    if (stored === null) return { enemy: first.enemy, settings: withEnemyPreset(DEFAULT_SKIRMISH_SETTINGS, first) };
    const kept = keptSettings(storage);
    return { enemy: (ENEMY_PRESETS.find((preset) => preset.maxShips === kept.maxShips) ?? first).enemy, settings: kept };
}

/** Choose an enemy, a battlefield and a budget, and start a skirmish, whose fleet is built next in the fleet editor. */
export function SetupScreen({ onEnemy, enemyCost, read, onStart, onImport }: SetupScreenProps) {
    const storage = useStorage();
    const { ships, fleets } = useLibrary();
    const [start] = useState(() => opening(storage));
    const [texts, setTexts] = useState(() => settingsTexts(start.settings));
    const [enemy, setEnemy] = useState(start.enemy);
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

    const settings = readSettings(texts);
    const enemyPreset = enemyPresetOf(enemy, settings);
    const battlefield = battlefieldOf(settings);
    const suggested = suggestedName(enemy, settings);
    // The enemy keeps every ship it starts with, past the limit (`enemyLimits`); the player is held to it.
    const enemyFleet = read(enemy);
    const enemyShips = enemyFleet === null ? 0 : fleetHulls(enemyFleet).length;
    const shipCount = (n: number): string => `${n} ship${n === 1 ? "" : "s"}`;

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
    const shownBudget = enemyCost === null ? null : readBudget(enemyCost);

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
                    onChange={(field, text) => keep({ ...texts, [field]: text })}
                />
            ))}
            <p>{note}</p>
        </details>
    );

    return (
        <Screen id="setupScreen">
            <h1>New skirmish</h1>
            <Intro>
                Pick an enemy and a battlefield, then build a fleet within the budget that beats it. Win, and the enemy evolves to beat you
                back.
            </Intro>
            <Field>
                Enemy
                <select
                    id="enemyPreset"
                    value={enemyPreset?.name ?? ""}
                    onChange={(event) => {
                        const preset = ENEMY_PRESETS.find((p) => p.name === event.target.value);
                        if (preset === undefined) return;
                        setEnemy(preset.enemy);
                        onEnemy(read(preset.enemy));
                        keep(settingsTexts(withEnemyPreset(settings, preset)));
                        // Blank boxes follow the enemy's cost as it comes in.
                        setBudget({ metal: "", fuel: "", build: "" });
                        setFollowed({ metal: "", fuel: "", build: "" });
                    }}
                >
                    {enemyPreset === undefined && <option value="">Custom</option>}
                    {ENEMY_PRESETS.map((preset) => (
                        <option key={preset.name} value={preset.name}>
                            {preset.name}
                        </option>
                    ))}
                </select>
            </Field>
            <Hint id="enemyHint">
                {enemyPreset?.hint ??
                    (enemyShips > settings.maxShips
                        ? `Against ${nameOf(enemy)}, which keeps its ${shipCount(enemyShips)}; you may field ${settings.maxShips}`
                        : `Against ${nameOf(enemy)}, ${shipCount(settings.maxShips)} a side at most`)}
            </Hint>
            <Field>
                Battlefield
                <select
                    id="battlefieldPreset"
                    value={battlefield?.name ?? ""}
                    onChange={(event) => {
                        const preset = BATTLEFIELD_PRESETS.find((p) => p.name === event.target.value);
                        if (preset !== undefined) keep(settingsTexts(withBattlefield(settings, preset)));
                    }}
                >
                    {battlefield === undefined && <option value="">Custom</option>}
                    {BATTLEFIELD_PRESETS.map((preset) => (
                        <option key={preset.name} value={preset.name}>
                            {preset.name}
                        </option>
                    ))}
                </select>
            </Field>
            <Hint id="battlefieldHint">{battlefield?.hint ?? "Your own settings, under Advanced settings below"}</Hint>
            <Field title="What the skirmish is called, which its exported files are named for">
                Name
                <input
                    id="skirmishNameNew"
                    type="text"
                    placeholder={suggested}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                />
            </Field>
            <Start>
                <Button
                    id="start"
                    variant="primary"
                    onClick={() => onStart(enemy, EMPTY, settings, readBudget, name.trim() === "" ? suggested : name)}
                >
                    Start: build your fleet
                </Button>
                <p id="startNote">
                    Next, build your fleet in the fleet editor
                    {shownBudget === null
                        ? "."
                        : ` within a budget of ${kg(shownBudget.metal)} metal, ${kg(shownBudget.fuel)} fuel and ${buildTime(shownBudget.build)} of building.`}{" "}
                    The enemy, {nameOf(enemy)}, is shown on the right.
                </p>
            </Start>
            <p>
                <Quiet
                    id="importSkirmish"
                    type="button"
                    onClick={onImport}
                    title="Load a skirmish file: its settings, and the skirmish and matches it holds"
                >
                    Load a saved skirmish…
                </Quiet>
            </p>
            <Section id="advanced" data-key="customise">
                <summary>
                    <h2>Customise</h2>
                </summary>
                <p>Any enemy from your library, and a budget of your own.</p>
                <h2>Enemy fleet</h2>
                <FleetChoices
                    id="enemy"
                    label="Enemy fleet"
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
                    <Field key={key} title={title}>
                        {label}
                        <input
                            id={`${key}Budget`}
                            type="number"
                            min={0}
                            step="any"
                            value={budget[key]}
                            onChange={(event) => setBudget({ ...budget, [key]: event.target.value })}
                        />
                    </Field>
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
                    onChange={(field, text) => keep({ ...texts, [field]: text })}
                />
            </Section>
            <Section id="evolutionSettings" data-key="evolution">
                <summary>
                    <h2>Advanced settings</h2>
                </summary>
                <p>
                    How the rounds are fought and how the enemy is bred, which the battlefield sets. They are kept with the skirmish, so one
                    already going is played out under those it started with.
                </p>
                <Cards>
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
            </Section>
        </Screen>
    );
}
