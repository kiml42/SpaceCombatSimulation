import { styled } from "@linaria/react";
import { useEffect, useEffectEvent, useMemo, useReducer, useRef, useState } from "react";
import { BattleCanvas } from "~/features/battle/BattleCanvas";
import { useStorage } from "~/features/storage/StorageContext";
import { useLibrary } from "~/features/storage/useLibrary";
import { useViewSettings } from "~/features/storage/useViewSettings";
import { nextName, toFileText, type Library } from "~/editor/library";
import { parseRunConfig, runConfigWarnings, serialiseRunConfig, type RunSetup } from "~/evolution/configFile";
import { isFleet, Match, planned, type Entrant } from "~/evolution/match";
import { parseRunRecord, RecordedRun, winsIn } from "~/evolution/recorded";
import type { MatchRecord } from "~/evolution/run";
import { breedOpening } from "./openingWorker";
import { latest, yardstickMatch } from "~/evolution/yardstick";
import type { BattleView } from "~/host/battleView";
import { designOf, LiveRun, type RunControl } from "~/host/evolutionRun";
import { BATTLE_KEYS } from "~/host/keyHelp";
import type { ViewSettings } from "~/host/viewSettings";
import { sidesOf, teamColour } from "~/render/teams";
import { serialiseBlueprint, serialiseFleet, type Blueprint, type Fleet } from "~/sim/index";
import { Button, ToggleButton } from "~/ui/buttons/Button";
import { KeyHelp } from "~/ui/dialogs/KeyHelp";
import { Combatants, SCORE_COLUMNS } from "./Combatants";
import {
    coevolutionOf,
    configOf,
    coRun,
    DEFAULT_TEXTS,
    defaultForm,
    effortOf,
    formOfHeld,
    formOfSetup,
    heldOf,
    pickOf,
    SETUP_KEY,
    setupOf,
    valueOf,
    type SetupForm,
} from "./evolutionSetup";
import { OWN_FINAL, Results } from "./Results";
import { RunCharts } from "./RunCharts";
import { RunDriver } from "./runDriver";
import { startEvolution } from "./runWorker";
import {
    champions,
    doctrineMoved,
    entrantById,
    finalists,
    inRounds,
    markedGeneration,
    pointLabel,
    scoreSeries,
    showing,
    sizeDigits,
    sizeSeries,
    timeline,
    twoSided,
    unfought,
    type AnyRun,
    type MassOf,
    type Row,
    type SizeMetric,
} from "./runView";
import { SetupScreen } from "./SetupScreen";
import { Pictures, Viewing, type Replay } from "./viewing";

const PAGE = "evolution";
// Team colours on here and off on the viewer: a run is watched to see who is doing what.
const DEFAULTS: ViewSettings = { arcs: "none", teamShots: true, strips: true, speed: 1 };
const SPEEDS = [0.25, 0.5, 1, 2, 4, 8, 16];
const KEYS = [...BATTLE_KEYS, { keys: "N", does: "Put another match on" }];
const NOTES = [
    "A run is decided entirely by its seed: the same settings give the same run, and any match in it can be fought again from the record.",
];
/** How long the settings must sit still before the preview is built again, ms. */
const PREVIEW_DELAY_MS = 300;
/** How often the panels are redrawn from the run, ms: they are a page of DOM, and the run is what the frame is for. */
const SAMPLE_MS = 200;
const MEASURE_INTRO =
    "Every design of every generation, one against one against the same opponent under the same seeds — the one number here that means " +
    "the same thing in generation one and generation four hundred. Fought afterwards and never during, or a run would learn to beat that one opponent.";

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

    > span {
        display: inline-flex;
        gap: 0.2rem;
        margin-right: 0.6rem;
    }
`;

const Body = styled.div`
    display: flex;
    flex: 1;
    min-height: 0;

    @media (width <= 1100px) {
        flex-direction: column;
        overflow-y: auto;
    }
`;

const Middle = styled.section`
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
`;

const Top = styled.div`
    padding: 0.7rem 0.9rem 0;
`;

const Bar = styled.div`
    height: 4px;
    margin-bottom: 0.4rem;
    overflow: hidden;
    border-radius: 2px;
    background: #16202e;

    > div {
        height: 100%;
        background: var(--colour-ok);
        transition: width 0.1s linear;
    }
`;

const Readout = styled.p`
    margin: 0 0 0.6rem;
    color: #7f93aa;

    &.warn {
        color: #e6a45b;
    }
