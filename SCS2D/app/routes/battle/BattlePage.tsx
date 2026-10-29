import { styled } from "@linaria/react";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { BattleCanvas } from "~/features/battle/BattleCanvas";
import { useSampled } from "~/features/battle/useSampled";
import { useStorage } from "~/features/storage/StorageContext";
import { useLibrary } from "~/features/storage/useLibrary";
import { useViewSettings } from "~/features/storage/useViewSettings";
import { fleetRoute, openFleetRoute, openShipRoute } from "~/editor/handoff";
import type { BattleView } from "~/host/battleView";
import { BATTLE_KEYS, ORDER_KEYS } from "~/host/keyHelp";
import type { ViewSettings } from "~/host/viewSettings";
import { gridStep } from "~/render/camera";
import { linkedBattle } from "~/scenarios/battleLink";
import type { Logged } from "~/scenarios/commands";
import { customBattle, type BattleSetup, type CustomBattle } from "~/scenarios/customBattle";
import { SCENES } from "~/scenarios/scenes";
import type { Battle } from "~/scenarios/types";
import { math, parseFleet, type Snapshot } from "~/sim/index";
import { CustomPanel } from "./custom/CustomPanel";
import { keepSetup, keptSetup, withReturned } from "./custom/keptSetup";
import { DEFAULT_FIELDS, fieldsOf, setupOf, slotsOf, type SetupFields, type Slot } from "./custom/customSetup";
import { KeyHelp } from "~/ui/dialogs/KeyHelp";
import { AddShip } from "./orders/AddShip";
import { AsteroidCard } from "~/features/battle/AsteroidCard";
import { DOCTRINE_KEY, DoctrinePanel } from "~/features/orders/DoctrinePanel";
import { OrderBar } from "~/features/orders/OrderBar";
import { useOrderState } from "~/features/orders/orderState";
import { Scrub } from "~/features/battle/Scrub";
import { Button } from "~/ui/buttons/Button";

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

const Footer = styled.footer`
    padding: 0.4rem 0.9rem;
    border-top: 1px solid var(--colour-border);
`;

const NOTES = [
    "Blue, red, green and magenta are the sides; grey is a side beyond the fourth, or a hulk.",
    "The ring marks where the gravity well pulls at 1 m/s².",
];

const Readout = styled.output`
    margin-left: auto;
    color: var(--colour-muted);
`;

