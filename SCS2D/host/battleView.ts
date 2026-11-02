import { capture, compileBlueprint, NEUTRAL_TEAM, Snapshot, type Blueprint, type ImpactLog, type ShipView } from "../sim/index.js";
import { NO_TARGET, OrderCancelCondition } from "../sim/ships.js";
import { Flashes } from "../render/flashes.js";
import {
    ARC_LABELS,
    ARCS_KEY,
    closeUps,
    draw,
    drawCloseUps,
    drawFleetStrips,
    StripCache,
    drawTargetRange,
    fleetStrips,
    nextArcs,
    overlayAt,
    overlayTileAt,
    STRIPS_KEY,
    stripsWidth,
    TEAM_SHOTS_KEY,
    viewPoint,
    type Arcs,
} from "../render/canvas2d.js";
import type { Strips } from "../render/fleetStrip.js";
import { viewOptions } from "./viewOptions.js";
import type { Inset } from "../render/inset.js";
import {
    frame,
    jumpAnchors,
    moveAcrossJump,
    moveWithVisibleShips,
    selectionBounds,
    type Bounds,
    type Camera,
    type JumpAnchor,
} from "../render/camera.js";
import { boxed, clicked, fighterGroup, sameDesign, shipViewAt, sideOf, stillThere, viewOf, wholeSide } from "../render/picking.js";
import type { Command, Held, Logged, Order } from "../scenarios/commands.js";
import type { Battle } from "../scenarios/types.js";
import { Rewind } from "../scenarios/rewind.js";
import { viewGestures } from "./viewGestures.js";
import { DEFAULT_LIGHT } from "../render/light.js";
import { sidesOf, STOCK, withSides, type Sides } from "../render/teams.js";
import { pixiUnder, type PixiView } from "../render/pixiView.js";
import { loadView, saveView, type ViewSettings } from "./viewSettings.js";

/**
 * A battle drawn on a canvas and run on the wall clock: the camera, the
 * flashes, picking a ship out, and the keys that go with them. The page
 * decides what battle it is and what else to show.
 *
 * **The wall clock lives here and only here.** The simulation takes a fixed
 * step and has no idea what time it is (DESIGN.md non-negotiable 2); this
 * accumulates real elapsed time and decides how many fixed steps to run for it.
 * That is what lets the same battle run at half speed, at eight times speed, or
 * flat out in a headless test, and come out identical.
 */

/**
 * Cap on steps per frame. A tab left in the background must not try to catch
 * up; twice what the fastest speed asks at 60 Hz, so a slow frame at 16x is
 * made up rather than dropped.
 */
const MAX_STEPS_PER_FRAME = 32;

/** The keys that arm a verb, and the one that stops. */
const VERB_KEYS: Readonly<Record<string, Verb>> = {
    k: "attack",
    d: "defend",
    r: "ram",
    h: "dock",
    g: "scavenge",
    u: "deliver",
    w: "flee",
};
const STOP_KEY = "s";
/** Picks the whole side of the selection, or the first side. */
const SIDE_KEY = "a";
const BOX_COLOUR = "#9fb4cc";

/** The ship drawn as a body, or null. */
function viewByBody(view: Snapshot, body: number): ShipView | null {
    for (let i = 0; i < view.shipCount; i++) if (view.ships[i]!.body === body) return view.ships[i]!;
    return null;
}

/** What framing a selection takes in: each picked ship, and what each is fighting and escorting. */
function pickedBounds(view: Snapshot, picked: readonly number[]): Bounds | null {
    let out: Bounds | null = null;
    for (const ship of picked) {
        const bounds = selectionBounds(view, viewOf(view, ship)?.body ?? -1);
        if (bounds === null) continue;
        out =
            out === null
                ? { ...bounds }
                : {
                      minX: Math.min(out.minX, bounds.minX),
                      minY: Math.min(out.minY, bounds.minY),
                      maxX: Math.max(out.maxX, bounds.maxX),
                      maxY: Math.max(out.maxY, bounds.maxY),
                  };
    }
    return out;
}

/** How long the frame rate is counted over before it is read again. */
const FPS_WINDOW_MS = 500;