`;

const ViewBar = styled.div`
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    align-items: center;
    padding: 0.4rem 0;

    > span {
        display: inline-flex;
        flex-wrap: wrap;
        gap: 0.4rem;
        align-items: center;
    }

    > span:last-child {
        flex: 1;
    }
`;

const ViewWrap = styled.div`
    position: relative;
    display: flex;
    flex: 1;
    min-height: 12rem;

    @media (width <= 1100px) {
        min-height: 20rem;
    }
`;

/** Over the battle, in a corner the camera keeps clear, and out of the way of the pointer. */
const Scores = styled.div`
    position: absolute;
    top: 0.5rem;
    left: 0.5rem;
    padding: 0.3rem 0.5rem;
    border-radius: 4px;
    background: #0b0f15cc;
    font-size: 0.8rem;
    pointer-events: none;

    table {
        border-collapse: collapse;
        font-variant-numeric: tabular-nums;
    }

    th,
    td {
        padding: 0 0.6rem 0 0;
        font-weight: normal;
        text-align: right;
    }

    th:first-child,
    td:first-child {
        text-align: left;
    }

    .hull {
        color: #7fd6a0;
    }

    .func {
        color: #b48ee0;
    }

    .dmg {
        color: #e0655f;
    }

    .dis {
        color: #e08ec0;
    }

    .grnd {
        color: #e9c05f;
    }
`;

const Footer = styled.footer`
    padding: 0.4rem 0.9rem;
    border-top: 1px solid var(--colour-border);
