import { styled } from "@linaria/react";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { BattleCanvas } from "~/features/battle/BattleCanvas";
import { LookFields } from "~/features/battle/LookFields";
import { pauseView } from "~/features/battle/pauseView";
import { Playback } from "~/features/battle/Playback";
import { useHelp } from "~/features/help/Help";
import { BackToMenu } from "~/features/menu/BackToMenu";
import { PauseMenu } from "~/features/menu/PauseMenu";
import { Scrub } from "~/features/battle/Scrub";
import { useSampled } from "~/features/battle/useSampled";
import { AsteroidCard } from "~/features/battle/AsteroidCard";
import { DOCTRINE_KEY, DoctrinePanel } from "~/features/orders/DoctrinePanel";
import { OrderBar } from "~/features/orders/OrderBar";
import { useOrderState } from "~/features/orders/orderState";
import { ArenaPicture } from "~/features/skirmish/ArenaPicture";
import { BudgetTable } from "~/features/skirmish/BudgetTable";
import { describeArena, destinationById } from "~/skirmish/destinations";
import { DestinationPick } from "~/features/skirmish/DestinationPick";
import { EarnedCard } from "~/features/skirmish/EarnedCard";
import { AbandonDialog } from "~/features/skirmish/AbandonDialog";
import { download, downloadSkirmish, skirmishStatus, skirmishTitle } from "~/features/skirmish/skirmishFile";
import { useSkirmish } from "~/features/skirmish/SkirmishProvider";
import { useStorage } from "~/features/storage/StorageContext";
import { useLibrary } from "~/features/storage/useLibrary";
import { useViewSettings } from "~/features/storage/useViewSettings";
import { fleetRoute, handedSkirmish, shipFleet } from "~/editor/handoff";
import { unusedName } from "~/editor/library";
import type { AnswerProgress } from "~/host/answer";
import type { BattleView, Watcher } from "~/host/battleView";
import { BATTLE_KEYS, ORDER_KEYS } from "~/host/keyHelp";
import type { ViewSettings } from "~/host/viewSettings";
import { sidesOf, STOCK, teamColour, teamName, type Sides } from "~/render/teams";
import { CommitText } from "~/ui/fields/CommitText";
import { readLog, writeLog, type Logged } from "~/scenarios/commands";
import { customBattle, DEFAULT_SETUP, tally, type BattleSetup, type CustomBattle } from "~/scenarios/customBattle";
import { lightOf, lit, roundLight } from "~/scenarios/lights";
import { Activity, mostRelevant, standings, type Decision, type ShipStanding } from "~/scenarios/decision";
import { ableLine, outLine, quietLine } from "./standingText";
import { Unarmed } from "~/sim/index";
import { EMPTY_HISTORY, parseHistory, type History, type WrittenLog } from "~/scenarios/history";
import {
    billOfFleet,
    canFight,
    cardProgress,
    DEFAULT_SKIRMISH_SETTINGS,
    fleetFault,
    goTo,
    lost,
    newSkirmish,
    nextRound,
    overLimit,
    parseSkirmish,
    parseSkirmishSettings,
    pick,
    playerLimits,
    roundBattle,
    roundYards,
    startingBudget,
    workLimit,
    roundSetup,
    settingsOf,
    won,
    type Skirmish,
    type SkirmishSettings,
} from "~/scenarios/skirmish";
import type { Battle } from "~/scenarios/types";
import { serialiseFleet, type Budget, type Fleet, type ShipModuleKind, type Snapshot } from "~/sim/index";
import { Button } from "~/ui/buttons/Button";
import { EditLink } from "~/ui/buttons/EditButton";
import { EMPTY } from "./FleetChoices";
import { keptSettings, SetupScreen } from "./SetupScreen";
import {
    SKIRMISH_CARD_HELP_KEY,
    SKIRMISH_HELP_KEY,
    SKIRMISH_HELP_LABEL,
    SKIRMISH_LOSS_HELP_KEY,
    SKIRMISH_ROUND_HELP_KEY,
    SKIRMISH_WIN_HELP_KEY,
    SkirmishCardHelp,
    SkirmishHelp,
    SkirmishLossHelp,
    SkirmishRoundHelp,
    SkirmishWinHelp,
} from "./SkirmishHelp";
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