export interface BattleView {
    /**
     * Show this battle from its start, running or held, and if `rewindable`,
     * able to be wound back and given `orders`, as a link carries them. A
     * step is `advance` where something else steps the battle, as a match
     * scoring it does.
     */
    show(battle: Battle, running: boolean, rewindable?: boolean, orders?: readonly Logged[], advance?: () => void): void;
    /** The battle on show, which winding back replaces. */
    readonly battle: Battle | null;
    /** Its sides' colours and names, from their liveries. */
    readonly sides: Sides;
    /** Steps taken, and the furthest reached. */
    readonly at: number;
    readonly reached: number;
    /** Go to the checkpoint nearest a step, or the furthest reached, if the battle can be wound back. */
    seek(step: number): void;
    setRunning(running: boolean): void;
    readonly running: boolean;
    /** Hold the battle and take one step. */
    step(): void;
    setSpeed(speed: number): void;
    /** Frame the picked ships and what they are about, or everything if none are, and keep it framed. */
    fit(): void;
    /** Remember this page's arcs and shot colours between visits, leaving the speed to the page; `defaults` for a page with none kept. */
    keepView(page: string, defaults?: ViewSettings): void;
    /** Stop the clock and let go of the window, for a page that takes the view away. */
    dispose(): void;
    readonly camera: Readonly<Camera>;
    /** Frames drawn a second, over about the last half second. */
    readonly fps: number;
    /**
     * Let the viewer give orders: right-click, a verb armed from the keys or
     * `arm`, Shift to add to the queue, Stop. Only on a battle that can be
     * wound back, since orders are logged where rewinds are kept. With `side`,
     * only that side's ships take them; with false, none do.
     */
    allowOrders(side?: number | false): void;
    /** The side of the ships picked out, if one side and one that may be given orders; else null. */
    orderSide(shown: Snapshot): number | null;
    /** Have `watcher` follow every battle shown from now, through rewinds; null for nothing. */
    watch(watcher: Watcher | null): void;
    /** The ships picked out, by the simulation's index, the first leading. */
    readonly picked: readonly number[];
    /** The verb the next click on a ship gives, or null. */
    readonly armed: Verb | null;
    /** Arm a verb, or with null, disarm; an attack finishing on `cancelOn`. */
    arm(verb: Verb | null, cancelOn?: OrderCancelCondition): void;
    /** How far off and how fast every attack, defence and ram given holds, however given; empty for doctrine's. */
    held: Held;
    /** The same as setting `held`, for a caller that may not assign to the view, as a React prop. */
    hold(next: Held): void;
    /** Give the armed verb, if its target is optional, with none: for doctrine to choose where. */
    nearest(append: boolean): void;
    /** Give a command to the battle now, logged. */
    issue(command: Command): void;
    /**
     * Have a click on a ship asked first whether it picks part of it, at the
     * world point it fell, through a close-up if it was in one; true takes the
     * click. Null to stop.
     */
    pickPart(handler: ((ship: ShipView, x: number, y: number) => boolean) | null): void;
    /** Outline these modules of this ship, by the simulation's index for it, or with null nothing. */
    mark(marked: { readonly ship: number; readonly modules: readonly number[] } | null): void;
    /** Every command given, for a link to carry. */
    readonly orders: readonly Logged[];
    /** Where a ship was last drawn, CSS pixels from the canvas's top left, or null. */
    screenOf(ship: number): { x: number; y: number } | null;
    /**
     * Make the next press on the view put a new ship built to `blueprint` into
     * the battle for `team`, asked as it is let go: where it is pressed, moving
     * as far in `PLACE_SECONDS` as it is dragged, and facing that way. Escape or
     * null gives it up. `ended` is told once it is placed or given up, not when
     * another takes its place. Only on a battle that can take orders, as it is
     * logged as one.
     */
    place(placing: { blueprint: Blueprint; team: () => number; ended?: () => void } | null): void;
    readonly placing: boolean;
}

/** The ring and line a ship being placed is drawn as. */
const PLACE_COLOUR = "#e9c05f";

/** How many seconds of travel a drag placing a new ship gives it. */
export const PLACE_SECONDS = 10;

/**
 * Something that follows a battle step by step, as a decision rule does, and
 * goes back with it: told every step the view takes or re-simulates, its
 * state kept with each checkpoint and given back when one is gone back to.
 */
export interface Watcher {
    observe(battle: Battle): void;
    save(): unknown;
    /** Back to what `save` gave, or with undefined, to how it began. */
    restore(saved: unknown): void;
}

/** What a checkpoint keeps of the view's own. */
interface Kept {
    readonly flashes: Flashes;
    readonly watched: unknown;
}

