import { styled } from "@linaria/react";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { BattleCanvas } from "~/features/battle/BattleCanvas";
import { Scrub } from "~/features/battle/Scrub";
import { useSampled } from "~/features/battle/useSampled";
import { AsteroidCard } from "~/features/battle/AsteroidCard";
import { DOCTRINE_KEY, DoctrinePanel } from "~/features/orders/DoctrinePanel";
import { OrderBar } from "~/features/orders/OrderBar";
import { useOrderState } from "~/features/orders/orderState";
import { useSkirmish } from "~/features/skirmish/SkirmishProvider";
import { useStorage } from "~/features/storage/StorageContext";
import { useLibrary } from "~/features/storage/useLibrary";
import { useViewSettings } from "~/features/storage/useViewSettings";
import { kg } from "~/editor/budget";
import { fleetRoute, handedSkirmish, shipFleet } from "~/editor/handoff";
import { unusedName } from "~/editor/library";
import { buildTime } from "~/editor/stats";
import type { AnswerProgress } from "~/host/answer";
import type { BattleView, Watcher } from "~/host/battleView";
import { BATTLE_KEYS, ORDER_KEYS } from "~/host/keyHelp";
import type { ViewSettings } from "~/host/viewSettings";
import { teamColour } from "~/render/canvas2d";
import { readLog, writeLog, type Logged } from "~/scenarios/commands";
import { customBattle, DEFAULT_SETUP, tally, type CustomBattle } from "~/scenarios/customBattle";
import { Activity, type Decision } from "~/scenarios/decision";
import { EMPTY_HISTORY, parseHistory, type History, type WrittenLog } from "~/scenarios/history";
import {
    billOfFleet,
    canFight,
    DEFAULT_SKIRMISH_SETTINGS,
    enemyMultiplier,
    fleetFault,
    lost,
    newSkirmish,
    nextRound,
    overLimit,
    parseSkirmish,
    parseSkirmishSettings,
    roundBattle,
    roundSetup,
    serialiseSkirmish,
    settingsOf,
    won,
    type Skirmish,
    type SkirmishSettings,
} from "~/scenarios/skirmish";
import type { Battle } from "~/scenarios/types";
import { serialiseFleet, type Budget, type Fleet, type Snapshot } from "~/sim/index";
import { Button } from "~/ui/buttons/Button";
import { EditLink } from "~/ui/buttons/EditButton";
import { KeyHelp } from "~/ui/dialogs/KeyHelp";
import { Figures } from "../ship/ShipReport";
import { EMPTY } from "./FleetChoices";
import { keptSettings, SetupScreen } from "./SetupScreen";
import { SETTINGS_KEY } from "./skirmishFields";
import { Timeline } from "./Timeline";