const FrameRate = styled.output`
    margin-left: 1.5em;
    color: var(--colour-muted);

    /* At the right without a readout before it. */
    &:first-of-type {
        margin-left: auto;
    }
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

    /* Clear of the fleet strip down the view's left edge, when it is shown. */
    left: calc(0.7rem + var(--strips-left, 0px));
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

    button {
        display: block;
        margin-top: 0.45rem;
        pointer-events: auto;
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

    ul {
        margin: 0.3rem 0 0;
        padding-left: 1.1rem;
        color: var(--colour-muted);
    }

    b {
        color: var(--colour-text);
        font-weight: 600;
    }
`;

/** What stands between the fleet and a fight, under the buttons that would fix it. */
const Fix = styled.p`
    margin: 0.4rem 0 0;
    color: var(--colour-warning);
    font-size: var(--font-size-small);
`;

/** How near the player is to an upgrade card. */
const CardProgress = styled.span`
    display: block;
    margin-top: 0.35rem;
    color: var(--colour-muted);
    font-size: var(--font-size-small);
`;

const NotReady = styled.div`
    position: absolute;
    top: 0.7rem;
    left: 50%;
    max-width: 26rem;
    padding: 0.45rem 0.7rem;
    border: 1px solid var(--colour-warning);
    border-radius: 4px;
    background: rgb(11 15 22 / 85%);
    color: var(--colour-warning);
    text-align: center;
    transform: translateX(-50%);
    pointer-events: none;
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

/** What the wide history is waiting on, said so it cannot be missed. */
const Evolving = styled.div`
    display: flex;
    gap: 0.9rem;
    align-items: center;
    margin-bottom: 0.6rem;
    padding: 0.8rem 1rem;
    border: 1px solid var(--colour-primary-border);
    border-radius: 6px;
    background: var(--colour-surface);

    > div {
        flex: 1;
    }

    strong {
        display: block;
        color: var(--colour-heading);
        font-size: 1.15rem;
    }

    p {
        margin: 0.25rem 0 0;
        color: var(--colour-muted);
    }

    b {
        color: var(--colour-heading);
    }
`;

/** The history over the battle view, which it covers while the search is not being watched. */
const WideHistory = styled.section`
    position: absolute;
    inset: 0;
    z-index: 1;
    display: flex;
    flex-direction: column;
    padding: 0.7rem 1.2rem;
    background: var(--colour-background);

    h2 {
        margin: 0.4rem 0;
        color: var(--colour-muted);
        font-size: var(--font-size-small);
    }
`;

const NameField = styled.label`
    display: flex;
    gap: 0.6rem;
    align-items: center;
    color: var(--colour-muted);

    input {
        flex: 1;
        min-width: 0;
    }
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

/** What is on the screen: the round, the best enemy so far fighting it, the answer it found, or a match watched again. */
type Mode = "round" | "watching" | "answer" | "replay";

/** The enemy where it will stand, in its colour, with nobody yet on the other side. */
/** The things a skirmish's fleet is over budget on, as "metal and build time". */
function overBudget(skirmish: Skirmish): string {
    const bill = billOfFleet(skirmish.player);
    const budget = workLimit(playerLimits(skirmish));
    const over = (["metal", "fuel", "build"] as const)
        .filter((what) => bill[what] > budget[what])
        .map((what) => (what === "build" ? "build time" : what));
    return over.length < 2 ? (over[0] ?? "budget") : `${over.slice(0, -1).join(", ")} and ${over.at(-1)}`;
}

function enemyAlone(enemy: Fleet): CustomBattle {
    return customBattle({ ...DEFAULT_SETUP, fleets: [{ name: "", designs: {}, ships: [] }, enemy] });
}