const FrameRate = styled.output`
    margin-left: 1.5em;
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
    const storage = useStorage();
    const { ships, fleets } = useLibrary();
    const navigate = useNavigate();
    // The custom setup as it was left, so a side can go to an editor and come back to the rest of it.
    const [kept] = useState(() => keptSetup(storage));
    const [slots, setSlots] = useState<readonly Slot[]>(kept?.slots ?? []);
    const [fields, setFields] = useState<SetupFields>(kept?.fields ?? DEFAULT_FIELDS);
    useEffect(() => keepSetup(storage, slots, fields), [storage, slots, fields]);
    const orders = useOrderState(view, () => shown.current);
    const [doctrineOpen, setDoctrineOpen] = useState(false);
    const [search, setSearch] = useSearchParams();

    // P opens or closes the picked ships' doctrine, as the button does.
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

    /** The scene built afresh, running or held as the battle before it was; a custom battle's logged orders replayed in it. */
    const show = (next: BattleView | null, index = scene, run = running, setup?: BattleSetup, logged: readonly Logged[] = []): void => {
        if (next === null) return;
        battle.current = index === CUSTOM ? customBattle(setup ?? setupOf(slots, fields)) : SCENES[index]!.create();
        next.show(battle.current, run, true, logged);
    };
    /** A custom battle handed over whole, by an editor or a link, held at its start. */
    const openWith = (next: BattleView, nextSlots: readonly Slot[], nextFields: SetupFields, logged: readonly Logged[] = []): void => {
        setScene(CUSTOM);
        setSlots(nextSlots);
        setFields(nextFields);
        show(next, CUSTOM, false, setupOf(nextSlots, nextFields), logged);
    };
    /**
     * What the address hands over: an editor's fleet (`?fleet=`) or a whole battle (`?battle=`). The
     * address is tidied after, so a reload is the battle route and not the hand-over again.
     */
    const takeHandOver = (next: BattleView): boolean => {
        const fleetText = search.get("fleet");
        const battleText = search.get("battle");
        if (fleetText === null && battleText === null) return false;
        setSearch({}, { replace: true });
        if (fleetText !== null) {
            try {
                const fleet = parseFleet(JSON.parse(fleetText));
                // Back from editing a side: in that side's place, the rest of the setup as it was.
                if (kept !== null && kept.editing !== null) {
                    const saved = (kind: "fleet" | "ship", name: string): boolean =>
                        (kind === "fleet" ? fleets : ships).list().some((entry) => entry.name === name);
                    openWith(next, withReturned({ ...kept, editing: kept.editing }, fleet, saved), kept.fields);
                } else openWith(next, [{ fleet, source: { kind: "other", label: `${fleet.name} (from the editor)` } }], fields);
                return true;
            } catch (error) {
                window.alert(`Could not read the fleet handed over.\n\n${error instanceof Error ? error.message : String(error)}`);
                return false;
            }
        }
        linkedBattle(`#battle=${battleText}`)
            .then((linked) => linked !== null && openWith(next, slotsOf(linked.setup, "link"), fieldsOf(linked.setup), linked.orders))
            .catch((error: unknown) =>
                window.alert(`Could not read the battle in the link.\n\n${error instanceof Error ? error.message : String(error)}`),
            );
        return false;
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
    /** Take a side to its editor, keeping the setup to come back to: the editor's Battle link brings it back in its place. */
    const editSide = (index: number): void => {
        const slot = slots[index];
        if (slot === undefined) return;
        keepSetup(storage, slots, fields, index);
        const source = slot.source;
        void navigate(
            source.kind === "ship"
                ? openShipRoute(source.name)
                : source.kind === "fleet"
                  ? openFleetRoute(source.name)
                  : fleetRoute(slot.fleet),
        );
    };
    const onView = (next: BattleView | null): void => {
        setView(next);
        // For the browser tests and anyone inspecting the page, as the old viewer has it.
        Reflect.set(window, "viewer", next ?? undefined);
        if (next === null) return;
        next.keepView(PAGE);
        next.allowOrders();
        next.setSpeed(settings.speed);
        if (!takeHandOver(next)) show(next, scene, true);
    };

    const fps = useSampled(() => (view === null || view.fps === 0 ? "" : `${Math.round(view.fps)} fps`));
    const readout = useSampled(() => {
        const at = shown.current;
        if (at === null || view === null) return "";
        return `t ${at.time.toFixed(1)} s · step ${at.tick} · grid ${gridStep(view.camera.scale)} m`;
    });
    // Not shown: kept for the browser tests and anyone inspecting the page, as the old viewer had it.
    const metrics = useSampled(() => {
        const at = shown.current;
        const now = battle.current;
        if (at === null || now === null) return "";
        // Between the first two ships, whatever the scene holds, but only if there are two.
        const [first, second] = at.ships;
        const range = first !== undefined && second !== undefined ? math.distance(first.x, first.y, second.x, second.y) : 0;
        return (
            `range ${range.toFixed(range < 10 ? 3 : 0)} m · in flight ${at.projectileCount} · ` +
            `p.fired ${now.totalProjectilesFired} · p.hits ${now.totalProjectileHits} · ` +
            `b.fired ${now.totalBeamsFired} · b.hits ${now.totalBeamHits} · ` +
            `severed ${now.totalSevered} · scrap ${(now.ships.discarded / 1000).toFixed(1)} t`
        );
    });

    return (
        <Main>
            <Controls>
                <Button id="play" onClick={() => view?.setRunning(!running)}>
                    {running ? "Pause" : "Play"}
                </Button>
                <Button id="step" onClick={() => view?.step()}>
                    Step
                </Button>
                <Button id="reset" onClick={() => show(view, scene, scene !== CUSTOM && running)}>
                    Reset
                </Button>
                <select
                    id="scene"
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
                <Button id="customBattle" title="Set up a battle between fleets" onClick={openCustom}>
                    Custom
                </Button>
                <Button id="fit" onClick={() => view?.fit()}>
                    Fit
                </Button>
                <AddShip view={view} />
                <Scrub view={view} />
                <label>
                    speed
                    <select
                        id="speed"
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
                <Readout id="readout" aria-label="Battle time">
                    {readout}
                </Readout>
                <FrameRate aria-label="Frame rate">{fps}</FrameRate>
                <output id="metrics" hidden>
                    {metrics}
                </output>
            </Controls>
            <Body>
                <BattleCanvas
                    id="view"
                    onView={onView}
                    onDrawn={(at) => (shown.current = at)}
                    onRunningChanged={setRunning}
                    onRewound={(rewound) => (battle.current = rewound)}
                >
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
                {scene === CUSTOM && (
                    <CustomPanel
                        slots={slots}
                        fields={fields}
                        onChange={changeSetup}
                        onEdit={editSide}
                        onFight={() => show(view, CUSTOM, true)}
                        current={() => (scene === CUSTOM ? (battle.current as CustomBattle | null) : null)}
                        orders={() => view?.orders ?? []}
                    />
                )}
            </Body>
            <Footer>
                <KeyHelp rows={[...BATTLE_KEYS, ...ORDER_KEYS]} notes={NOTES} />
            </Footer>
        </Main>
    );
}