const PAGE = "skirmish";
const DEFAULTS: ViewSettings = { arcs: "none", teamShots: false, strips: true, speed: 1 };
const SPEEDS = [0.25, 0.5, 1, 2, 4, 8, 16];
const NOTES = [
    "You are blue.",
    "Once both sides have fired, a side that has not fired, hit or closed in to ram for the round's quiet time is out of the battle; one with nothing left armed is out at once.",
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

const Readout = styled.output`
    margin-left: auto;
    color: var(--colour-muted);
`;

const Body = styled.div`
    display: flex;
    flex: 1;
    min-height: 0;

    @media (width <= 800px) {
        flex-direction: column;
    }
`;

const Decided = styled.div`
    position: absolute;
    top: 0.7rem;
    left: 0.7rem;
    max-width: 22rem;
    padding: 0.45rem 0.7rem;
    border: 1px solid var(--colour-control-border);
    border-radius: 4px;
    background: rgb(11 15 22 / 85%);
    pointer-events: none;

    strong {
        display: block;
        font-size: 15px;
    }

    &.won strong {
        color: var(--colour-ok);
    }

    &.lost strong {
        color: var(--colour-danger);
    }

    span {
        color: var(--colour-muted);
    }
`;

const Panel = styled.aside`
    display: flex;
    flex-direction: column;
    width: 26rem;
    max-width: 45vw;
    padding: 0.7rem 0.9rem 1.5rem;
    overflow-y: auto;
    border-left: 1px solid var(--colour-border);

    h2 {
        margin: 1.1rem 0 0.4rem;
        color: var(--colour-muted);
        font-size: var(--font-size-small);
        font-weight: 400;
        letter-spacing: 0.08em;
        text-transform: uppercase;
    }

    h2:first-child {
        margin-top: 0;
    }

    p {
        margin: 0.3rem 0;
    }

    tr.over th,
    tr.over td {
        color: var(--colour-danger);
    }

    @media (width <= 800px) {
        width: auto;
        max-width: none;
        border-top: 1px solid var(--colour-border);
        border-left: none;
    }
`;

/* The history alone scrolls, given room for a match or so; on a screen with less, the whole panel does. */
const HistoryBox = styled.section`
    display: flex;
    flex: 1 1 0;
    flex-direction: column;
    min-height: 19rem;

    > * {
        flex: none;
    }
`;

const Muted = styled.p`
    color: var(--colour-muted);
`;

const Outcome = styled.p`
    margin: 0.8rem 0 0.3rem !important;
    font-size: 15px;

    &.won {
        color: var(--colour-ok);
    }

    &.lost {
        color: var(--colour-danger);
    }
`;

const Buttons = styled.div`
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    align-items: center;
    margin: 0.5rem 0;

    > * {
        flex: 1;
        text-align: center;
    }
`;

const Spinner = styled.span`
    display: inline-block;
    flex: none;
    width: 0.9rem;
    height: 0.9rem;
    margin-top: 0.15rem;
    border: 2px solid var(--colour-control-border);
    border-top-color: var(--colour-link);
    border-radius: 50%;
    animation: spin 0.9s linear infinite;

    @keyframes spin {
        to {
            transform: rotate(360deg);
        }
    }

    @media (prefers-reduced-motion: reduce) {
        animation-duration: 3s;
    }
`;

const Waiting = styled.div`
    display: flex;
    gap: 0.5rem;
    align-items: flex-start;

    p {
        margin: 0;
    }
`;

const Side = styled.div`
    display: flex;
    gap: 0.4rem;
    align-items: center;
    margin-top: 0.4rem;
    color: var(--colour-heading);

    span {
        flex: none;
        width: 0.8rem;
        height: 0.8rem;
        border-radius: 2px;
    }
`;

const SideStats = styled.div`
    padding-left: 1.2rem;
    color: var(--colour-muted);
`;

const Footer = styled.footer`
    padding: 0.4rem 0.9rem;
    border-top: 1px solid var(--colour-border);
`;

/** What is on the screen: the round, the best enemy so far fighting it, the answer it found, or a match watched again. */
type Mode = "round" | "watching" | "answer" | "replay";

const times = (m: number): string => `${Number(m.toFixed(3))}×`;

/** The enemy where it will stand, in its colour, with nobody yet on the other side. */
function enemyAlone(enemy: Fleet): CustomBattle {
    return customBattle({ ...DEFAULT_SETUP, fleets: [{ name: "", designs: {}, ships: [] }, enemy] });
}

function download(name: string, text: string): void {
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    URL.revokeObjectURL(url);
}

/**
 * The skirmish: pick an enemy, fight it a round at a time, and go to the fleet
 * editor and back between tries; win, and watch the enemy evolve an answer,
 * then fight that. The skirmish and its search live above the routes, so the
 * search goes on while the player looks elsewhere.
 */
export function SkirmishPage() {
    const skirmishes = useSkirmish();
    const { skirmish, history, leading, answering } = skirmishes;
    const storage = useStorage();
    const { ships, fleets } = useLibrary();
    const navigate = useNavigate();
    const [search, setSearch] = useSearchParams();
    const { pathname } = useLocation();
    const [settings, keepView] = useViewSettings(PAGE, DEFAULTS);
    const [view, setView] = useState<BattleView | null>(null);
    const [running, setRunning] = useState(false);
    const shown = useRef<Snapshot | null>(null);
    const orders = useOrderState(view, () => shown.current);
    const [doctrineOpen, setDoctrineOpen] = useState(false);

    // What the battle on the view is, and how it is being decided: per step, so refs, never state.
    const battle = useRef<CustomBattle | null>(null);
    const activity = useRef(new Activity(2));
    const decision = useRef<Decision | null>(null);
    const mode = useRef<Mode>("round");
    /** Where Back to the round goes from a match watched again. */
    const resume = useRef<(() => void) | null>(null);
    /** The enemy being chosen, alone, to show once the view is there. */
    const previewed = useRef<Fleet | null>(null);

    // What the panel shows of it.
    const [decided, setDecided] = useState<Decision | null>(null);
    const [outcome, setOutcome] = useState<{ text: string; kind: "" | "won" | "lost" }>({ text: "", kind: "" });
    const [enemyLine, setEnemyLine] = useState<string | null>(null);
    const [fightable, setFightable] = useState(false);
    const [roundOver, setRoundOver] = useState(false);
    const [replaying, setReplaying] = useState(false);
    const [watching, setWatching] = useState(true);
    const [enemyCost, setEnemyCost] = useState<Budget | null>(null);
    const [setupKey, setSetupKey] = useState(0);
    const ticked = useSampled(() => (view === null ? 0 : (battle.current?.world.tick ?? 0) > 0 ? 1 : 0));

    /** A fleet, or a single ship as a fleet of one, from a list value. */
    const read = (value: string): Fleet | null => {
        const [kind, ...rest] = value.split(":");
        const name = rest.join(":");
        try {
            if (kind === "fleet") return fleets.load(name);
            if (kind === "ship") {
                const blueprint = ships.load(name);
                return blueprint === null ? null : shipFleet(blueprint);
            }
        } catch (error) {
            window.alert(`Could not read ${name}.\n\n${error instanceof Error ? error.message : String(error)}`);
        }
        return null;
    };

    const newActivity = (): Activity => {
        const now = skirmish === null ? DEFAULT_SKIRMISH_SETTINGS : settingsOf(skirmish);
        return new Activity(2, now.timeCap, now.quietTime);
    };
    const undecided = (): void => {
        decision.current = null;
        setDecided(null);
    };
    /** Show a battle that takes no orders: given the orders it was played with, if any, to play again. */
    const showOn = (on: BattleView, shownBattle: Battle, run: boolean, given?: readonly Logged[]): void => {
        on.allowOrders(false);
        on.show(shownBattle, run, given !== undefined && given.length > 0, given ?? []);
    };

    const showRound = (current: Skirmish | null = skirmishes.skirmish, on: BattleView | null = view): void => {
        if (current === null || on === null) return;
        mode.current = "round";
        resume.current = null;
        setReplaying(false);
        setOutcome({ text: "", kind: "" });
        setEnemyLine(null);
        setRoundOver(false);
        undecided();
        activity.current = new Activity(2, settingsOf(current).timeCap, settingsOf(current).quietTime);
        const fits = canFight(current);
        setFightable(fits);
        if (fits) {
            battle.current = customBattle(roundSetup(current));
            // Your round alone takes orders, and can be wound back.
            on.allowOrders(0);
            on.show(battle.current, false, true);
        } else {
            battle.current = null;
            showOn(on, enemyAlone(current.enemy), false);
        }
    };

    /** Show the best enemy so far fighting the round, if the player is watching. */
    const watch = (now: AnswerProgress, current: Skirmish | null = skirmishes.skirmish): void => {
        if (current === null || current.won === undefined || !watching || view === null) return;
        mode.current = "watching";
        undecided();
        activity.current = newActivity();
        battle.current = customBattle(roundBattle(current.player, now.best, current.won, settingsOf(current)));
        setOutcome({ text: `Generation ${now.generation}'s best enemy against your fleet.`, kind: "" });
        setEnemyLine(`Against ${now.best.name}, evolving.`);
        setFightable(true);
        showOn(view, battle.current, true);
    };

    const showAnswer = (enemy: Fleet, current: Skirmish | null = skirmishes.skirmish): void => {
        if (current === null || current.won === undefined || view === null) return;
        mode.current = "answer";
        undecided();
        activity.current = newActivity();
        battle.current = customBattle(roundBattle(current.player, enemy, current.won, settingsOf(current)));
        setOutcome({ text: "The enemy's answer.", kind: "lost" });
        setEnemyLine(`Against ${enemy.name}, the answer.`);
        setFightable(true);
        showOn(view, battle.current, true);
    };

    /** Fight a match of the history again on the battle view, and come back to where things were. */
    const replay = (round: number, seed: number, player: Fleet, enemy: Fleet, written?: WrittenLog): void => {
        if (view === null) return;
        if (mode.current !== "replay") {
            const was = mode.current;
            resume.current =
                was === "round"
                    ? () => showRound()
                    : was === "answer"
                      ? () => skirmishes.skirmish !== null && showAnswer(skirmishes.skirmish.enemy)
                      : () => answering.latest !== null && watch(answering.latest);
        }
        mode.current = "replay";
        setRoundOver(true);
        undecided();
        activity.current = newActivity();
        battle.current = customBattle(
            roundBattle(player, enemy, seed, skirmish === null ? DEFAULT_SKIRMISH_SETTINGS : settingsOf(skirmish)),
        );
        setOutcome({ text: `Round ${round}, again.`, kind: "" });
        setFightable(true);
        setReplaying(true);
        // What the player told their fleet, as they told it; a log that cannot be read is played without.
        let given: readonly Logged[] = [];
        try {
            if (written !== undefined) given = readLog(written.orders, written.designs);
        } catch {
            given = [];
        }
        showOn(view, battle.current, true, given);
    };

    const roundDecided = (result: Decision): void => {
        const current = skirmishes.skirmish;
        if (current === null || view === null) return;
        // The round is decided: it can be watched back, but told nothing more.
        view.allowOrders(false);
        const given = view.orders;
        skirmishes.recordMatch({
            kind: "try",
            round: current.round,
            seed: current.seed,
            winner: result.winner,
            player: current.player,
            enemy: current.enemy,
            ...(given.length === 0 ? {} : { orders: writeLog(given) }),
        });
        setRoundOver(true);
        const at = `at ${result.time.toFixed(0)} s${given.length === 0 ? "" : ", with orders"}`;
        if (result.winner === 0) {
            setOutcome({ text: `Victory ${at}. Wait while the enemy evolves an answer.`, kind: "won" });
            skirmishes.setSkirmish(won(current));
            skirmishes.answer();
        } else {
            setOutcome({
                text:
                    result.winner < 0
                        ? result.reason === "time"
                            ? `Stalemate ${at}: a draw is a loss. Edit your fleet and try again.`
                            : `Neither side can fight on ${at}: a draw is a loss. Edit your fleet and try again.`
                        : `Defeat ${at}. Edit your fleet and try again.`,
                kind: "lost",
            });
            skirmishes.setSkirmish(lost(current));
        }
    };

    // Every step: has the battle on the view been decided?
    const stepped = (steppedBattle: Battle): void => {
        if (decision.current !== null || skirmishes.skirmish === null || steppedBattle !== battle.current) return;
        // The decision rule has seen the step already, as the view's watcher.
        const result = activity.current.decided;
        if (result === null) return;
        decision.current = result;
        setDecided(result);
        if (mode.current === "round") roundDecided(result);
        else if (mode.current === "replay")
            setOutcome({
                text:
                    result.winner === 0
                        ? `You won this one at ${result.time.toFixed(0)} s.`
                        : result.winner === 1
                          ? `The enemy won this one at ${result.time.toFixed(0)} s.`
                          : `A draw at ${result.time.toFixed(0)} s.`,
                kind: "",
            });
        else if (mode.current === "answer")
            setOutcome({ text: `The enemy's answer beats your fleet at ${result.time.toFixed(0)} s.`, kind: "" });
        // Watching, a match that is over gives way to the next best enemy.
        else if (answering.latest !== null) watch(answering.latest);
    };

    // Each generation of the search: the newest best shown, unless a match is being watched again; the answer, once found.
    const progressed = useEffectEvent((now: AnswerProgress) => {
        const current = skirmishes.skirmish;
        if (now.found !== null) {
            if (mode.current === "replay") resume.current = () => showAnswer(now.found!, current);
            else showAnswer(now.found, current);
            return;
        }
        if (mode.current === "replay") return;
        if (mode.current !== "watching" || decision.current !== null) watch(now, current);
    });
    useEffect(() => skirmishes.subscribe((now) => progressed(now)), [skirmishes]);

    // A skirmish handed over in the address, by a link: take it up, and tidy the address.
    const takeUp = (on: BattleView): boolean => {
        if (pathname !== "/skirmish" || search.get("skirmish") === null) return false;
        let handed: Skirmish | null = null;
        try {
            handed = handedSkirmish(search);
        } catch (error) {
            window.alert(`Could not read the skirmish handed over.\n\n${error instanceof Error ? error.message : String(error)}`);
        }
        setSearch({}, { replace: true });
        if (handed === null) return false;
        skirmishes.setSkirmish(handed);
        if (handed.won !== undefined) skirmishes.answer();
        else skirmishes.stopAnswer();
        showRound(handed, on);
        return true;
    };

    const onView = (next: BattleView | null): void => {
        setView(next);
        // For the browser tests and anyone inspecting the page.
        Reflect.set(window, "viewer", next ?? undefined);
        if (next === null) return;
        next.keepView(PAGE);
        next.setSpeed(settings.speed);
        // The decision rule goes back with the battle when it is wound back.
        const watcher: Watcher = {
            observe: (steppedBattle) => activity.current.observe(steppedBattle as CustomBattle),
            save: () => activity.current.copy(),
            restore: (saved) => {
                activity.current = saved instanceof Activity ? saved.copy() : newActivity();
            },
        };
        next.watch(watcher);
        if (takeUp(next)) return;
        const current = skirmishes.skirmish;
        if (current === null) {
            if (previewed.current !== null) showOn(next, enemyAlone(previewed.current), false);
            return;
        }
        showRound(current, next);
        // Back while the enemy is answering: its answer, or the best so far, as it was left.
        const found = answering.latest?.found ?? null;
        if (current.won !== undefined && found !== null) showAnswer(found, current);
    };

    // P opens or closes the picked ships' doctrine.
    useEffect(() => {
        const toggle = (event: KeyboardEvent): void => {
            const focus = document.activeElement;
            if (focus instanceof HTMLInputElement || focus instanceof HTMLTextAreaElement || event.ctrlKey || event.metaKey || event.altKey)
                return;
            if (event.key.toLowerCase() === DOCTRINE_KEY && view !== null && view.picked.length > 0) setDoctrineOpen((open) => !open);
        };
        window.addEventListener("keydown", toggle);
        return () => window.removeEventListener("keydown", toggle);
    }, [view]);

    const readout = useSampled(() => {
        const at = shown.current;
        return skirmish === null || at === null ? "" : `round ${skirmish.round} · t ${at.time.toFixed(1)} s`;
    });
    // A table to read, not an animation: sampled, as every figure off a running battle is.
    const sides = useSampled(() => {
        const now = battle.current;
        if (now === null || skirmish === null) return "";
        const counts = tally(now, 2);
        return JSON.stringify(
            now.start.map((start, i) => ({
                name: i === 0 ? "You" : (now.setup.fleets[i]?.name ?? "Enemy"),
                ships: `${counts[i]!.ships}/${start.ships} ships · ${counts[i]!.armed} armed · ${Math.round(start.mass > 0 ? (1 - counts[i]!.mass / start.mass) * 100 : 0)}% of mass lost`,
            })),
        );
    });

    const start = (enemyValue: string, playerValue: string, chosen: SkirmishSettings, budgetOf: (cost: Budget) => Budget): void => {
        const enemy = read(enemyValue);
        if (enemy === null) return;
        const enemyFault = fleetFault(enemy);
        if (enemyFault !== null) return window.alert(`That enemy would not fly: ${enemyFault}`);
        const player = playerValue === EMPTY ? { name: "My fleet", designs: {}, ships: [] } : read(playerValue);
        if (player === null) return;
        // The page's own randomness, not the battle's: it only picks which battle.
        const begun = newSkirmish(enemy, player, Math.floor(Math.random() * 2 ** 32), chosen, budgetOf(billOfFleet(enemy)));
        skirmishes.setSkirmish(begun);
        // Nothing to fight with yet: straight to the editor to build it.
        if (player.ships.length === 0) void navigate(fleetRoute(begun.player, begun));
        else showRound(begun);
    };
    const previewEnemy = (enemy: Fleet | null): void => {
        const flies = enemy !== null && fleetFault(enemy) === null;
        previewed.current = flies ? enemy : null;
        setEnemyCost(flies ? billOfFleet(enemy) : null);
        battle.current = null;
        undecided();
        if (flies && view !== null) showOn(view, enemyAlone(enemy), false);
    };
    const abandon = (): void => {
        if (!window.confirm("Give up this skirmish and start another?")) return;
        skirmishes.stopAnswer();
        skirmishes.setSkirmish(null);
        skirmishes.setHistory(EMPTY_HISTORY);
        mode.current = "round";
        resume.current = null;
        setReplaying(false);
        undecided();
        setFightable(false);
    };
    const exportSkirmish = (): void => {
        const file = {
            about:
                "A skirmish exported from the Skirmish page: the settings on the setup screen, the skirmish under way " +
                "(round, budget, both fleets and the settings it started with) if there is one, and the history of every " +
                "match played, its fleets kept by id.",
            setup: keptSettings(storage),
            skirmish: skirmish === null ? null : serialiseSkirmish(skirmish),
            history,
        };
        download(
            `${skirmish === null ? "skirmish" : `skirmish-round-${skirmish.round}`}.skirmish.json`,
            `${JSON.stringify(file, null, 2)}\n`,
        );
    };
    // An exported skirmish read back: its settings into the setup screen, and the skirmish and history it
    // holds in place of these. Checked whole first, so a bad file changes nothing.
    const importSkirmish = async (chosen: File): Promise<void> => {
        let setup: SkirmishSettings | null;
        let next: Skirmish | null;
        let nextHistory: History;
        try {
            const file = JSON.parse(await chosen.text()) as Record<string, unknown>;
            if (typeof file !== "object" || file === null || !("skirmish" in file || "setup" in file))
                throw new Error("it is not a skirmish file");
            setup = file["setup"] === undefined ? null : parseSkirmishSettings(file["setup"]);
            next = file["skirmish"] === undefined || file["skirmish"] === null ? null : parseSkirmish(file["skirmish"]);
            nextHistory = file["history"] === undefined ? EMPTY_HISTORY : parseHistory(file["history"]);
        } catch (error) {
            window.alert(`Could not read ${chosen.name}.\n\n${error instanceof Error ? error.message : String(error)}`);
            return;
        }
        if (skirmish !== null && !window.confirm("Replace the skirmish under way, and its history, with the one in this file?")) return;
        skirmishes.stopAnswer();
        if (setup !== null) {
            try {
                storage.setItem(SETTINGS_KEY, JSON.stringify(setup));
            } catch {
                // Storage full or refused: they last as long as the page.
            }
            setSetupKey((n) => n + 1);
        }
        skirmishes.setHistory(nextHistory);
        skirmishes.setSkirmish(next);
        if (next === null) return;
        showRound(next);
        if (next.won !== undefined) skirmishes.answer();
    };

    const fault = skirmish === null ? null : fleetFault(skirmish.player);
    const fits = skirmish !== null && canFight(skirmish);
    const limit = skirmish === null || fault !== null ? null : overLimit(skirmish);
    const bill = skirmish === null || fault !== null ? null : billOfFleet(skirmish.player);
    const answeringNow = skirmish?.won !== undefined;
    const found = answering.latest?.found ?? null;
    const latest = answering.latest;
    // The one thing to press next in the round's buttons.
    const next = answeringNow ? null : fits && !roundOver ? "fight" : "edit";
    const fightLabel = running ? "Fighting…" : ticked > 0 ? "Resume" : "Fight";
    const parsedSides = sides === "" ? [] : (JSON.parse(sides) as { name: string; ships: string }[]);

    return (
        <Main>
            <Controls>
                <Button id="play" disabled={!fightable} onClick={() => view?.setRunning(!running)}>
                    {running ? "Pause" : decided !== null || ticked > 0 ? "Resume" : "Fight"}
                </Button>
                <Button id="fit" onClick={() => view?.fit()}>
                    Fit
                </Button>
                <Scrub view={view} />
                <Button
                    id="exportSkirmish"
                    title="Save the skirmish, its settings and every match played to a file, to look into or ask about"
                    onClick={exportSkirmish}
                >
                    Export
                </Button>
                <Button
                    id="importSkirmish"
                    title="Load a skirmish file: its settings, and the skirmish and matches it holds, in place of these"
                    onClick={() => document.getElementById("importSkirmishFile")?.click()}
                >
                    Import
                </Button>
                <input
                    id="importSkirmishFile"
                    type="file"
                    accept="application/json,.json"
                    hidden
                    onChange={(event) => {
                        const chosen = event.target.files?.[0];
                        event.target.value = "";
                        if (chosen !== undefined) void importSkirmish(chosen);
                    }}
                />
                <label>
                    speed
                    <select
                        id="speed"
                        title="How fast the battle runs"
                        value={settings.speed}
                        onChange={(event) => {
                            const speed = Number(event.target.value);
                            keepView({ speed });
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
                <Readout id="readout" aria-label="Battle time">
                    {readout}
                </Readout>
            </Controls>
            <Body>
                {skirmish === null && (
                    <SetupScreen key={setupKey} read={read} enemyCost={enemyCost} onEnemy={previewEnemy} onStart={start} />
                )}
                <BattleCanvas
                    id="view"
                    onView={onView}
                    onStepped={stepped}
                    onDrawn={(at) => (shown.current = at)}
                    onRunningChanged={setRunning}
                    onRewound={(rewound) => (battle.current = rewound as CustomBattle)}
                >
                    {decided !== null && (
                        <Decided id="decided" className={decided.winner === 0 ? "won" : "lost"}>
                            <strong id="decidedTitle">{`${decided.winner === 0 ? "Victory" : decided.winner === 1 ? "Defeat" : "Draw"} at ${decided.time.toFixed(0)} s`}</strong>
                            <span id="decidedReason">
                                {decided.reason === "time"
                                    ? `Neither side won within the ${(skirmish === null ? DEFAULT_SKIRMISH_SETTINGS : settingsOf(skirmish)).timeCap} s limit.`
                                    : decided.reason === "disarmed"
                                      ? decided.winner < 0
                                          ? "Neither side has anything left to fight with."
                                          : `${decided.winner === 0 ? "The enemy" : "Your fleet"} has nothing left to fight with.`
                                      : `${decided.winner === 0 ? "The enemy" : "Your fleet"} went ${(skirmish === null ? DEFAULT_SKIRMISH_SETTINGS : settingsOf(skirmish)).quietTime} s without firing.`}
                            </span>
                        </Decided>
                    )}
                    <AsteroidCard contents={orders.asteroid} />
                    {view !== null && doctrineOpen && orders.side !== null && (
                        <DoctrinePanel view={view} state={orders} shown={() => shown.current} />
                    )}
                    {view !== null && (
                        <OrderBar
                            view={view}
                            state={orders}
                            shown={() => shown.current}
                            doctrineOpen={doctrineOpen}
                            onDoctrine={() => setDoctrineOpen((open) => !open)}
                        />
                    )}
                </BattleCanvas>
                {skirmish !== null && (
                    <Panel>
                        <section id="round">
                            <h2 id="roundTitle">
                                {`Round ${skirmish.round}` + (skirmish.tries > 0 ? ` · try ${skirmish.tries + 1}` : "")}
                            </h2>
                            <p id="enemyName">{enemyLine ?? `Against ${skirmish.enemy.name}.`}</p>
                            <Muted id="multiplier">{`Playing against a ${times(enemyMultiplier(skirmish))} enemy: its budget is ${times(enemyMultiplier(skirmish))} yours.`}</Muted>
                            <h2>Your fleet</h2>
                            <p id="playerName">{skirmish.player.name}</p>
                            <Figures id="budget">
                                {bill !== null && (
                                    <tbody>
                                        <tr className={bill.metal > skirmish.budget.metal ? "over" : undefined}>
                                            <th>metal</th>
                                            <td>{`${kg(bill.metal)} of ${kg(skirmish.budget.metal)}`}</td>
                                        </tr>
                                        <tr className={bill.fuel > skirmish.budget.fuel ? "over" : undefined}>
                                            <th>fuel</th>
                                            <td>{`${kg(bill.fuel)} of ${kg(skirmish.budget.fuel)}`}</td>
                                        </tr>
                                        <tr className={bill.build > skirmish.budget.build ? "over" : undefined}>
                                            <th>build</th>
                                            <td>{`${buildTime(bill.build)} of ${buildTime(skirmish.budget.build)}`}</td>
                                        </tr>
                                    </tbody>
                                )}
                            </Figures>
                            <Muted id="fleetNote">
                                {fits
                                    ? ""
                                    : skirmish.player.ships.length === 0
                                      ? "Your fleet has no ships: edit it to add some."
                                      : fault !== null
                                        ? `Your fleet would not fly: ${fault}. Edit it to fix that.`
                                        : limit !== null
                                          ? `Your fleet has ${limit}: edit it to fit.`
                                          : "Your fleet is over budget: edit it to cut it down."}
                            </Muted>
                            {!answeringNow && (
                                <Buttons>
                                    {!roundOver && (
                                        <Button
                                            id="fight"
                                            variant={next === "fight" ? "primary" : "plain"}
                                            title="Fight the round"
                                            disabled={running || !fightable}
                                            onClick={() => view?.setRunning(true)}
                                        >
                                            {running && <Spinner aria-hidden="true" />}
                                            {fightLabel}
                                        </Button>
                                    )}
                                    <EditLink
                                        id="editFleet"
                                        href="#/fleet"
                                        variant={next === "edit" ? "primary" : "plain"}
                                        title="Change your fleet in the fleet editor"
                                        onClick={(event) => {
                                            event.preventDefault();
                                            void navigate(fleetRoute(skirmish.player, skirmish));
                                        }}
                                    >
                                        Edit fleet
                                    </EditLink>
                                    <Button
                                        id="retry"
                                        title="Fight this round again from the start"
                                        disabled={!fits}
                                        onClick={() => {
                                            showRound();
                                            view?.setRunning(true);
                                        }}
                                    >
                                        Restart
                                    </Button>
                                </Buttons>
                            )}
                            <Outcome id="outcome" className={outcome.kind}>
                                {outcome.text}
                            </Outcome>
                            {answeringNow && (
                                <div id="answering">
                                    <h2>The enemy answers</h2>
                                    <Waiting>
                                        {found === null && <Spinner id="answerSpinner" aria-hidden="true" />}
                                        <p id="answerProgress">
                                            {found !== null
                                                ? `Found in generation ${latest!.generation}: ${found.name}, which beats your fleet on the next round's seed.`
                                                : latest === null
                                                  ? "Wait while the enemy evolves an answer: fighting the first generation of mutants…"
                                                  : `Generation ${latest.generation}: the best enemy so far won ${latest.wins} of its ${latest.seeds} matches. It may spend ${times(latest.multiplier)} your budget.`}
                                        </p>
                                    </Waiting>
                                    {found === null ? (
                                        <Buttons>
                                            <Button
                                                id="watchAnswer"
                                                title="Stop or start watching the best enemy so far fight your fleet"
                                                onClick={() => {
                                                    setWatching(!watching);
                                                    if (!watching && latest !== null) watch(latest);
                                                    else if (watching) view?.setRunning(false);
                                                }}
                                            >
                                                {watching ? "Stop watching" : "Watch"}
                                            </Button>
                                        </Buttons>
                                    ) : (
                                        <Buttons id="answered">
                                            <Button
                                                id="nextRound"
                                                variant="primary"
                                                onClick={() => {
                                                    const going = nextRound(skirmish, skirmish.enemy);
                                                    skirmishes.setSkirmish(going);
                                                    showRound(going);
                                                }}
                                            >
                                                Next round
                                            </Button>
                                        </Buttons>
                                    )}
                                </div>
                            )}
                            <h2>Sides</h2>
                            <div id="sides">
                                {parsedSides.map((side, i) => (
                                    <div key={i}>
                                        <Side>
                                            <span style={{ background: teamColour(i) }} />
                                            {side.name}
                                        </Side>
                                        <SideStats>{side.ships}</SideStats>
                                    </div>
                                ))}
                            </div>
                            <Buttons>
                                <Button id="abandon" title="Give up this skirmish and start another" onClick={abandon}>
                                    New skirmish
                                </Button>
                            </Buttons>
                        </section>
                        <HistoryBox id="history">
                            <h2>History</h2>
                            {replaying && (
                                <Buttons id="replaying">
                                    <Button
                                        id="backToRound"
                                        variant="primary"
                                        onClick={() => {
                                            setReplaying(false);
                                            const back = resume.current;
                                            resume.current = null;
                                            mode.current = "round";
                                            setRoundOver(false);
                                            (back ?? (() => showRound()))();
                                        }}
                                    >
                                        Back to the round
                                    </Button>
                                </Buttons>
                            )}
                            <Timeline
                                history={history}
                                leading={leading}
                                watch={(row, player, enemy) => replay(row.round, row.seed, player, enemy, row.orders)}
                                save={(fleet) => {
                                    const name = unusedName(fleet.name, fleets.savedNames());
                                    fleets.save({ ...fleet, name });
                                    window.alert(`Saved to your fleets as ${name}.`);
                                }}
                                exportFleet={(fleet) =>
                                    download(`${fleet.name}.fleet.json`, `${JSON.stringify(serialiseFleet(fleet), null, 2)}\n`)
                                }
                            />
                        </HistoryBox>
                    </Panel>
                )}
            </Body>
            <Footer>
                <KeyHelp rows={[...BATTLE_KEYS, ...ORDER_KEYS]} notes={NOTES} />
            </Footer>
        </Main>
    );
}

/** The route: a skirmish handed over in the address, even to the route already showing, is taken up afresh. */
export function SkirmishRoute() {
    const [search] = useSearchParams();
    const { pathname } = useLocation();
    // Only its own address: leaving for the fleet editor carries a skirmish too, which is the editor's to take up.
    return <SkirmishPage key={pathname === "/skirmish" ? (search.get("skirmish") ?? "") : ""} />;
}