/** A round's battle, seen in the light its settings have wandered to, or else the one its seed draws, as bright as they say. */
function roundOn(setup: BattleSetup, settings: SkirmishSettings): CustomBattle {
    const light = settings.lighting === undefined ? roundLight(setup.seed, settings.light) : lightOf(settings.lighting, settings.light);
    return lit(customBattle(setup), light);
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
    // How a skirmish works is the setup screen's: a skirmish under way has its keys behind ? instead.
    const help = useHelp(SKIRMISH_HELP_KEY, { enabled: skirmish === null });
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
    // Every ship as it stood when the battle was decided, to say why.
    const [stood, setStood] = useState<readonly ShipStanding[]>([]);
    // The sides as the battle drew them, so the standings name each as its hulls do.
    const [stoodSides, setStoodSides] = useState<Sides>(STOCK);
    const [outcome, setOutcome] = useState<{ text: string; kind: "" | "won" | "lost" }>({ text: "", kind: "" });
    const [enemyLine, setEnemyLine] = useState<string | null>(null);
    const [fightable, setFightable] = useState(false);
    const [roundOver, setRoundOver] = useState(false);
    const [begun, setBegun] = useState(false);
    // Which choice is open over the battle, a hand dealt or where to go next, and whether the battle was running when it opened.
    const [picking, setPicking] = useState<"card" | "way" | null>(null);
    // Whether the last loss was with a fleet that had already lost the round, and so did not count towards a card.
    const [repeatLoss, setRepeatLoss] = useState(false);
    const resumeAfterPick = useRef(false);
    const [replaying, setReplaying] = useState(false);
    // Whether the enemy's search is shown fighting your fleet; not at first, so its evolving is what you see.
    const [watching, setWatching] = useState(false);
    const [enemyCost, setEnemyCost] = useState<Budget | null>(null);
    // What a round's end means, told once each; ? stays the pause menu's keys.
    const told = roundOver && !replaying && picking === null;
    // Not over the enemy's answer to a round won, which is shown as a loss too.
    const lossHelp = useHelp(SKIRMISH_LOSS_HELP_KEY, {
        enabled: told && outcome.kind === "lost" && skirmish?.won === undefined,
        key: false,
    });
    const winHelp = useHelp(SKIRMISH_WIN_HELP_KEY, { enabled: told && outcome.kind === "won", key: false });
    const cardHelp = useHelp(SKIRMISH_CARD_HELP_KEY, { enabled: picking === "card", key: false });
    const roundHelp = useHelp(SKIRMISH_ROUND_HELP_KEY, {
        enabled: skirmish !== null && skirmish.won === undefined && skirmish.hand === undefined && !roundOver && !replaying,
        key: false,
    });
    const [setupKey, setSetupKey] = useState(0);
    const [abandoning, setAbandoning] = useState(false);
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
    /** Show a battle that takes no orders, and can be wound back: given the orders it was played with, if any, to play again. */
    const showOn = (on: BattleView, shownBattle: Battle, run: boolean, given: readonly Logged[] = []): void => {
        on.allowOrders(false);
        on.show(shownBattle, run, true, given);
    };

    const showRound = (current: Skirmish | null = skirmishes.skirmish, on: BattleView | null = view): void => {
        if (current === null || on === null) return;
        setBegun(false);
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
            battle.current = roundOn(roundSetup(current), settingsOf(current));
            // Your round alone takes orders, and can be wound back.
            on.allowOrders(0);
            on.show(battle.current, false, true);
        } else {
            // Your fleet laid out against the enemy's as the round would be, to see, but not to fight.
            battle.current = null;
            let preview: Battle;
            try {
                preview = roundOn(roundSetup(current), settingsOf(current));
            } catch {
                preview = enemyAlone(current.enemy);
            }
            showOn(on, preview, false);
        }
    };

    /**
     * A skirmish as it opens: its round, or once that is won, the enemy as it
     * stands fighting your fleet on the round it is answering — not the round
     * already won, which the search has left behind.
     */
    const showOpened = (current: Skirmish, on: BattleView, run: boolean = watching): void => {
        if (current.won === undefined) return showRound(current, on);
        mode.current = "watching";
        resume.current = null;
        setReplaying(false);
        undecided();
        activity.current = newActivity();
        battle.current = roundOn(
            roundBattle(current.player, current.enemy, current.won, settingsOf(current), current.won, roundYards(current)),
            settingsOf(current),
        );
        if (current.ways !== undefined) {
            setOutcome({ text: "Round won. Pick where the next round is fought.", kind: "won" });
            setEnemyLine(current.enemy.name);
        } else {
            setOutcome({ text: "The enemy as it stands against your fleet, evolving an answer.", kind: "" });
            setEnemyLine(`${current.enemy.name}, evolving`);
        }
        setFightable(true);
        showOn(on, battle.current, run);
    };

    /** Show the best enemy so far fighting the round, if the player is watching. */
    const watch = (now: AnswerProgress, current: Skirmish | null = skirmishes.skirmish, watched: boolean = watching): void => {
        if (current === null || current.won === undefined || !watched || view === null) return;
        mode.current = "watching";
        undecided();
        activity.current = newActivity();
        battle.current = roundOn(
            roundBattle(current.player, now.best, current.won, settingsOf(current), current.won, roundYards(current, now.best, now.cards)),
            settingsOf(current),
        );
        setOutcome({ text: `Generation ${now.generation}'s best enemy against your fleet.`, kind: "" });
        setEnemyLine(`${now.best.name}, evolving`);
        setFightable(true);
        showOn(view, battle.current, true);
    };

    /** Set up the answer fighting the round; run only where it is watched, not behind the history covering it. */
    const showAnswer = (enemy: Fleet, current: Skirmish | null = skirmishes.skirmish, run: boolean = watching): void => {
        if (current === null || current.won === undefined || view === null) return;
        mode.current = "answer";
        undecided();
        activity.current = newActivity();
        battle.current = roundOn(
            roundBattle(current.player, enemy, current.won, settingsOf(current), current.won, roundYards(current, enemy)),
            settingsOf(current),
        );
        setOutcome({ text: "The enemy's answer.", kind: "lost" });
        setEnemyLine(`${enemy.name}, the answer`);
        setFightable(true);
        showOn(view, battle.current, run);
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
                      : () =>
                            answering.latest !== null
                                ? watch(answering.latest)
                                : skirmishes.skirmish !== null && showOpened(skirmishes.skirmish, view);
        }
        mode.current = "replay";
        setRoundOver(true);
        undecided();
        activity.current = newActivity();
        const settings = skirmish === null ? DEFAULT_SKIRMISH_SETTINGS : settingsOf(skirmish);
        battle.current = roundOn(
            roundBattle(player, enemy, seed, settings, seed, skirmish === null ? undefined : roundYards(skirmish, enemy)),
            settings,
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
            ...(current.picked === undefined ? {} : { card: current.picked }),
        });
        setRoundOver(true);
        const at = `at ${result.time.toFixed(0)} s${given.length === 0 ? "" : ", with orders"}`;
        if (result.winner === 0) {
            const going = won(current);
            setOutcome({
                text:
                    going.ways === undefined
                        ? `Victory ${at}. Wait while the enemy evolves an answer.`
                        : `Victory ${at}. Pick where the next round is fought.`,
                kind: "won",
            });
            skirmishes.setSkirmish(going);
            skirmishes.answer();
        } else {
            const after = lost(current);
            setRepeatLoss((after.streak ?? 0) === (current.streak ?? 0) && after.hand === undefined);
            const then = after.hand !== undefined ? "You have earned an upgrade card." : "Edit your fleet and try again.";
            setOutcome({
                text:
                    result.winner < 0
                        ? result.reason === "time"
                            ? `Stalemate ${at}: a draw is a loss. ${then}`
                            : `Neither side can fight on ${at}: a draw is a loss. ${then}`
                        : `Defeat ${at}. ${then}`,
                kind: "lost",
            });
            skirmishes.setSkirmish(after);
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
        setStood(standings(steppedBattle, 2));
        setStoodSides(sidesOf(steppedBattle.liveries));
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
        showOpened(handed, on);
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
        showOpened(current, next);
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

    const fps = useSampled(() => (view === null || view.fps === 0 ? "" : `${Math.round(view.fps)} fps`));
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
                colour: teamColour(i, sidesOf(now.liveries)),
                ships: `${counts[i]!.ships}/${start.ships} ships · ${counts[i]!.armed} armed · ${Math.round(start.mass > 0 ? (1 - counts[i]!.mass / start.mass) * 100 : 0)}% of mass lost`,
            })),
        );
    });

    const start = (
        enemyValue: string,
        playerValue: string,
        chosen: SkirmishSettings,
        budgetOf: (cost: Budget) => Budget,
        name: string,
        tech: readonly ShipModuleKind[],
    ): void => {
        const enemy = read(enemyValue);
        if (enemy === null) return;
        const enemyFault = fleetFault(enemy);
        if (enemyFault !== null) return window.alert(`That enemy would not fly: ${enemyFault}`);
        const player = playerValue === EMPTY ? { name: "My fleet", designs: {}, ships: [] } : read(playerValue);
        if (player === null) return;
        // The page's own randomness, not the battle's: it only picks which battle.
        const begun = newSkirmish(enemy, player, Math.floor(Math.random() * 2 ** 32), chosen, budgetOf(startingBudget(enemy)), name, tech);
        skirmishes.setSkirmish(begun);
        // Nothing to fight with yet: straight to the editor to build it.
        if (player.ships.length === 0) void navigate(fleetRoute(begun.player, begun));
        else showRound(begun);
    };
    const previewEnemy = (enemy: Fleet | null): void => {
        const flies = enemy !== null && fleetFault(enemy) === null;
        previewed.current = flies ? enemy : null;
        setEnemyCost(flies ? startingBudget(enemy) : null);
        battle.current = null;
        undecided();
        if (flies && view !== null) showOn(view, enemyAlone(enemy), false);
    };
    const abandon = (): void => {
        setAbandoning(false);
        skirmishes.abandon();
        mode.current = "round";
        resume.current = null;
        setReplaying(false);
        undecided();
        setFightable(false);
    };
    const exportSkirmish = (): void => downloadSkirmish(keptSettings(storage), skirmish, history);
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
        if (view !== null) showOpened(next, view);
        if (next.won !== undefined) skirmishes.answer();
    };

    const fault = skirmish === null ? null : fleetFault(skirmish.player);
    const fits = skirmish !== null && canFight(skirmish);
    const limit = skirmish === null || fault !== null ? null : overLimit(skirmish);
    // What to fix in your fleet, in a few words under the buttons.
    const fix =
        skirmish === null || fits || skirmish.hand !== undefined
            ? null
            : skirmish.player.ships.length === 0
              ? "add some ships"
              : fault !== null
                ? "a design won't fly"
                : limit !== null
                  ? limit
                  : `over budget on ${overBudget(skirmish)}`;
    // Why your fleet cannot fight the round, if it cannot.
    // A hand dealt is offered over the battle instead.
    const fleetProblem =
        skirmish === null || fits || skirmish.hand !== undefined
            ? null
            : skirmish.player.ships.length === 0
              ? "Your fleet has no ships: edit it to add some."
              : fault !== null
                ? `Your fleet would not fly: ${fault}. Edit it to fix that.`
                : limit !== null
                  ? `Your fleet has ${limit}: edit it to fit.`
                  : "Your fleet is over budget: edit it to cut it down.";
    const answeringNow = skirmish?.won !== undefined;
    // Not watching the search, or its answer, the history has the battle's room, the two sides of each match side by side,
    // until the next round starts.
    const wideHistory = answeringNow && skirmish.ways === undefined && !watching && !replaying;
    const timeline = (
        <Timeline
            history={history}
            leading={leading}
            wide={wideHistory}
            watch={(row, player, enemy) => replay(row.round, row.seed, player, enemy, row.orders)}
            save={(fleet) => {
                const name = unusedName(fleet.name, fleets.savedNames());
                fleets.save({ ...fleet, name });
                window.alert(`Saved to your fleets as ${name}.`);
            }}
            exportFleet={(fleet) => download(`${fleet.name}.fleet.json`, `${JSON.stringify(serialiseFleet(fleet), null, 2)}\n`)}
        />
    );
    const latest = answering.latest;
    const found = answering.latest?.found ?? null;
    const answerText =
        found !== null
            ? `Found in generation ${latest!.generation}: ${found.name}, which beats your fleet on the next round's seed.`
            : latest === null
              ? "Wait while the enemy evolves an answer: fighting the first generation of mutants…"
              : `Generation ${latest.generation}: the best enemy so far won ${latest.wins} of its ${latest.seeds} matches. It holds ${latest.cards.length} upgrade ${latest.cards.length === 1 ? "card" : "cards"}.`;
    const toggleWatching = (): void => {
        setWatching(!watching);
        // `watching` is still the old value here, so the new one is passed on.
        if (watching) view?.setRunning(false);
        else if (latest !== null) watch(latest, skirmishes.skirmish, true);
        else view?.setRunning(true);
    };
    /** On to the next round, against the answer: fought where it was found to win. */
    const goToNextRound = (): void => {
        if (skirmish === null) return;
        const going = nextRound(skirmish, skirmish.enemy);
        skirmishes.setSkirmish(going);
        showRound(going);
    };
    const headedTo = skirmish?.headed === undefined ? null : destinationById(skirmish.headed);
    // The one thing to press next in the round's buttons.
    const hand = answeringNow ? undefined : skirmish?.hand;
    const ways = answeringNow ? skirmish?.ways : undefined;
    const openPicker = (kind: "card" | "way"): void => {
        resumeAfterPick.current = running;
        view?.setRunning(false);
        setPicking(kind);
    };
    const closePicker = (): void => {
        setPicking(null);
        if (resumeAfterPick.current) view?.setRunning(true);
    };
    const progress = answeringNow || skirmish === null ? null : cardProgress(skirmish);
    const progressLine = (id: string) =>
        progress !== null &&
        progress.lost > 0 && (
            <CardProgress
                id={id}
                title={`Each fleet that loses this round counts once: when ${progress.of} have, you earn an upgrade card.`}
            >
                {`${progress.lost} of ${progress.of} different fleets lost towards an upgrade card`}
            </CardProgress>
        );
    const pickButton = (id: string, kind: "card" | "way" = "card") => (
        <Button id={id} variant="primary" onClick={() => openPicker(kind)}>
            {kind === "card" ? "Pick your upgrade card" : "Pick where to fight next"}
        </Button>
    );
    const next = answeringNow || hand !== undefined ? null : fits && !roundOver ? "fight" : "edit";
    const fightLabel = running ? "Fighting…" : ticked > 0 ? "Resume" : "Fight";
    // Before the first step there is nothing to pause, wind back or restart: the panel's Fight starts it. Once it
    // has run it stays begun, wound back to its start or not, until the round is shown afresh.
    if (!begun && (running || ticked > 0 || decided !== null)) setBegun(true);
    const started = begun || running || ticked > 0 || decided !== null;
    const parsedSides = sides === "" ? [] : (JSON.parse(sides) as { name: string; ships: string; colour: string }[]);

    return (
        <Main>
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
            <Controls>
                {skirmish === null ? (
                    // Setting one up, there is nothing to pause and nowhere to go but back.
                    <BackToMenu help={{ label: SKIRMISH_HELP_LABEL, show: help.show }} />
                ) : (
                    <PauseMenu
                        title="Paused"
                        pause={pauseView(() => view)}
                        actions={[
                            {
                                id: "exportSkirmish",
                                label: "Export skirmish",
                                title: "Save the skirmish, its settings and every match played to a file, to look into or ask about",
                                onSelect: exportSkirmish,
                            },
                            { id: "menuNewSkirmish", label: "New skirmish", onSelect: () => setAbandoning(true) },
                        ]}
                        settings={view === null ? undefined : <LookFields view={view} />}
                        keys={[...BATTLE_KEYS, ...ORDER_KEYS]}
                        notes={NOTES}
                    />
                )}
                {skirmish !== null && (
                    <>
                        {started && (
                            <Button id="play" disabled={!fightable} onClick={() => view?.setRunning(!running)}>
                                {running ? "Pause" : "Resume"}
                            </Button>
                        )}
                        <Button id="fit" onClick={() => view?.fit()}>
                            Fit
                        </Button>
                        <Playback>
                            {started && <Scrub view={view} />}
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
                        </Playback>
                        {started && (
                            <Readout id="readout" aria-label="Battle time">
                                {readout}
                            </Readout>
                        )}
                        <FrameRate aria-label="Frame rate">{fps}</FrameRate>
                    </>
                )}
            </Controls>
            <Body>
                <SkirmishHelp open={help.open && skirmish === null} onClose={help.close} />
                <SkirmishRoundHelp open={roundHelp.open} onClose={roundHelp.close} />
                <SkirmishLossHelp open={lossHelp.open} onClose={lossHelp.close} />
                <SkirmishWinHelp open={winHelp.open} onClose={winHelp.close} />
                <SkirmishCardHelp open={cardHelp.open} onClose={cardHelp.close} />
                {skirmish === null && (
                    <SetupScreen
                        key={setupKey}
                        read={read}
                        enemyCost={enemyCost}
                        onEnemy={previewEnemy}
                        onStart={start}
                        onImport={() => document.getElementById("importSkirmishFile")?.click()}
                    />
                )}
                <BattleCanvas
                    id="view"
                    onView={onView}
                    onStepped={stepped}
                    onDrawn={(at) => (shown.current = at)}
                    onRunningChanged={(now) => {
                        // A round your fleet cannot fight is there to look at: Space does not start it.
                        if (now && mode.current === "round" && battle.current === null) view?.setRunning(false);
                        else setRunning(now);
                    }}
                    onRewound={(rewound) => (battle.current = rewound as CustomBattle)}
                >
                    {wideHistory && (
                        <WideHistory id="wideHistory">
                            <Evolving id="evolving">
                                {found === null && <Spinner aria-hidden="true" />}
                                <div>
                                    <strong>{found === null ? "The enemy is evolving an answer" : "The enemy has an answer"}</strong>
                                    <p id="evolvingProgress">{answerText}</p>
                                    {headedTo !== null && skirmish !== null && (
                                        <p id="headedTo">
                                            Next round: <b>{headedTo.name}</b>. {describeArena(settingsOf(skirmish))}.
                                        </p>
                                    )}
                                </div>
                                {skirmish !== null && <ArenaPicture skirmish={skirmish} />}
                                {found === null ? (
                                    <Button id="watchEvolving" variant="primary" onClick={toggleWatching}>
                                        Watch the best so far
                                    </Button>
                                ) : (
                                    // The answer fights the next round as it will be fought: going on to it is the way to see it.
                                    <Button id="evolvingNextRound" variant="primary" onClick={goToNextRound}>
                                        Next round
                                    </Button>
                                )}
                            </Evolving>
                            <h2>History</h2>
                            {timeline}
                        </WideHistory>
                    )}
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
                            <Standings decided={decided} stood={stood} sides={stoodSides} />
                            {hand !== undefined && decided.winner !== 0 && pickButton("pickFromDecided")}
                            {ways !== undefined && decided.winner === 0 && pickButton("pickWayFromDecided", "way")}
                            {hand === undefined && decided.winner !== 0 && !replaying && !answeringNow && (
                                <>
                                    {repeatLoss && (
                                        <CardProgress id="repeatLoss">
                                            This fleet had already lost this round, so it does not count again.
                                        </CardProgress>
                                    )}
                                    {progressLine("decidedProgress")}
                                </>
                            )}
                        </Decided>
                    )}
                    {fleetProblem !== null && !answeringNow && decided === null && !replaying && (
                        <NotReady id="notReady">
                            <strong>Not ready to fight.</strong> {fleetProblem}
                        </NotReady>
                    )}
                    {hand !== undefined && skirmish !== null && picking === "card" && (
                        <EarnedCard
                            hand={hand}
                            of={settingsOf(skirmish).cardAfter}
                            onLater={closePicker}
                            onPick={(id) => {
                                const picked = pick(skirmish, id);
                                setPicking(null);
                                skirmishes.setSkirmish(picked);
                                showRound(picked);
                            }}
                        />
                    )}
                    {ways !== undefined && skirmish !== null && picking === "way" && (
                        <DestinationPick
                            ways={ways}
                            settings={settingsOf(skirmish)}
                            onLater={closePicker}
                            onPick={(id) => {
                                const going = goTo(skirmish, id);
                                setPicking(null);
                                // Its evolving is what to see next, not another battle much like the one just won.
                                setWatching(false);
                                skirmishes.setSkirmish(going);
                                skirmishes.answer();
                                if (view !== null) showOpened(going, view, false);
                            }}
                        />
                    )}
                    <AsteroidCard contents={orders.asteroid} mining={orders.mining} />
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
                            <NameField title="What this skirmish is called, which its exported files are named for">
                                Name
                                <CommitText
                                    id="skirmishName"
                                    placeholder="Name this skirmish"
                                    value={skirmish.name ?? ""}
                                    onCommit={(typed) => {
                                        const current = skirmishes.skirmish;
                                        if (current === null) return;
                                        const { name: _old, ...rest } = current;
                                        const name = typed.trim();
                                        skirmishes.setSkirmish(name === "" ? rest : { ...rest, name });
                                    }}
                                />
                            </NameField>
                            <h2 id="roundTitle">
                                {`Round ${skirmish.round}` + (skirmish.tries > 0 ? ` · try ${skirmish.tries + 1}` : "")}
                            </h2>
                            <BudgetTable
                                id="budget"
                                skirmish={skirmish}
                                names={{ player: skirmish.player.name, enemy: enemyLine ?? skirmish.enemy.name }}
                                cards={{ player: skirmish.cards ?? [], enemy: skirmish.enemyCards ?? [] }}
                            />
                            {/* A hand dealt is what to do next: it stands in for the buttons that wait on it. */}
                            {hand !== undefined && <Buttons>{pickButton("pickCard")}</Buttons>}
                            {!answeringNow && hand === undefined && (
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
                                    {started && (
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
                                    )}
                                </Buttons>
                            )}
                            {!answeringNow && fix !== null && <Fix id="editFleetWhy">Edit fleet to fight: {fix}.</Fix>}
                            {hand === undefined && progressLine("cardProgress")}
                            <Outcome id="outcome" className={outcome.kind}>
                                {outcome.text}
                            </Outcome>
                            {answeringNow && (
                                <div id="answering">
                                    {skirmish.ways !== undefined ? (
                                        <Buttons id="ways">{pickButton("pickWay", "way")}</Buttons>
                                    ) : (
                                        <>
                                            <h2>The enemy answers</h2>
                                            <Waiting>
                                                {found === null && <Spinner id="answerSpinner" aria-hidden="true" />}
                                                <p id="answerProgress">{answerText}</p>
                                            </Waiting>
                                            {found === null ? (
                                                <Buttons>
                                                    <Button
                                                        id="watchAnswer"
                                                        title="Stop or start watching the best enemy so far fight your fleet"
                                                        onClick={toggleWatching}
                                                    >
                                                        {watching ? "Stop watching" : "Watch the best so far"}
                                                    </Button>
                                                </Buttons>
                                            ) : (
                                                <Buttons id="answered">
                                                    <Button id="nextRound" variant="primary" onClick={goToNextRound}>
                                                        Next round
                                                    </Button>
                                                </Buttons>
                                            )}
                                        </>
                                    )}
                                </div>
                            )}
                            {parsedSides.length > 0 && <h2>Sides</h2>}
                            <div id="sides">
                                {parsedSides.map((side, i) => (
                                    <div key={i}>
                                        <Side>
                                            <span style={{ background: side.colour }} />
                                            {side.name}
                                        </Side>
                                        <SideStats>{side.ships}</SideStats>
                                    </div>
                                ))}
                            </div>
                        </section>
                        {!wideHistory && (
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
                                {timeline}
                            </HistoryBox>
                        )}
                    </Panel>
                )}
            </Body>
            {skirmish !== null && (
                <AbandonDialog
                    open={abandoning}
                    title={skirmishTitle(skirmish)}
                    status={skirmishStatus(skirmish)}
                    onExport={exportSkirmish}
                    onAbandon={abandon}
                    onCancel={() => setAbandoning(false)}
                />
            )}
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