`;

function download(name: string, text: string): void {
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    URL.revokeObjectURL(url);
}

const fleetFileText = (fleet: Fleet): string => `${JSON.stringify(serialiseFleet(fleet), null, 2)}\n`;

/** Save a ship or fleet as a file named for it. */
function exportEntrant(entrant: Entrant): void {
    download(
        `${entrant.name.replace(/[^\w.-]+/g, "_")}${isFleet(entrant) ? ".fleet.json" : ".ship.json"}`,
        isFleet(entrant) ? fleetFileText(entrant) : toFileText(entrant),
    );
}

/** A founder or benchmark by its option's value, or null where it is missing or unreadable. */
function loadChoice(value: string, ships: Library<Blueprint>, fleets: Library<Fleet>): Entrant | null {
    const { kind, name } = pickOf(value);
    try {
        return kind === "fleet" ? fleets.load(name) : ships.load(name);
    } catch {
        // An unreadable saved file is left out, as a missing one is.
        return null;
    }
}

/**
 * A founder from a settings file, as the library holds it: the copy under its
 * name if that is the same design, else saved, under the next free name if its
 * own holds a different one. Its option's value; a renaming is said in `renamed`.
 */
function adopt(entrant: Entrant, ships: Library<Blueprint>, fleets: Library<Fleet>, renamed: string[]): string {
    const fleet = isFleet(entrant);
    const text = (e: Entrant): string => JSON.stringify(isFleet(e) ? serialiseFleet(e) : serialiseBlueprint(e));
    let name = entrant.name;
    for (;;) {
        let kept: Entrant | null | undefined;
        try {
            kept = fleet ? fleets.load(name) : ships.load(name);
        } catch {
            // Unreadable: taken, and not to be saved over.
            kept = undefined;
        }
        const named = { ...entrant, name };
        if (kept === null) {
            if (isFleet(named)) fleets.save(named);
            else ships.save(named);
            break;
        }
        if (kept !== undefined && text(kept) === text(named)) break;
        name = nextName(name);
    }
    if (name !== entrant.name) renamed.push(`"${entrant.name}" as "${name}"`);
    return valueOf(fleet ? "fleet" : "ship", name);
}

/**
 * The evolution route: set a run going, watch what it is doing, and fight any
 * match in it again. Setting a run up and watching it are two screens: the
 * settings have the width to themselves, and a run has it for its charts,
 * combatants and matches.
 */
export function EvolutionPage() {
    const storage = useStorage();
    const { ships, fleets } = useLibrary();
    const [settings, keepView] = useViewSettings(PAGE, DEFAULTS);
    const [form, setFormState] = useState<SetupForm>(() => {
        const kept = formOfHeld(storage.getItem(SETUP_KEY));
        const exists = (value: string): boolean => loadChoice(value, ships, fleets) !== null;
        const founders = kept.founders.filter(exists);
        const first = ships.list()[0];
        return {
            ...kept,
            founders: founders.length > 0 || first === undefined ? founders : [valueOf("ship", first.name)],
            versus: kept.versus.filter(exists),
        };
    });
    const formNow = useRef(form);
    const setForm = (next: SetupForm): void => {
        formNow.current = next;
        setFormState(next);
        try {
            storage.setItem(SETUP_KEY, JSON.stringify(heldOf(next)));
        } catch {
            // Storage being full or refused costs the settings, not the run.
        }
    };

    const [driver] = useState(() => new RunDriver());
    // The run is fought until the route goes, as it was when it was fought on the page.
    useEffect(() => () => driver.end(), [driver]);
    const run: AnyRun | null = driver.run;
    const [serial, setSerial] = useState(0);
    const [screen, setScreen] = useState<"setup" | "run">("setup");
    const [canRun, setCanRun] = useState(false);
    const [stopped, setStopped] = useState(true);
    const [mode, setModeState] = useState<"fleet" | "battle">("fleet");
    const [shown, setShown] = useState(-1);
    const [picked, setPicked] = useState(-1);
    const [metric, setMetric] = useState<SizeMetric>("mass");
    const [notice, setNotice] = useState({ text: "", warn: false });
    const [savedAs, setSavedAs] = useState<{ id: number; text: string } | null>(null);
    const [benchmark, setBenchmark] = useState(OWN_FINAL);
    const [measureNote, setMeasureNote] = useState(MEASURE_INTRO);
    const [running, setRunning] = useState(false);
    const [, sample] = useReducer((n: number) => n + 1, 0);

    const [viewing] = useState(() => new Viewing());
    const [pictures] = useState(() => new Pictures());
    const massOf: MassOf = (id, entrant) => pictures.of(id, entrant).mass;

    const founders = useMemo(
        () => form.founders.map((value) => loadChoice(value, ships, fleets)).filter((entrant) => entrant !== null),
        [form.founders, ships, fleets],
    );
    const rivals = useMemo(
        () => form.versus.map((value) => loadChoice(value, ships, fleets)).filter((entrant) => entrant !== null),
        [form.versus, ships, fleets],
    );
    const previewRows = useMemo((): Row[] => {
        const co = rivals.length > 0;
        return [...founders, ...rivals].map((entrant, k) => {
            const id = -(k + 1);
            return unfought(id, entrant, pictures.of(id, entrant).mass, co ? (k < founders.length ? 0 : 1) : undefined);
        });
    }, [founders, rivals, pictures]);

    // The first match Start would fight, rebuilt once the settings have sat still: it breeds a whole first generation.
    useEffect(() => {
        if (run !== null) return;
        const config = configOf(form);
        const co = rivals.length > 0;
        const coSettings = co ? coevolutionOf(form) : null;
        // How long the run goes on, and who breeds, do not change its opening.
        const opening = { ...config, generations: config.generations > 0, minMatches: 0, winners: 0 };
        const key = JSON.stringify([founders, rivals, opening, coSettings]);
        if (key === viewing.preview.key) return;
        // Bred in a worker, which takes seconds for two large fleets; the match is built here, to be shown.
        let breeding: { cancel(): void } | null = null;
        const timer = setTimeout(() => {
            breeding = breedOpening({ founders, rivals, config, coevolution: coSettings }, (plan) => {
                let match: Match | null = null;
                try {
                    match = plan === null ? null : planned(plan);
                } catch {
                    // A founder that will not compile has nothing to show.
                }
                viewing.setPreview(key, match);
                sample();
            });
        }, PREVIEW_DELAY_MS);
        return () => {
            clearTimeout(timer);
            breeding?.cancel();
        };
    }, [run, form, founders, rivals, viewing]);

    const setMode = (next: "fleet" | "battle"): void => {
        setModeState(next);
        if (next === "fleet") viewing.stop();
    };

    const watchReplay = (next: Replay): void => {
        // Asked for a battle, so show one: the battle view comes up showing it.
        if (!viewing.watch(next)) setMode("battle");
        sample();
    };

    const startReplay = (record: MatchRecord, rows: readonly Row[]): void => {
        const run = driver.run;
        if (run === null) return;
        const entrants: Entrant[] = [];
        for (const id of record.competitors) {
            const entrant = rows.find((candidate) => candidate.id === id)?.entrant ?? entrantById(run, id);
            if (entrant !== null) entrants.push(entrant);
        }
        // One is enough: a match of one ship is a run's test of its piloting.
        if (entrants.length === 0) return;
        if (entrants.length < record.competitors.length) {
            // Only a run read from a file can lack a design: a side B that did not evolve is not in it.
            viewing.cannot("can't fight that again: the run file does not hold every design in it");
            return;
        }
        const teams = record.teams !== undefined && record.teams.length === entrants.length ? record.teams : null;
        const match = new Match(entrants, { ...run.config.match, seed: record.seed }, teams, record.invulnerable ?? []);
        watchReplay({ match, record, ids: record.competitors, vs: null });
    };

    /**
     * Put on the most recently finished match of the run, whichever generation
     * is on show, or hold on the one being watched if nothing has finished
     * since: a run fights faster than anybody can watch, so this is a sample,
     * each the latest there is when the one before it ends.
     */
    const rollOn = (): void => {
        const run = driver.run;
        if (run === null) return;
        // The generation being fought has none yet just after it opens, so the newest may be the last of the one before it.
        let newest = showing(run, -1, massOf);
        if (newest.matches.length === 0 && newest.index > 0) newest = showing(run, newest.index - 1, massOf);
        const last = newest.matches[newest.matches.length - 1];
        if (last === undefined || last === viewing.replay?.record) return;
        startReplay(last, newest.rows);
    };

    /**
     * Give up on the match being watched and put another on: the next of the
     * generation on show or, if the run has not fought one yet, whatever it
     * finishes next.
     */
    const skipMatch = (): void => {
        const run = driver.run;
        if (run === null) return;
        const { rows, matches } = showing(run, shown, massOf);
        const at = viewing.replay?.record == null ? -1 : matches.indexOf(viewing.replay.record);
        // Round the list when there will be no later match: a finished or paused run is a fixed set.
        const next = matches[at + 1] ?? (run.done || driver.paused ? matches[0] : undefined);
        if (next !== undefined && next !== viewing.replay?.record) {
            startReplay(next, rows);
            return;
        }
        viewing.skip();
    };

    const frame = useEffectEvent((now: number, sampled: number): boolean => {
        driver.work(effortOf(formNow.current));
        const on = viewing.view;
        if (on !== null) {
            const r = viewing.replay;
            if (r === null || viewing.skipping || (on.running && r.match.done)) rollOn();
            const opening = viewing.preview.match;
            if (viewing.replay === null && driver.run === null && opening !== null && on.battle !== opening.battle) {
                on.show(opening.battle, false, false, [], () => opening.advance());
            }
        }
        // A generation picked off the chart shows on the next frame rather than at the next sample.
        const seek = viewing.takeSeek();
        if (seek !== null) {
            setShown(seek);
            sample();
            return true;
        }
        if (now - sampled < SAMPLE_MS) return false;
        sample();
        return true;
    });
    useEffect(() => {
        let request = 0;
        let sampled = 0;
        const tick = (now: number): void => {
            request = window.requestAnimationFrame(tick);
            if (frame(now, sampled)) sampled = now;
        };
        request = window.requestAnimationFrame(tick);
        return () => window.cancelAnimationFrame(request);
    }, []);

    // N for another match, while a battle is on show and nothing is being typed into: the page is mostly a form.
    const onKey = useEffectEvent((event: KeyboardEvent) => {
        const active = document.activeElement;
        if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement) return;
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        const run = driver.run;
        if ((event.key === "n" || event.key === "N") && run !== null && !(run.done && showing(run, shown, massOf).matches.length < 2))
            skipMatch();
    });
    useEffect(() => {
        if (mode !== "battle") return;
        const listener = (event: KeyboardEvent): void => onKey(event);
        window.addEventListener("keydown", listener);
        return () => window.removeEventListener("keydown", listener);
    }, [mode]);

    const onView = (next: BattleView | null): void => {
        if (next !== null) {
            next.keepView(PAGE, DEFAULTS);
            next.setSpeed(settings.speed);
        }
        viewing.setView(next);
    };

    const begin = (next: AnyRun, control: RunControl | null = null): void => {
        driver.begin(next, control);
        viewing.setPreview("", null);
        viewing.stop();
        setNotice({ text: "", warn: false });
        setSavedAs(null);
        setMeasureNote("Measure once there is something to measure.");
        pictures.clear();
        setShown(-1);
        setStopped(next.done);
        setSerial((n) => n + 1);
        sample();
    };

    const start = (): void => {
        if (founders.length === 0) {
            setNotice({ text: "Pick at least one ship or fleet to start from.", warn: true });
            return;
        }
        const config = configOf(form);
        const coevolution = rivals.length > 0 ? coevolutionOf(form) : null;
        const live = new LiveRun(config, coevolution);
        const control = startEvolution({ founders: founders.map(designOf), rivals: rivals.map(designOf), config, coevolution }, (wire) =>
            live.apply(wire),
        );
        begin(live, control);
        setCanRun(true);
        setScreen("run");
    };

    /** A run fought by `pnpm evolve`, from the file it wrote, shown as a finished run whose matches can be fought again. */
    const openRun = async (file: File): Promise<void> => {
        let opened: RecordedRun;
        try {
            opened = new RecordedRun(parseRunRecord(JSON.parse(await file.text())));
        } catch (error) {
            window.alert(`Could not read that run.\n\n${error instanceof Error ? error.message : error}`);
            return;
        }
        begin(opened);
        const fought = opened.generations.length + opened.rivalGenerations.length;
        setNotice({
            text:
                `${file.name}: ${fought} of ${opened.config.generations} generations` +
                `${fought < opened.config.generations ? ", stopped early" : ""}. Pick a match to fight it again.`,
            warn: false,
        });
        setCanRun(true);
        setScreen("run");
    };

    const exportConfig = (): void => {
        const setup = setupOf(form, founders, rivals);
        const name = setup.name === undefined ? "evolution-config" : setup.name.replace(/[^\w.-]+/g, "_");
        download(`${name}.evo.json`, `${JSON.stringify(serialiseRunConfig(setup), null, 2)}\n`);
    };

    const importConfig = async (file: File): Promise<void> => {
        const text = await file.text();
        let setup: RunSetup;
        let warnings: string[];
        try {
            const value: unknown = JSON.parse(text);
            setup = parseRunConfig(value);
            warnings = runConfigWarnings(value);
        } catch (error) {
            window.alert(`Could not read those settings.\n\n${error instanceof Error ? error.message : error}`);
            return;
        }
        const renamed: string[] = [];
        const adopted = [...setup.founders, ...(setup.fleets ?? [])].map((entrant) => adopt(entrant, ships, fleets, renamed));
        const versus = [...(setup.versus?.founders ?? []), ...(setup.versus?.fleets ?? [])].map((entrant) =>
            adopt(entrant, ships, fleets, renamed),
        );
        setForm(formOfSetup(setup, adopted, [...new Set(versus)], formNow.current));
        // Read anyway: a key nothing reads is said, not refused.
        setNotice({
            text:
                "Settings read from a file. Press Start when you are ready." +
                (renamed.length > 0
                    ? ` Founders that differ from the ones of the same name here are kept under other names: ${renamed.join(", ")}.`
                    : "") +
                (warnings.length > 0 ? ` Not read: ${warnings.join("; ")}.` : ""),
            warn: warnings.length > 0,
        });
    };

    const resetConfig = (): void => {
        const fresh = defaultForm(form.founders, form.versus);
        setForm({ ...fresh, texts: { ...DEFAULT_TEXTS, configName: form.texts["configName"] ?? "" } });
    };

    const saveChampion = (): void => {
        const best = champions(run);
        if (best.length === 0) return;
        for (const { entrant } of best) {
            if (isFleet(entrant)) fleets.save(entrant);
            else ships.save(entrant);
        }
        // Kept until there is a new best.
        setSavedAs({
            id: best[0]!.id,
            text: `saved as ${best.map(({ entrant }) => `"${entrant.name}"`).join(" and ")} — open ${best.length > 1 ? "them" : "it"} in the editor`,
        });
    };

    const chosenBenchmark = (): Entrant | null =>
        run === null ? null : benchmark === OWN_FINAL ? latest(run.record()) : loadChoice(benchmark, ships, fleets);

    const measure = (): void => {
        if (run === null || run.generations.length === 0) return;
        if (inRounds(run)) {
            driver.measureGrid();
            sample();
            return;
        }
        const against = chosenBenchmark();
        if (against === null) {
            setMeasureNote("Nothing to measure against yet.");
            return;
        }
        const before = driver.measure(against, isFleet(against) ? fleetFileText(against) : toFileText(against));
        setMeasureNote(
            before === undefined
                ? `Measuring against ${against.name}…`
                : `Measuring against ${against.name} from generation ${before.points.length + 1}…`,
        );
        sample();
    };

    /**
     * Watch the match the measurement fights for one design, the one picked in
     * the generation on show or its best, so a point on the yardstick line can
     * be looked at rather than taken on trust.
     */
    const watchYardstick = (): void => {
        if (run === null || run.generations.length === 0) return;
        const against = chosenBenchmark();
        if (against === null) return;
        const record = run.record();
        // Only a closed generation is measured, so the one being fought shows the one before it.
        const index = Math.min(showing(run, shown, massOf).index, record.generations.length - 1);
        const individuals = record.generations[index]!.individuals;
        let slot = individuals.findIndex((individual) => individual.id === picked);
        if (slot < 0) {
            slot = 0;
            for (let k = 1; k < individuals.length; k++) if (individuals[k]!.fitness > individuals[slot]!.fitness) slot = k;
        }
        watchReplay({ match: yardstickMatch(record, against, index, slot), record: null, ids: [individuals[slot]!.id], vs: against.name });
    };

    // ---- what the panels say, read from the run at each sample ----

    const now = run === null ? { index: 0, rows: previewRows, matches: [] as readonly MatchRecord[] } : showing(run, shown, massOf);
    const wins = winsIn(now.matches);
    const rows = now.rows.map((row) => {
        const of = wins.get(row.id);
        return of === undefined ? row : { ...row, wins: of };
    });
    const live = run !== null && !run.done && now.index >= timeline(run).length;
    const r = viewing.replay;
    const skipDisabled = run === null || (run.done && now.matches.length < 2);
    let longest = now.matches.length;
    for (const generation of run?.generations ?? []) longest = Math.max(longest, generation.matches.length);

    const tops = finalists(run);
    const top = tops[0] ?? null;
    const champion =
        top === null
            ? "—"
            : savedAs?.id === top.individual.id
              ? savedAs.text
              : tops
                    .map(
                        (each) =>
                            `${each.label}#${each.individual.id}, best of generation ${each.generation + 1}: ` +
                            `${each.individual.fitness.toFixed(3)} over ${each.individual.matches} matches, ` +
                            `${(each.individual.mass / 1000).toFixed(1)} t`,
                    )
                    .join(" · ");

    const gridShown = driver.grid?.report() ?? driver.gridResult;
    const points = driver.points;
    const yardstickLine =
        gridShown !== null
            ? driver.grid !== null
                ? `Fighting each side's champions against the other's, ${(driver.grid.progress * 100).toFixed(0)}%`
                : `${gridShown.matches} matches, ${gridShown.seeds} a cell. Down a column, later A against the same B; ` +
                  "along a row, later B against the same A. An arms race shades towards each side going down and across."
            : points !== undefined && points.length > 0
              ? (() => {
                    const first = points[0]!;
                    const last = points[points.length - 1]!;
                    const gain = last.mean - first.mean;
                    const where = driver.yardstick === null ? "" : ` · measuring, ${(driver.yardstick.progress * 100).toFixed(0)}%`;
                    return (
                        `generation ${first.generation + 1} scored ${first.mean.toFixed(3)}, ` +
                        `generation ${last.generation + 1} scored ${last.mean.toFixed(3)} ` +
                        `(${gain >= 0 ? "+" : ""}${gain.toFixed(3)}) · ${last.wins} of ${last.individuals} beat it${where}`
                    );
                })()
              : measureNote;

    const done = run === null ? 0 : run.generations.length + (twoSided(run) ? run.rivalGenerations.length : 0);
    let fought = 0;
    for (const generation of run?.generations ?? []) fought += generation.matches.length;
    if (twoSided(run)) for (const generation of run.rivalGenerations) fought += generation.matches.length;
    if (run !== null && !run.done) fought += run.played.length;
    const turn = twoSided(run) && run.alternates && !run.done ? `round ${run.round + 1}, side ${run.turn === 0 ? "A" : "B"} · ` : "";
    const readout =
        notice.text !== ""
            ? notice.text
            : run === null
              ? "Pick founders and press Start."
              : `${turn}generation ${Math.min(done + 1, run.config.generations)} of ${run.config.generations} · ` +
                `${fought} matches fought · ${(run.progress * 100).toFixed(0)}%`;
    const state =
        run === null ? "idle" : run instanceof RecordedRun ? "from a file" : run.done ? "finished" : driver.paused ? "paused" : "running";

    const watching =
        run === null
            ? mode === "battle"
                ? viewing.preview.match === null
                    ? "nothing to fight"
                    : "first match, unmutated"
                : `${previewRows.length} founders, unmutated`
            : mode !== "battle"
              ? `${rows.length} combatants of ${pointLabel(run, now.index)}`
              : viewing.skipping
                ? "skipped · waiting for the next match"
                : r !== null
                  ? `${[...r.ids, ...(r.vs === null ? [] : [r.vs])].join(" v ")} · ${(r.match.progress * 100).toFixed(0)}%${r.match.done ? " · over" : ""}`
                  : viewing.note || "pick a match from the list";

    // Each side's score in the battle on show, as the match would pay it if it ended now.
    const scored = mode !== "battle" ? null : (r?.match ?? (run === null ? viewing.preview.match : null));
    const scoreNames = scored !== null && scored === r?.match ? [...r.ids.map((id) => `#${id}`), ...(r.vs === null ? [] : [r.vs])] : [];

    const setupScreen = screen === "setup";
    return (
        <Main>
            <Controls>
                <span>
                    <ToggleButton
                        id="toSetup"
                        title="The settings a run starts from"
                        pressed={setupScreen}
                        onPressedChange={() => setScreen("setup")}
                    >
                        Setup
                    </ToggleButton>
                    <ToggleButton
                        id="toRun"
                        title="The run: its charts, its combatants and its matches"
                        disabled={!canRun}
                        pressed={!setupScreen}
                        onPressedChange={() => setScreen("run")}
                    >
                        Run
                    </ToggleButton>
                </span>
                <Button id="start" variant="primary" onClick={start}>
                    Start
                </Button>
                <Button
                    id="pause"
                    disabled={run === null || run.done}
                    onClick={() => {
                        driver.setPaused(!driver.paused);
                        sample();
                    }}
                >
                    {driver.paused ? "Resume" : "Pause"}
                </Button>
                <Button
                    id="stop"
                    disabled={run === null || stopped}
                    onClick={() => {
                        // Stopping keeps what was fought: the generations closed are a run.
                        if (run !== null && !run.done) driver.setPaused(true);
                        setStopped(true);
                    }}
                >
                    Stop
                </Button>
                <Button
                    id="openRun"
                    title="Show a run fought by pnpm evolve, from the .run.json file it wrote"
                    onClick={() => document.getElementById("openRunFile")?.click()}
                >
                    Open run
                </Button>
                <input
                    id="openRunFile"
                    type="file"
                    accept="application/json,.json"
                    hidden
                    onChange={(event) => {
                        const chosen = event.target.files?.[0];
                        event.target.value = "";
                        if (chosen !== undefined) void openRun(chosen);
                    }}
                />
                <output id="state">{state}</output>
            </Controls>
            <Body>
                <SetupScreen
                    hidden={!setupScreen}
                    form={form}
                    onForm={setForm}
                    ships={ships}
                    fleets={fleets}
                    onExport={exportConfig}
                    onImport={(file) => void importConfig(file)}
                    onReset={resetConfig}
                />
                <Middle>
                    <Top>
                        {!setupScreen && (
                            <Bar>
                                <div style={{ width: `${((run?.progress ?? 0) * 100).toFixed(1)}%` }} />
                            </Bar>
                        )}
                        <Readout id="readout" className={notice.warn ? "warn" : undefined}>
                            {readout}
                        </Readout>
                        {!setupScreen && (
                            <RunCharts
                                score={scoreSeries(run, points)}
                                showScore={!(coRun(form) && form.rivalEvolves)}
                                size={sizeSeries(run, metric)}
                                metric={metric}
                                onMetric={(next) => setMetric(next as SizeMetric)}
                                doctrineLabel={(key) => {
                                    const moved = doctrineMoved(run, key);
                                    return Number.isFinite(moved) ? `${key} (${moved >= 0 ? "+" : ""}${moved.toPrecision(2)})` : key;
                                }}
                                sizeKey={sizeDigits(metric)}
                                picked={markedGeneration(run, shown)}
                                label={(at) => pointLabel(run, at)}
                                onSeek={(at) => viewing.seek(at)}
                            />
                        )}
                        <ViewBar>
                            <label>
                                showing{" "}
                                <select id="mode" value={mode} onChange={(event) => setMode(event.target.value as "fleet" | "battle")}>
                                    <option value="fleet">the combatants</option>
                                    <option value="battle">a battle</option>
                                </select>
                            </label>
                            {mode === "battle" && (
                                <span>
                                    <Button
                                        id="play"
                                        title="Space"
                                        disabled={r === null}
                                        onClick={() => viewing.view?.setRunning(!viewing.view.running)}
                                    >
                                        {running ? "Pause" : "Play"}
                                    </Button>
                                    <Button id="step" title="Full stop" disabled={r === null} onClick={() => viewing.view?.step()}>
                                        Step
                                    </Button>
                                    <Button
                                        id="skip"
                                        title="Give up on this match and watch another (N)"
                                        disabled={skipDisabled}
                                        onClick={skipMatch}
                                    >
                                        Skip
                                    </Button>
                                    <Button id="fit" title="F" onClick={() => viewing.view?.fit()}>
                                        Fit
                                    </Button>
                                    <label>
                                        speed{" "}
                                        <select
                                            id="speed"
                                            value={settings.speed}
                                            onChange={(event) => {
                                                const speed = Number(event.target.value);
                                                keepView({ speed });
                                                viewing.view?.setSpeed(speed);
                                            }}
                                        >
                                            {SPEEDS.map((speed) => (
                                                <option key={speed} value={speed}>
                                                    {speed}x
                                                </option>
                                            ))}
                                        </select>
                                    </label>
                                </span>
                            )}
                            <span id="watching">{watching}</span>
                        </ViewBar>
                    </Top>
                    <ViewWrap>
                        {mode === "battle" ? (
                            <BattleCanvas id="view" onView={onView} onRunningChanged={setRunning}>
                                <Scores
                                    id="battleScores"
                                    hidden={scored === null}
                                    title="What each side would score if the match ended as it stands"
                                >
                                    {scored !== null && (
                                        <table>
                                            <tbody>
                                                <tr>
                                                    <th>side</th>
                                                    <th title="weighted total">score</th>
                                                    {SCORE_COLUMNS.map((column) => (
                                                        <th key={column.css} className={column.css} title={column.title}>
                                                            {column.head}
                                                        </th>
                                                    ))}
                                                </tr>
                                                {scored.result().scores.map((score, i) => {
                                                    // In the colour its ships are drawn in: its own, or its side's.
                                                    const { slots, owners, ships: fleet } = scored.battle;
                                                    const k = owners.indexOf(i);
                                                    const colour = teamColour(
                                                        k < 0 ? i : fleet.teamOf(slots[k]!),
                                                        sidesOf(scored.battle.liveries),
                                                    );
                                                    const parts = [
                                                        score.survival,
                                                        score.functional,
                                                        score.damage,
                                                        score.disabling,
                                                        score.race,
                                                    ];
                                                    return (
                                                        <tr key={i} style={{ color: colour }}>
                                                            {[
                                                                scoreNames[i] ?? String(i + 1),
                                                                score.total.toFixed(3),
                                                                ...parts.map((part) => part.toFixed(2)),
                                                            ].map((cell, c) => (
                                                                <td key={c} style={{ color: colour }}>
                                                                    {cell}
                                                                </td>
                                                            ))}
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    )}
                                </Scores>
                            </BattleCanvas>
                        ) : (
                            <Combatants
                                key={serial}
                                rows={rows}
                                empty={run === null ? "Pick founders to see them here." : "Nothing bred yet."}
                                picture={(row) => pictures.of(row.id, row.entrant)}
                                picked={picked}
                                onPick={setPicked}
                                // Named for its id too: a child keeps its parent's name, so a lineage would export as its founder over and over.
                                onExport={(row) =>
                                    exportEntrant(row.id < 0 ? row.entrant : { ...row.entrant, name: `${row.entrant.name} #${row.id}` })
                                }
                                owed={run?.config.minMatches ?? 0}
                            />
                        )}
                    </ViewWrap>
                </Middle>
                <Results
                    hidden={setupScreen}
                    generation={run === null ? null : now.index + 1}
                    fighting={live}
                    pinned={run !== null && shown >= 0}
                    onLatest={() => setShown(-1)}
                    matches={now.matches}
                    longest={longest}
                    watched={r?.record ?? null}
                    onWatch={(record) => startReplay(record, now.rows)}
                    champion={champion}
                    hasChampion={top !== null}
                    onSave={saveChampion}
                    onExport={() => {
                        for (const { entrant } of champions(run)) exportEntrant(entrant);
                    }}
                    ships={ships}
                    fleets={fleets}
                    benchmark={benchmark}
                    onBenchmark={setBenchmark}
                    inRounds={inRounds(run)}
                    canMeasure={top !== null && !driver.measuring}
                    onMeasure={measure}
                    onWatchYardstick={watchYardstick}
                    yardstickLine={yardstickLine}
                    grid={gridShown}
                />
            </Body>
            <Footer>
                <KeyHelp rows={KEYS} notes={NOTES} />
            </Footer>
        </Main>
    );
}