/** What a click on a ship can be armed to tell the selection. */
export type Verb = "attack" | "defend" | "ram" | "dock" | "scavenge" | "deliver" | "flee";

/** Verbs given to a friend rather than against an enemy. */
const FRIENDLY: ReadonlySet<Verb> = new Set(["defend", "dock", "deliver"]);
/** Verbs given to a ship of either side. */
const EITHER: ReadonlySet<Verb> = new Set(["scavenge", "flee"]);
/** Verbs that can be given with no target, for doctrine to choose one. */
export const ANYWHERE: ReadonlySet<Verb> = new Set(["dock", "scavenge", "deliver", "flee"]);

/**
 * `stepped` is told after every step, for whatever is judging the battle;
 * `drawn` after every frame, with what was drawn; `runningChanged` whenever
 * it starts or stops; `rewound` when it is wound back, with the copy of the
 * battle it goes on with, whose steps up to there `stepped` is not told of.
 */
export function battleView(
    canvas: HTMLCanvasElement,
    stepped: (battle: Battle) => void,
    drawn: (view: Snapshot) => void,
    runningChanged: (running: boolean) => void,
    rewound: (battle: Battle) => void = () => {},
): BattleView {
    const ctx = canvas.getContext("2d");
    if (ctx === null) throw new Error("no 2d context");

    let battle: Battle | null = null;
    /** Its sides' colours, from their liveries. */
    let sides: Sides = STOCK;
    let advance: (() => void) | null = null;
    let rewind: Rewind<Kept> | null = null;
    let watcher: Watcher | null = null;
    /** The one side that takes orders, or null for any. */
    let ownSide: number | null = null;
    const orderSide = (shown: Snapshot): number | null => {
        const side = sideOf(shown, picked);
        return side !== null && (ownSide === null || side === ownSide) ? side : null;
    };
    /** A step to go to, taken at the next frame, so dragging a scrub bar re-simulates once a frame at most. */
    let seeking = -1;
    const snapshot = new Snapshot();
    const flashes = new Flashes();
    const stripCache = new StripCache();
    // The fleet strips, on a canvas of their own over the view: left as drawn between frames, so a tile not due
    // a redraw costs nothing. It takes no input; the view under it does.
    const stripCanvas = document.createElement("canvas");
    stripCanvas.id = "strips";
    stripCanvas.setAttribute("aria-hidden", "true");
    Object.assign(stripCanvas.style, { position: "absolute", inset: "0", width: "100%", height: "100%", pointerEvents: "none" });
    canvas.style.position = "relative";
    canvas.after(stripCanvas);
    const stripCtx = stripCanvas.getContext("2d");
    if (stripCtx === null) throw new Error("no 2d context");
    const camera: Camera = { x: 0, y: 0, scale: 0.1 };
    /** The leading picked ship's body, as the renderer marks it, worked out each frame. */
    let selected = -1;
    let picked: number[] = [];
    let ordersAllowed = false;
    let partPicker: ((ship: ShipView, x: number, y: number) => boolean) | null = null;
    let markedModules: { readonly ship: number; readonly modules: readonly number[] } | null = null;
    let armed: Verb | null = null;
    let armedCancel = OrderCancelCondition.CompleteDisable;
    let held: Held = {};
    /** A box being dragged out, canvas pixels. */
    let box: { x0: number; y0: number; x1: number; y1: number } | null = null;
    let autoFrame = true;
    /** Whether auto-framing takes in the picked ships, as Fit asks, rather than everything; so does picking, while fitted. */
    let framePicked = false;
    let framed = false;
    let running = false;
    let speed = 1;
    let accumulator = 0;
    let last = 0;
    let lastSimTime = 0;
    /** The battle's time the flashes are aged to. */
    let flashesAt = 0;
    let arcs: Arcs = "none";
    let teamShots = false;
    let strips = true;
    /** What was last drawn over the view, for a tap to find. */
    let shownStrips: Strips | null = null;
    let shownInsets: Inset[] = [];
    /** Where the view's settings are kept, once a page has asked for them to be. */
    let kept: { page: string; settings: ViewSettings } | null = null;
    /** Pixi's canvas, under this one, which draws the battle: this one holds only what is dragged or placed. */
    const stacked = pixiUnder(canvas);
    const layer: PixiView = stacked.view;
    const options = viewOptions(canvas.parentElement ?? document.body, [
        {
            label: () => ARC_LABELS[arcs],
            title: "Cycle the firing arcs drawn (Ctrl+A)",
            press: () => {
                arcs = nextArcs(arcs);
                remember();
            },
        },
        {
            label: () => (teamShots ? "Shots: sides" : "Shots: light"),
            title: "Draw rounds and beams as light, or in their side's colours (C)",
            press: () => {
                teamShots = !teamShots;
                remember();
            },
        },
        {
            label: () => (strips ? "Fleets: shown" : "Fleets: hidden"),
            title: "Show or hide each side's ships down the view's edges (T)",
            press: () => {
                strips = !strips;
                remember();
            },
        },
    ]);
    const remember = (): void => {
        options.refresh();
        if (kept === null) return;
        // Over what is kept now, whose speed the page may have changed since.
        kept.settings = { ...loadView(kept.page, kept.settings), arcs, teamShots, strips };
        saveView(kept.page, kept.settings);
    };

    const resize = (): void => {
        const ratio = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        const width = Math.round(rect.width * ratio);
        const height = Math.round(rect.height * ratio);
        // Setting either clears the canvas, even to the size it already is.
        for (const each of [canvas, stripCanvas, stacked.canvas]) {
            if (each.width !== width) each.width = width;
            if (each.height !== height) each.height = height;
        }
    };
    const resizing = new ResizeObserver(resize);
    resizing.observe(canvas);
    resize();

    const setRunning = (next: boolean): void => {
        running = next;
        // Drop whatever time passed while paused, rather than running it off in one burst.
        last = 0;
        runningChanged(running);
    };
    const step = (): void => {
        if (battle === null) return;
        if (advance !== null) advance();
        else if (rewind === null) battle.step();
        else rewind.step();
        watcher?.observe(battle);
        stepped(battle);
    };

    viewGestures(
        canvas,
        camera,
        () => {
            autoFrame = false;
        },
        (x, y, reach, shift, queue) => {
            // A tile or close-up first: it is drawn over whatever is under it. Not
            // with Shift, which adds the ship under the pointer in the battle itself.
            const shown = shift ? -1 : overlayAt(shownStrips, shownInsets, camera, canvas.width, canvas.height, x, y);
            const ship = shown >= 0 ? viewByBody(snapshot, shown) : shipViewAt(snapshot, x, y, reach);
            if (armed !== null && ship !== null) {
                order(armed, ship, queue, armedCancel);
                armed = null;
                return;
            }
            if (partPicker !== null && ship !== null && !shift) {
                const at = viewPoint(shownInsets, camera, canvas.width, canvas.height, x, y);
                if (partPicker(ship, at.x, at.y)) return;
            }
            // A tile standing for a side's fighters of one design picks them all.
            const tile = shift ? null : overlayTileAt(shownStrips, shownInsets, camera, canvas.width, canvas.height, x, y);
            picked = tile !== null && tile.count > 1 ? fighterGroup(snapshot, ship) : clicked(snapshot, picked, ship, shift);
            // A close-up clicked asks to see its ship, as Fit does.
            if (shown >= 0 && tile === null && picked.length > 0) {
                autoFrame = true;
                framePicked = true;
            }
        },
        {
            commanded(x, y, reach, queue) {
                const ship = shipViewAt(snapshot, x, y, reach);
                const side = orderSide(snapshot);
                if (ship === null || side === null) return;
                // An armed verb first: on a Mac, Ctrl and a click arrive as a right-click.
                if (armed !== null) {
                    order(armed, ship, queue, armedCancel);
                    armed = null;
                    return;
                }
                // An asteroid is mined, by those with a claw to hold it.
                if (ship.rock !== undefined) order("scavenge", ship, queue, armedCancel);
                else if (ship.team !== NEUTRAL_TEAM)
                    order(ship.team === side ? "defend" : "attack", ship, queue, OrderCancelCondition.CompleteDisable);
            },
            doubled(x, y, reach) {
                if (!ordersAllowed) return;
                picked = sameDesign(snapshot, shipViewAt(snapshot, x, y, reach));
            },
            boxed(x0, y0, x1, y1) {
                if (!ordersAllowed) return;
                picked = boxed(snapshot, picked, x0, y0, x1, y1);
            },
            boxing(next) {
                box = ordersAllowed ? next : null;
            },
        },
    );

    /** The picked ships told `verb` against `target`, if that makes sense for them. */
    const order = (verb: Verb, target: ShipView, append: boolean, cancelOn: OrderCancelCondition): void => {
        const side = orderSide(snapshot);
        if (!ordersAllowed || side === null || target.ship === undefined) return;
        // On no side is only cover, and asteroids to mine.
        if (target.team === NEUTRAL_TEAM && verb !== "flee" && !(verb === "scavenge" && target.rock !== undefined)) return;
        // A friend is defended or docked with, and an enemy attacked or rammed.
        if (!EITHER.has(verb) && FRIENDLY.has(verb) !== (target.team === side)) return;
        // Only a ship with a claw scavenges: the rest keep what they were doing.
        const ships = picked.filter((i) => i !== target.ship && (verb !== "scavenge" || hasClaw(viewOf(snapshot, i))));
        if (ships.length === 0) return;
        const speed = held.speed === undefined ? {} : { speed: held.speed };
        const given: Order =
            verb === "attack"
                ? { kind: "attack", target: target.ship, cancelOn, ...held }
                : verb === "defend"
                  ? { kind: "defend", target: target.ship, ...held }
                  : verb === "ram"
                    ? { kind: "ram", target: target.ship, ...speed }
                    : { kind: verb, target: target.ship };
        issue({ kind: "order", ships, order: given, append });
    };

    const nearest = (append: boolean): void => {
        if (armed === null || !ANYWHERE.has(armed) || orderSide(snapshot) === null) return;
        issue({
            kind: "order",
            ships: picked,
            order: { kind: armed as "dock" | "scavenge" | "deliver" | "flee", target: NO_TARGET },
            append,
        });
        armed = null;
    };

    /** A ship being placed: what and whose, and once pressed, where from and where the drag has got to, world metres. */
    let placing: {
        blueprint: Blueprint;
        team: () => number;
        ended?: () => void;
        radius: number;
        from: { x: number; y: number } | null;
        to: { x: number; y: number };
    } | null = null;
    const worldAt = (event: PointerEvent): { x: number; y: number } => {
        const rect = canvas.getBoundingClientRect();
        const ratio = canvas.width / rect.width;
        const px = (event.clientX - rect.left) * ratio - canvas.width / 2;
        const py = (event.clientY - rect.top) * ratio - canvas.height / 2;
        return { x: camera.x + px / camera.scale, y: camera.y - py / camera.scale };
    };
    // Ahead of panning and picking, which a press placing a ship is neither.
    canvas.addEventListener(
        "pointerdown",
        (event) => {
            if (placing === null || event.button !== 0) return;
            event.stopImmediatePropagation();
            canvas.setPointerCapture(event.pointerId);
            placing.from = worldAt(event);
            placing.to = placing.from;
        },
        { capture: true },
    );
    canvas.addEventListener(
        "pointermove",
        (event) => {
            if (placing === null) return;
            event.stopImmediatePropagation();
            placing.to = worldAt(event);
        },
        { capture: true },
    );
    canvas.addEventListener(
        "pointerup",
        (event) => {
            if (placing?.from == null) return;
            event.stopImmediatePropagation();
            const { blueprint, team, from, ended } = placing;
            const to = worldAt(event);
            placing = null;
            ended?.();
            const dx = to.x - from.x;
            const dy = to.y - from.y;
            issue({
                kind: "spawn",
                blueprint,
                team: team(),
                x: from.x,
                y: from.y,
                vx: dx / PLACE_SECONDS,
                vy: dy / PLACE_SECONDS,
                angle: dx === 0 && dy === 0 ? 0 : Math.atan2(dy, dx),
            });
        },
        { capture: true },
    );

    const issue = (command: Command): void => {
        if (!ordersAllowed || rewind === null) return;
        // Given where the battle is now, not where a pending seek would have taken it.
        seeking = -1;
        rewind.issue(command);
        battle = rewind.battle;
    };

    const onKey = (event: KeyboardEvent): void => {
        // Typing in a field is not a command; a list or a slider still answers to Space.
        const focus = document.activeElement;
        if ((focus instanceof HTMLInputElement && focus.type !== "range") || focus instanceof HTMLTextAreaElement) return;
        if (event.key === " ") {
            event.preventDefault();
            setRunning(!running);
        } else if (event.key === ".") {
            setRunning(false);
            step();
        } else if (event.key === "," && rewind !== null) {
            setRunning(false);
            seeking = Math.max(0, (seeking >= 0 ? seeking : rewind.at) - 1);
        } else if (event.key === "Enter" && armed !== null && ANYWHERE.has(armed)) {
            event.preventDefault();
            nearest(event.ctrlKey || event.metaKey || event.shiftKey);
        } else if (event.key === "Escape") {
            if (placing !== null) {
                const ended = placing.ended;
                placing = null;
                ended?.();
            } else if (armed !== null) armed = null;
            else picked = [];
        } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === ARCS_KEY) {
            // Not the browser's select-all.
            event.preventDefault();
            arcs = nextArcs(arcs);
            remember();
        } else if (ordersAllowed && !event.altKey && event.key.toLowerCase() === SIDE_KEY) {
            const side = ownSide ?? sideOf(snapshot, picked) ?? 0;
            picked = wholeSide(snapshot, side);
        } else if (
            ordersAllowed &&
            !event.ctrlKey &&
            !event.metaKey &&
            orderSide(snapshot) !== null &&
            VERB_KEYS[event.key.toLowerCase()] !== undefined
        ) {
            armed = VERB_KEYS[event.key.toLowerCase()]!;
            armedCancel = OrderCancelCondition.CompleteDisable;
        } else if (ordersAllowed && !event.ctrlKey && !event.metaKey && event.key.toLowerCase() === STOP_KEY && picked.length > 0) {
            if (orderSide(snapshot) !== null) issue({ kind: "stop", ships: picked });
        } else if (event.key === "f" || event.key === "F") {
            autoFrame = true;
            framePicked = true;
        } else if (event.key.toLowerCase() === TEAM_SHOTS_KEY && !event.ctrlKey && !event.metaKey) {
            teamShots = !teamShots;
            remember();
        } else if (event.key.toLowerCase() === STRIPS_KEY && !event.ctrlKey && !event.metaKey) {
            strips = !strips;
            remember();
        }
    };
    window.addEventListener("keydown", onKey);

    /** What a step hit, into the flashes, as `capture` hands it over. */
    const drain = (log: ImpactLog): void => {
        addHits(flashes, log);
        log.clear();
    };

    /** The flashes a frame drawn now would show: those on screen, aged to now, and what was hit since. */
    const flashesNow = (on: Battle): Flashes => {
        const out = flashes.copy();
        const time = on.world.tick * on.world.dt;
        if (time > flashesAt) out.step(time - flashesAt);
        addHits(out, on.impacts.log);
        return out;
    };
    /** What a checkpoint keeps of the view's: its flashes, and what is watching the battle, before it sees the step. */
    const keepNow = (on: Battle): Kept => ({ flashes: flashesNow(on), watched: watcher?.save() });

    let frameRequest = 0;
    let fps = 0;
    let framesCounted = 0;
    let countedSince = 0;
    const tick = (now: number): void => {
        frameRequest = window.requestAnimationFrame(tick);
        withSides(sides, () => drawFrame(now));
    };
    const drawFrame = (now: number): void => {
        framesCounted++;
        if (now - countedSince >= FPS_WINDOW_MS) {
            if (countedSince > 0) fps = (framesCounted * 1000) / (now - countedSince);
            framesCounted = 0;
            countedSince = now;
        }
        if (last === 0) last = now;
        const elapsed = Math.min((now - last) / 1000, 0.25);
        last = now;
        if (battle === null) return;

        // A seek is a jump, not time passing: the camera is carried across it, not run on over it.
        let jumped = false;
        let anchors: JumpAnchor[] | null = null;
        if (seeking >= 0 && rewind !== null) {
            // The ships being followed, from the picture last drawn, before it is replaced.
            if (!autoFrame) anchors = jumpAnchors(camera, snapshot, canvas.width, canvas.height);
            // Flashes are those kept with the checkpoint, then rebuilt across the steps re-simulated.
            const restored = rewind.seek(
                seeking,
                (kept) => {
                    if (kept === undefined) flashes.clear();
                    else flashes.set(kept.flashes);
                    flashesAt = rewind!.battle.world.tick * rewind!.battle.dt;
                    // Kept before it saw the checkpoint's own step, which it sees now.
                    watcher?.restore(kept?.watched);
                    if (rewind!.battle.world.tick > 0) watcher?.observe(rewind!.battle);
                },
                (on) => {
                    flashes.step(on.dt);
                    drain(on.impacts.log);
                    flashesAt = on.world.tick * on.dt;
                    watcher?.observe(on);
                },
            );
            battle = rewind.battle;
            if (restored) rewound(battle);
            jumped = true;
            seeking = -1;
            accumulator = 0;
        }

        if (running) {
            accumulator += elapsed * speed;
            let steps = 0;
            while (accumulator >= battle.dt && steps < MAX_STEPS_PER_FRAME) {
                step();
                accumulator -= battle.dt;
                steps++;
            }
            // Falling behind slows the battle down rather than queueing up a lurch.
            if (steps === MAX_STEPS_PER_FRAME) accumulator = 0;
        }

        const view = capture(snapshot, battle.world, battle.ships, battle.projectiles, battle.beams, battle.wells, battle.impacts.log);
        const simDt = !jumped && view.time > lastSimTime ? view.time - lastSimTime : 0;
        lastSimTime = view.time;

        const ratio = window.devicePixelRatio || 1;
        const tiles = strips ? fleetStrips(view, canvas.width, canvas.height, ratio) : null;
        // Framed between the strips, which cover the view's edges.
        const framedWidth = canvas.width - 2 * stripsWidth(tiles);
        moveWithVisibleShips(camera, view, simDt, canvas.width, canvas.height);
        if (anchors !== null) moveAcrossJump(camera, anchors, view);
        if (autoFrame) {
            // A camera still fitted fits to what is picked; one moved by hand is left where it is.
            if (picked.length > 0) framePicked = true;
            if (!framed) {
                frame(camera, view, framedWidth, canvas.height, 1);
                framed = true;
            }
            // Framed exactly across a jump, rather than eased there in real time.
            frame(camera, (framePicked ? pickedBounds(view, picked) : null) ?? view, framedWidth, canvas.height, jumped ? 1 : undefined);
        }

        // Flashes fade on the battle's clock, so a paused battle holds them.
        flashes.step(simDt);
        flashesAt = view.time;
        for (let i = 0; i < view.impactCount; i++) {
            flashes.add(
                view.impactX[i]!,
                view.impactY[i]!,
                view.impactEnergy[i]!,
                view.impactKind[i]!,
                view.impactBody[i]!,
                view.impactLocalX[i]!,
                view.impactLocalY[i]!,
                view.impactVx[i]!,
                view.impactVy[i]!,
                view.impactGrowth[i]!,
                view.impactDirX[i]!,
                view.impactDirY[i]!,
            );
        }
        picked = stillThere(view, picked);
        selected = viewOf(view, picked[0])?.body ?? -1;
        const also = picked.slice(1).map((i) => viewOf(view, i)?.body ?? -1);
        const markedBody = markedModules === null ? -1 : (viewOf(view, markedModules.ship)?.body ?? -1);
        const marked = markedBody < 0 ? null : { body: markedBody, modules: markedModules!.modules };
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        // Nothing until Pixi has started.
        const pixi = layer.ready ? layer.begin(view, camera, canvas.width, canvas.height, battle.light) : null;
        // Pixi's context draws as a canvas does (render/pixiCanvas.ts).
        const into = pixi as unknown as CanvasRenderingContext2D;
        if (pixi !== null)
            draw(
                into,
                view,
                camera,
                canvas.width,
                canvas.height,
                flashes,
                arcs,
                teamShots,
                selected,
                also,
                marked,
                true,
                battle.light ?? DEFAULT_LIGHT,
            );
        if (tiles !== null) drawFleetStrips(stripCtx, view, tiles, selected, ratio, flashes, arcs, teamShots, stripCache);
        else stripCache.begin(stripCtx, null);
        const insets = closeUps(view, camera, canvas.width, canvas.height, selected, ratio, tiles);
        if (pixi !== null) {
            drawCloseUps(into, view, insets, selected, ratio, flashes, arcs, teamShots, marked);
            drawTargetRange(into, view, camera, canvas.width, canvas.height, selected, insets, ratio);
            layer.end();
        }
        shownStrips = tiles;
        shownInsets = insets;
        if (box !== null) {
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.strokeStyle = BOX_COLOUR;
            ctx.lineWidth = 1;
            ctx.strokeRect(box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0);
        }
        if (placing?.from != null) {
            // The new ship's hull as a ring where it will be put, and the line it will travel in `PLACE_SECONDS`.
            const toCanvas = (p: { x: number; y: number }): [number, number] => [
                (p.x - camera.x) * camera.scale + canvas.width / 2,
                (camera.y - p.y) * camera.scale + canvas.height / 2,
            ];
            const [fx, fy] = toCanvas(placing.from);
            const [tx, ty] = toCanvas(placing.to);
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.strokeStyle = PLACE_COLOUR;
            ctx.lineWidth = ratio;
            ctx.beginPath();
            ctx.arc(fx, fy, Math.max(placing.radius * camera.scale, 4 * ratio), 0, Math.PI * 2);
            ctx.moveTo(fx, fy);
            ctx.lineTo(tx, ty);
            ctx.stroke();
        }
        drawn(view);
    };
    frameRequest = window.requestAnimationFrame(tick);

    return {
        show(next, run, rewindable = false, orders = [], stepper) {
            battle = next;
            sides = sidesOf(next.liveries);
            advance = stepper ?? null;
            picked = [];
            armed = null;
            // Cleared first, so the first checkpoint keeps none of the last battle's.
            flashes.clear();
            flashesAt = 0;
            rewind = rewindable ? new Rewind(next, () => performance.now(), orders, keepNow) : null;
            seeking = -1;
            framed = false;
            autoFrame = true;
            framePicked = false;
            accumulator = 0;
            lastSimTime = 0;
            setRunning(run);
        },
        get battle() {
            return battle;
        },
        get sides() {
            return sides;
        },
        get at() {
            return rewind?.at ?? battle?.world.tick ?? 0;
        },
        get reached() {
            return rewind?.reached ?? battle?.world.tick ?? 0;
        },
        seek(target) {
            if (rewind !== null) seeking = rewind.snap(target);
        },
        allowOrders(side) {
            ordersAllowed = side !== false;
            ownSide = side === undefined || side === false ? null : side;
            if (!ordersAllowed) armed = null;
        },
        orderSide: (shown) => orderSide(shown),
        watch(next) {
            watcher = next;
        },
        get picked() {
            return picked;
        },
        get armed() {
            return armed;
        },
        arm(verb, cancelOn = OrderCancelCondition.CompleteDisable) {
            armed = ordersAllowed && picked.length > 0 ? verb : null;
            armedCancel = cancelOn;
        },
        get held() {
            return held;
        },
        set held(next) {
            held = next;
        },
        hold(next) {
            held = next;
        },
        nearest,
        issue,
        pickPart(handler) {
            partPicker = handler;
        },
        mark(next) {
            markedModules = next;
        },
        get orders() {
            return rewind?.orders ?? [];
        },
        place(next) {
            const was = placing;
            placing =
                next === null || !ordersAllowed
                    ? null
                    : { ...next, radius: compileBlueprint(next.blueprint).radius, from: null, to: { x: 0, y: 0 } };
            if (placing === null) was?.ended?.();
        },
        get placing() {
            return placing !== null;
        },
        screenOf(ship) {
            const seen = viewOf(snapshot, ship);
            if (seen === null) return null;
            const r = canvas.getBoundingClientRect().width / canvas.width;
            return {
                x: ((seen.x - camera.x) * camera.scale + canvas.width / 2) * r,
                y: (-(seen.y - camera.y) * camera.scale + canvas.height / 2) * r,
            };
        },
        setRunning,
        step() {
            setRunning(false);
            step();
        },
        get running() {
            return running;
        },
        setSpeed(next) {
            speed = next;
        },
        fit() {
            autoFrame = true;
            framePicked = true;
        },
        keepView(page, defaults) {
            const settings = loadView(page, defaults ?? { arcs, teamShots, strips, speed });
            kept = { page, settings };
            arcs = settings.arcs;
            teamShots = settings.teamShots;
            strips = settings.strips;
            options.refresh();
        },
        dispose() {
            window.cancelAnimationFrame(frameRequest);
            resizing.disconnect();
            window.removeEventListener("keydown", onKey);
            options.remove();
            stacked.remove();
            stripCanvas.remove();
            battle = null;
            rewind = null;
        },
        camera,
        get fps() {
            return fps;
        },
    };
}

/** What a log of hits holds, as flashes. */
function addHits(flashes: Flashes, log: ImpactLog): void {
    for (let i = 0; i < log.count; i++) {
        flashes.add(
            log.x[i]!,
            log.y[i]!,
            log.energy[i]!,
            log.kind[i]!,
            log.body[i]!,
            log.localX[i]!,
            log.localY[i]!,
            log.vx[i]!,
            log.vy[i]!,
            log.growth[i]!,
            log.dirX[i]!,
            log.dirY[i]!,
        );
    }
}

function hasClaw(ship: ShipView | null): boolean {
    return ship?.currentStructure.modules.some((m) => m.spec.kind === "claw") === true;
}