/**
 * Why the battle went as it did, a ship at a time: what put each of the losing
 * side's ships out of the fight, or what each was doing while it went quiet,
 * and what the winners still had.
 */
function Standings({
    decided,
    stood,
    sides,
}: {
    readonly decided: Decision;
    readonly stood: readonly ShipStanding[];
    readonly sides: Sides;
}) {
    if (decided.reason === "time") return null;
    // As its cores are labelled in the picture, so it can be found there.
    const label = (standing: ShipStanding): string => `${teamName(standing.team, sides)} ${standing.name} (${standing.design})`;
    const losers = decided.winner < 0 ? [0, 1] : [1 - decided.winner];
    // The few worth reading, and how many more there were.
    const more = (all: number, shown: number) => (all > shown ? <li key="more">and {all - shown} more</li> : null);
    const lines = (team: number) => {
        const all = stood.filter((standing) => standing.team === team && standing.unarmed !== Unarmed.Gone);
        const shown = mostRelevant(all);
        return [
            ...shown.map((standing, k) => (
                <li key={k}>
                    <b>{label(standing)}</b>: {standing.unarmed === Unarmed.None ? quietLine(standing) : outLine(standing)}
                </li>
            )),
            more(all.length, shown.length),
        ];
    };
    const allAble =
        decided.winner < 0 ? [] : stood.filter((standing) => standing.team === decided.winner && standing.unarmed === Unarmed.None);
    const able = mostRelevant(allAble);
    return (
        <>
            {losers.map((team) => (
                <ul key={team} id={team === 0 ? "yourStanding" : "enemyStanding"}>
                    {lines(team)}
                </ul>
            ))}
            {able.length > 0 && (
                <>
                    <span>{decided.winner === 0 ? "You still had:" : "The enemy still had:"}</span>
                    <ul id="stillAble">
                        {able.map((standing, k) => (
                            <li key={k}>
                                <b>{label(standing)}</b>: {ableLine(standing)}
                            </li>
                        ))}
                        {more(allAble.length, able.length)}
                    </ul>
                </>
            )}
        </>
    );
}
