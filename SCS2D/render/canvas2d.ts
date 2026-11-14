import {
    approachesOf,
    approachTurn,
    hullMountGeometry,
    BEAM_STALK_WIDTH,
    lensDiscRadius,
    IMPACT_BEAM,
    IMPACT_BURST,
    IMPACT_EXIT,
    IMPACT_MUZZLE,
    IMPACT_ROUND,
    isHullMount,
    LANCE_BASE_SHARE,
    LANCE_PRONG_SHARE,
    UNPAINTED,
    math,
    nozzleOffset,
    nozzleReach,
    HULL_LAYER,
    landedIndex,
    layerCount,
    OWN_LAYERS,
    plumeIntensity,
    plumeLayers,
    WEAPONS_LAYER,
    PLUME_POWER_PER_NEWTON,
    PLUME_RAYS,
    SHELL_CALIBRES,
    engineGeometry,
    isMagnetic,
    type GunStats,
    type ModuleSpec,
    originOf,
    type ShipDesign,
    type Livery,
    type ShipView,
    type Snapshot,
    insetTriangle,
    fillOf,
    shapeOf,
    ROBOT_VIEW_STRIDE,
    ROBOT_BERTH_PITCH,
    BATTERY_ENERGY_PER_VOLUME,
    FUEL_DENSITY,
    GENERATOR_POWER_PER_VOLUME,
    METAL_DENSITY,
    type ModuleStats,
    berthGrid,
    edgeFade,
} from "../sim/index.js";
import { BACKGROUND, GRID, WELL, WELL_ARM_PX, WELL_PULLS } from "./backdrop.js";
import { barrelLines, MIN_BARREL_PX } from "./barrels.js";
import { fighterHeight, THICK_SHADOW_M, type Light } from "./light.js";
import { RoundedParts, type Level } from "./roundedLights.js";
import {
    BEVEL_DARK,
    BEVEL_LIGHT,
    BEVEL_OF_RADIUS,
    BEVEL_STRIDE,
    bevelQuad,
    bevelsOf,
    drawnMounts,
    isBevelled,
    MIN_BEVEL_LIT,
    MIN_BEVEL_PX,
} from "./bevels.js";
import { cylinderShade, domeShade, lightSlope, sphereShade } from "./shading.js";
import { engineLayout } from "./engineLayout.js";
import { gridStep, type Camera } from "./camera.js";
import {
    fillAlpha,
    fillColour,
    isFighterModule,
    isFitted,
    moduleFills,
    padMark,
    paintedSide,
    PORT_COLLAR_SHARE,
    PORT_COLLAR_WIDTH,
    drawnExit,
    BARREL,
    ringBars,
    ringThickness,
    type Fill,
} from "./moduleFills.js";
import {
    describeRange,
    insetAt,
    insetsFor,
    labelAlong,
    labelBeside,
    type Inset,
    type InsetArea,
    type InsetShip,
    type LabelAt,
} from "./inset.js";
import { stripsFor, stripTileAt, stripTileUnder, type StripColumn, type StripShip, type Strips, type StripTile } from "./fleetStrip.js";
import { fighterColours, markerOf, NEUTRAL, shipColours, teamLivery, teamName } from "./teams.js";
import { RESOURCE_COLOURS } from "./resources.js";
import { patternColour, patternTile, patternTransform, tileKey } from "./livery.js";
import { SOOT, SOOT_ALPHA, wearLevel, wearTile, wearTransform } from "./wear.js";

export { teamColour } from "./teams.js";
import { beamAlpha, BEAM_GLOW_ALPHA, flooredFade, legibleWidth, plumeAlpha, tracerAlpha } from "./strokes.js";
import { flashExtent, flashFade, flashPosition, muzzleWedge, type Flashes } from "./flashes.js";
import { clipToStart, exposureEnds, flashSamples, shutterWeight } from "./exposure.js";
import { flameSprite, rgba, SHARDS, sprite, WEDGE_HEADROOM, WEDGE_STEPS, wedgeBox, wedgeSprite } from "./sprites.js";
import { drawGlows, Lights, type Transform } from "./glows.js";
import { Overshadowed } from "./blocks.js";
import { Income, incomeText } from "./income.js";
import { LIGHT_GAIN, LightField, type Seen } from "./lightField.js";
import { leakSpeed } from "../sim/fuel.js";
import { LEAK_LINGER } from "../sim/snapshot.js";
import { eachCloudPuff, eachPuff, type Cloud, type Hole, type Pose, type Puff } from "./vapour.js";
import { Poses } from "./poses.js";
import { bit, bitCount, seedOf, spark, sparkColour, sparkCount, sparkFade, sprayOf, type Bit, type Spark } from "./particles.js";
import type { PixiCanvas } from "./pixiCanvas.js";
import { iconAlpha, ICON_OUTLINE, ICON_PX, isWreckage } from "./icons.js";

const { cos, floor, sin, length, max, min, PI, sqrt, TAU } = math;

/**
 * A snapshot drawn as calls on a Canvas2D context.
 *
 * On screen the context is `PixiCanvas`, a Canvas-shaped facade over Pixi, so
 * this file is the one source for what everything looks like, drawn in its true
 * order; what is hot moves out to shared geometry (`hullLayer.ts`) one thing at
 * a time (ROADMAP.md §8 step 17). It is a function of a snapshot, with no access
 * to the simulation and no state of its own beyond the camera.
 *
 * It knows no game rules. Everything it draws, it draws because the snapshot
 * says so: module boxes from the design, barrels from turret bearings, tracers
 * from projectile velocity. It never asks who is winning.
 */

/**
 * Colours, chosen so the three layers of a turret always separate. The sides'
 * own palettes are in `teams.ts`.
 *
 * A mount is drawn as its module box, then the sector it can traverse through,
 * then the barrel — and the ordering of *values* is what makes all three
 * legible rather than the ordering of hues. The sweep is a pale wash, so it
 * shows over the dark field as well as over the hull; the barrel is dark, so
 * it shows against that wash. A barrel never leaves its own sector — the two
 * share a radius — so it only ever has to contrast with the sweep, which is
 * why it can afford to be the darkest thing on the ship.
 *
 * The sweep is deliberately not team-tinted. It marks where a gun *could*
 * point rather than anything belonging to the ship, and colouring it by team
 * made it read as hull.
 */
const TRACER = "#ffe6a8";
const TRACER_GLOW = "#ffb2a888";
/**
 * A round passing through a hull, drawn as though seen through it. Null hides
 * that part, leaving only the flashes along its path.
 */
const TRACER_INSIDE: string | null = "#ffe6a840";
const TRACER_GLOW_INSIDE: string | null = null;

/**
 * Where a gun or a weapon engine will fire, faintly: on target and about to,
 * not yet, and pointing into its own ship where it will not.
 */
const TRIGGER_ON = "#ffd76a2e";
const TRIGGER_OFF = "#9fb6d61a";
const TRIGGER_FOULED = "#ff5a5a24";
/** A band's fill and edge colours. */
interface BandColours {
    readonly fill: string;
    readonly edge: string;
}
/** The band of ranges a ship's doctrine closes to, against the enemy it wants. */
const ATTACK_BAND: BandColours = { fill: "#ff9a3c14", edge: "#ff9a3c66" };
/** The band a ship stays inside round what it is escorting. */
const ESCORT_BAND: BandColours = { fill: "#7fd6c214", edge: "#7fd6c266" };
/** Where a ship turns its target to, out to the band. */
const ATTACK_LINE = "#7fd6c2b0";
const ATTACK_DASH_PX = 6;
const ATTACK_LINE_PX = 1.5;

/** Where a gun's barrel is pointing now, along its wedge, in battle. */
const BARREL_LINE = "#e6edf566";
const BARREL_LINE_PX = 1;
/** The narrowest a firing wedge's sides are drawn, in pixels; a gun's are a calibre wide otherwise. */
const MIN_TRIGGER_PX = 3;

/**
 * Which arcs a ship is drawn with: none, where each gun may point, or that and
 * where each gun and weapon engine will fire, with the band a ship's doctrine
 * closes to where it is known.
 */
export type Arcs = "none" | "firing" | "trigger";

/** The next of `Arcs`, as the key that cycles them steps through. */
export function nextArcs(arcs: Arcs): Arcs {
    return arcs === "none" ? "firing" : arcs === "firing" ? "trigger" : "none";
}

/** What a button cycling `Arcs` reads. */
export const ARC_LABELS: Record<Arcs, string> = { none: "Arcs: off", firing: "Arcs: firing", trigger: "Arcs: trigger" };

/** The key that cycles `Arcs`: alone in the editors, with Ctrl or Cmd on a battle, where alone it picks a side. */
export const ARCS_KEY = "a";

/** The key that toggles rounds and beams between light and their side's colours. */
export const TEAM_SHOTS_KEY = "c";

/** The key that shows and hides each side's ships down the view's edges. */
export const STRIPS_KEY = "t";

const BEAM = "#3df72c";
const BEAM_GLOW = "#a8f132";

/**
 * Width of the tracer's halo, in calibres, for a round at full opacity
 * (`tracerAlpha`); a fainter round's is narrower by as much, floored or not.
 * Proportional to the round rather than a fixed size, so that close up a light
 * round is a small bright thing and a heavy one is a large one — a fixed halo
 * makes every round look the same size at the zoom where its true size is
 * finally legible.
 */
const GLOW_CALIBRES = 7;

/**
 * Smallest widths anything is drawn at on screen, in pixels.
 *
 * Zoomed out, honest widths go to a fraction of a pixel and detail that
 * carries meaning stops being drawn at all: a round's two colours collapse
 * into one, and a barrel — a few centimetres of steel — disappears, taking
 * with it the only indication of where a turret is pointing. Below these
 * floors a stroke is therefore drawn wider than life. Above them the true
 * width wins and what is on screen is to scale, which is the point of having
 * derived it from the mount in the first place.
 *
 * The glow's floor is the widest because it has to stay visible *around* the
 * tracer rather than merely be present. That ordering holds at every zoom, and
 * not by luck: where the tracer is at its floor the glow's larger floor wins,
 * and where the tracer is at its true width the glow is at least
 * `GLOW_CALIBRES * TRACER_MIN_ALPHA` times it. The glow's floor is for a round
 * at full opacity, so zoomed out a fainter round's glow is smaller: it is then
 * the only thing that tells a heavy round from a light one.
 */
const MIN_GLOW_PX = 5;
/** A beam's halo, in its widths, and its floor on screen: kept apart from a tracer's. */
const BEAM_GLOW_WIDTHS = 5;
/** How far a beam's glow reaches to either side, as a share of `BEAM_GLOW_WIDTHS` of it: past the half, as it fades out to its edge. */
const BEAM_GLOW_REACH = 0.8;
/** Its brightness at the middle beside the flat stroke it replaced, which was as bright edge to edge. */
const BEAM_GLOW_BOOST = 1.2;
/** The glow where a beam leaves its emitter: its reach as a share of the beam's glow's width, and how bright beside the beam. */
const BEAM_EMITTER_REACH = 0.6;
const BEAM_EMITTER_BRIGHTNESS = 0.6;
/** Pixels across a beam is drawn as a rod lit across it, under which it is a line. */
const MIN_ROD_PX = 2;
const MIN_BEAM_GLOW_PX = 3;
const MIN_TRACER_PX = 0.1;
/** A flash is never smaller than this on screen, however far out the camera is. */
const MIN_FLASH_PX = 1;

/** A tank's wall as drawn round the fuel in it, as a share of its smaller side. */
const TANK_INSET = 0.15;
/** A store's gauge: its whole capacity in this, and what it holds over it. */
const FUEL_TRACK = "#1a1d22";
/**
 * What a store holds, in its cost's colour (`RESOURCE_COLOURS`).
 */
const FUEL = RESOURCE_COLOURS.fuel;
const METAL = RESOURCE_COLOURS.metal;
/** Charge, the third store: electric violet, the other hue the sides leave free. */
const CHARGE = "#9b7bff";
/** How much of a generator's smaller side its disc is drawn across. */
const GENERATOR_DISC = 0.55;

/** How much of a berth's square its round pad fills across, as a radius. */
const ROBOT_PAD = 0.38;

/** How many numbers a snapshot gives each robot home: its bay, its charge and metal shares, and its berth. */
const ROBOT_DOCK_STRIDE = 4;
/** Fuller than this a robot home is drawn as a filled pad rather than as itself. */
const ROBOT_FULL = 0.999;

/** A robot out on a hull, nose to tail in metres: drawn to scale, so it is seen when zoomed in close. */
const ROBOT_LENGTH = 1.2;
/** How far short of the tail each wing case stops, radians round the shell. */
const ROBOT_WING_GAP = 0.22;
/** Pixels long a robot is on screen before it is drawn in detail rather than as a dot. */
const ROBOT_DETAIL_PX = 4;
/** How round a tank's gauge is drawn at its ends, as a share of the tank's smaller side: enough to read as a tank. */
const TANK_ROUNDING = 0.35;

/** A core's gauges, its own fuel, metal and charge in three of its corners: each this share of its smaller side thick. */
const CORE_GAUGE = 0.18;
/** The core's generator disc, in its fourth corner, is never wider than this many gauges. */
const CORE_DISC_GAUGES = 1.5;
/** How far in from the core's edge they sit, as a share of its smaller side. */
const CORE_GAUGE_INSET = 0.08;
/** A core's status light, beside its generator disc or in that corner: lit while it flies anything, dark once it does not. */
const CORE_LIGHT_GAUGES = 0.7;

/** Scratch for a module's fills. */
const fills: Fill[] = [];

/** An impact: the white-hot moment, and the warmer flare around it. */
const FLASH_CORE = "#fff6e2";
const FLASH_GLOW = "#ffb257";
/** A beam's, which reads as the beam's own colour boiling the hull away. */
const BEAM_FLASH_CORE = "#eaffd9";
const BEAM_FLASH_GLOW = "#8ef04a";
/** A shell bursting: redder than a hit, since it is fire rather than metal. */
const BURST_FLASH_CORE = "#fff0c8";
const BURST_FLASH_GLOW = "#ff7a2e";
/** How much brighter a burst is than a hit's flash of its size: a blast of hot gas, not a spot. */
const BURST_BRIGHTNESS = 1.5;
/** How far a flash's glow reaches, in its core's radii. */
const FLASH_GLOW_SHARE = 2.2;
/** A muzzle flash's glow, in its core's widths: tight, so the wedge keeps its shape. */
const MUZZLE_GLOW_SHARE = 1.5;
/**
 * How much brighter than its wedge's glow a muzzle flash is as light, at the
 * muzzle itself: a small, very bright point, whose light reaches back along a
 * barrel of 40 to 50 calibres to the front of the gun's block as the flash
 * leaves, and less far as it fades.
 */
const MUZZLE_TIP_BRIGHTNESS = 4;
/** A hit's cone, in a muzzle flash's radii of the same size: a little shorter, as it opens off a face rather than out of a barrel. */
const HIT_CONE_SHARE = 0.6;
/** The hot spot where a hit struck, as a share of its flash's size. */
const HIT_SPOT_SHARE = 0.35;
/** Scratch for the way a hit's cone opens. */
const sprayed = { x: 0, y: 0 };
/** How bright a muzzle flash's glow is at its middle. */
const WEDGE_GLOW = 0.6;
/** How much of a blast's width its bright core fills; the glow is the rest. */
const BLAST_CORE_SHARE = 0.45;

/** The firing arc: a pale wash with an optional edge to define it (currently disabled). */
const SWEEP = "rgba(196, 210, 232, 0.2)";
const SWEEP_EDGE = "rgba(196, 210, 232, 0)";
/** The part of a sweep a mount may not fire into. */
const MASKED = "rgba(226, 110, 84, 0.28)";

/** A pad's ways in: the arrows on it its fighters come in along. */
const APPROACH_EDGE = "rgba(150, 214, 170, 0.8)";
/** A pad's one longest run, when nothing is clear all the way out. */
const APPROACH_BLOCKED = "rgba(232, 176, 72, 0.9)";

/**
 * How far the arc indicator reaches, as a multiple of the mount's own face.
 *
 * The quantity being shown is an *angle* — where the gun may shoot — and the
 * radius is only there to make that angle readable. Drawn at the mount's own
 * size the wedge is too small to judge, and reads as the volume the mount
 * sweeps rather than the sky it covers. Four times is enough to see the span
 * at a glance while staying well short of the weapon's actual reach, which is
 * measured in kilometres and would swallow the battle.
 *
 * From the mount rather than from the barrel, because a barrel is not a thing
 * every weapon has. A beam mount's emitter housing is about as deep as it is
 * wide, so scaling from that drew a wedge a metre or so across — invisible,
 * and invisible in a way that reads as a mount having no arc rather than as
 * the renderer having nothing to scale by. The mount's smaller face is the
 * same quantity the pivot disc is drawn at and the same one the mount's own
 * footprint is reckoned by, and every weapon has one.
 *
 * The bounds are guards rather than tuning: nothing in the current fleet
 * reaches either, and they are there so that a mount far outside today's range
 * of sizes still draws a wedge that can be read and does not swamp the ship
 * carrying it.
 */
const ARC_RADIUS_SCALE = 4;
const ARC_MIN_RADIUS = 8;
const ARC_MAX_RADIUS = 40;

/** A barrel that is not clear to fire. Dark, because it sits on the pale sweep. */
/** Bracing on a barrel too long to hold itself up: the barrel's colour, darker. */
const BRACE = "#4f3d14";
/**
 * A gun's load display: amber while it reloads, green while it is ready or a
 * beam is firing, on a grey track that shows how full it will get.
 */
const LOAD_TRACK = "#707070";
const LOAD_RELOADING = "#ffb000";
const LOAD_READY = "#4cf24c";
/** Flame colours, as the RGB a gradient fades to transparent from. */
const PLUME = "255, 217, 160";
const PLUME_CORE = "255, 244, 224";
/** A plasma lance's pulse: blue-white at its core, purple at its edge, and the purple it lights round it. */
const PULSE = "150, 90, 255";
const PULSE_CORE = "225, 235, 255";
const PULSE_GLOW = "#9a5cff";
/** How much brighter a plume's hot core is than its edge. */
const PLUME_CORE_BOOST = 1.8;
/** The glow round a burning nozzle's exit, spilling past its bell: its colour, reach as a multiple of the exit's half-width, and brightness beside the flame's. */
const NOZZLE_GLOW = "#ffd9a0";
const NOZZLE_GLOW_REACH = 1.8;
const NOZZLE_GLOW_SHARE = 0.35;
/** How long a flame is, in exit widths, when its glow is at full strength. */
const NOZZLE_GLOW_GROWN = 4;
/** A burn on a hull: the flame's colour, hotter at the middle. */
const BURN = "#ffaa5a";
const BURN_CORE = "#ffecc8";

/**
 * Trace a triangle with its corners rounded by up to `radius`. A sharp corner
 * gets less, so the curve never eats more than a fifth of the edges beside it
 * and a prow keeps its point.
 */
function roundedTriangle(ctx: CanvasRenderingContext2D, corners: readonly number[], radius: number): void {
    ctx.moveTo((corners[4]! + corners[0]!) / 2, (corners[5]! + corners[1]!) / 2);
    for (let k = 0; k < 3; k++) {
        const x = corners[2 * k]!;
        const y = corners[2 * k + 1]!;
        const nx = corners[(2 * k + 2) % 6]!;
        const ny = corners[(2 * k + 3) % 6]!;
        const px = corners[(2 * k + 4) % 6]!;
        const py = corners[(2 * k + 5) % 6]!;
        const toNext = length(nx - x, ny - y);
        const toPrev = length(px - x, py - y);
        // The tangent of half the corner's angle, from its cosine.
        const cosine = max(-1, min(1, ((nx - x) * (px - x) + (ny - y) * (py - y)) / (toNext * toPrev)));
        const halfTan = sqrt((1 - cosine) / (1 + cosine));
        const r = max(0, min(radius, 0.2 * min(toNext, toPrev) * halfTan));
        ctx.arcTo(x, y, nx, ny, r);
    }
    ctx.closePath();
}

/** What a core's room past its computing holds, m³ each: its fuel, metal, battery and generator. */
function coreRoom(stats: ModuleStats): { fuel: number; metal: number; charge: number; generator: number } {
    return {
        fuel: stats.fuel / FUEL_DENSITY,
        metal: stats.metal / METAL_DENSITY,
        charge: stats.charge / BATTERY_ENERGY_PER_VOLUME,
        generator: stats.generation / GENERATOR_POWER_PER_VOLUME,
    };
}

/**
 * A robot as a beetle `size` long, facing `heading`: a shell with its head at
 * the front, and over its back two wing cases, each a curved bar filling from
 * the waist back with what it has left — charge on its left, metal on its right.
 */
function drawRobot(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    heading: number,
    charge: number,
    metal: number,
    size: number,
    shell: string,
    head: string,
): void {
    const half = size / 2;
    const broad = size * 0.32;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(heading);
    // The shell, its back a little behind the middle.
    const back = -size * 0.08;
    ctx.fillStyle = shell;
    ctx.beginPath();
    ctx.ellipse(back, 0, half * 0.82, broad, 0, 0, TAU);
    ctx.fill();
    // The head, ahead of it.
    ctx.fillStyle = head;
    ctx.beginPath();
    ctx.ellipse(half * 0.68, 0, size * 0.16, broad * 0.62, 0, 0, TAU);
    ctx.fill();
    // The wing cases: a track round each side of the back, filled from the waist.
    const inset = broad * 0.72;
    const along = half * 0.62;
    ctx.lineWidth = size * 0.11;
    ctx.lineCap = "round";
    const wing = (side: number, share: number, fill: string): void => {
        const from = (side * PI) / 2;
        // Stopping short of the tail, so the two cases part down the middle.
        const to = side * (PI - ROBOT_WING_GAP);
        const clockwise = side < 0;
        ctx.strokeStyle = FUEL_TRACK;
        ctx.beginPath();
        ctx.ellipse(back, 0, along, inset, 0, from, to, clockwise);
        ctx.stroke();
        const left = max(0, min(1, share));
        if (!(left > 0)) return;
        ctx.strokeStyle = fill;
        ctx.beginPath();
        ctx.ellipse(back, 0, along, inset, 0, from, from + (to - from) * left, clockwise);
        ctx.stroke();
    };
    wing(-1, charge, CHARGE);
    wing(1, metal, METAL);
    ctx.restore();
}

/**
 * One ship's modules and mounts: its capital hull's, or with `fighters` those
 * of fighters, whether it is one or carries them. What belongs to the ship
 * as a whole is drawn with whichever of the two it is.
 */
function drawShip(
    ctx: CanvasRenderingContext2D,
    ship: ShipView,
    metresToPx: number,
    arcs: Arcs,
    fighters: boolean,
    /** Whether the modules' fills are drawn already, underneath. */
    filled = false,
    /** The light its rounded parts are shaded by; flat without one. */
    light?: Light,
): void {
    const design = ship.currentStructure;
    const whole = design.fighter === fighters;
    if (!whole && (!fighters || design.fighterPieces === undefined)) return;

    if (!drawPicture(ctx, ship, metresToPx, arcs, fighters, whole, filled))
        drawHull(ctx, ship, metresToPx, arcs, fighters, whole, filled, light);

    // Turrets are drawn in world space: a turret's bearing is a world bearing, so
    // rotating into the hull frame first would apply the hull's angle twice.
    const lineWidth = max(0.6, 1.5 / metresToPx);
    const c = cos(ship.angle);
    const s = sin(ship.angle);

    for (let t = 0; t < design.turrets.length; t++) {
        const module = design.turrets[t]!.module;
        if (ship.drawn?.[module] === false || isFighterModule(design, module) !== fighters) continue;
        const colours = moduleColours(design, module, ship.sides?.[module] ?? ship.team);
        const mount = design.turrets[t]!.mount;
        const mx = ship.x + mount.x * c - mount.y * s;
        const my = ship.y + mount.x * s + mount.y * c;
        const reach = mount.muzzleOffset ?? 0;
        const left = mount.leftArc ?? PI;
        const right = mount.rightArc ?? PI;
        const rest = ship.angle + (mount.restBearing ?? 0);

        // Where the gun may shoot: a mount fouled by its own ship shows a narrow
        // wedge, one with clear sky a full disc. This is the layout's cost made
        // visible — DESIGN.md §3 has arcs derived from where a gun was put rather
        // than authored, and this is what that decision bought or cost, per mount.
        //
        // Asymmetric, because the model is: an obstruction off one beam costs the
        // sweep that way alone. The wedge runs from `rest - rightArc` to
        // `rest + leftArc`, since bearings increase anticlockwise and +y is to
        // port — so the left arc is the *upper* bound. Drawing it the other way
        // round looks perfectly plausible on a symmetric ship and mirrors every
        // gun's arc on an asymmetric one.
        const spec = design.modules[design.turrets[t]!.module]!.spec;
        const face = min(spec.length, spec.width);
        // A wrecked mount shows no arc: the wash says "this gun may shoot here",
        // which is a promise a gun that cannot shoot is not making. The barrel
        // stays, because it is still there.
        if (arcs !== "none" && ship.turretDisabled?.[t] !== true) {
            const scaled = face * ARC_RADIUS_SCALE;
            const span = scaled < ARC_MIN_RADIUS ? ARC_MIN_RADIUS : scaled > ARC_MAX_RADIUS ? ARC_MAX_RADIUS : scaled;
            ctx.fillStyle = SWEEP;
            ctx.strokeStyle = SWEEP_EDGE;
            ctx.lineWidth = lineWidth * 0.8;
            ctx.beginPath();
            if (left + right >= 2 * PI) {
                ctx.arc(mx, my, span, 0, TAU);
            } else {
                ctx.moveTo(mx, my);
                ctx.arc(mx, my, span, rest - right, rest + left);
                ctx.closePath();
            }
            ctx.fill();
            ctx.stroke();

            // Where it may point and may not fire, because its own ship is
            // downrange: the trigger mask, within the sweep.
            const mask = mount.mask;
            if (mask !== undefined && mask.length > 0) {
                const whole = left + right >= 2 * PI;
                ctx.fillStyle = MASKED;
                for (let k = 0; k < mask.length; k += 2) {
                    for (let wrap = -1; wrap <= 1; wrap++) {
                        const from = whole ? mask[k]! : max(mask[k]! + wrap * TAU, -right);
                        const to = whole ? mask[k + 1]! : min(mask[k + 1]! + wrap * TAU, left);
                        if (!(to > from)) continue;
                        ctx.beginPath();
                        ctx.moveTo(mx, my);
                        ctx.arc(mx, my, span, rest + from, rest + to);
                        ctx.closePath();
                        ctx.fill();
                        if (whole) break;
                    }
                }
            }
        }

        // Where it will fire: the bearing it is aiming along, as far either side as
        // it will pull the trigger, out to as far as it is worth shooting at what
        // it is aiming at. Tinted by whether it would fire now — on target, not
        // yet, or pointing into its own ship.
        const triggerReach = ship.turretTriggerReach?.[t] ?? 0;
        // Its sides are lines a calibre wide, floored on screen, so a gun allowed
        // only a hair either side still shows which way it will fire.
        const half = ship.turretTrigger?.[t] ?? 0;
        if (arcs === "trigger" && triggerReach > 0 && ship.turretDisabled?.[t] !== true) {
            const aim = ship.turretAim?.[t] ?? rest;
            const tint = ship.turretFouled?.[t] === true ? TRIGGER_FOULED : ship.turretReady[t] === true ? TRIGGER_ON : TRIGGER_OFF;
            ctx.fillStyle = tint;
            ctx.beginPath();
            ctx.moveTo(mx, my);
            ctx.arc(mx, my, triggerReach, aim - half, aim + half);
            ctx.closePath();
            ctx.fill();
            ctx.strokeStyle = tint;
            ctx.lineWidth = legibleWidth(design.turrets[t]!.gun.calibre, MIN_TRIGGER_PX, metresToPx);
            ctx.beginPath();
            ctx.moveTo(mx + cos(aim - half) * triggerReach, my + sin(aim - half) * triggerReach);
            ctx.lineTo(mx, my);
            ctx.lineTo(mx + cos(aim + half) * triggerReach, my + sin(aim + half) * triggerReach);
            ctx.stroke();

            // In battle, where the barrel actually points, so how far it is off its
            // aim shows. A preview has no body, and its barrel is on its aim anyway.
            if (ship.body >= 0) {
                const bearing = ship.turretBearings[t] ?? aim;
                ctx.strokeStyle = BARREL_LINE;
                ctx.lineWidth = BARREL_LINE_PX / metresToPx;
                ctx.beginPath();
                ctx.moveTo(mx, my);
                ctx.lineTo(mx + cos(bearing) * triggerReach, my + sin(bearing) * triggerReach);
                ctx.stroke();
            }
        }

        const bearing = ship.turretBearings[t] ?? 0;
        const dirX = cos(bearing);
        const dirY = sin(bearing);
        const gun = design.turrets[t]!.gun;
        const count = gun.barrelCount;
        const spacing = gun.barrelSpacing;
        const hull = isHullMount(spec.kind) ? hullMountGeometry(spec) : null;
        const beamLenses = spec.kind === "hullBeam";

        // A lance has no mount to draw over its module, only the field it is charging.
        if (spec.kind === "plasmaLance") {
            drawSparks(ctx, ship, t, design.modules[module]!);
            drawLoad(ctx, ship, t, mx, my, bearing);
            continue;
        }

        // What it is made of is seen in the battle's light; what it says, its arcs and its load, is not.
        if (light !== undefined) inLight(ctx, light);
        // The rotating part itself. A turret's is a disc at the mount, sized to the
        // module it sits in so a heavy mount looks heavy. Each of a hull beam's
        // lenses has a mount of its own on a stalk out of the face. A hull gun's
        // mantlet goes on after its barrels, below. A livery picks every one out in its highlight.
        const mountColour = colours.highlight ?? colours.pivot;
        ctx.fillStyle = mountColour;
        if (hull === null) {
            // A disc looks the same however it is turned, and its light comes from the world: kept, and only moved.
            ctx.save();
            ctx.translate(mx, my);
            keep(ctx, `turret ${mountColour} ${face} ${light === undefined ? "" : idOf(light)}`, () => {
                ctx.fillStyle = mountColour;
                ctx.beginPath();
                ctx.arc(0, 0, face * 0.5, 0, TAU);
                ctx.fill();
                if (light !== undefined) shadeDome(ctx, 0, 0, face * 0.5, light);
            });
            // Drawn over the hull's lit fill, so taking all its light: outside the picture, which is kept.
            rounded?.dome(ctx.getTransform(), 0, 0, face * 0.5, rgba(mountColour), 0, turretLevel(ship));
            ctx.restore();
        } else if (beamLenses) {
            // Each lens on a disc of its own that it turns on, as wide as the lens
            // sweeps, and a stalk back from it to the block's face.
            const back = hull.trains - hull.pivot;
            const radius = lensDiscRadius(hull);
            const restX = cos(rest);
            const restY = sin(rest);
            for (let k = 0; k < count; k++) {
                const lat = count > 1 ? (k - (count - 1) * 0.5) * spacing : 0;
                const cx = mx - restY * lat;
                const cy = my + restX * lat;
                ctx.beginPath();
                ctx.arc(cx, cy, radius, 0, TAU);
                ctx.fill();
                ctx.save();
                ctx.translate(cx, cy);
                ctx.rotate(rest);
                ctx.fillRect(-back, -hull.outletWidth * BEAM_STALK_WIDTH * 0.5, back, hull.outletWidth * BEAM_STALK_WIDTH);
                ctx.restore();
            }
        }

        ctx.strokeStyle = BARREL;
        // Barrels are allowed to overlap once the floor has widened them past their
        // own gaps, which happens only when the whole ship is a hundred-odd pixels
        // across. A row that closes into one solid bar still says where the turret
        // is pointing, where holding each barrel inside its gap would shrink them
        // back below the floor and say nothing. Overlap is free: the barrel colours
        // are opaque, so a bar drawn twice looks like a bar.
        // A rail gun's rails lie on top of its block, so nothing of them is hidden.
        const hidden = hull !== null && !beamLenses && spec.kind !== "railGun";
        // The mantlet drawn over the barrels' roots, below, and each barrel's collar out of it.
        const pivot = hidden ? { x: mx, y: my, radius: min(spec.width * 0.5, ((count - 1) / 2) * spacing + hull.outletWidth) } : null;
        if (hidden) {
            // Behind the block, so a barrel trained hard over never shows its breech.
            const placed = design.modules[module]!;
            blockClip(ctx, ship, placed.x, placed.y, placed.angle, spec.length, spec.width, hull.blockLength, reach + spec.length);
        }
        ctx.beginPath();
        const physicalWidth = barrelLines(ship, t, (x0, y0, x1, y1) => {
            ctx.moveTo(x0, y0);
            ctx.lineTo(x1, y1);
        });
        ctx.lineWidth = legibleWidth(physicalWidth, MIN_BARREL_PX, metresToPx);
        ctx.stroke();
        if (light !== undefined) {
            const placed = design.modules[module]!;
            const block = hidden ? blockBox(ship, placed.x, placed.y, placed.angle, spec.length, spec.width, hull.blockLength) : null;
            shadeBarrels(ctx, ship, t, ctx.lineWidth, light, block, pivot);
        }
        if (pivot !== null) drawCollars(ctx, ship, t, ctx.lineWidth, pivot);
        if (gun.braceLength > 0) drawBracing(ctx, gun, physicalWidth, mx, my, dirX, dirY);
        if (hidden) ctx.restore();
        if (hidden) {
            // Over the barrels' roots, standing out of the block's face, so a barrel
            // trained hard over is seen to come out of it rather than the block.
            ctx.fillStyle = mountColour;
            const row = ((count - 1) / 2) * spacing + hull.outletWidth;
            mantlet(ctx, mx, my, min(spec.width * 0.5, row), rest);
        }
        if (light !== undefined) ctx.restore();
        drawLoad(ctx, ship, t, mx, my, bearing);
    }

    if (!whole) return;
    if (arcs === "trigger") drawEngineTriggers(ctx, ship, metresToPx);
    drawPlumes(ctx, ship, light);
    drawLeaks(ctx, ship, light);
}

/** Steps a gauge's level is drawn in: each a picture kept between frames (`keep`), so it is redrawn only as it moves a step. */
const GAUGE_STEPS = 64;

function gaugeStep(share: number): number {
    return Math.round(share * GAUGE_STEPS) / GAUGE_STEPS;
}

/** What a robot bay's berth shows: an empty pad, a robot being built on it, one home being filled, or one home full. */
const BERTH_EMPTY = 0;
const BERTH_BUILDING = 1;
const BERTH_FILLING = 2;
const BERTH_HOME = 3;
/** Each berth of the bay being drawn: its state, then the build's progress or the robot's charge, then its metal. */
const berthStates: number[] = [];

const ids = new WeakMap<object, number>();
let lastId = 0;

/** A number for `thing`, the same every time, for keys. */
function idOf(thing: object): number {
    let id = ids.get(thing);
    if (id === undefined) ids.set(thing, (id = ++lastId));
    return id;
}

/**
 * `draw`, kept between frames where the context can keep it (render/pixiCanvas.ts),
 * by `key`, which says everything it draws from; drawn as it is where it cannot.
 */
function keep(ctx: CanvasRenderingContext2D, key: string, draw: () => void): void {
    const keeper = (ctx as unknown as { keep?: (key: string, draw: () => void) => void }).keep;
    if (keeper === undefined) draw();
    else keeper.call(ctx, key, draw);
}

/** Pixels across on screen below which a ship's hull is drawn from a picture of it rather than shape by shape. */
const PICTURE_BELOW_PX = 32;
/** Steps a gauge's level or a module's integrity is taken to in a picture's key, so it is not redrawn every frame. */
const PICTURE_STEPS = 4;
/** Pictures kept a design, beyond which they are all let go: a design's damage and gauges only move one way. */
const PICTURES_KEPT = 48;

interface Picture {
    readonly image: HTMLCanvasElement | OffscreenCanvas;
    /** Its pixels a metre. */
    readonly scale: number;
}

/** Each design's hull pictures, by what they show (`pictureKey`), at each size drawn. */
const pictures = new WeakMap<ShipDesign, Map<string, Picture | null>>();

/** A team's colours as a key: by colour rather than team, since a team's colours are its battle's. */
function paletteKey(team: number | undefined): string {
    if (team === undefined) return "";
    const { hull, trim, pivot } = shipColours(team);
    return `${hull}${trim}${pivot}${liveryKey(teamLivery(team))}`;
}

/** Everything `drawHull` draws from, rounded to `PICTURE_STEPS`, with the picture's size in pixels. */
function pictureKey(ship: ShipView, fighters: boolean, filled: boolean, size: number): string {
    const step = (v: number | undefined): number => (v === undefined ? -1 : Math.round(v * PICTURE_STEPS));
    let key = `${size} ${paletteKey(ship.team)} ${fighters ? 1 : 0}${filled ? 1 : 0}`;
    const n = ship.currentStructure.modules.length;
    for (let i = 0; i < n; i++) {
        key +=
            `|${step(ship.integrity?.[i])},${isFitted(ship, i) ? 1 : 0},${ship.drawn?.[i] === false ? 0 : 1},${paletteKey(ship.sides?.[i])},` +
            `${ship.outOfReach?.[i] === true ? 1 : 0},${step(ship.fuel?.[i])},${step(ship.metal?.[i])},${step(ship.charge?.[i])},` +
            `${ship.berthed?.[i] ?? ""},${ship.aboard?.[i] ?? ""}`;
    }
    key += `|${ship.coresWorking?.join(",") ?? ""}|${ship.docked?.length ?? -1}|${ship.builds?.length ?? -1}`;
    return key;
}

/**
 * A small ship's hull drawn from a picture of it, made once for what it shows
 * and stamped at its place and angle: a few pixels across, it shows none of
 * what drawing it shape by shape would. Not with arcs, which reach well past
 * the hull, and not round fighters aboard, drawn in a pass of their own.
 * Whether it was drawn so; if not, it is for `drawHull`.
 */
function drawPicture(
    ctx: CanvasRenderingContext2D,
    ship: ShipView,
    metresToPx: number,
    arcs: Arcs,
    fighters: boolean,
    whole: boolean,
    filled: boolean,
): boolean {
    const design = ship.currentStructure;
    const across = 2 * design.radius * metresToPx;
    if (!(across < PICTURE_BELOW_PX) || arcs !== "none" || !whole || design.fighterPieces !== undefined) return false;
    // In powers of two, so a ship zoomed through a range is drawn at a few sizes, not one a frame.
    const size = Math.max(4, 2 ** Math.ceil(Math.log2(across)));
    const key = pictureKey(ship, fighters, filled, size);
    let kept = pictures.get(design);
    if (kept === undefined) pictures.set(design, (kept = new Map()));
    let picture = kept.get(key);
    if (picture === undefined) {
        if (kept.size >= PICTURES_KEPT) kept.clear();
        picture = makePicture(ship, fighters, filled, size);
        kept.set(key, picture);
    }
    if (picture === null) return false;
    const { image, scale } = picture;
    ctx.save();
    ctx.translate(ship.x, ship.y);
    ctx.rotate(ship.angle);
    // The picture's rows run down the screen, the world's y up it.
    ctx.scale(1 / scale, -1 / scale);
    ctx.drawImage(image, -image.width / 2, -image.height / 2);
    ctx.restore();
    return true;
}

/** Pixels round a picture's hull, for the half of an outline drawn outside it. */
const PICTURE_MARGIN_PX = 2;

function makePicture(ship: ShipView, fighters: boolean, filled: boolean, size: number): Picture | null {
    const side = size + 2 * PICTURE_MARGIN_PX;
    const image =
        typeof OffscreenCanvas !== "undefined"
            ? new OffscreenCanvas(side, side)
            : typeof document !== "undefined"
              ? Object.assign(document.createElement("canvas"), { width: side, height: side })
              : null;
    const ctx = image?.getContext("2d") as CanvasRenderingContext2D | null | undefined;
    if (image === null || ctx === null || ctx === undefined) return null;
    const scale = size / (2 * ship.currentStructure.radius);
    ctx.setTransform(scale, 0, 0, -scale, side / 2, side / 2);
    // Unlit: the light's shading follows the ship's angle in the world, and is lost at this size anyway.
    drawHull(ctx, { ...ship, x: 0, y: 0, angle: 0 }, scale, "none", fighters, true, filled, undefined);
    return { image, scale };
}

/**
 * The ship's hull in its own frame: the doctrine's band, each module's fills
 * and what is on it, and its approaches. Everything `drawShip` draws but the
 * turrets, which turn in the world, and the exhaust.
 */
function drawHull(
    ctx: CanvasRenderingContext2D,
    ship: ShipView,
    metresToPx: number,
    arcs: Arcs,
    fighters: boolean,
    whole: boolean,
    filled: boolean,
    light: Light | undefined,
): void {
    const design = ship.currentStructure;
    ctx.save();
    ctx.translate(ship.x, ship.y);
    ctx.rotate(ship.angle);

    // Where its doctrine closes to, centre to centre: under everything, so the
    // trigger wedges' tips can be read against it.
    const holdMax = ship.holdMax ?? 0;
    if (whole && arcs === "trigger" && holdMax > 0) {
        drawBand(ctx, 0, 0, ship.holdMin ?? 0, holdMax, design.doctrine.approach.bandFade, metresToPx, ATTACK_BAND);
        ctx.strokeStyle = ATTACK_LINE;
        ctx.lineWidth = ATTACK_LINE_PX / metresToPx;
        ctx.setLineDash([ATTACK_DASH_PX / metresToPx, ATTACK_DASH_PX / metresToPx]);
        for (const bearing of ship.attackBearings ?? []) {
            ctx.save();
            ctx.rotate(bearing);
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(holdMax, 0);
            ctx.stroke();
            ctx.restore();
        }
        ctx.setLineDash([]);
    }

    // Lit, every fill first and then every bevel over them, since a bevel
    // mitred into an inside corner reaches into the module beside it.
    if (!filled && light !== undefined) {
        // Seen in the battle's light, as the capital ships' fills are tinted by it in the hull layer.
        inLight(ctx, light);
        for (const bevelled of [false, true]) {
            for (let i = 0; i < design.modules.length; i++) {
                if (ship.drawn?.[i] === false || isFighterModule(design, i) !== fighters) continue;
                const m = design.modules[i]!;
                if (bevelled && !isBevelled(m.spec)) continue;
                ctx.save();
                ctx.translate(m.x, m.y);
                ctx.rotate(m.angle);
                ctx.globalAlpha = fillAlpha(ship, i);
                if (bevelled) bevel(ctx, design, i, ship.angle + m.angle, metresToPx, light);
                else keptFill(ctx, ship, i);
                ctx.restore();
            }
        }
        ctx.restore();
        filled = true;
        if (fighters) lightFighter(ctx, ship, fighters);
    }

    // Module boxes, in the body frame the design already put them in.
    for (let i = 0; i < design.modules.length; i++) {
        if (ship.drawn?.[i] === false || isFighterModule(design, i) !== fighters) continue;
        const m = design.modules[i]!;
        // A piece hooked on from another ship keeps that ship's colours; one being fitted is bare metal.
        const colours = moduleColours(design, i, paintedSide(ship, i));
        const spec = m.spec;
        ctx.save();
        ctx.translate(m.x, m.y);
        ctx.rotate(m.angle);
        // Wreckage: still there, still stopping shells, no longer doing its job.
        // Drawn as what it is rather than removed, which is what §4 means by
        // conserving matter — and it is the only way to see a ship being killed
        // module by module rather than simply going quiet.
        // Optional, because a view can be built by hand: the editor's preview and
        // the camera's tests both do, and neither has anything to be damaged.
        const integrity = ship.integrity?.[i] ?? 1;
        // Its lights are out while it is broken, and while its fittings are not all in.
        const working = integrity > 0 && isFitted(ship, i);
        ctx.globalAlpha = fillAlpha(ship, i);
        const halfLength = spec.length / 2;
        const halfWidth = spec.width / 2;
        // Unless Pixi underneath has filled it already (render/pixiView.ts).
        if (!filled) keptFill(ctx, ship, i);
        // Rounded parts' shading, in the battle's light: its highlights are that light.
        if (spec.kind === "engine" && light !== undefined) {
            inLight(ctx, light);
            shadeEngine(
                ctx,
                spec,
                ship.angle + m.angle,
                light,
                drawnMounts(design, i).round,
                rgba(fillColour(spec, colours)),
                fighters,
                colours.hull,
                fillColour(spec, colours),
            );
            ctx.restore();
        }
        if (spec.kind === "port" && light !== undefined) {
            inLight(ctx, light);
            shadePort(ctx, spec, ship.angle + m.angle, light, rgba(fillColour(spec, colours)), fighters);
            ctx.restore();
        }
        if (spec.kind === "pad") {
            // Its landing square is drawn with its fill (`fillModule`); its lights, lit by its field, here.
            drawPadLights(ctx, spec, working ? (ship.padField?.[i] ?? 0) : 0);
        } else if (
            spec.kind !== "engine" &&
            !isHullMount(spec.kind) &&
            spec.kind !== "port" &&
            spec.kind !== "slipway" &&
            spec.kind !== "claw"
        ) {
            const triangle = shapeOf(spec);
            if (spec.kind === "tank" || spec.kind === "hold" || spec.kind === "battery") {
                // A gauge, like a gun's load: the whole capacity as a track inside the
                // walls, and what is left in it filling along its longer side, so it
                // moves as far as it can: from the aft end, or the -y one. Drawn at full
                // strength however torn the store, since a wreck's load is still there
                // for a claw to take.
                const inset = min(spec.length, spec.width) * TANK_INSET;
                const share = gaugeStep(
                    (spec.kind === "tank" ? ship.fuel?.[i] : spec.kind === "hold" ? ship.metal?.[i] : ship.charge?.[i]) ?? fillOf(spec),
                );
                const content = spec.kind === "tank" ? FUEL : spec.kind === "hold" ? METAL : CHARGE;
                ctx.globalAlpha = 1;
                keep(ctx, `gauge ${idOf(spec)} ${content} ${share}`, () => {
                    if (triangle !== null) {
                        // The same band of the tank, kept inside the shape rather than drawn
                        // as the box the corners fit in. Measured from the corner furthest
                        // back along it, so a triangular tank empties the way a rectangular one does.
                        const lining = insetTriangle(triangle, inset);
                        if (lining !== null) {
                            let aft = Infinity;
                            let fore = -Infinity;
                            let low = Infinity;
                            let high = -Infinity;
                            for (let v = 0; v < lining.length; v += 2) {
                                aft = min(aft, lining[v]!);
                                fore = max(fore, lining[v]!);
                                low = min(low, lining[v + 1]!);
                                high = max(high, lining[v + 1]!);
                            }
                            ctx.save();
                            ctx.beginPath();
                            roundedTriangle(ctx, lining, min(spec.length, spec.width) * TANK_ROUNDING - inset);
                            ctx.fillStyle = FUEL_TRACK;
                            ctx.fill();
                            ctx.clip();
                            ctx.fillStyle = content;
                            if (fore - aft >= high - low) ctx.fillRect(aft, -halfWidth, (fore - aft) * share, spec.width);
                            else ctx.fillRect(-halfLength, low, spec.length, (high - low) * share);
                            ctx.restore();
                        }
                    } else {
                        // Rounded inside a square hull that meets its neighbours, the fuel kept inside the rounding.
                        const inner = spec.length - 2 * inset;
                        const across = spec.width - 2 * inset;
                        ctx.save();
                        ctx.beginPath();
                        ctx.roundRect(
                            -halfLength + inset,
                            -halfWidth + inset,
                            inner,
                            across,
                            max(0, min(spec.length, spec.width) * TANK_ROUNDING - inset),
                        );
                        ctx.fillStyle = FUEL_TRACK;
                        ctx.fill();
                        ctx.clip();
                        ctx.fillStyle = content;
                        if (inner >= across) ctx.fillRect(-halfLength + inset, -halfWidth + inset, inner * share, across);
                        else ctx.fillRect(-halfLength + inset, -halfWidth + inset, inner, across * share);
                        ctx.restore();
                    }
                });
            }
            if (spec.kind === "robotBay") {
                // A round pad for each berth, all one size, spread evenly over the
                // bay in the grid its berths make (`berthGrid`), dark once it can no
                // longer tend its robots; a robot home sits on its pad.
                ctx.globalAlpha = 1;
                const { across, down } = berthGrid(spec);
                const cellLength = spec.length / max(1, across);
                const cellWidth = spec.width / max(1, down);
                const pad = ROBOT_BERTH_PITCH * ROBOT_PAD;
                // The robots home here, each on its own berth.
                const docked = ship.docked ?? [];
                const here: number[] = [];
                for (let r = 0; r + ROBOT_DOCK_STRIDE <= docked.length; r += ROBOT_DOCK_STRIDE)
                    if (docked[r] === i) here[docked[r + 3]!] = r;
                const home = ship.berthed?.[i] ?? 0;
                // The pads after every robot aboard are the ones it is building on, in turn.
                const first = ship.aboard?.[i] ?? m.stats.robots;
                const builds = ship.builds ?? [];
                // Each berth's state first, in steps, so the bay is kept (`keep`) until one of them changes.
                const states = berthStates;
                states.length = 0;
                let made = 0;
                let key = `bay ${idOf(spec)} ${idOf(colours)} ${working}`;
                for (let k = 0; k < m.stats.robots; k++) {
                    let progress = -1;
                    if (k >= first) {
                        while (made < builds.length && builds[made] !== i) made += 2;
                        if (made < builds.length) {
                            progress = builds[made + 1]!;
                            made += 2;
                        }
                    }
                    let state: number;
                    let charge = 1;
                    let metal = 1;
                    if (progress >= 0) {
                        state = BERTH_BUILDING;
                        charge = gaugeStep(min(1, progress));
                    } else if (ship.docked === undefined ? k >= home : here[k] === undefined) state = BERTH_EMPTY;
                    else {
                        const r = here[k];
                        charge = gaugeStep(r === undefined ? 1 : docked[r + 1]!);
                        metal = gaugeStep(r === undefined ? 1 : docked[r + 2]!);
                        state = charge < ROBOT_FULL || metal < ROBOT_FULL ? BERTH_FILLING : BERTH_HOME;
                    }
                    states.push(state, charge, metal);
                    key += state === BERTH_EMPTY || state === BERTH_HOME ? ` ${state}` : ` ${state},${charge},${metal}`;
                }
                keep(ctx, key, () => {
                    ctx.lineWidth = pad * 0.25;
                    for (let k = 0; k < m.stats.robots; k++) {
                        const x = -halfLength + cellLength * ((k % across) + 0.5);
                        const y = -halfWidth + cellWidth * (floor(k / across) + 0.5);
                        const [state, charge, metal] = [states[3 * k]!, states[3 * k + 1]!, states[3 * k + 2]!];
                        if (state === BERTH_BUILDING) {
                            // A loading ring: the pad's circle drawn round as the robot is built.
                            ctx.strokeStyle = FUEL_TRACK;
                            ctx.beginPath();
                            ctx.arc(x, y, pad, 0, TAU);
                            ctx.stroke();
                            ctx.strokeStyle = colours.trim;
                            ctx.beginPath();
                            ctx.arc(x, y, pad, -PI / 2, -PI / 2 + TAU * charge);
                            ctx.stroke();
                            continue;
                        }
                        ctx.strokeStyle = working ? colours.trim : FUEL_TRACK;
                        ctx.beginPath();
                        ctx.arc(x, y, pad, 0, TAU);
                        ctx.stroke();
                        if (state === BERTH_FILLING) {
                            // Being filled: the robot itself, so its bars are seen filling.
                            drawRobot(ctx, x, y, 0, charge, metal, min(ROBOT_LENGTH, pad * 2.2), colours.trim, colours.pivot);
                        } else if (state === BERTH_HOME) {
                            ctx.fillStyle = colours.trim;
                            ctx.beginPath();
                            ctx.arc(x, y, pad * 0.55, 0, TAU);
                            ctx.fill();
                        }
                    }
                });
            }
            if (spec.kind === "generator") {
                // The plant: a disc of charge, dark once it has stopped making any.
                ctx.globalAlpha = 1;
                keep(ctx, `generator ${idOf(spec)} ${working}`, () => {
                    ctx.fillStyle = working ? CHARGE : FUEL_TRACK;
                    ctx.beginPath();
                    ctx.arc(0, 0, (min(spec.length, spec.width) * GENERATOR_DISC) / 2, 0, TAU);
                    ctx.fill();
                });
            }
            if (spec.kind === "core") {
                const lit = ship.coresWorking?.[design.cores.indexOf(i)] ?? working;
                keep(ctx, `coreLight ${idOf(spec)} ${idOf(m.stats)} ${lit}`, () => drawCoreLight(ctx, design, i, spec, lit));
            }
            if (spec.kind === "core" && working) {
                // What the core holds, each in a corner and sized by the square root
                // of its share of the room, so a small share is still seen: fuel and
                // metal forward, charge and the generator aft, the middle left for
                // the ship's name.
                ctx.globalAlpha = 1;
                const fuelShare = gaugeStep(ship.fuel?.[i] ?? fillOf(spec));
                const metalShare = gaugeStep(ship.metal?.[i] ?? fillOf(spec));
                const chargeShare = gaugeStep(ship.charge?.[i] ?? fillOf(spec));
                keep(ctx, `coreGauges ${idOf(spec)} ${idOf(m.stats)} ${fuelShare} ${metalShare} ${chargeShare}`, () => {
                    const sideways = spec.width > spec.length;
                    ctx.save();
                    if (sideways) ctx.rotate(PI / 2);
                    const along = sideways ? spec.width : spec.length;
                    const across = sideways ? spec.length : spec.width;
                    const small = min(along, across);
                    const bar = small * CORE_GAUGE;
                    const inset = small * CORE_GAUGE_INSET;
                    const reach = along / 2 - 1.5 * inset;
                    const room = coreRoom(m.stats);
                    const most = max(room.fuel, room.metal, room.charge, room.generator);
                    const size = (volume: number): number => (most > 0 ? reach * sqrt(volume / most) : 0);
                    const gauge = (share: number, x: number, length: number, y: number, fill: string): void => {
                        if (!(length > 0)) return;
                        ctx.save();
                        ctx.beginPath();
                        ctx.roundRect(x, y, length, bar, bar / 2);
                        ctx.fillStyle = FUEL_TRACK;
                        ctx.fill();
                        ctx.clip();
                        ctx.fillStyle = fill;
                        ctx.fillRect(x, y, length * share, bar);
                        ctx.restore();
                    };
                    const top = -across / 2 + inset;
                    const bottom = across / 2 - inset - bar;
                    const fore = along / 2 - inset;
                    const aft = -along / 2 + inset;
                    const fuel = size(room.fuel);
                    const metal = size(room.metal);
                    gauge(fuelShare, fore - fuel, fuel, top, FUEL);
                    gauge(metalShare, fore - metal, metal, bottom, METAL);
                    gauge(chargeShare, aft, size(room.charge), top, CHARGE);
                    const disc = min(size(room.generator), bar * CORE_DISC_GAUGES);
                    if (disc > 0) {
                        ctx.fillStyle = CHARGE;
                        ctx.beginPath();
                        ctx.arc(aft + disc / 2, across / 2 - inset - disc / 2, disc / 2, 0, TAU);
                        ctx.fill();
                    }
                    ctx.restore();
                });
            }
        }
        ctx.restore();
    }
    // Over the hull, since fighters come in over it.
    if (whole && arcs !== "none") drawApproaches(ctx, ship, metresToPx);
    ctx.restore();
}

/** A ship's robots out on its hull: over every capital hull, under every fighter. */
/**
 * Clip what follows to outside a hull mount's block, out to `reach` from its
 * middle; the caller restores. In world coordinates, from the module's place
 * in its ship.
 */
function blockClip(
    ctx: CanvasRenderingContext2D,
    ship: ShipView,
    x: number,
    y: number,
    angle: number,
    length: number,
    width: number,
    block: number,
    reach: number,
): void {
    const c = cos(ship.angle);
    const s = sin(ship.angle);
    const cx = ship.x + x * c - y * s;
    const cy = ship.y + x * s + y * c;
    const a = ship.angle + angle;
    const ax = cos(a);
    const ay = sin(a);
    const back = -length / 2;
    const half = width / 2;
    ctx.save();
    ctx.beginPath();
    ctx.rect(cx - reach, cy - reach, 2 * reach, 2 * reach);
    for (const [along, across] of [
        [back, -half],
        [back + block, -half],
        [back + block, half],
        [back, half],
    ] as const) {
        const px = cx + ax * along - ay * across;
        const py = cy + ay * along + ax * across;
        if (along === back && across === -half) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.clip("evenodd");
}

/** A half disc on a face, its round side out along `facing`. */
function mantlet(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, facing: number): void {
    ctx.beginPath();
    ctx.arc(x, y, radius, facing - PI / 2, facing + PI / 2);
    ctx.closePath();
    ctx.fill();
}

/**
 * Whether any of a ship's robots out is near the box `halfW` by `halfH` either
 * side of `x`, `y`: one working on a rock it is moored to is well off its own
 * hull, so the hull's being out of view says nothing.
 */
function robotsShown(ship: ShipView, x: number, y: number, halfW: number, halfH: number): boolean {
    const robots = ship.robots ?? [];
    let reach = 0;
    for (let r = 0; r + ROBOT_VIEW_STRIDE <= robots.length; r += ROBOT_VIEW_STRIDE) {
        reach = max(reach, length(robots[r]!, robots[r + 1]!));
    }
    reach += ROBOT_LENGTH;
    return Math.abs(ship.x - x) - reach <= halfW && Math.abs(ship.y - y) - reach <= halfH;
}

function drawRobots(ctx: CanvasRenderingContext2D, ship: ShipView): void {
    const robots = ship.robots ?? [];
    if (robots.length === 0) return;
    const colours = shipColours(ship.team);
    const m = ctx.getTransform();
    if (ROBOT_LENGTH * Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) < ROBOT_DETAIL_PX) {
        // Too small for its wing cases to be told apart: a dot of its shell's colour.
        ctx.save();
        ctx.translate(ship.x, ship.y);
        ctx.rotate(ship.angle);
        ctx.fillStyle = colours.trim;
        ctx.beginPath();
        for (let r = 0; r + ROBOT_VIEW_STRIDE <= robots.length; r += ROBOT_VIEW_STRIDE) {
            const half = ROBOT_LENGTH / 2;
            ctx.rect(robots[r]! - half, robots[r + 1]! - half * 0.6, ROBOT_LENGTH, half * 1.2);
        }
        ctx.fill();
        ctx.restore();
        return;
    }
    ctx.save();
    ctx.translate(ship.x, ship.y);
    ctx.rotate(ship.angle);
    for (let r = 0; r + ROBOT_VIEW_STRIDE <= robots.length; r += ROBOT_VIEW_STRIDE) {
        drawRobot(
            ctx,
            robots[r]!,
            robots[r + 1]!,
            robots[r + 2]!,
            robots[r + 3]!,
            robots[r + 4]!,
            ROBOT_LENGTH,
            colours.trim,
            colours.pivot,
        );
    }
    ctx.restore();
}

/** `colour` lit by a light of `light`'s colour, as the hull's lit fills are: each channel multiplied. */
function litColour(colour: string, light: string): string {
    const [r, g, b] = rgba(colour);
    const [lr, lg, lb] = rgba(light);
    const hex = (c: number, l: number): string =>
        Math.round((c * l) / 255)
            .toString(16)
            .padStart(2, "0");
    return `#${hex(r, lr)}${hex(g, lg)}${hex(b, lb)}`;
}

/** What leaking fuel looks like: vapour, white, in the light it is seen in. */
const LEAK = "#ebf2fa";
const LEAK_RGB = rgba(LEAK);

/**
 * Fuel leaking from a hole: puffs of white vapour (`render/vapour.ts`) widening
 * and thinning as they go, reaching further the faster fuel is going out, so a
 * gash reads from across the battle and a pinhole as a wisp. They leave as fast
 * as the fuel does, far slower than an engine's exhaust, so a new leak grows out
 * of its hole and one closing thins at the hole while what is out drifts on.
 * One batch a ship, laid over what is under it.
 */
function drawLeaks(ctx: CanvasRenderingContext2D, ship: ShipView, light?: Light): void {
    const xs = ship.leakX;
    if (xs === undefined || xs.length === 0) return;
    const image = sprite("halo", "#ffffff");
    const batches = (ctx as Partial<{ particles: PixiCanvas["particles"] }>).particles;
    if (image === null || batches === undefined) return;
    // Set out from where the hull was when each puff left, where that is kept;
    // otherwise in the hull's frame as it is now.
    const tracked = poses.at(ship.body, ship.serial, 0, pose);
    ctx.save();
    if (!tracked) {
        ctx.translate(ship.x, ship.y);
        ctx.rotate(ship.angle);
    }
    const poseAgo = tracked ? (ago: number, into: Pose): boolean => poses.at(ship.body, ship.serial, ago, into) : undefined;
    const [r, g, b] = rgba(light === undefined ? LEAK : litColour(LEAK, light.colour));
    const tint = (r << 16) | (g << 8) | b;
    // In a shadow, only the light's ambient share, as the hull there is.
    const shaded = light !== undefined && overshadowed.set(ship, light);
    const dim = light?.ambient ?? 1;
    const shadowTint = (Math.round(r * dim) << 16) | (Math.round(g * dim) << 8) | Math.round(b * dim);
    const c = Math.cos(ship.angle);
    const s = Math.sin(ship.angle);
    const inShadow = (p: Puff): boolean => {
        if (!tracked) return overshadowed.covers(p.x, p.y);
        // Set out from a past pose, so in the world: into the hull's frame as it is now.
        const dx = p.x - ship.x;
        const dy = p.y - ship.y;
        return overshadowed.covers(dx * c + dy * s, -dx * s + dy * c);
    };
    let batch: ReturnType<PixiCanvas["particles"]> | null = null;
    for (let k = 0; k < xs.length; k++) {
        const width = ship.leakWidth![k]!;
        const age = ship.leakAge?.[k] ?? LONG_OPEN;
        // Shut, or with nothing left behind it, long enough for its vapour to have drifted off: only its mark is left.
        const closed = ship.leakClosed?.[k];
        if (closed !== undefined && !(ship.leakRate![k]! > 0) && !(closed >= 0 && age - closed < LEAK_LINGER)) continue;
        // What the hole has been, or, for a picture that does not say, as it is now and always was.
        hole.opened = ship.leakOpened?.[k] ?? width;
        hole.closing = ship.leakClosing?.[k] ?? 0;
        hole.floor = ship.leakFloor?.[k] ?? width;
        hole.patched = ship.leakPatched?.[k] ?? -1;
        const fill = ship.leakFill?.[k] ?? 1;
        const speed = ship.leakSpeed?.[k] ?? leakSpeed(fill);
        const dx = ship.leakDirX![k]!;
        const dy = ship.leakDirY![k]!;
        // At deck height, so under the thick modules standing over it.
        batch ??= batches.call(ctx, image, false, true);
        const into = batch;
        eachPuff(
            hole,
            xs[k]!,
            ship.leakY![k]!,
            dx,
            dy,
            age,
            fill,
            speed,
            puff,
            (p) => {
                const base = shaded && inShadow(p) ? shadowTint : tint;
                // In the world, for the light there: set out from a past pose it already is.
                const x = tracked ? p.x : ship.x + p.x * c - p.y * s;
                const y = tracked ? p.y : ship.y + p.x * s + p.y * c;
                into.add(p.x, p.y, p.dirX, p.dirY, p.length, 2 * p.radius, lightUp(base, LEAK_RGB, x, y), p.alpha);
            },
            poseAgo,
        );
    }
    batch?.end();
    ctx.restore();
}

/** Scratch for drawing a leak, so drawing one allocates nothing. */
const hole: Hole = { opened: 0, closing: 0, floor: 0, patched: -1 };
const puff: Puff = { x: 0, y: 0, radius: 0, dirX: 1, dirY: 0, length: 0, alpha: 0 };
const pose: Pose = { x: 0, y: 0, angle: 0, vx: 0, vy: 0 };
/** Whether a puff is in its own ship's shadows. */
const overshadowed = new Overshadowed();
/** Where each leaking ship has been lately, for its vapour to set out from. */
const poses = new Poses();
/** How long a hole is taken to have been open where a picture does not say: long enough for its vapour to have reached its end. */
const LONG_OPEN = 1e6;

/**
 * The bracing on a row of long barrels: a block either side of the row and
 * one filling each gap between neighbours, which share it, out from the root
 * of the barrels.
 */
function drawBracing(
    ctx: CanvasRenderingContext2D,
    gun: GunStats,
    barrelWidth: number,
    mx: number,
    my: number,
    dirX: number,
    dirY: number,
): void {
    const count = gun.barrelCount;
    const half = barrelWidth * 0.5;
    const first = count > 1 ? -(count - 1) * 0.5 * gun.barrelSpacing : 0;
    const last = -first;
    const far = gun.braceLength;
    ctx.fillStyle = BRACE;
    const block = (from: number, to: number): void => {
        ctx.beginPath();
        ctx.moveTo(mx - dirY * from, my + dirX * from);
        ctx.lineTo(mx + dirX * far - dirY * from, my + dirY * far + dirX * from);
        ctx.lineTo(mx + dirX * far - dirY * to, my + dirY * far + dirX * to);
        ctx.lineTo(mx - dirY * to, my + dirX * to);
        ctx.closePath();
        ctx.fill();
    };
    block(first - half - gun.braceWidth, first - half);
    block(last + half, last + half + gun.braceWidth);
    for (let k = 0; k + 1 < count; k++) {
        const lat = first + k * gun.barrelSpacing;
        block(lat + half, lat + gun.barrelSpacing - half);
    }
}

/**
 * A gun's load, as a display on the mount: an arc round the back of a
 * turret's ring, or a bar down the starboard side of a hull mount's block.
 */
function drawLoad(ctx: CanvasRenderingContext2D, ship: ShipView, t: number, mx: number, my: number, bearing: number): void {
    // A view built by hand says nothing of loading, so its guns are ready. A
    // disabled gun is empty, so it never shows a ready light.
    const load = ship.turretDisabled?.[t] === true ? 0 : (ship.turretLoad?.[t] ?? 1);
    const module = ship.currentStructure.modules[ship.currentStructure.turrets[t]!.module]!;
    const spec = module.spec;
    const colour = ship.turretReloading?.[t] === true ? LOAD_RELOADING : LOAD_READY;
    if (isHullMount(spec.kind)) {
        const block = hullMountGeometry(spec).blockLength;
        const thick = min(spec.width * 0.08, block * 0.25);
        const end = block * 0.12;
        const from = -spec.length / 2 + end;
        const span = block - 2 * end;
        const y = -spec.width / 2 + thick;
        ctx.save();
        ctx.translate(ship.x, ship.y);
        ctx.rotate(ship.angle);
        ctx.translate(module.x, module.y);
        ctx.rotate(module.angle);
        ctx.fillStyle = LOAD_TRACK;
        ctx.fillRect(from, y, span, thick);
        ctx.fillStyle = colour;
        ctx.fillRect(from, y, span * load, thick);
        ctx.restore();
        return;
    }
    // Inside the ring's back edge, by about its own thickness.
    const pivot = min(spec.length, spec.width) * 0.5;
    const thick = pivot * 0.14;
    const radius = pivot - 2 * thick;
    const half = PI * 0.3;
    const step = gaugeStep(load);
    // The same ring at any bearing, so kept by how full it is and turned to the barrel's.
    ctx.save();
    ctx.translate(mx, my);
    ctx.rotate(bearing + PI);
    keep(ctx, `load ${radius} ${thick} ${colour} ${step}`, () => {
        ctx.lineWidth = thick;
        ctx.lineCap = "butt";
        ctx.strokeStyle = LOAD_TRACK;
        ctx.beginPath();
        ctx.arc(0, 0, radius, -half, half);
        ctx.stroke();
        if (step > 0) {
            ctx.strokeStyle = colour;
            ctx.beginPath();
            ctx.arc(0, 0, radius, -half, -half + 2 * half * step);
            ctx.stroke();
        }
    });
    ctx.restore();
}

/**
 * Where each engine used as a weapon will burn: the part of each flame that
 * lands enough to fire for, tinted as a gun's wedge is.
 */
function drawEngineTriggers(ctx: CanvasRenderingContext2D, ship: ShipView, metresToPx: number): void {
    const reaches = ship.engineTriggerReach;
    if (reaches === undefined) return;
    const design = ship.currentStructure;
    ctx.save();
    ctx.translate(ship.x, ship.y);
    ctx.rotate(ship.angle);
    ctx.lineWidth = legibleWidth(0, MIN_TRIGGER_PX, metresToPx);
    for (let t = 0; t < design.engines.length; t++) {
        const reach = reaches[t] ?? 0;
        const engine = design.engines[t]!;
        const module = design.modules[engine.module ?? -1];
        if (!(reach > 0) || module === undefined) continue;
        const tint = (engine.escaping ?? 1) <= 0 ? TRIGGER_FOULED : ship.engineFiring?.[t] === true ? TRIGGER_ON : TRIGGER_OFF;
        const geometry = engineGeometry(module.spec);
        const root = -module.spec.length / 2;
        const half = geometry.exitWidth / 2;
        ctx.save();
        ctx.translate(module.x, module.y);
        ctx.rotate(module.angle);
        ctx.fillStyle = tint;
        ctx.strokeStyle = tint;
        for (let n = 0; n < geometry.nozzles; n++) {
            const across = nozzleOffset(geometry, n);
            ctx.beginPath();
            ctx.moveTo(root, across - half);
            ctx.lineTo(root - reach, across);
            ctx.lineTo(root, across + half);
            ctx.closePath();
            ctx.fill();
            ctx.beginPath();
            ctx.moveTo(root, across - half);
            ctx.lineTo(root - reach, across);
            ctx.lineTo(root, across + half);
            ctx.stroke();
        }
        ctx.restore();
    }
    ctx.restore();
}

/**
 * Whether a nozzle's plume, from its exit out `reach` and as wide as its glow,
 * reaches the box being drawn: `across` from its engine's middle, on module
 * `m` of a ship turned by `sc`, `ss`.
 */
function plumeNear(
    ship: ShipView,
    sc: number,
    ss: number,
    m: { x: number; y: number; angle: number },
    length: number,
    across: number,
    reach: number,
    exitWidth: number,
): boolean {
    const mc = cos(m.angle);
    const ms = sin(m.angle);
    const world = (px: number, py: number): [number, number] => {
        const x = m.x + px * mc - py * ms;
        const y = m.y + px * ms + py * mc;
        return [ship.x + x * sc - y * ss, ship.y + x * ss + y * sc];
    };
    const [x0, y0] = world(-length / 2, across);
    const [x1, y1] = world(-length / 2 - reach, across);
    const pad = exitWidth * NOZZLE_GLOW_REACH;
    return (
        max(x0, x1) + pad >= shownBox.x - shownBox.halfW &&
        min(x0, x1) - pad <= shownBox.x + shownBox.halfW &&
        max(y0, y1) + pad >= shownBox.y - shownBox.halfH &&
        min(y0, y1) - pad <= shownBox.y + shownBox.halfH
    );
}

/** How far the longest plume a ship is burning reaches past its engine, metres; 0 for none. */
export function plumeReach(ship: ShipView): number {
    const design = ship.currentStructure;
    let engine = 0;
    let most = 0;
    for (const m of design.modules) {
        if (m.spec.kind !== "engine") continue;
        const t = engine++;
        const force = (ship.throttles[t] ?? 0) * (design.engines[t]?.maxThrust ?? 0);
        if (force > 0) most = max(most, nozzleReach(engineGeometry(m.spec), force));
    }
    return most;
}

/**
 * Exhaust, in a pass of its own after the turrets.
 *
 * Drawn last of the ship's parts because a plume is in front of the hull, not
 * part of it: sharing the module pass put it *under* the sector a nearby
 * turret sweeps, which dimmed a burning engine to the colour of a shadow.
 */
/** The most sparks a fully charged lance shows between its prongs. */
const MAX_SPARKS = 7;
/** Kinks in each spark. */
const SPARK_KINKS = 4;
/** How many times a second the lightning changes shape. */
const SPARK_RATE = 12;
const SPARK = "rgba(170, 220, 255, 0.9)";

/** A number in [0, 1) that depends on its three arguments alone. */
function sparkNoise(a: number, b: number, c: number): number {
    let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1);
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Lightning between a plasma lance's prongs, none when it is empty and more as
 * it fills: it leaks what it holds, and this is the leak. Its shape follows the
 * ship's spark clock, so it holds still while time does and while the view moves.
 */
function drawSparks(
    ctx: CanvasRenderingContext2D,
    ship: ShipView,
    t: number,
    module: { x: number; y: number; angle: number; spec: ModuleSpec },
): void {
    const charge = ship.turretDisabled?.[t] === true ? 0 : (ship.turretSparks?.[t] ?? 0);
    const count = Math.round(charge * charge * MAX_SPARKS);
    if (count === 0) return;
    const { spec } = module;
    const l = spec.length / 2;
    const w = spec.width / 2;
    const from = -l + spec.length * LANCE_BASE_SHARE;
    const edge = w - spec.width * LANCE_PRONG_SHARE;
    const frame = Math.floor((ship.sparkClock ?? 0) * SPARK_RATE);
    ctx.save();
    ctx.translate(ship.x, ship.y);
    ctx.rotate(ship.angle);
    ctx.translate(module.x, module.y);
    ctx.rotate(module.angle);
    ctx.strokeStyle = SPARK;
    ctx.lineWidth = spec.width * 0.03;
    ctx.beginPath();
    for (let k = 0; k < count; k++) {
        const x = from + sparkNoise(frame, t, k * SPARK_KINKS) * (l - from);
        ctx.moveTo(x, -edge);
        for (let j = 1; j < SPARK_KINKS; j++) {
            ctx.lineTo(x + (sparkNoise(frame, t, k * SPARK_KINKS + j) - 0.5) * edge, -edge + (2 * edge * j) / SPARK_KINKS);
        }
        ctx.lineTo(x, edge);
    }
    ctx.stroke();
    ctx.restore();
}

function drawPlumes(ctx: CanvasRenderingContext2D, ship: ShipView, light?: Light): void {
    eachNozzle(
        ctx,
        ship,
        (engine, force, reach, across, landed, split) => {
            // One flame per nozzle, the same triangles the burn samples its rays
            // across. How hot it burns is its opacity, and it fades to nothing at its
            // tip the way its share of the power does, so the brightest part of the
            // picture is the part doing the most damage.
            const root = -engine.length / 2;
            // As wide as its bell is drawn: a magnetic nozzle's is narrower, its jet the same.
            const gap = engine.geometry.nozzleLength - engine.geometry.bellLength;
            const half = drawnExit(engine.geometry, gap > 0);
            const image = flameSprite(PLUME, PLUME_CORE);
            if (image === null) return;
            const outer = ctx.globalAlpha;
            const brightness = layerAlpha(min(1, plumeAlpha(plumeIntensity(engine.geometry, force)) * PLUME_CORE_BOOST), split);
            // The flame blurred: from the exit, past the bell's sides and back over its
            // mouth, out to where the flame ends or lands; light, so it brightens
            // whatever it is over. Fading in with the flame, so a short one has no
            // glow larger than itself.
            const grown = min(1, reach / (NOZZLE_GLOW_GROWN * 2 * half));
            const g = half * NOZZLE_GLOW_REACH * (0.5 + 0.5 * grown);
            const shown = landed[1]! > 0 ? (1 - landed[1]!) * reach : reach;
            // A magnetic nozzle's jet glows from its bell, through the gap to its ring.
            lights.coneOf(
                ctx.getTransform(),
                root + gap,
                across,
                root - shown,
                across,
                g,
                NOZZLE_GLOW,
                outer * brightness * NOZZLE_GLOW_SHARE * grown,
                heightOf(ship),
            );
            // The sprite's core is its brightest, its edge a little dimmer.
            ctx.globalAlpha = outer * brightness;
            // A magnetic nozzle's jet runs straight from its bell through its ring,
            // as the flame's own base does: its last column, stretched over the gap.
            if (gap > 0) ctx.drawImage(image, image.width - 1, 0, 1, image.height, root, across - half, gap, 2 * half);
            let cutAny = false;
            for (let k = 0; k < PLUME_RAYS; k++) if (landed[k]! > 0) cutAny = true;
            if (!cutAny) ctx.drawImage(image, root - reach, across - half, reach, 2 * half);
            else {
                // Each third cut off where it lands on a hull, inside the glow that marks
                // it, by drawing only that much of its third of the sprite. A side third
                // reaches a third as far as the core.
                const { width, height } = image;
                for (let k = 0; k < PLUME_RAYS; k++) {
                    const third = k === 1 ? reach : reach / 3;
                    const cut = landed[k]! > 0 ? (1 - landed[k]!) * third : reach;
                    if (!(cut > 0)) continue;
                    const shown = cut / reach;
                    const strip = (half * 2) / 3;
                    ctx.drawImage(
                        image,
                        width * (1 - shown),
                        (height * k) / 3,
                        width * shown,
                        height / 3,
                        root - cut,
                        across - half + k * strip,
                        cut,
                        strip,
                    );
                }
            }
            ctx.globalAlpha = outer;
            // The ring stands across the jet, in front of it and of its glow: drawn
            // once the glows are (`drawJetRings`), so the jet's light does not fall on it.
            if (gap > 0) {
                const m = ctx.getTransform();
                const ring: JetRing = {
                    m: { a: m.a, b: m.b, c: m.c, d: m.d, e: m.e, f: m.f },
                    x: root,
                    span: engine.geometry.pitch * engine.geometry.nozzles,
                    thickness: ringThickness(engine.geometry),
                    hull: engine.hull,
                    angle: engine.angle,
                    light,
                };
                // Outside a scene there are no glows to wait for.
                if (inScene) jetRings.push(ring);
                else drawJetRing(ctx, ring);
            }
        },
        true,
    );
}

/** An engine's bells, chambers and pump shaded as rounded, in its module's frame, the module turned `angle` in the world. */
function shadeEngine(
    ctx: CanvasRenderingContext2D,
    spec: ModuleSpec,
    angle: number,
    light: Light,
    roundPump: boolean,
    /** Its colour, and whether it stands at a thick module's height, as a fighter's does, for the dynamic lights. */
    colour: readonly number[],
    thick: boolean,
    /** The hull's colour, which a magnetic nozzle's ring and bars are in. */
    hull: string,
    /** The engine's own colour, its chambers' fill. */
    fill: string,
): void {
    const m = ctx.getTransform();
    const engine = engineGeometry(spec);
    const layout = engineLayout(spec);
    const l = spec.length / 2;
    const { across, up } = lightSlope(light);
    // The light across a part lying along x, toward its +y side.
    const side = across * sin(light.from - angle);
    const magnetic = isMagnetic(spec);
    const exit = drawnExit(engine, magnetic);
    const mouth = layout.mouth;
    const bell = exit > 0 && mouth + l > 0 ? cylinderShade(side, up, engine.throatWidth / (2 * exit)) : null;
    const r = layout.radius;
    const straight = layout.nose - layout.centre;
    const tube = r > 0 && straight > 0 ? cylinderShade(side, up) : null;
    // Each end of the chamber as a sphere's picture cut to it, the tube between them if there is one.
    const ends: [number, number, number][] =
        straight > 0
            ? [
                  [layout.centre, layout.aft, layout.centre],
                  [layout.nose, layout.nose, layout.fore],
              ]
            : [[layout.centre, layout.aft, layout.fore]];
    for (const y of layout.centres) {
        if (bell === null) continue;
        const end = mouth - engine.bellLength;
        ctx.drawImage(bell, end, y - exit, mouth - end, 2 * exit);
        rounded?.tube(m, end, y, mouth - end, exit, engine.throatWidth / (2 * exit), colour, 1, thick ? "thick" : "deck");
    }
    // A magnetic nozzle's bars, rods along the engine from its ring, pass
    // behind its chambers: painted over the bells beside them, then each
    // chamber painted again over them.
    if (magnetic) {
        const rod = cylinderShade(side, up);
        const root = layout.pumpAft < l ? layout.pumpAft : l;
        const start = -l + ringThickness(engine);
        ctx.fillStyle = hull;
        for (const y of layout.centres) {
            for (const [from, to] of ringBars(engine, y)) {
                ctx.fillRect(start, from, root - start, to - from);
                if (rod !== null) ctx.drawImage(rod, start, from, root - start, to - from);
                rounded?.tube(m, start, (from + to) / 2, root - start, (to - from) / 2, 1, rgba(hull), 1, thick ? "thick" : "deck");
            }
        }
        ctx.fillStyle = fill;
        for (const y of layout.centres) {
            const points = layout.chamber;
            ctx.beginPath();
            for (let k = 0; k < points.length; k += 2) ctx.lineTo(points[k]!, points[k + 1]! + y);
            ctx.closePath();
            ctx.fill();
        }
    }
    for (const y of layout.centres) {
        if (!(r > 0)) continue;
        for (const [x, from, to] of ends) {
            const image = sphereShade(light.from - angle, across, up, (from - x) / r, (to - x) / r);
            if (image !== null) ctx.drawImage(image, from, y - r, to - from, 2 * r);
            rounded?.sphere(m, x, y, r, from, to, colour, 1, thick ? "thick" : "deck");
        }
        if (tube !== null) {
            ctx.drawImage(tube, layout.centre, y - r, straight, 2 * r);
            rounded?.tube(m, layout.centre, y, straight, r, 1, colour, 1, thick ? "thick" : "deck");
        }
    }
    // Its ring round the jet at its aft end, shaded by the battle's light alone:
    // the dynamic lights are mostly its own jet's, which it stands in front of.
    if (magnetic) {
        ctx.fillStyle = hull;
        ctx.fillRect(-l, -spec.width / 2, ringThickness(engine), spec.width);
        shadeRing(ctx, -l, spec.width, ringThickness(engine), angle, light);
    }
    if (roundPump) {
        const pump = cylinderShade(side, up);
        if (pump !== null) ctx.drawImage(pump, layout.pumpAft, -layout.halfWidth, l - layout.pumpAft, 2 * layout.halfWidth);
        rounded?.tube(m, layout.pumpAft, 0, l - layout.pumpAft, layout.halfWidth, 1, colour, 1, thick ? "thick" : "deck");
    }
}

/** A magnetic nozzle's ring over a burning jet, waiting to be drawn over the jet's glow. */
interface JetRing {
    m: { a: number; b: number; c: number; d: number; e: number; f: number };
    x: number;
    span: number;
    thickness: number;
    hull: string;
    angle: number;
    light: Light | undefined;
}

const jetRings: JetRing[] = [];
/** Whether a scene is being drawn, whose glows the rings over its jets wait for. */
let inScene = false;

function drawJetRing(ctx: CanvasRenderingContext2D, ring: JetRing): void {
    ctx.save();
    ctx.setTransform(ring.m.a, ring.m.b, ring.m.c, ring.m.d, ring.m.e, ring.m.f);
    // Its fill in the battle's light too, as a hull's is.
    if (ring.light !== undefined) inLight(ctx, ring.light);
    ctx.fillStyle = ring.hull;
    ctx.fillRect(ring.x, -ring.span / 2, ring.thickness, ring.span);
    if (ring.light !== undefined) {
        shadeRing(ctx, ring.x, ring.span, ring.thickness, ring.angle, ring.light);
        ctx.restore();
    }
    ctx.restore();
}

/** The rings in front of burning jets, over the glows, so a jet's light does not fall on its own ring. */
function drawJetRings(ctx: CanvasRenderingContext2D): void {
    for (const ring of jetRings) drawJetRing(ctx, ring);
    jetRings.length = 0;
}

/** A magnetic nozzle's ring, `span` across at `x`, shaded as round about the jet it encircles. */
function shadeRing(ctx: CanvasRenderingContext2D, x: number, span: number, thickness: number, angle: number, light: Light): void {
    const { across, up } = lightSlope(light);
    const image = cylinderShade(across * sin(light.from - angle), up);
    if (image !== null) ctx.drawImage(image, x, -span / 2, thickness, span);
}

/** A docking port's block and collar shaded as rounded across, in its module's frame, the module turned `angle`. */
function shadePort(
    ctx: CanvasRenderingContext2D,
    spec: ModuleSpec,
    angle: number,
    light: Light,
    colour: readonly number[],
    thick: boolean,
): void {
    const { across, up } = lightSlope(light);
    const image = cylinderShade(across * sin(light.from - angle), up);
    if (image === null) return;
    const l = spec.length / 2;
    const w = spec.width / 2;
    const collar = spec.length * PORT_COLLAR_SHARE;
    ctx.drawImage(image, -l, -w, spec.length - collar, 2 * w);
    ctx.drawImage(image, l - collar, -w * PORT_COLLAR_WIDTH, collar, 2 * w * PORT_COLLAR_WIDTH);
    const m = ctx.getTransform();
    rounded?.tube(m, -l, 0, spec.length - collar, w, 1, colour, 1, thick ? "thick" : "deck");
    rounded?.tube(m, l - collar, 0, collar, w * PORT_COLLAR_WIDTH, 1, colour, 1, thick ? "thick" : "deck");
}

/**
 * Module `i`'s side's pattern in a colour, laid in its own frame
 * (`patternTransform`), or null where its side has none or it is rock.
 */
function patternOf(
    ctx: CanvasRenderingContext2D,
    design: ShipDesign,
    i: number,
    side: number,
): ((colour: string) => CanvasPattern | null) | null {
    const kind = design.modules[i]!.spec.kind;
    const livery = kind !== "rock" && kind !== "kernel" ? teamLivery(side) : undefined;
    if (livery === undefined || livery.pattern === "none") return null;
    const t = patternTransform(livery, design, i);
    return (colour) => {
        const tile = patternTile(livery, colour);
        const pattern = tile === null ? null : ctx.createPattern(tile as HTMLCanvasElement, "repeat");
        pattern?.setTransform({ a: t.a, b: t.b, c: t.c, d: t.d, e: t.e, f: t.f });
        return pattern ?? null;
    };
}

/** What `patternOf` lays on module `i` of side `side`, as a key: empty for nothing. */
function patternKey(design: ShipDesign, i: number, side: number): string {
    const livery = teamLivery(side);
    if (livery === undefined || livery.pattern === "none") return "";
    const origin = originOf(design, i);
    return `${idOf(origin.design)}.${origin.module} ${liveryKey(livery)}`;
}

function liveryKey(livery: Livery | undefined): string {
    if (livery === undefined) return "";
    return `${tileKey(livery, livery.highlight)},${livery.size},${livery.spacing},${livery.offset},${livery.lateral},${livery.angle}`;
}

/** `fillModule`, kept (`keep`) by what it is filled with. */
function keptFill(ctx: CanvasRenderingContext2D, ship: ShipView, i: number): void {
    const design = ship.currentStructure;
    const m = design.modules[i]!;
    const side = paintedSide(ship, i);
    const colours = moduleColours(design, i, side);
    const integrity = ship.integrity?.[i] ?? 1;
    const colour = fillColour(m.spec, colours);
    keep(
        ctx,
        `fill ${idOf(m.spec)} ${idOf(colours)} ${colour} ${integrity} ${patternKey(design, i, side)} ${drawnMounts(design, i).key}`,
        () => fillModule(ctx, ship, i),
    );
}

/**
 * Module `i`'s fill, in its own frame: a pad's with its landing square marked
 * on it, so where Pixi fills it the square is shadowed too.
 */
function fillModule(ctx: CanvasRenderingContext2D, ship: ShipView, i: number): void {
    const design = ship.currentStructure;
    const m = design.modules[i]!;
    const spec = m.spec;
    const side = paintedSide(ship, i);
    const colours = moduleColours(design, i, side);
    const integrity = ship.integrity?.[i] ?? 1;
    moduleFills(spec, fillColour(spec, colours), colours, integrity, fills, drawnMounts(design, i).polygons);
    const pattern = patternOf(ctx, design, i, side);
    const ground = spec.kind === "rock" || spec.kind === "kernel";
    const burnt = !ground && integrity <= 0;
    const wear = ground ? null : wearPattern(ctx, design, i, wearLevel(integrity));
    for (const fill of fills) {
        const points = fill.points;
        ctx.fillStyle = fill.colour;
        ctx.beginPath();
        ctx.moveTo(points[0]!, points[1]!);
        for (let v = 2; v < points.length; v += 2) ctx.lineTo(points[v]!, points[v + 1]!);
        ctx.closePath();
        ctx.fill();
        const over = pattern === null ? null : patternColour(spec.kind, fill.colour, colours);
        const tiled = over === null ? null : pattern!(over);
        if (tiled !== null) {
            ctx.fillStyle = tiled;
            ctx.fill();
        }
    }
    if (spec.kind === "pad") {
        const mark = padMark(spec);
        ctx.strokeStyle = colours.highlight ?? colours.trim;
        ctx.lineWidth = mark.line;
        ctx.strokeRect(mark.x, mark.y, mark.width, mark.height);
    }
    if (!burnt && wear === null) return;
    const soot = `${SOOT}${Math.round(SOOT_ALPHA * 255)
        .toString(16)
        .padStart(2, "0")}`;
    for (const fill of fills) {
        const points = fill.points;
        ctx.beginPath();
        ctx.moveTo(points[0]!, points[1]!);
        for (let v = 2; v < points.length; v += 2) ctx.lineTo(points[v]!, points[v + 1]!);
        ctx.closePath();
        if (burnt) {
            ctx.fillStyle = soot;
            ctx.fill();
        }
        if (wear !== null) {
            ctx.fillStyle = wear;
            ctx.fill();
        }
    }
}

/** Wear `level` laid on module `i` (`render/wear.ts`), or null for none. */
function wearPattern(ctx: CanvasRenderingContext2D, design: ShipDesign, i: number, level: number): CanvasPattern | null {
    const tile = level > 0 ? wearTile(level) : null;
    const pattern = tile === null ? null : ctx.createPattern(tile as HTMLCanvasElement, "repeat");
    if (pattern === null) return null;
    const t = wearTransform(design, i);
    pattern.setTransform({ a: t.a, b: t.b, c: t.c, d: t.d, e: t.e, f: t.f });
    return pattern;
}

/**
 * Module `m`'s bevels, lit at `angle` in the world, in its own frame: those
 * HullLayer does not draw, as a fighter's (render/hullLayer.ts).
 */
function bevel(ctx: CanvasRenderingContext2D, design: ShipDesign, m: number, angle: number, metresToPx: number, light: Light): void {
    const origin = originOf(design, m);
    const width = BEVEL_OF_RADIUS * origin.design.radius;
    if (width * metresToPx < MIN_BEVEL_PX) return;
    const edges = bevelsOf(origin.design, origin.module);
    const { across } = lightSlope(light);
    const towardX = cos(light.from - angle) * across;
    const towardY = sin(light.from - angle) * across;
    const alpha = ctx.globalAlpha;
    for (let k = 0; k < edges.length; k += BEVEL_STRIDE) {
        const lit = edges[k + 4]! * towardX + edges[k + 5]! * towardY;
        if (Math.abs(lit) < MIN_BEVEL_LIT) continue;
        bevelQuad(edges, k, width, quad);
        ctx.globalAlpha = alpha * Math.abs(lit) * (lit > 0 ? BEVEL_LIGHT : BEVEL_DARK);
        ctx.fillStyle = lit > 0 ? "#fff" : "#000";
        ctx.beginPath();
        ctx.moveTo(quad[0]!, quad[1]!);
        for (let v = 2; v < 8; v += 2) ctx.lineTo(quad[v]!, quad[v + 1]!);
        ctx.closePath();
        ctx.fill();
    }
    ctx.globalAlpha = alpha;
}
const quad: number[] = [0, 0, 0, 0, 0, 0, 0, 0];

/** How much wider a barrel's collar is than the barrel, and how far it stands out of the mantlet, in barrel widths. */
const COLLAR_WIDTH = 1.3;
const COLLAR_OUT = 0.4;

/**
 * How long a barrel `width` wide from `(x, y)` along the unit `(ux, uy)` has its
 * collar: to where all of it is out of `pivot`, and a little further.
 */
function collarLength(
    x: number,
    y: number,
    ux: number,
    uy: number,
    width: number,
    pivot: { x: number; y: number; radius: number },
): number {
    const ox = x - pivot.x;
    const oy = y - pivot.y;
    const along = ox * ux + oy * uy;
    // Its edge nearest the pivot's middle is the last of it out.
    const side = max(0, Math.abs(ox * uy - oy * ux) - (COLLAR_WIDTH * width) / 2);
    const inside = side < pivot.radius ? sqrt(pivot.radius * pivot.radius - side * side) - along : 0;
    return max(0, inside) + COLLAR_OUT * width;
}

/**
 * How far along the same barrel its collar starts: as far out as it can while
 * its corners there are still inside `pivot`'s whole disc, under the mantlet or
 * in the block behind it, so they never stand out past either however it is trained.
 */
function collarStart(x: number, y: number, ux: number, uy: number, width: number, pivot: { x: number; y: number; radius: number }): number {
    const ox = x - pivot.x;
    const oy = y - pivot.y;
    const along = ox * ux + oy * uy;
    const side = Math.abs(ox * uy - oy * ux) + (COLLAR_WIDTH * width) / 2;
    if (side >= pivot.radius) return 0;
    return max(0, sqrt(pivot.radius * pivot.radius - side * side) - along);
}

/**
 * A flat collar round each of a hull gun's barrels where it comes out of the
 * mantlet `pivot` over their roots, so a barrel meets it square rather than
 * along the mantlet's curve. Unlit by the dynamic lights, as the mantlet is:
 * their light is added over what is drawn on it.
 */
function drawCollars(
    ctx: CanvasRenderingContext2D,
    ship: ShipView,
    t: number,
    width: number,
    pivot: { x: number; y: number; radius: number },
): void {
    ctx.fillStyle = BARREL;
    barrelLines(ship, t, (x0, y0, x1, y1) => {
        const span = length(x1 - x0, y1 - y0);
        if (!(span > 0)) return;
        const ux = (x1 - x0) / span;
        const uy = (y1 - y0) / span;
        const collar = min(span, collarLength(x0, y0, ux, uy, width, pivot));
        const start = min(collar, collarStart(x0, y0, ux, uy, width, pivot));
        const half = (COLLAR_WIDTH * width) / 2;
        ctx.save();
        ctx.translate(x0, y0);
        ctx.rotate(math.atan2(uy, ux));
        ctx.fillRect(start, -half, collar - start, 2 * half);
        ctx.restore();
    });
}

/** Where a turret is lit by the dynamic lights: halfway up a capital ship's hull, as its flames are thick; a fighter's nearest its height. */
function turretLevel(ship: ShipView): Level {
    return ship.currentStructure.fighter ? "thick" : "middle";
}

/** A turret's dome shaded as rounded, at `x`, `y` in the world. */
function shadeDome(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, light: Light): void {
    const { across, up } = lightSlope(light);
    const image = domeShade(across, up);
    if (image === null) return;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(light.from);
    ctx.drawImage(image, -radius, -radius, 2 * radius, 2 * radius);
    ctx.restore();
}

/** A turret's barrels shaded as tubes `width` wide, in the world, out of `block` and, for the dynamic lights, past their collars out of `pivot`. */
function shadeBarrels(
    ctx: CanvasRenderingContext2D,
    ship: ShipView,
    t: number,
    width: number,
    light: Light,
    block: Box | null,
    pivot: { x: number; y: number; radius: number } | null,
): void {
    const { across, up } = lightSlope(light);
    barrelLines(ship, t, (x0, y0, x1, y1) => {
        const dx = x1 - x0;
        const dy = y1 - y0;
        const span = length(dx, dy);
        if (!(span > 0)) return;
        const angle = math.atan2(dy, dx);
        const image = cylinderShade(across * sin(light.from - angle), up);
        if (image === null) return;
        // Only where it is out of its block: a picture is not clipped where Pixi draws it.
        const [from, to] = block === null ? [1, 1] : throughBox(block, x0, y0, dx, dy);
        ctx.save();
        ctx.translate(x0, y0);
        ctx.rotate(angle);
        if (from > 0) ctx.drawImage(image, 0, -width / 2, span * from, width);
        if (to < 1) ctx.drawImage(image, span * to, -width / 2, span * (1 - to), width);
        // Drawn over everything, so taking all the light, at a turret's height: past its
        // collar, as it adds to what is drawn over it rather than being hidden.
        const m = ctx.getTransform();
        const level = turretLevel(ship);
        const out = pivot === null ? 0 : collarLength(x0, y0, dx / span, dy / span, width, pivot) / span;
        const lit = (a: number, b: number): void => {
            const start = max(a, out);
            if (b > start) rounded?.tube(m, span * start, 0, span * (b - start), width / 2, 1, BARREL_RGB, 0, level);
        };
        if (from > 0) lit(0, from);
        if (to < 1) lit(to, 1);
        ctx.restore();
    });
}

/** A hull mount's block in the world: its centre, which way it runs, and its extent along and across that. */
export interface Box {
    readonly x: number;
    readonly y: number;
    readonly ax: number;
    readonly ay: number;
    readonly back: number;
    readonly front: number;
    readonly half: number;
}

/** The block of a hull mount `length` by `width` placed at `x`, `y`, `angle` on `ship`, `block` long from its back. */
function blockBox(ship: ShipView, x: number, y: number, angle: number, length: number, width: number, block: number): Box {
    const c = cos(ship.angle);
    const s = sin(ship.angle);
    const a = ship.angle + angle;
    return {
        x: ship.x + x * c - y * s,
        y: ship.y + x * s + y * c,
        ax: cos(a),
        ay: sin(a),
        back: -length / 2,
        front: -length / 2 + block,
        half: width / 2,
    };
}

/**
 * Where the line from `x`, `y` to `x + dx`, `y + dy` runs through `box`, as
 * shares of it from and to; 1 and 1 where it misses.
 */
export function throughBox(box: Box, x: number, y: number, dx: number, dy: number): [number, number] {
    const rx = x - box.x;
    const ry = y - box.y;
    let from = -Infinity;
    let to = Infinity;
    for (const [p, d, lo, hi] of [
        [rx * box.ax + ry * box.ay, dx * box.ax + dy * box.ay, box.back, box.front],
        [-rx * box.ay + ry * box.ax, -dx * box.ay + dy * box.ax, -box.half, box.half],
    ] as const) {
        if (d === 0) {
            if (p < lo || p > hi) return [1, 1];
            continue;
        }
        const t0 = (lo - p) / d;
        const t1 = (hi - p) / d;
        from = max(from, min(t0, t1));
        to = min(to, max(t0, t1));
    }
    from = max(0, from);
    to = min(1, to);
    return from < to ? [from, to] : [1, 1];
}

/**
 * The opacity of one of `split` flames laid over each other that together
 * look like one flame of `alpha`, so a thick engine's two flames are the
 * single one where neither is blocked, and dimmer where one is.
 */
function layerAlpha(alpha: number, split: number): number {
    return split > 1 ? 1 - sqrt(1 - alpha) : alpha;
}

/**
 * Where flames are burning something: a soft glow on the hull, as wide as
 * the flame is there and spread along the surface rather than round, and as
 * bright as the power landing on it per square metre — a little brighter
 * than the flame itself, for the hull it is boiling off.
 *
 * Lights, so drawn with the scene's glows, over every hull and lighting it
 * rather than covering it.
 */
function drawBurns(ctx: CanvasRenderingContext2D, snapshot: Snapshot): void {
    for (let i = 0; i < snapshot.shipCount; i++) {
        eachNozzle(ctx, snapshot.ships[i]!, (engine, force, reach, across, landed, split) => {
            // What of this nozzle's power is landing, and roughly where: the core's
            // landing if it has one, otherwise wherever its edges met something.
            const perRay = (PLUME_POWER_PER_NEWTON * force) / (engine.geometry.nozzles * PLUME_RAYS * split);
            let power = 0;
            let at = 0;
            let off = 0;
            let count = 0;
            for (let k = 0; k < PLUME_RAYS; k++) {
                const share = landed[k]!;
                if (!(share > 0)) continue;
                power += perRay * share;
                // A side ray reaches a third as far, so its landing is a third as deep.
                const rayReach = k === 1 ? reach : reach / 3;
                at += (1 - share) * rayReach;
                off += (k - 1) / 3;
                count++;
            }
            if (count === 0) return;
            at /= count;
            off /= count;
            const root = -engine.length / 2;
            const exit = engine.geometry.exitWidth;
            // As wide as the flame is where it lands, and never a speck.
            const along = max(exit * (1 - at / reach), exit * 0.5) * 1.8;
            const deep = along * 0.55;
            const alpha = min(1, plumeAlpha(power / (PI * along * deep)) * 1.3);

            // A line along the surface, so its glow is spread along it rather than round.
            const m = ctx.getTransform();
            const x = root - at;
            const y = across + off * exit;
            const spread = along - deep;
            lights.line(m, x, y - spread, x, y + spread, deep, BURN, alpha * 0.7);
            lights.line(m, x, y - spread * 0.5, x, y + spread * 0.5, deep * 0.5, BURN_CORE, alpha * 0.6);
        });
    }
}

/** An engine as the flame passes need it: its bell geometry and its length. */
interface Engine {
    geometry: ReturnType<typeof engineGeometry>;
    length: number;
    /** The hull's colour, which a magnetic nozzle's ring is drawn in. */
    hull: string;
    /** The engine's bearing in the world, for its ring's shading. */
    angle: number;
}

/**
 * Every burning nozzle on a ship, in its own module's frame with the exhaust
 * running along -x: what the flame and burn passes both draw from, so they
 * cannot disagree about where a flame is. A thick engine's nozzle is visited
 * once a layer, each with its share `split` of the flame.
 */
function eachNozzle(
    ctx: CanvasRenderingContext2D,
    ship: ShipView,
    visit: (engine: Engine, force: number, reach: number, across: number, landed: readonly number[], split: number) => void,
    /** Only the nozzles whose plume, with its glow, reaches the box being drawn. */
    onlyShown = false,
): void {
    const design = ship.currentStructure;
    // Engines are counted as they are met, because a design lists its
    // engines in the order its modules appear.
    let engine = 0;
    const landed = [0, 0, 0];
    const sc = cos(ship.angle);
    const ss = sin(ship.angle);

    ctx.save();
    ctx.translate(ship.x, ship.y);
    ctx.rotate(ship.angle);
    for (let i = 0; i < design.modules.length; i++) {
        const m = design.modules[i]!;
        const spec = m.spec;
        if (spec.kind !== "engine") continue;
        const t = engine++;
        const force = (ship.throttles[t] ?? 0) * (design.engines[t]?.maxThrust ?? 0);
        if (!(force > 0)) continue;
        const geometry = engineGeometry(spec);
        const reach = nozzleReach(geometry, force);
        const hull = moduleColours(design, i, paintedSide(ship, i)).hull;
        ctx.save();
        ctx.translate(m.x, m.y);
        ctx.rotate(m.angle);
        const layers = ship.plumeLayers?.[t] ?? plumeLayers(design, t, OWN_LAYERS);
        const split = layerCount(layers);
        for (let layer = HULL_LAYER; layer <= WEAPONS_LAYER; layer <<= 1) {
            if ((layers & layer) === 0) continue;
            for (let n = 0; n < geometry.nozzles; n++) {
                if (onlyShown && !plumeNear(ship, sc, ss, m, spec.length, nozzleOffset(geometry, n), reach, geometry.exitWidth)) continue;
                for (let k = 0; k < PLUME_RAYS; k++) {
                    landed[k] = ship.landed[landedIndex(design, t, n * PLUME_RAYS + k, layer)] ?? 0;
                }
                visit(
                    { geometry, length: spec.length, hull, angle: ship.angle + m.angle },
                    force,
                    reach,
                    nozzleOffset(geometry, n),
                    landed,
                    split,
                );
            }
        }
        ctx.restore();
    }
    ctx.restore();
}

/**
 * A ship's icon: an arrowhead in its team's colour, pointing the way it is.
 *
 * Drawn at a fixed size on screen rather than in metres, which is the whole
 * point of it — the hull shrinks with the zoom and this does not, so a
 * skirmish seen from far enough out to fit is still a picture of ships facing
 * each other rather than a field of specks. `render/icons.ts` decides when it
 * shows and how solid it is.
 *
 * **The team's colour is for a ship still in the fight.** Grey is for one
 * whose core is out, or one that has lost every gun and engine it had, or
 * the stores to use them. Not for one built with neither: a hull with a sound
 * core and nothing else is still a ship, and drawing it grey said the
 * opposite about an entire generation of engineless craft.
 *
 * Wreckage gets no icon (`isWreckage`): a severed piece, or a hulk under
 * `HULK_ICON_MASS`, so a field of dead fighters and torpedoes does not read
 * as a swarm. A bigger hulk keeps its icon in grey, being a solid thing in
 * the way that would otherwise vanish at this zoom. A ship riding another's
 * body, as a fighter on its pad, has none: the hull's own stands for it.
 *
 * It points the way the ship does (`ShipView.heading`), which is not always
 * its body's angle: a fighter launched from a pad keeps the carrier's frame.
 */
function drawIcon(ctx: CanvasRenderingContext2D, ship: ShipView, metresToPx: number): void {
    if (isWreckage(ship) || ship.riding === true) return;
    const alpha = iconAlpha(ship.currentStructure.radius * 2 * metresToPx);
    if (alpha <= 0) return;
    const palette = ship.currentStructure.fighter ? fighterColours : shipColours;
    const colours = markerOf(palette(ship.hasControl && !ship.isMissionKilled ? ship.team : -1));
    const size = ICON_PX / metresToPx;

    ctx.save();
    ctx.translate(ship.x, ship.y);
    ctx.rotate(ship.heading ?? ship.angle);
    ctx.scale(size, size);
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.moveTo(ICON_OUTLINE[0]![0], ICON_OUTLINE[0]![1]);
    for (let i = 1; i < ICON_OUTLINE.length; i++) {
        ctx.lineTo(ICON_OUTLINE[i]![0], ICON_OUTLINE[i]![1]);
    }
    ctx.closePath();
    ctx.fillStyle = colours.hull;
    ctx.fill();
    // An outline in the lighter of the same two colours, so the arrowhead holds
    // its shape against the hull it is sitting on as well as against the field.
    ctx.strokeStyle = colours.trim;
    ctx.lineWidth = 1 / ICON_PX;
    ctx.stroke();
    ctx.restore();
}

/**
 * A core's status light, in its aft corner on the side the generator disc
 * takes, just forward of the disc: the same green as a gun's ready light, so
 * that lit means doing its job here as there.
 */
function drawCoreLight(ctx: CanvasRenderingContext2D, design: ShipDesign, i: number, spec: ModuleSpec, working: boolean): void {
    ctx.save();
    ctx.globalAlpha = 1;
    const sideways = spec.width > spec.length;
    if (sideways) ctx.rotate(PI / 2);
    const along = sideways ? spec.width : spec.length;
    const across = sideways ? spec.length : spec.width;
    const small = min(along, across);
    const bar = small * CORE_GAUGE;
    const inset = small * CORE_GAUGE_INSET;
    const room = coreRoom(design.modules[i]!.stats);
    const most = max(room.fuel, room.metal, room.charge, room.generator);
    const reach = along / 2 - 1.5 * inset;
    const disc = most > 0 ? min(reach * sqrt(room.generator / most), bar * CORE_DISC_GAUGES) : 0;
    const r = (bar * CORE_LIGHT_GAUGES) / 2;
    const middle = across / 2 - inset - max(disc, 2 * r) / 2;
    ctx.fillStyle = working ? LOAD_READY : FUEL_TRACK;
    ctx.beginPath();
    ctx.arc(-along / 2 + inset + (disc > 0 ? disc + inset : 0) + r, middle, r, 0, TAU);
    ctx.fill();
    ctx.restore();
}

/** A pad's lights, across, as a share of its narrower side. */
const PAD_LIGHT = 0.07;
/** How bright a lit pad light is at the least, before how hard its field is working adds the rest. */
const PAD_LIGHT_LEAST = 0.4;

/**
 * A pad's four lights, one inside each corner of its landing square: dark,
 * or green while its field is holding a fighter, brighter the harder it is
 * working (`field`, 0 to 1), the green a gun's ready light and a core's are.
 */
function drawPadLights(ctx: CanvasRenderingContext2D, spec: ModuleSpec, field: number): void {
    const mark = padMark(spec);
    const r = (min(spec.length, spec.width) * PAD_LIGHT) / 2;
    const left = mark.x + mark.line / 2 + r * 1.5;
    const right = mark.x + mark.width - mark.line / 2 - r * 1.5;
    const top = mark.y + mark.line / 2 + r * 1.5;
    const bottom = mark.y + mark.height - mark.line / 2 - r * 1.5;
    ctx.save();
    for (let k = 0; k < 4; k++) {
        const x = k % 2 === 0 ? left : right;
        const y = k < 2 ? top : bottom;
        ctx.globalAlpha = 1;
        ctx.fillStyle = FUEL_TRACK;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, TAU);
        ctx.fill();
        if (!(field > 0)) continue;
        const bright = PAD_LIGHT_LEAST + (1 - PAD_LIGHT_LEAST) * min(1, field);
        ctx.fillStyle = LOAD_READY;
        ctx.globalAlpha = bright;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, TAU);
        ctx.fill();
    }
    ctx.restore();
}

/** Smallest a core is drawn, across, before its ship's name is written on it, pixels. */
const NAME_MIN_CORE_PX = 18;
/** The smallest a name is worth writing, pixels. */
const NAME_MIN_PX = 7;

/**
 * The name painted on each of a ship's cores — the side and which of its ships
 * built it, as "Red 5", or "Red 5.2" for the second core of a ship with more —
 * in that side's trim, once the core is big enough on screen to carry it.
 * Paint, so it turns with the ship, grows with the zoom, and stays however
 * battered the core or whoever now flies it.
 */
function drawName(ctx: CanvasRenderingContext2D, ship: ShipView, metresToPx: number): void {
    if (ship.serial <= 0) return;
    const cores = ship.currentStructure.cores;
    for (let k = 0; k < cores.length; k++) {
        const core = cores[k]!;
        // Absent for a view built by hand, which is named after itself.
        const painted = ship.coreNames === undefined ? (ship.name ?? `${ship.serial}`) : ship.coreNames[k];
        // Null for another ship's on the same hull, which writes its own.
        const side = ship.sides?.[core] ?? ship.team;
        if (painted === null || painted === undefined || side < 0) continue;
        drawLabel(ctx, ship, core, `${teamName(side)} ${painted}`, side, metresToPx);
    }
}

/** `text` written along module `core` of a ship in `side`'s trim, as on its hull, if the core is big enough on screen. */
function drawLabel(ctx: CanvasRenderingContext2D, ship: ShipView, core: number, text: string, side: number, metresToPx: number): void {
    const module = ship.currentStructure.modules[core]!;
    const across = Math.min(module.spec.length, module.spec.width) * metresToPx;
    if (across < NAME_MIN_CORE_PX) return;
    const c = Math.cos(ship.angle);
    const s = Math.sin(ship.angle);
    const view = ctx.getTransform();
    const wx = ship.x + module.x * c - module.y * s;
    const wy = ship.y + module.x * s + module.y * c;
    const atX = view.a * wx + view.c * wy + view.e;
    const atY = view.b * wx + view.d * wy + view.f;
    const along = Math.max(module.spec.length, module.spec.width) * metresToPx;
    // Along the long side, and that direction as the screen has it, so a
    // camera that flips an axis turns the name rather than mirroring it.
    const own = ship.angle + module.angle + (module.spec.width > module.spec.length ? Math.PI / 2 : 0);
    const dx = Math.cos(own);
    const dy = Math.sin(own);
    const turn = Math.atan2(view.b * dx + view.d * dy, view.a * dx + view.c * dy);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, atX, atY);
    ctx.rotate(turn);
    let size = across * 0.4;
    ctx.font = `${size}px ui-monospace, monospace`;
    // No wider than the core is long, so it reads as written on the core.
    const width = ctx.measureText(text).width;
    if (width > along * 0.9) size *= (along * 0.9) / width;
    if (size >= NAME_MIN_PX) {
        ctx.font = `${size}px ui-monospace, monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = markerOf(shipColours(side)).trim;
        ctx.fillText(text, 0, 0);
    }
    ctx.restore();
}

/** Draw one snapshot. The canvas is cleared first; nothing persists between frames. */
export function draw(
    ctx: CanvasRenderingContext2D,
    snapshot: Snapshot,
    camera: Camera,
    widthPx: number,
    heightPx: number,
    flashes?: Flashes,
    arcs: Arcs = "none",
    /** Rounds and beams in the colours of the side that fired them, rather than as light. */
    teamShots = false,
    /**
     * The body of a ship picked out by the viewer, or -1: marked, its target
     * shown, and drawn with every arc whatever `arcs` says, while no other ship
     * is drawn with any.
     */
    selected = -1,
    /** Bodies of more ships picked out with it, for orders: ringed, and their orders drawn. */
    alsoSelected: readonly number[] = [],
    marked: Marked | null = null,
    /**
     * Whether Pixi underneath (render/pixiView.ts) has drawn the field, grid and
     * wells and filled the capital ships' modules, which are then left clear.
     */
    underneath = false,
    /** The light rounded parts are shaded by; flat without one. */
    light?: Light,
): void {
    // Lit by the lights of this view's last frame: this one's are not all known
    // until it is drawn, and a frame on there is no telling them apart.
    const last = lastSeen.get(ctx);
    if (last === undefined) field.clear();
    else field.set(last.lights, last.camera, last.widthPx, last.heightPx);
    seenLights.clear();
    seenRounded.clear();
    rounded = seenRounded;
    drawScene(
        ctx,
        snapshot,
        camera,
        0,
        0,
        widthPx,
        heightPx,
        flashes,
        arcs,
        teamShots,
        selected,
        alsoSelected,
        marked,
        underneath,
        light,
        seenLights,
    );
    rounded = null;
    field.clear();
    const kept = last ?? { lights: new Lights(), camera: { x: 0, y: 0, scale: 1 }, widthPx, heightPx };
    kept.lights.clear();
    kept.lights.add(seenLights);
    kept.camera = { x: camera.x, y: camera.y, scale: camera.scale };
    kept.widthPx = widthPx;
    kept.heightPx = heightPx;
    lastSeen.set(ctx, kept);
}

/** Each view's lights in its last frame, and the camera it saw them through. */
const lastSeen = new WeakMap<object, { lights: Lights; camera: Seen; widthPx: number; heightPx: number }>();
/** What lights what is lit a piece at a time, while a view is drawn. */
const field = new LightField();
/** Scratch for the light at a point. */
const glow = { r: 0, g: 0, b: 0 };

/**
 * `tint`, as `0xrrggbb`, with what the light at `(x, y)` sheds on a surface of
 * colour `albedo` added: as the light buffer lights the hull.
 */
function lightUp(tint: number, albedo: readonly number[], x: number, y: number): number {
    if (field.count === 0 || !field.at(x, y, glow)) return tint;
    const add = (channel: number, shift: number, light: number): number =>
        Math.min(255, ((tint >> shift) & 0xff) + Math.round(albedo[channel]! * light * LIGHT_GAIN)) << shift;
    return add(0, 16, glow.r) | add(1, 8, glow.g) | add(2, 0, glow.b);
}

/**
 * Save the context and draw from here, until its `restore`, multiplied by
 * `light`'s colour, as the hull layer tints what it fills: where the context
 * can (`PixiCanvas.tinted`), and otherwise as it was.
 */
function inLight(ctx: CanvasRenderingContext2D, light: Light): void {
    ctx.save();
    (ctx as Partial<Pick<PixiCanvas, "tinted">>).tinted?.(Number.parseInt(light.colour.slice(1, 7), 16));
}

/**
 * How high above the deck a ship is, metres, as its shadow falls: a flying
 * fighter at its height, one parked on a pad lower, and anything else on the deck.
 */
function heightOf(ship: ShipView): number {
    if (!ship.currentStructure.fighter) return 0;
    return fighterHeight(ship.riding, ship.lowered);
}

/**
 * A fighter's modules filled once more, added over themselves in their own
 * colour times the light on each: the dynamic lights, as the hull layer's
 * filter gives the capital ships'. A burnt-out module is soot, and stays dark.
 */
function lightFighter(ctx: CanvasRenderingContext2D, ship: ShipView, fighters: boolean): void {
    if (field.count === 0) return;
    const design = ship.currentStructure;
    const c = Math.cos(ship.angle);
    const s = Math.sin(ship.angle);
    for (let i = 0; i < design.modules.length; i++) {
        if (ship.drawn?.[i] === false || isFighterModule(design, i) !== fighters) continue;
        const integrity = ship.integrity?.[i] ?? 1;
        if (integrity <= 0) continue;
        const m = design.modules[i]!;
        if (!field.at(ship.x + m.x * c - m.y * s, ship.y + m.x * s + m.y * c, glow, heightOf(ship))) continue;
        const colours = moduleColours(design, i, paintedSide(ship, i));
        moduleFills(m.spec, fillColour(m.spec, colours), colours, integrity, fills, drawnMounts(design, i).polygons);
        ctx.save();
        ctx.translate(m.x, m.y);
        ctx.rotate(m.angle);
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = fillAlpha(ship, i);
        for (const fill of fills) {
            const [r, g, b] = rgba(fill.colour);
            const lit = (colour: number, light: number): string =>
                Math.min(255, Math.round(colour * light * LIGHT_GAIN))
                    .toString(16)
                    .padStart(2, "0");
            ctx.fillStyle = `#${lit(r, glow.r)}${lit(g, glow.g)}${lit(b, glow.b)}`;
            const points = fill.points;
            ctx.beginPath();
            ctx.moveTo(points[0]!, points[1]!);
            for (let v = 2; v < points.length; v += 2) ctx.lineTo(points[v]!, points[v + 1]!);
            ctx.closePath();
            ctx.fill();
        }
        ctx.restore();
    }
}

/**
 * Every light the last view `draw` drew gave off, in its canvas pixels: what
 * lights the hulls near them (`render/lightBuffer.ts`). Not a close-up's.
 */
export const seenLights = new Lights();
/** The rounded parts the last view `draw` drew, for the dynamic lights to light by which way they face (`render/litRounded.ts`). Not a close-up's. */
export const seenRounded = new RoundedParts();
/** Where rounded parts are recorded while the main view is drawn, and nowhere otherwise. */
let rounded: RoundedParts | null = null;
/** A barrel's colour, as its channels. */
const BARREL_RGB = rgba(BARREL);

/** Modules of one ship to outline: the mounts a doctrine is being told to. */
export interface Marked {
    readonly body: number;
    readonly modules: readonly number[];
}

const MARK_COLOUR = "#e9c05f";

function drawMarked(ctx: CanvasRenderingContext2D, snapshot: Snapshot, marked: Marked, metresToPx: number): void {
    const ship = shipByBody(snapshot, marked.body);
    if (ship === null) return;
    ctx.save();
    ctx.translate(ship.x, ship.y);
    ctx.rotate(ship.angle);
    ctx.strokeStyle = MARK_COLOUR;
    ctx.lineWidth = 2 / metresToPx;
    for (const i of marked.modules) {
        const m = ship.currentStructure.modules[i];
        if (m === undefined) continue;
        ctx.save();
        ctx.translate(m.x, m.y);
        ctx.rotate(m.angle);
        ctx.strokeRect(-m.spec.length / 2, -m.spec.width / 2, m.spec.length, m.spec.width);
        ctx.restore();
    }
    ctx.restore();
}

/**
 * The world point under a canvas pixel of the main view, through the close-up
 * drawn over it if there is one: where a click inside a close-up lands in the
 * battle it shows.
 */
export function viewPoint(
    insets: readonly Inset[],
    camera: Camera,
    widthPx: number,
    heightPx: number,
    x: number,
    y: number,
): { x: number; y: number } {
    const px = widthPx / 2 + (x - camera.x) * camera.scale;
    const py = heightPx / 2 - (y - camera.y) * camera.scale;
    const body = insetAt(insets, px, py);
    const inset = body < 0 ? undefined : [...insets].reverse().find((i) => i.body === body);
    if (inset === undefined) return { x, y };
    const half = inset.size / 2;
    return {
        x: inset.camera.x + (px - inset.x - half) / inset.camera.scale,
        y: inset.camera.y - (py - inset.y - half) / inset.camera.scale,
    };
}

/** Pixels round a ship within which it is still drawn when its hull is just out of view: its icon and name. */
const CULL_PAD_PX = 48;

/** The world box the scene being drawn shows, padded, for skipping rounds and beams nowhere near it. */
const shownBox = { x: 0, y: 0, halfW: Infinity, halfH: Infinity };

/** `draw`, into the `widthPx` by `heightPx` box whose top left is at `left`, `top`. */
/** What gives off light in the scene being drawn, its glows drawn at the scene's end. */
const lights = new Lights();

function drawScene(
    ctx: CanvasRenderingContext2D,
    snapshot: Snapshot,
    camera: Camera,
    left: number,
    top: number,
    widthPx: number,
    heightPx: number,
    flashes: Flashes | undefined,
    arcs: Arcs,
    teamShots: boolean,
    selected: number,
    alsoSelected: readonly number[] = [],
    marked: Marked | null = null,
    underneath = false,
    light?: Light,
    /** Where to keep what gave off light, as well as drawing its glow. */
    seen?: Lights,
): void {
    inScene = true;
    lights.clear();
    poses.record(snapshot);
    ctx.setTransform(1, 0, 0, 1, left, top);
    if (!underneath) {
        ctx.fillStyle = BACKGROUND;
        ctx.fillRect(0, 0, widthPx, heightPx);
    } else {
        ctx.clearRect(0, 0, widthPx, heightPx);
    }

    // World to screen: metres up, y flipped so +y is up as the maths intends.
    ctx.translate(widthPx / 2, heightPx / 2);
    ctx.scale(camera.scale, -camera.scale);
    ctx.translate(-camera.x, -camera.y);

    if (!underneath) {
        drawGrid(ctx, camera, widthPx, heightPx);
        drawWells(ctx, snapshot, camera);
    }

    // A ship nowhere near the view is not drawn: a close-up draws the whole
    // battle again for one ship. One with its arcs showing is, since they reach.
    const halfW = (widthPx / 2 + CULL_PAD_PX) / camera.scale;
    const halfH = (heightPx / 2 + CULL_PAD_PX) / camera.scale;
    shownBox.x = camera.x;
    shownBox.y = camera.y;
    shownBox.halfW = halfW;
    shownBox.halfH = halfH;
    const shown = (ship: ShipView): boolean =>
        arcsFor(ship.body, selected, arcs) !== "none" ||
        (Math.abs(ship.x - camera.x) - ship.currentStructure.radius <= halfW &&
            Math.abs(ship.y - camera.y) - ship.currentStructure.radius <= halfH);

    // Every capital hull, then the robots crawling over them, then every
    // fighter, aboard a carrier or not: robots work on the deck, and a fighter
    // sits above it, so neither a capital spawned later nor a robot under a
    // landed fighter may be painted over what is on top.
    // A ship out of view may still burn a plume reaching into it.
    const plumeShown = (ship: ShipView): boolean => {
        const reach = ship.currentStructure.radius + plumeReach(ship);
        return Math.abs(ship.x - camera.x) - reach <= halfW && Math.abs(ship.y - camera.y) - reach <= halfH;
    };
    for (let i = 0; i < snapshot.shipCount; i++) {
        const ship = snapshot.ships[i]!;
        if (shown(ship)) drawShip(ctx, ship, camera.scale, arcsFor(ship.body, selected, arcs), false, underneath, light);
        else if (!ship.currentStructure.fighter && plumeShown(ship)) drawPlumes(ctx, ship, light);
    }
    for (let i = 0; i < snapshot.shipCount; i++) {
        const ship = snapshot.ships[i]!;
        if (robotsShown(ship, camera.x, camera.y, halfW, halfH)) drawRobots(ctx, ship);
    }
    for (let i = 0; i < snapshot.shipCount; i++) {
        const ship = snapshot.ships[i]!;
        if (shown(ship)) drawShip(ctx, ship, camera.scale, arcsFor(ship.body, selected, arcs), true, false, light);
        else if (ship.currentStructure.fighter && plumeShown(ship)) drawPlumes(ctx, ship, light);
    }

    drawDebris(ctx, snapshot, camera, light);
    drawClouds(ctx, snapshot, light);

    // Icons in a pass of their own, after every hull: an icon stands for the
    // ship as a whole, so it belongs over its neighbours rather than under
    // whichever of them happens to be drawn next.
    for (let i = 0; i < snapshot.shipCount; i++) {
        if (!shown(snapshot.ships[i]!)) continue;
        drawIcon(ctx, snapshot.ships[i]!, camera.scale);
        drawName(ctx, snapshot.ships[i]!, camera.scale);
    }

    for (const body of alsoSelected) if (body !== selected) drawRing(ctx, snapshot, body, camera.scale);
    if (selected >= 0) drawSelected(ctx, snapshot, selected, camera.scale);
    if (marked !== null) drawMarked(ctx, snapshot, marked, camera.scale);
    drawOrders(ctx, snapshot, selected, alsoSelected, camera.scale);
    drawBurns(ctx, snapshot);
    drawProjectiles(ctx, snapshot, camera, teamShots);
    // Beams' glows under their cores, so their own light does not wash out
    // their colour; their emitters' glows and the flashes where they land over
    // them, so those lighten them rather than being cut by them.
    beamLights(ctx, snapshot, camera, teamShots);
    drawGlows(ctx, lights);
    inScene = false;
    drawJetRings(ctx);
    seen?.add(lights);
    lights.clear();
    drawBeams(ctx, snapshot, camera, teamShots);
    if (flashes !== undefined) drawFlashes(ctx, snapshot, flashes, camera, light);
    drawGlows(ctx, lights);
    seen?.add(lights);
    lights.clear();
    shownBox.halfW = Infinity;
    shownBox.halfH = Infinity;
}

/** Whether a segment's box reaches the box being drawn. */
function nearShown(x0: number, y0: number, x1: number, y1: number): boolean {
    return (
        Math.max(x0, x1) >= shownBox.x - shownBox.halfW &&
        Math.min(x0, x1) <= shownBox.x + shownBox.halfW &&
        Math.max(y0, y1) >= shownBox.y - shownBox.halfH &&
        Math.min(y0, y1) <= shownBox.y + shownBox.halfH
    );
}

/** CSS pixels a metre in a close-up, where its size is not held to a bound: a Gunship's is about 150 px. */
const CLOSE_UP_ZOOM = 1.35;
/** A close-up's smallest and largest side, CSS pixels. */
const CLOSE_UP_MIN_PX = 64;
const CLOSE_UP_MAX_PX = 240;
/** Gap kept from the view's edge and between close-ups, CSS pixels. */
const CLOSE_UP_MARGIN_PX = 10;
/** A ship drawn smaller across than this, CSS pixels, gets a close-up. */
const CLOSE_UP_SMALLEST_PX = 16;
/** The pointer on a close-up's frame towards a ship off screen, CSS pixels. */
const CLOSE_UP_POINTER_PX = 9;

/**
 * Where the selected ship and what it is fighting get close-ups: each where
 * the view shows it off screen or too small to read. `ratio` is canvas pixels
 * per CSS pixel.
 */
export function closeUps(
    snapshot: Snapshot,
    camera: Camera,
    widthPx: number,
    heightPx: number,
    selected: number,
    ratio = 1,
    strips: Strips | null = null,
): Inset[] {
    const ship = shipByBody(snapshot, selected);
    if (ship === null) return [];
    const ships: InsetShip[] = [ship, shipByBody(snapshot, ship.fighting ?? -1)]
        .filter((s): s is ShipView => s !== null)
        .map((s) => ({ body: s.body, x: s.x, y: s.y, vx: s.vx, vy: s.vy, radius: s.currentStructure.radius }));
    const area: InsetArea = { left: strips?.left.width ?? 0, top: 0, right: widthPx - (strips?.right.width ?? 0), bottom: heightPx };
    return insetsFor(
        ships,
        camera,
        widthPx,
        heightPx,
        {
            zoom: CLOSE_UP_ZOOM * ratio,
            least: CLOSE_UP_MIN_PX * ratio,
            most: CLOSE_UP_MAX_PX * ratio,
            margin: CLOSE_UP_MARGIN_PX * ratio,
            smallest: CLOSE_UP_SMALLEST_PX * ratio,
        },
        area,
    );
}

/**
 * The ship whose tile or close-up is under a world point the main view was
 * tapped at, or -1: picking it from there frames it, wherever it is. They are
 * drawn over the view, so a tap on one is a tap on it.
 */
export function overlayAt(
    strips: Strips | null,
    insets: readonly Inset[],
    camera: Camera,
    widthPx: number,
    heightPx: number,
    x: number,
    y: number,
): number {
    const px = widthPx / 2 + (x - camera.x) * camera.scale;
    const py = heightPx / 2 - (y - camera.y) * camera.scale;
    const inset = insetAt(insets, px, py);
    if (inset >= 0) return inset;
    return strips === null ? -1 : stripTileAt(strips, px, py);
}

/** The tile under a world point the main view was tapped at, unless a close-up is over it; null for none. */
export function overlayTileAt(
    strips: Strips | null,
    insets: readonly Inset[],
    camera: Camera,
    widthPx: number,
    heightPx: number,
    x: number,
    y: number,
): StripTile | null {
    const px = widthPx / 2 + (x - camera.x) * camera.scale;
    const py = heightPx / 2 - (y - camera.y) * camera.scale;
    if (strips === null || insetAt(insets, px, py) >= 0) return null;
    return stripTileUnder(strips, px, py);
}

/**
 * Draw the close-ups `closeUps` asks for over a view already drawn: each the
 * battle again through a camera of its own, framed in its ship's colours,
 * with a pointer towards its ship when that is off screen.
 */
export function drawCloseUps(
    ctx: CanvasRenderingContext2D,
    snapshot: Snapshot,
    insets: readonly Inset[],
    selected: number,
    ratio = 1,
    flashes?: Flashes,
    arcs: Arcs = "none",
    teamShots = false,
    marked: Marked | null = null,
): void {
    for (const inset of insets) {
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.beginPath();
        ctx.rect(inset.x, inset.y, inset.size, inset.size);
        ctx.clip();
        drawScene(ctx, snapshot, inset.camera, inset.x, inset.y, inset.size, inset.size, flashes, arcs, teamShots, selected, [], marked);
        ctx.restore();

        const ship = shipByBody(snapshot, inset.body)!;
        const colour = markerOf(ship.hasControl && !ship.isMissionKilled ? shipColours(ship.team) : NEUTRAL).trim;
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.strokeStyle = colour;
        ctx.lineWidth = (inset.body === selected ? 2 : 1.5) * ratio;
        if (inset.body !== selected) ctx.setLineDash([5 * ratio, 4 * ratio]);
        ctx.strokeRect(inset.x, inset.y, inset.size, inset.size);
        ctx.setLineDash([]);
        if (inset.toward !== null) {
            // From the frame's centre along the bearing, out to the frame, a wedge beyond it.
            const half = inset.size / 2;
            const cx = inset.x + half;
            const cy = inset.y + half;
            const dx = Math.cos(inset.toward);
            const dy = Math.sin(inset.toward);
            const reach = half / Math.max(Math.abs(dx), Math.abs(dy));
            const tip = CLOSE_UP_POINTER_PX * ratio;
            const bx = cx + dx * reach;
            const by = cy + dy * reach;
            ctx.fillStyle = colour;
            ctx.beginPath();
            ctx.moveTo(bx + dx * tip, by + dy * tip);
            ctx.lineTo(bx - dy * tip * 0.6, by + dx * tip * 0.6);
            ctx.lineTo(bx + dy * tip * 0.6, by - dx * tip * 0.6);
            ctx.closePath();
            ctx.fill();
        }
        ctx.restore();
    }
}

/** Size of the range to a picked ship's target, CSS pixels, and its clearances. */
const RANGE_LABEL_PX = 12;
const RANGE_PAD_PX = 3;
const RANGE_GAP_PX = 6;

/**
 * How far the picked ship is from what it is fighting, upright, by the
 * picked ship: on the line to its target just past its ring, so it stays in
 * frame while the ship is and the eye finds it where it left it; or, when the
 * ship is shown in a window, just outside the window on the side facing the
 * target.
 */
export function drawTargetRange(
    ctx: CanvasRenderingContext2D,
    snapshot: Snapshot,
    camera: Camera,
    widthPx: number,
    heightPx: number,
    selected: number,
    insets: readonly Inset[],
    ratio: number,
): void {
    const ship = shipByBody(snapshot, selected);
    const target = shipByBody(snapshot, ship?.fighting ?? -1);
    if (ship === null || target === null) return;
    const text = describeRange(Math.hypot(target.x - ship.x, target.y - ship.y));
    const colour = markerOf(ship.hasControl && !ship.isMissionKilled ? shipColours(ship.team) : NEUTRAL).trim;
    const size = RANGE_LABEL_PX * ratio;
    const pad = RANGE_PAD_PX * ratio;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.font = `${size}px ui-monospace, monospace`;
    const w = ctx.measureText(text).width + 2 * pad;
    const h = size + 2 * pad;
    const screen = (x: number, y: number): LabelAt => ({
        x: widthPx / 2 + (x - camera.x) * camera.scale,
        y: heightPx / 2 - (y - camera.y) * camera.scale,
    });
    const from = screen(ship.x, ship.y);
    const to = screen(target.x, target.y);
    const box = insets.find((inset) => inset.body === selected);
    let at: LabelAt;
    if (box !== undefined) {
        const cx = box.x + box.size / 2;
        const cy = box.y + box.size / 2;
        const others = insets.filter((inset) => inset !== box);
        at = labelBeside(box, Math.atan2(to.y - cy, to.x - cx), w, h, RANGE_GAP_PX * ratio, widthPx, heightPx, others);
    } else {
        const length = Math.hypot(to.x - from.x, to.y - from.y);
        if (!(length > 0)) {
            ctx.restore();
            return;
        }
        const ring = (ship.currentStructure.radius + SELECTED_GAP_PX / camera.scale) * camera.scale;
        at = labelAlong(from.x, from.y, (to.x - from.x) / length, (to.y - from.y) / length, ring, length, w, h, RANGE_GAP_PX * ratio);
    }
    ctx.fillStyle = BACKGROUND;
    ctx.fillRect(at.x - w / 2, at.y - h / 2, w, h);
    ctx.fillStyle = colour;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, at.x, at.y);
    ctx.restore();
}

/** A tile's side as a share of the view's width, and its bounds in CSS pixels. */
const STRIP_SHARE = 0.09;
const STRIP_MAX_PX = 88;
const STRIP_MIN_PX = 34;
const STRIP_MARGIN_PX = 6;
const STRIP_GAP_PX = 4;

/** Mass of what is left of a ship, each module discounted by its wear: kg, roughly. */
function intactMass(ship: ShipView): number {
    const design = ship.currentStructure;
    const n = design.modules.length;
    if (n === 0) return design.mass;
    let integrity = 0;
    for (let m = 0; m < n; m++) integrity += ship.integrity[m] ?? 1;
    return (design.mass * integrity) / n;
}

/**
 * Each side's ships as live tiles down the view's edges: every ship anyone
 * controls, a side's ships of one design sharing a tile when there are too
 * many, as they come and go in numbers. `ratio` is canvas pixels per CSS pixel.
 */
export function fleetStrips(snapshot: Snapshot, widthPx: number, heightPx: number, ratio = 1): Strips {
    const ships: StripShip[] = [];
    const designs = new Map<string, number>();
    for (let i = 0; i < snapshot.shipCount; i++) {
        const ship = snapshot.ships[i]!;
        if (ship.team < 0 || !ship.hasControl) continue;
        // Grouped by the name of what each is built to, so a ship knocked about
        // stays with its kind, and fighters from each of a carrier's pads, each
        // pad's copy of the design its own, all go together.
        const name = (ship.blueprint ?? ship.currentStructure).name;
        let design = designs.get(name);
        if (design === undefined) designs.set(name, (design = designs.size));
        ships.push({
            body: ship.body,
            team: ship.team,
            x: ship.x,
            y: ship.y,
            vx: ship.vx,
            vy: ship.vy,
            radius: ship.currentStructure.radius,
            design,
            intact: intactMass(ship),
        });
    }
    return stripsFor(ships, widthPx, heightPx, {
        largest: Math.min(STRIP_MAX_PX * ratio, widthPx * STRIP_SHARE),
        smallest: STRIP_MIN_PX * ratio,
        margin: STRIP_MARGIN_PX * ratio,
        gap: STRIP_GAP_PX * ratio,
    });
}

/** How much of the view's width the strips take from each edge, the wider of the two, canvas pixels. */
export function stripsWidth(strips: Strips | null): number {
    return strips === null ? 0 : Math.max(strips.left.width, strips.right.width);
}

/** Frames between redrawing a fleet strip tile that is not the selected ship's, staggered across the tiles. */
const STRIP_REFRESH_FRAMES = 4;

/**
 * The fleet strips on a canvas of their own over the view, which is not
 * cleared between frames, so each tile is redrawn only every
 * `STRIP_REFRESH_FRAMES` frames, a few each frame, and left as it is in
 * between: a tile draws the battle again through a camera of its own, and a
 * side of fighters round a capital hull draws that hull again for each of
 * them. The selected ship's tile is drawn every frame, and one picked or let go
 * at once. When the tiles move, or the canvas changes size, it all starts again.
 */
export class StripCache {
    private frame = 0;
    /** Each tile's frame and whether it was picked, when last drawn, by its place in the layout. */
    private drawn: { frame: number; picked: boolean }[] = [];
    /** Where every tile and "more" box was, and what each showed, as last laid out. */
    private layout = "";
    private width = 0;
    private height = 0;

    /** Start a frame of `strips`, or of none: if they are not where they were, the canvas is cleared. */
    begin(ctx: CanvasRenderingContext2D, strips: Strips | null): void {
        this.frame++;
        const layout = strips === null ? "" : layoutOf(strips);
        const { width, height } = ctx.canvas;
        if (layout === this.layout && width === this.width && height === this.height) return;
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, width, height);
        ctx.restore();
        this.drawn.length = 0;
        this.layout = layout;
        this.width = width;
        this.height = height;
    }

    /** Whether the `index`th tile is due a redraw this frame. */
    due(index: number, picked: boolean): boolean {
        const last = this.drawn[index];
        const due = last === undefined || picked || last.picked !== picked || (this.frame + index) % STRIP_REFRESH_FRAMES === 0;
        if (due) this.drawn[index] = { frame: this.frame, picked };
        return due;
    }
}

function layoutOf(strips: Strips): string {
    const column = (c: StripColumn): string =>
        c.tiles.map((t) => `${t.x},${t.y},${t.size},${t.body},${t.team},${t.count}`).join(";") +
        (c.more === null ? "" : `+${c.more.x},${c.more.y},${c.hidden}`);
    return `${column(strips.left)}|${column(strips.right)}`;
}

/** What each tile's ships have been bringing in lately, keyed by the lowest body a tile stands for. */
const tileIncome = new Income();

/** What the ships of a tile have brought in all battle, kg of metal, or null if none of them has gathered any. */
function gatheredBy(snapshot: Snapshot, bodies: readonly number[]): number | null {
    let total: number | null = null;
    for (const body of bodies) {
        const metal = shipByBody(snapshot, body)?.gatheredMetal;
        if (metal !== undefined) total = (total ?? 0) + metal;
    }
    return total;
}

/** Draw the strips: each tile its ship live, framed in its side's colours, the picked one brightest, and what it is mining as income. */
export function drawFleetStrips(
    ctx: CanvasRenderingContext2D,
    snapshot: Snapshot,
    strips: Strips,
    selected: number,
    ratio = 1,
    flashes?: Flashes,
    arcs: Arcs = "none",
    teamShots = false,
    cache?: StripCache,
): void {
    cache?.begin(ctx, strips);
    let index = 0;
    const drawColumn = (column: StripColumn): void => {
        for (const tile of column.tiles) {
            const picked = tile.body === selected;
            const fresh = cache === undefined || cache.due(index, picked);
            index++;
            if (!fresh) continue;
            ctx.save();
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            // Its frame is stroked on its edge, half outside it, so that half is cleared too, or it would build up.
            const edge = 2 * ratio;
            ctx.clearRect(tile.x - edge, tile.y - edge, tile.size + 2 * edge, tile.size + 2 * edge);
            ctx.beginPath();
            ctx.rect(tile.x, tile.y, tile.size, tile.size);
            ctx.clip();
            drawScene(ctx, snapshot, tile.camera, tile.x, tile.y, tile.size, tile.size, flashes, arcs, teamShots, selected);
            ctx.restore();
            ctx.save();
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.strokeStyle = markerOf(shipColours(tile.team)).trim;
            ctx.globalAlpha = picked ? 1 : 0.55;
            ctx.lineWidth = (picked ? 2 : 1) * ratio;
            ctx.strokeRect(tile.x, tile.y, tile.size, tile.size);
            if (tile.count > 1) {
                ctx.globalAlpha = 1;
                ctx.fillStyle = ctx.strokeStyle;
                ctx.font = `${11 * ratio}px ui-monospace, monospace`;
                ctx.textAlign = "right";
                ctx.textBaseline = "bottom";
                ctx.fillText(`×${tile.count}`, tile.x + tile.size - 3 * ratio, tile.y + tile.size - 2 * ratio);
            }
            const gathered = gatheredBy(snapshot, tile.bodies);
            if (gathered !== null) {
                const rate = tileIncome.note(Math.min(...tile.bodies), snapshot.time, gathered);
                if (rate > 0) {
                    ctx.globalAlpha = 1;
                    ctx.fillStyle = ctx.strokeStyle;
                    ctx.font = `${10 * ratio}px ui-monospace, monospace`;
                    ctx.textAlign = "left";
                    ctx.textBaseline = "bottom";
                    const text = incomeText(rate);
                    // On a backing, as it often sits over bright rock.
                    const colour = ctx.fillStyle;
                    ctx.fillStyle = BACKGROUND;
                    ctx.globalAlpha = 0.75;
                    ctx.fillRect(tile.x + ratio, tile.y + tile.size - 13 * ratio, ctx.measureText(text).width + 4 * ratio, 12 * ratio);
                    ctx.globalAlpha = 1;
                    ctx.fillStyle = colour;
                    ctx.fillText(text, tile.x + 3 * ratio, tile.y + tile.size - 2 * ratio);
                }
            }
            ctx.restore();
        }
        if (column.more !== null) {
            const box = column.more;
            ctx.save();
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.fillStyle = BACKGROUND;
            ctx.fillRect(box.x, box.y, box.size, box.size * 0.5);
            ctx.fillStyle = markerOf(shipColours(column.tiles[0]?.team ?? 0)).trim;
            ctx.font = `${11 * ratio}px ui-monospace, monospace`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(`+${column.hidden}`, box.x + box.size / 2, box.y + box.size * 0.25);
            ctx.restore();
        }
    };
    drawColumn(strips.left);
    drawColumn(strips.right);
}

/** A selected ship shows all its arcs and the rest none; with none selected, every ship shows `arcs`. */
function arcsFor(body: number, selected: number, arcs: Arcs): Arcs {
    if (selected < 0) return arcs;
    return body === selected ? "trigger" : "none";
}

/** Pixels between the selected ship's hull circle and the ring drawn round it. */
const SELECTED_GAP_PX = 6;

/**
 * The ship the viewer has picked out: a ring round it in its side's trim, a
 * broken line from it to whatever it is fighting, with a smaller ring there,
 * a broken ring round whatever it is escorting, and a red one round whatever
 * it is keeping clear of.
 */
function drawSelected(ctx: CanvasRenderingContext2D, snapshot: Snapshot, body: number, metresToPx: number): void {
    const ship = shipByBody(snapshot, body);
    if (ship === null) return;
    const colour = markerOf(ship.hasControl && !ship.isMissionKilled ? shipColours(ship.team) : NEUTRAL).trim;
    const gap = SELECTED_GAP_PX / metresToPx;
    ctx.save();
    ctx.strokeStyle = colour;
    ctx.lineWidth = 1.5 / metresToPx;
    ctx.beginPath();
    ctx.arc(ship.x, ship.y, ship.currentStructure.radius + gap, 0, Math.PI * 2);
    ctx.stroke();
    // What it is doing, in the colour an order to do it is drawn in, told or not.
    const target = shipByBody(snapshot, ship.doingTo ?? ship.fighting ?? -1);
    if (target !== null) {
        if (ship.doing !== undefined) ctx.strokeStyle = ORDER_COLOURS[ship.doing];
        drawWay(ctx, ship, target, gap, metresToPx);
        // The band it is holding, round what it is holding it against, as the editor draws a ship's own.
        if (ship.fightingMax !== undefined && target.body === ship.fighting) {
            ctx.save();
            drawBand(ctx, target.x, target.y, ship.fightingMin ?? 0, ship.fightingMax, bandFadeOf(ship), metresToPx, ATTACK_BAND);
            ctx.restore();
        }
        ctx.globalAlpha = 0.6;
        ctx.beginPath();
        ctx.arc(target.x, target.y, target.currentStructure.radius + gap, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = colour;
    }
    // What it is escorting, ringed in a broken line: a ship it stays with, not one it shoots.
    const consort = shipByBody(snapshot, ship.covering ?? -1);
    if (consort !== null && ship.coverBand !== undefined) {
        // And the band it stays inside, round it.
        ctx.save();
        drawBand(ctx, consort.x, consort.y, ship.coverInner ?? 0, ship.coverBand, bandFadeOf(ship), metresToPx, ESCORT_BAND);
        ctx.restore();
    }
    if (consort !== null) {
        ctx.globalAlpha = 0.6;
        ctx.setLineDash([3 / metresToPx, 4 / metresToPx]);
        ctx.beginPath();
        ctx.arc(consort.x, consort.y, consort.currentStructure.radius + gap, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
    }
    const hazard = shipByBody(snapshot, ship.avoiding ?? -1);
    if (hazard !== null && ship.avoidRoom !== undefined) drawAvoiding(ctx, ship, hazard, ship.avoidRoom, metresToPx);
    ctx.restore();
}

/** Pixels across the marks for where a selected ship goes first and where it means to end up. */
const VIA_MARK_PX = 2.5;
const CORNER_MARK_PX = 3;
const DEST_MARK_PX = 4;

/**
 * A broken line from a ship to where it is flying: by the corner it plans
 * round what is in its way, through the point it makes for first, and on to
 * the point it means to end up at, if it has them, or else to the edge of
 * what it is after. The corner is ringed, the first point dotted, the end ringed larger.
 */
function drawWay(ctx: CanvasRenderingContext2D, ship: ShipView, target: ShipView, gap: number, metresToPx: number): void {
    const corner = ship.routeX !== undefined && ship.routeY !== undefined;
    const via = ship.viaX !== undefined && ship.viaY !== undefined;
    const dest = ship.destX !== undefined && ship.destY !== undefined;
    const xs: number[] = [];
    const ys: number[] = [];
    if (corner) {
        xs.push(ship.routeX!);
        ys.push(ship.routeY!);
    }
    if (via) {
        xs.push(ship.viaX!);
        ys.push(ship.viaY!);
    }
    if (dest) {
        xs.push(ship.destX!);
        ys.push(ship.destY!);
    } else {
        // Short of what it is after, by its radius and the gap.
        const fromX = xs.length > 0 ? xs[xs.length - 1]! : ship.x;
        const fromY = ys.length > 0 ? ys[ys.length - 1]! : ship.y;
        const dx = target.x - fromX;
        const dy = target.y - fromY;
        const length = Math.sqrt(dx * dx + dy * dy);
        const short = target.currentStructure.radius + gap;
        if (length > short) {
            xs.push(target.x - (dx / length) * short);
            ys.push(target.y - (dy / length) * short);
        }
    }
    if (xs.length === 0) return;
    // Starting outside the ring round the ship.
    const dx = xs[0]! - ship.x;
    const dy = ys[0]! - ship.y;
    const length = Math.sqrt(dx * dx + dy * dy);
    const from = ship.currentStructure.radius + gap;
    ctx.setLineDash([6 / metresToPx, 6 / metresToPx]);
    ctx.beginPath();
    if (length > from) ctx.moveTo(ship.x + (dx / length) * from, ship.y + (dy / length) * from);
    else ctx.moveTo(xs[0]!, ys[0]!);
    for (let k = 0; k < xs.length; k++) ctx.lineTo(xs[k]!, ys[k]!);
    ctx.stroke();
    ctx.setLineDash([]);
    if (corner) {
        ctx.beginPath();
        ctx.arc(ship.routeX!, ship.routeY!, CORNER_MARK_PX / metresToPx, 0, Math.PI * 2);
        ctx.stroke();
        // What that corner goes round, as the route saw it.
        if (ship.routeAroundR !== undefined) {
            ctx.setLineDash([2 / metresToPx, 4 / metresToPx]);
            ctx.beginPath();
            ctx.arc(ship.routeAroundX!, ship.routeAroundY!, ship.routeAroundR, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);
        }
    }
    if (via) {
        ctx.fillStyle = ctx.strokeStyle;
        ctx.beginPath();
        ctx.arc(ship.viaX!, ship.viaY!, VIA_MARK_PX / metresToPx, 0, Math.PI * 2);
        ctx.fill();
    }
    if (dest) {
        ctx.beginPath();
        ctx.arc(ship.destX!, ship.destY!, DEST_MARK_PX / metresToPx, 0, Math.PI * 2);
        ctx.stroke();
    }
}

const DANGER = "#ff3b30";

/**
 * What a ship is keeping clear of: red round the part of it the ship can hit,
 * out to where the ship wants it, fading from where they would touch to nothing
 * at that edge, as `avoid` weighs a near miss.
 */
function drawAvoiding(ctx: CanvasRenderingContext2D, ship: ShipView, hazard: ShipView, room: number, metresToPx: number): void {
    const touching = Math.min(room, ship.avoidTouch ?? ship.currentStructure.radius + hazard.currentStructure.radius);
    ctx.save();
    ctx.translate(ship.avoidX ?? hazard.x, ship.avoidY ?? hazard.y);
    keep(ctx, `avoid ${touching} ${room}`, () => avoidRings(ctx, touching, room, metresToPx));
    ctx.restore();
}

/** Stepped, not a gradient: the battle view's context draws no gradients. */
function avoidRings(ctx: CanvasRenderingContext2D, touching: number, room: number, metresToPx: number): void {
    const strongest = 0.3;
    ctx.fillStyle = DANGER;
    ctx.globalAlpha = strongest;
    ctx.beginPath();
    ctx.arc(0, 0, touching, 0, TAU);
    ctx.fill();
    const step = (room - touching) / FADE_STEPS;
    for (let k = 0; k < FADE_STEPS && step > 0; k++) {
        ctx.globalAlpha = strongest * (1 - (k + 0.5) / FADE_STEPS);
        ctx.beginPath();
        ctx.arc(0, 0, touching + (k + 1) * step, 0, TAU);
        ctx.arc(0, 0, touching + k * step, TAU, 0, true);
        ctx.fill("evenodd");
    }
    ctx.strokeStyle = DANGER;
    ctx.lineWidth = 1 / metresToPx;
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.arc(0, 0, room, 0, TAU);
    ctx.stroke();
}

/** How soft the edges of a ship's bands are, from what it has been told over its doctrine where it says. */
function bandFadeOf(ship: ShipView): number {
    return (ship.doctrine ?? ship.currentStructure.doctrine).approach.bandFade;
}

/** A picked-out ship's ring, without the lines to what it is fighting. */
function drawRing(ctx: CanvasRenderingContext2D, snapshot: Snapshot, body: number, metresToPx: number): void {
    const ship = shipByBody(snapshot, body);
    if (ship === null) return;
    ctx.save();
    ctx.strokeStyle = markerOf(ship.hasControl && !ship.isMissionKilled ? shipColours(ship.team) : NEUTRAL).trim;
    ctx.lineWidth = 1.5 / metresToPx;
    ctx.beginPath();
    ctx.arc(ship.x, ship.y, ship.currentStructure.radius + SELECTED_GAP_PX / metresToPx, 0, TAU);
    ctx.stroke();
    ctx.restore();
}

/** Each order's colour, by what it says to do. */
const ORDER_COLOURS = {
    attack: "#ff7a6b",
    defend: "#6fb6ff",
    waypoint: "#8f8f8f",
    ram: "#ffb347",
    dock: "#7ee07a",
    scavenge: "#d7a6ff",
    deliver: "#5fd6c8",
    flee: "#f2e35b",
    hide: "#b8c4cf",
} as const;

/**
 * The orders of every picked-out ship: a line from it through each target in
 * turn, in the colour of the order, and the order's place in the queue by
 * each target.
 */
function drawOrders(
    ctx: CanvasRenderingContext2D,
    snapshot: Snapshot,
    selected: number,
    also: readonly number[],
    metresToPx: number,
): void {
    const bodies = also.includes(selected) || selected < 0 ? also : [selected, ...also];
    ctx.save();
    ctx.lineWidth = 1.5 / metresToPx;
    for (const body of bodies) {
        const ship = shipByBody(snapshot, body);
        if (ship?.orders === undefined) continue;
        let fromX = ship.x;
        let fromY = ship.y;
        // Places in the queue by target, so two orders against one ship read "1, 2" rather than one over the other.
        const places = new Map<number, { ship: ShipView; text: string; colour: string }>();
        ship.orders.forEach((order, n) => {
            const target = shipByBody(snapshot, order.target);
            if (target === null) return;
            ctx.strokeStyle = ORDER_COLOURS[order.kind];
            ctx.globalAlpha = n === 0 ? 0.9 : 0.5;
            ctx.beginPath();
            ctx.moveTo(fromX, fromY);
            ctx.lineTo(target.x, target.y);
            ctx.stroke();
            const place = places.get(target.body);
            if (place === undefined) places.set(target.body, { ship: target, text: `${n + 1}`, colour: ORDER_COLOURS[order.kind] });
            else place.text += `, ${n + 1}`;
            fromX = target.x;
            fromY = target.y;
        });
        for (const place of places.values()) {
            drawScreenText(ctx, place.text, place.ship.x, place.ship.y + place.ship.currentStructure.radius, place.colour);
        }
    }
    ctx.restore();
}

/** Text at a world point, upright and at a fixed size on screen, just above it. */
function drawScreenText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, colour: string): void {
    const view = ctx.getTransform();
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, view.a * x + view.c * y + view.e, view.b * x + view.d * y + view.f);
    ctx.globalAlpha = 1;
    ctx.fillStyle = colour;
    ctx.font = "12px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText(text, 0, -4);
    ctx.restore();
}

/** Rings each edge's fade is shaded in. */
const FADE_STEPS = 8;

/**
 * A band of ranges about a point, filled faintly and edged: where a ship's
 * doctrine closes to. Each edge fades out across `fade` of its distance
 * either side of it, as the pull back into the band fades in (`edgeFade`).
 */
function drawBand(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    min: number,
    max: number,
    fade: number,
    metresToPx: number,
    colours: BandColours,
): void {
    // Rings the same from frame to frame while it holds the same band: kept (`keep`), and only moved.
    ctx.save();
    ctx.translate(x, y);
    keep(ctx, `band ${colours.fill} ${min} ${max} ${fade}`, () => bandRings(ctx, min, max, fade, metresToPx, colours));
    ctx.restore();
}

function bandRings(ctx: CanvasRenderingContext2D, min: number, max: number, fade: number, metresToPx: number, colours: BandColours): void {
    const x = 0;
    const y = 0;
    ctx.fillStyle = colours.fill;
    const ring = (from: number, to: number, alpha: number): void => {
        if (!(to > from) || !(alpha > 0)) return;
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.arc(x, y, to, 0, TAU);
        if (from > 0) ctx.arc(x, y, from, TAU, 0, true);
        ctx.fill("evenodd");
    };
    const near = min > 0 ? min * (1 + fade) : 0;
    const far = max * (1 - fade);
    const shaded = (r: number): number => (1 - edgeFade(r - max, max, fade)) * (min > 0 ? 1 - edgeFade(min - r, min, fade) : 1);
    const alpha = ctx.globalAlpha;
    if (fade > 0 && near < far) {
        ring(near, far, alpha);
        const fades: [number, number][] = [[far, max * (1 + fade)]];
        if (min > 0) fades.push([min * (1 - fade), near]);
        for (const [from, to] of fades) {
            const step = (to - from) / FADE_STEPS;
            for (let k = 0; k < FADE_STEPS; k++) ring(from + k * step, from + (k + 1) * step, alpha * shaded(from + (k + 0.5) * step));
        }
    } else {
        ring(min, max, alpha);
    }
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = colours.edge;
    ctx.lineWidth = 1 / metresToPx;
    ctx.beginPath();
    ctx.arc(x, y, max, 0, TAU);
    ctx.stroke();
    if (min > 0) {
        ctx.beginPath();
        ctx.arc(x, y, min, 0, TAU);
        ctx.stroke();
    }
}

/** The ship a flash is riding, or null when nothing in the picture is it. */
function shipByBody(snapshot: Snapshot, body: number): ShipView | null {
    if (body < 0) return null;
    for (let i = 0; i < snapshot.shipCount; i++) {
        const ship = snapshot.ships[i]!;
        if (ship.body === body) return ship;
    }
    return null;
}

/**
 * Impacts, as a hot core inside a warmer flare.
 *
 * Drawn last and additively, so a flash reads as light rather than as paint: a
 * hit on a hull brightens the hull rather than covering it, and two hits in
 * the same place are brighter than one.
 */
function drawFlashes(ctx: CanvasRenderingContext2D, snapshot: Snapshot, flashes: Flashes, camera: Camera, light?: Light): void {
    // Exposed for the last step, as a camera would photograph it: drawn at
    // moments through the step, each at the size and brightness it had then and
    // where it was then relative to the camera, weighted by how open the shutter
    // was, and summed.
    const dt = snapshot.dt;
    const cvx = camera.vx ?? 0;
    const cvy = camera.vy ?? 0;
    const floor = MIN_FLASH_PX / camera.scale;
    const base = ctx.getTransform();
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < flashes.count; i++) {
        const kind = flashes.kind[i]!;
        const glow = kind === IMPACT_BEAM ? BEAM_FLASH_GLOW : kind === IMPACT_BURST ? BURST_FLASH_GLOW : FLASH_GLOW;
        // A burst or a muzzle is a blast of gas rather than a spot of hot metal, so
        // its core is soft: as bright in the middle, fading out to its edge.
        const coreColour = kind === IMPACT_BEAM ? BEAM_FLASH_CORE : kind === IMPACT_BURST ? BURST_FLASH_CORE : FLASH_CORE;
        const core = sprite(kind === IMPACT_BURST || kind === IMPACT_MUZZLE ? "halo" : "hot", coreColour);
        const boost = kind === IMPACT_BURST ? BURST_BRIGHTNESS : 1;
        if (core === null) continue;
        const age = flashes.age[i]!;
        const lifetime = flashes.lifetime[i]!;
        // Centred on now, as a round's is, and reaching back half a step past the
        // flash's birth at full brightness: so a burst's flash is brightest where
        // its fragments' streaks cross.
        const opened = age - dt * 0.5;
        const closed = min(lifetime, age + dt * 0.5);
        const exposure = closed - opened;
        // A picture with no step, as the editor's, is an instant rather than an exposure.
        if (dt > 0 ? !(exposure > 0) : !(age < lifetime)) continue;
        // On the hull it went off against, wherever that hull has got to since,
        // and moving with it. A ship that has gone leaves its flashes where they
        // happened, and a burst drifts on at its shell's velocity.
        const anchor = shipByBody(snapshot, flashes.body[i]!);
        // What gives it off: a flying fighter's at its height, a gun's at a turret's, a hit on a hull's on its deck.
        const height = anchor !== null && (kind !== IMPACT_MUZZLE || anchor.currentStructure.fighter) ? heightOf(anchor) : THICK_SHADOW_M;
        const at = anchor === null ? { x: flashes.x[i]!, y: flashes.y[i]! } : flashPosition(flashes.localX[i]!, flashes.localY[i]!, anchor);
        const rvx = (anchor === null ? flashes.vx[i]! : anchor.vx) - cvx;
        const rvy = (anchor === null ? flashes.vy[i]! : anchor.vy) - cvy;
        // The way it points, turned with the hull it rides.
        let dirX = flashes.dirX[i]!;
        let dirY = flashes.dirY[i]!;
        if (anchor !== null) {
            const c = cos(anchor.angle);
            const sn = sin(anchor.angle);
            const lx = dirX;
            dirX = lx * c - dirY * sn;
            dirY = lx * sn + dirY * c;
        }
        const pointing = kind === IMPACT_MUZZLE && (dirX !== 0 || dirY !== 0);
        // A hit on a surface is a cone, opening the way what it throws off goes.
        let cone = false;
        if (kind === IMPACT_ROUND || kind === IMPACT_EXIT) {
            const angle = anchor?.angle ?? 0;
            const c = cos(angle);
            const sn = sin(angle);
            const nx = flashes.normalX[i]! * c - flashes.normalY[i]! * sn;
            const ny = flashes.normalX[i]! * sn + flashes.normalY[i]! * c;
            cone = sprayOf(kind, dirX, dirY, nx, ny, sprayed);
        }

        const radius = flashes.radius[i]!;
        const growth = flashes.growth[i]!;
        // A blast's glow is its edge, which goes out with its fastest fragments,
        // and its core sits inside it; a hit's glow is a flare around its core.
        const blast = growth > 0;
        const coreShare = blast ? BLAST_CORE_SHARE : 1;
        const glowShare = blast ? 1 : FLASH_GLOW_SHARE;
        const start = blast ? radius * FLASH_GLOW_SHARE : radius;
        const rStart = max(flashExtent(start, growth, opened, lifetime) * coreShare, floor);
        const rEnd = max(flashExtent(start, growth, closed, lifetime) * coreShare, floor);
        const travelPx = length(rvx, rvy) * exposure * camera.scale;
        const widestPx = 2 * max(rStart, rEnd) * camera.scale;
        const n = flashSamples(travelPx, (rEnd - rStart) * camera.scale, widestPx * 0.5);

        // Shared between the moments, but only between those that overlap: a
        // flash streaked out along its path stays as bright at any one point as
        // it would standing still.
        let total = 0;
        for (let k = 0; k < n; k++) total += n === 1 ? 1 : shutterWeight((k + 0.5) / n);
        const overlapping = travelPx > widestPx ? widestPx / travelPx : 1;
        // A muzzle flash's light: one small point at the muzzle, far brighter than
        // its wedge's glow, so it reaches back along the barrel to the gun's own
        // block, furthest as the flash leaves and less as it fades. Unseen: the
        // wedge is how it looks, and lights nothing itself.
        if (pointing) {
            const tip = max(muzzleWedge(radius, age, lifetime).backWidth * MUZZLE_GLOW_SHARE, floor);
            const shine = flashFade(age, lifetime) * WEDGE_GLOW * MUZZLE_TIP_BRIGHTNESS;
            lights.line(base, at.x, at.y, at.x, at.y, tip, glow, shine, false, true, false, height);
        }
        for (let k = 0; k < n; k++) {
            const u = n === 1 ? 0.5 : (k + 0.5) / n;
            const weight = (n === 1 ? 1 : shutterWeight(u)) / (total * overlapping);
            const t = opened + u * exposure;
            const fade = flashFade(t, lifetime);
            if (fade <= 0 || weight <= 0) continue;
            const ahead = t - age;
            const x = at.x + rvx * ahead;
            const y = at.y + rvy * ahead;
            if (pointing) {
                ctx.setTransform(base);
                drawWedge(
                    ctx,
                    base,
                    glow,
                    coreColour,
                    x,
                    y,
                    dirX,
                    dirY,
                    flashes.radius[i]!,
                    t,
                    lifetime,
                    fade * weight,
                    floor,
                    false,
                    height,
                );
                continue;
            }
            if (cone) {
                // A hot spot where it struck, and the cone opening from it.
                const spot = max(flashExtent(start, growth, t, lifetime) * HIT_SPOT_SHARE, floor);
                ctx.setTransform(base);
                ctx.globalAlpha = min(1, 0.9 * fade * weight);
                ctx.drawImage(core, x - spot, y - spot, 2 * spot, 2 * spot);
                drawWedge(
                    ctx,
                    base,
                    glow,
                    coreColour,
                    x,
                    y,
                    sprayed.x,
                    sprayed.y,
                    radius * HIT_CONE_SHARE,
                    t,
                    lifetime,
                    fade * weight,
                    floor,
                    true,
                    height,
                );
                continue;
            }
            // Floored on screen, so a hit is visible from far enough out to see the
            // battle it is part of.
            const extent = flashExtent(start, growth, t, lifetime);
            const r = max(extent * coreShare, floor);
            const g = max(extent * glowShare, floor);
            ctx.setTransform(base);
            lights.point(base, x, y, g, glow, 0.5 * boost * fade * weight, height);
            ctx.globalAlpha = min(1, 0.9 * boost * fade * weight);
            ctx.drawImage(core, x - r, y - r, 2 * r, 2 * r);
        }
    }
    ctx.restore();
    drawThrown(ctx, snapshot, flashes, camera, light);
}

/**
 * What hits and collisions throw off, as it is now: sparks in one additive
 * batch, each a streak along its way, and bits of metal in another, laid over
 * what is under them and catching the light as they tumble.
 */
function drawThrown(ctx: CanvasRenderingContext2D, snapshot: Snapshot, flashes: Flashes, camera: Camera, light: Light | undefined): void {
    const image = sprite("glowStreak", "#ffffff");
    const shard = sprite("shard", "#ffffff");
    const batches = (ctx as Partial<{ particles: PixiCanvas["particles"] }>).particles;
    if (image === null || shard === null || batches === undefined) return;
    const dt = snapshot.dt;
    const cvx = camera.vx ?? 0;
    const cvy = camera.vy ?? 0;
    const pixel = 1 / camera.scale;
    let batch: ReturnType<PixiCanvas["particles"]> | null = null;
    for (let i = 0; i < flashes.count; i++) {
        const kind = flashes.kind[i]!;
        const seed = seedOf(flashes.x[i]!, flashes.y[i]!, flashes.energy[i]!, kind, flashes.born[i]!);
        const n = sparkCount(kind, flashes.energy[i]!, seed);
        if (n === 0) continue;
        for (let j = 0; j < n; j++) {
            if (!spark(flashes, i, j, seed, flashes.age[i]!, thrown)) continue;
            // As a step's exposure sees it, as a tracer is: drawn out along its way past the camera.
            const rvx = thrown.vx - cvx;
            const rvy = thrown.vy - cvy;
            const speed = length(rvx, rvy);
            const streak = max(thrown.width, speed * dt);
            // Under a pixel it is not drawn.
            if (max(streak, thrown.width) < pixel) continue;
            batch ??= batches.call(ctx, image, true);
            const dirX = speed > 0 ? rvx / speed : 1;
            const dirY = speed > 0 ? rvy / speed : 0;
            batch.add(thrown.x, thrown.y, dirX, dirY, streak, max(thrown.width, pixel), sparkColour(thrown.t), sparkFade(thrown.t));
        }
    }
    batch?.end();

    let metal: ReturnType<PixiCanvas["particles"]> | null = null;
    const lit = rgba(light?.colour ?? "#ffffff");
    for (let i = 0; i < flashes.count; i++) {
        const n = bitCount(flashes.kind[i]!, flashes.energy[i]!);
        if (n === 0) continue;
        const seed = seedOf(flashes.x[i]!, flashes.y[i]!, flashes.energy[i]!, flashes.kind[i]!, flashes.born[i]!);
        for (let j = 0; j < n; j++) {
            if (!bit(flashes, i, j, seed, flashes.age[i]!, broken)) continue;
            if (broken.length < pixel) continue;
            metal ??= batches.call(ctx, shard, false);
            // Dull metal, flashing the light's colour as a face turns to it.
            const shine = broken.glint ** 6;
            const tint = lightUp(mixRgb(BIT_COLOUR, lit, shine), BIT_COLOUR, broken.x, broken.y);
            const fade = min(1, (1 - broken.t) / 0.3);
            metal.add(broken.x, broken.y, cos(broken.angle), sin(broken.angle), broken.length, max(broken.width, pixel), tint, fade);
        }
    }
    metal?.end();
}

/**
 * Lingering debris (`sim/debris.ts`): jagged shards of dull metal, some still
 * in their side's paint, tumbling and glinting in the battle's light as they
 * turn, lit by what is near them, fading at the end of their lives. One batch
 * a shape, laid over what is under it. A bit born in a blast glows white-hot
 * and cools through orange, its glow reaching a few times its length, so a
 * module blown apart flashes rather than turning into pieces between frames.
 */
function drawDebris(ctx: CanvasRenderingContext2D, snapshot: Snapshot, camera: Camera, light: Light | undefined): void {
    if (snapshot.debrisCount === 0) return;
    const batches = (ctx as Partial<{ particles: PixiCanvas["particles"] }>).particles;
    if (batches === undefined) return;
    const pixel = 1 / camera.scale;
    const lit = rgba(light?.colour ?? "#ffffff");
    debrisBatches.fill(null);
    let glows: ReturnType<PixiCanvas["particles"]> | null = null;
    for (let i = 0; i < snapshot.debrisCount; i++) {
        const length = snapshot.debrisSize[i]!;
        const heat = snapshot.debrisHeat[i]!;
        if (length * (heat > 0 ? HOT_REACH : 1) < pixel) continue;
        const x = snapshot.debrisX[i]!;
        const y = snapshot.debrisY[i]!;
        if (!nearShown(x, y, x, y)) continue;
        const seed = snapshot.debrisSeed[i]!;
        const fade = snapshot.debrisFade[i]!;
        if (heat > 0) {
            const halo = sprite("halo", "#ffffff");
            if (halo !== null) {
                glows ??= batches.call(ctx, halo, true);
                const reach = max(length * HOT_REACH, pixel);
                glows.add(x, y, 1, 0, reach, reach, mixRgb(HOT_COOL, HOT_FRESH, heat), heat * heat);
            }
        }
        if (length < pixel) continue;
        const angle = snapshot.debrisAngle[i]!;
        // Its shape, its width, whether its paint is still on, and which way a face catches the light, from its seed.
        const shape = (seed >>> 16) % SHARDS.length;
        let batch = debrisBatches[shape]!;
        if (batch === null) {
            const image = sprite(SHARDS[shape]!, "#ffffff");
            if (image === null) continue;
            batch = debrisBatches[shape] = batches.call(ctx, image, false);
        }
        const across = 0.3 + 0.4 * ((seed & 0xff) / 255);
        const side = snapshot.debrisPaint[i]!;
        const painted = side !== UNPAINTED && (seed >>> 24) / 256 < PAINTED_SHARE;
        const base = painted ? paintOf(side) : BIT_COLOUR;
        const shine = Math.abs(cos(angle * 1.7 + (seed >>> 8))) ** 6;
        let tint = lightUp(mixRgb(base, lit, shine * (painted ? PAINT_SHINE : 1)), base, x, y);
        if (heat > 0) tint = mixRgb(unpack(tint), HOT_FRESH, heat);
        batch.add(x, y, cos(angle), sin(angle), length, max(length * across, pixel), tint, fade);
    }
    for (const batch of debrisBatches) batch?.end();
    glows?.end();
}

/**
 * Fuel let out where a module holding it broke up (`render/vapour.ts`): a puff
 * of white vapour out every way at once, as a leak's but all in one go,
 * thinning to nothing. One batch, laid over the debris.
 */
function drawClouds(ctx: CanvasRenderingContext2D, snapshot: Snapshot, light: Light | undefined): void {
    if (snapshot.cloudCount === 0) return;
    const batches = (ctx as Partial<{ particles: PixiCanvas["particles"] }>).particles;
    const image = sprite("halo", "#ffffff");
    if (batches === undefined || image === null) return;
    const [r, g, b] = rgba(light === undefined ? LEAK : litColour(LEAK, light.colour));
    const tint = (r << 16) | (g << 8) | b;
    let batch: ReturnType<PixiCanvas["particles"]> | null = null;
    for (let i = 0; i < snapshot.cloudCount; i++) {
        cloud.x = snapshot.cloudX[i]!;
        cloud.y = snapshot.cloudY[i]!;
        cloud.age = snapshot.cloudAge[i]!;
        cloud.fuel = snapshot.cloudFuel[i]!;
        cloud.fill = snapshot.cloudFill[i]!;
        cloud.size = snapshot.cloudSize[i]!;
        cloud.seed = snapshot.cloudSeed[i]!;
        eachCloudPuff(cloud, puff, (p) => {
            if (!nearShown(p.x - p.radius, p.y - p.radius, p.x + p.radius, p.y + p.radius)) return;
            batch ??= batches.call(ctx, image, false);
            batch.add(p.x, p.y, p.dirX, p.dirY, p.length, 2 * p.radius, lightUp(tint, LEAK_RGB, p.x, p.y), p.alpha);
        });
    }
    (batch as ReturnType<PixiCanvas["particles"]> | null)?.end();
}

/** Scratch for drawing a cloud, so drawing one allocates nothing. */
const cloud: Cloud = { x: 0, y: 0, age: 0, fuel: 0, fill: 0, size: 0, seed: 0 };

/** One batch a shape of bit, open while debris is drawn. */
const debrisBatches: (ReturnType<PixiCanvas["particles"]> | null)[] = SHARDS.map(() => null);

/** The share of a painted module's bits that keep their paint, the rest torn or burnt back to the metal. */
const PAINTED_SHARE = 0.4;
/** How much less a painted face glints than bare metal. */
const PAINT_SHINE = 0.5;
/** How far a hot bit's glow reaches, in its lengths: enough between them to cover the module they came from. */
const HOT_REACH = 3;
/** A hot bit's colour as it is born, and as it is about to go out. */
const HOT_FRESH: readonly [number, number, number] = [255, 236, 200];
const HOT_COOL: readonly [number, number, number] = [255, 110, 30];

/** A side's paint as it looks on a bit: its hull colour, a little weathered. Kept by colour, which a livery can change. */
const paints = new Map<string, readonly number[]>();
function paintOf(side: number): readonly number[] {
    const hull = shipColours(side).hull;
    let paint = paints.get(hull);
    if (paint === undefined) {
        const [r, g, b] = rgba(hull);
        paint = [r * PAINT_WEAR, g * PAINT_WEAR, b * PAINT_WEAR];
        paints.set(hull, paint);
    }
    return paint;
}
/** How much darker paint on a bit is than on the hull: scorched, and turned from the light. */
const PAINT_WEAR = 0.75;

/** `0xrrggbb` as its channels. */
function unpack(colour: number): readonly number[] {
    unpacked[0] = (colour >> 16) & 0xff;
    unpacked[1] = (colour >> 8) & 0xff;
    unpacked[2] = colour & 0xff;
    return unpacked;
}
const unpacked = [0, 0, 0];

/** Bits of metal before they catch the light: a dark steel grey. */
const BIT_COLOUR: readonly [number, number, number] = [92, 100, 112];

/** `a` towards `b` by `u`, as `0xrrggbb`. */
function mixRgb(a: readonly number[], b: readonly number[], u: number): number {
    const mix = (k: number): number => Math.round(a[k]! + (b[k]! - a[k]!) * u);
    return (mix(0) << 16) | (mix(1) << 8) | mix(2);
}

/** Scratch for one spark or bit at a time, so throwing them allocates nothing. */
const thrown: Spark = { x: 0, y: 0, vx: 0, vy: 0, width: 0, t: 0 };
const broken: Bit = { x: 0, y: 0, angle: 0, length: 0, width: 0, glint: 0, t: 0 };

/**
 * A muzzle flash: a wedge from its narrow back to its wide front, out along
 * the barrel's line, brightest at the muzzle end, in one sprite; its glow is a
 * light along it.
 */
function drawWedge(
    ctx: CanvasRenderingContext2D,
    base: Transform,
    glow: string,
    core: string,
    x: number,
    y: number,
    dirX: number,
    dirY: number,
    radius: number,
    age: number,
    lifetime: number,
    brightness: number,
    floor: number,
    /** Whether it stays where it started, as a hit's on the face it struck, rather than moving out ahead as a muzzle's does. */
    anchored = false,
    /** How high above the deck what gives it off is, metres. */
    height = 0,
): void {
    const step = Math.round(sqrt(min(1, max(0, age / lifetime))) * WEDGE_STEPS);
    const image = wedgeSprite(core, step);
    if (image === null) return;
    const box = wedgeBox(radius, step);
    const wedge = muzzleWedge(radius, age, lifetime);
    const back = anchored ? wedge.back : 0;
    ctx.transform(dirX, dirY, -dirY, dirX, x - dirX * back, y - dirY * back);
    const half = max(box.half, floor);
    for (let left = brightness * WEDGE_HEADROOM; left > 0; left--) {
        ctx.globalAlpha = min(1, left);
        ctx.drawImage(image, box.from, -half, box.to - box.from, 2 * half);
    }
    const reach = max(((wedge.backWidth + wedge.frontWidth) / 2) * MUZZLE_GLOW_SHARE, floor);
    lights.line(
        base,
        x + dirX * (wedge.back - back),
        y + dirY * (wedge.back - back),
        x + dirX * (wedge.front - back),
        y + dirY * (wedge.front - back),
        reach,
        glow,
        brightness * WEDGE_GLOW,
        false,
        false,
        // A muzzle's light comes from its tip; a hit's from its wedge.
        !anchored,
        height,
    );
}

/**
 * Draw a sprite over the stretch a round crosses in a step centred on now: from
 * `(x0, y0)` to `(x1, y1)`, `width` across, and half a width further at either
 * end for the round's own size.
 */
function drawStreak(
    ctx: CanvasRenderingContext2D,
    base: DOMMatrix,
    image: CanvasImageSource,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    width: number,
    fallbackX: number,
    fallbackY: number,
): void {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const travel = length(dx, dy);
    // Still relative to the camera: the round's own heading, so it is not a
    // disc turned whichever way.
    const fallback = length(fallbackX, fallbackY);
    const ux = travel > 0 ? dx / travel : fallback > 0 ? fallbackX / fallback : 1;
    const uy = travel > 0 ? dy / travel : fallback > 0 ? fallbackY / fallback : 0;
    const along = travel + width;
    // The streak's own frame, composed onto the world's by hand: one call
    // rather than a reset and a multiply for every round.
    const a = ux * along;
    const b = uy * along;
    const c = -uy * width;
    const d = ux * width;
    const e = x0 - ux * width * 0.5;
    const f = y0 - uy * width * 0.5;
    ctx.setTransform(
        base.a * a + base.c * b,
        base.b * a + base.d * b,
        base.a * c + base.c * d,
        base.b * c + base.d * d,
        base.a * e + base.c * f + base.e,
        base.b * e + base.d * f + base.f,
    );
    ctx.drawImage(image, 0, -0.5, 1, 1);
}

/**
 * The ways in to each of a ship's pads, on the pad: a small arrow pointing in
 * from the middle of each side, or each corner, a fighter can come in over,
 * along the way it comes. Amber for a pad's one longest run, when no way is
 * clear all the way out.
 */
function drawApproaches(ctx: CanvasRenderingContext2D, ship: ShipView, metresToPx: number): void {
    const design = ship.currentStructure;
    for (let m = 0; m < design.modules.length; m++) {
        const module = design.modules[m]!;
        if (module.spec.kind !== "pad" || ship.drawn?.[m] === false) continue;
        const turn = approachTurn(design, m);
        const halfLength = module.spec.length / 2;
        const halfWidth = module.spec.width / 2;
        const size = 0.6 * min(halfLength, halfWidth);
        ctx.save();
        ctx.translate(module.x, module.y);
        ctx.rotate(module.angle);
        ctx.lineWidth = 2 / metresToPx;
        for (const approach of approachesOf(design, m)) {
            // In the pad's frame: the way out, and the side or corner it leaves by.
            const way = approach.angle + turn - module.angle;
            const ux = cos(way);
            const uy = sin(way);
            const x = Math.abs(ux) < 0.1 ? 0 : Math.sign(ux) * halfLength;
            const y = Math.abs(uy) < 0.1 ? 0 : Math.sign(uy) * halfWidth;
            const tipX = x - ux * size;
            const tipY = y - uy * size;
            ctx.strokeStyle = approach.through ? APPROACH_EDGE : APPROACH_BLOCKED;
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(tipX, tipY);
            ctx.moveTo(tipX + (ux - uy) * size * 0.4, tipY + (uy + ux) * size * 0.4);
            ctx.lineTo(tipX, tipY);
            ctx.lineTo(tipX + (ux + uy) * size * 0.4, tipY + (uy - ux) * size * 0.4);
            ctx.stroke();
        }
        ctx.restore();
    }
}

/** Module `m`'s colours: a fighter's, aboard a carrier or not, a shade darker than its side's ships. */
function moduleColours(design: ShipDesign, m: number, team: number): ReturnType<typeof shipColours> {
    return isFighterModule(design, m) ? fighterColours(team) : shipColours(team);
}

/** A round's colours: as light, or in its side's trim with a glow of its hull colour. */
function tracerColour(team: number, teamShots: boolean, glow: boolean, inside: boolean): string | null {
    if (!teamShots || team < 0) {
        return glow ? (inside ? TRACER_GLOW_INSIDE : TRACER_GLOW) : inside ? TRACER_INSIDE : TRACER;
    }
    const { hull, trim } = markerOf(shipColours(team));
    if (glow) return inside ? TRACER_GLOW_INSIDE : `${hull}88`;
    return inside ? `${trim}40` : trim;
}

function drawProjectiles(ctx: CanvasRenderingContext2D, snapshot: Snapshot, camera: Camera, teamShots: boolean) {
    // Tracers, in two passes so that every glow sits under every streak. Each
    // is exposed for the last step, as a camera would photograph it: drawn over
    // the line it crossed relative to the camera, fading in and out towards
    // either end as the shutter opens and closes. The round has hard sides; its
    // glow fades out from the line as well. Both are sized from the calibre and
    // floored on screen, so a round is true to size close up and legible from
    // far out. A round that covers each point of its streak for longer, by being
    // longer or slower, is more opaque; its glow is wider instead, which is what
    // a brighter soft glow looks like.
    const dt = snapshot.dt;
    const cvx = camera.vx ?? 0;
    const cvy = camera.vy ?? 0;
    const base = ctx.getTransform();
    ctx.save();
    for (let pass = 0; pass < 2; pass++) {
        const glowPass = pass === 0;
        for (let i = 0; i < snapshot.projectileCount; i++) {
            const inside = snapshot.projectileInside[i] === 1;
            const colour = tracerColour(snapshot.projectileTeam[i]!, teamShots, glowPass, inside);
            if (colour === null) continue;
            const image = sprite(glowPass ? "glowStreak" : "streak", colour);
            if (image === null) continue;
            const calibre = snapshot.projectileWidth[i]!;
            const x = snapshot.projectileX[i]!;
            const y = snapshot.projectileY[i]!;
            const vx = snapshot.projectileVx[i]!;
            const vy = snapshot.projectileVy[i]!;
            // Its streak is the last step's travel relative to the camera, so no further than that from it.
            if (!nearShown(x - 2 * (vx - cvx) * dt, y - 2 * (vy - cvy) * dt, x + 2 * (vx - cvx) * dt, y + 2 * (vy - cvy) * dt)) continue;
            const sx = snapshot.projectileStartX[i];
            const sy = snapshot.projectileStartY[i];
            const open = exposureEnds(x, y, vx, vy, cvx, cvy, dt);
            // The editor's demonstration fills only the rounds' own figures.
            const ends = sx === undefined || sy === undefined ? open : clipToStart(open, sx, sy, vx, vy);
            const exposure = tracerAlpha(SHELL_CALIBRES * calibre, length(ends.x1 - ends.x0, ends.y1 - ends.y0));
            const width = glowPass
                ? legibleWidth(GLOW_CALIBRES * calibre, MIN_GLOW_PX, camera.scale) * exposure
                : legibleWidth(calibre, MIN_TRACER_PX, camera.scale);
            ctx.globalAlpha = glowPass ? 1 : exposure;
            drawStreak(ctx, base, image, ends.x0, ends.y0, ends.x1, ends.y1, width, vx, vy);
        }
    }
    ctx.restore();
}

/**
 * Each beam's glow, as a light: sized from its width and floored on screen as
 * its line is, so a beam is true to size close up and legible from far out.
 */
function beamLights(ctx: CanvasRenderingContext2D, snapshot: Snapshot, camera: Camera, teamShots: boolean): void {
    const team = (i: number): number => (teamShots ? snapshot.beamTeam[i]! : -1);
    const base = ctx.getTransform();
    for (let i = 0; i < snapshot.beamCount; i++) {
        if (!nearShown(snapshot.beamStartX[i]!, snapshot.beamStartY[i]!, snapshot.beamEndX[i]!, snapshot.beamEndY[i]!)) continue;
        const halo = BEAM_GLOW_WIDTHS * snapshot.beamWidth[i]!;
        lights.line(
            base,
            snapshot.beamStartX[i]!,
            snapshot.beamStartY[i]!,
            snapshot.beamEndX[i]!,
            snapshot.beamEndY[i]!,
            legibleWidth(halo, MIN_BEAM_GLOW_PX, camera.scale) * BEAM_GLOW_REACH,
            snapshot.beamPlasma[i] === 1 ? PULSE_GLOW : team(i) < 0 ? BEAM_GLOW : markerOf(shipColours(team(i))).hull,
            beamAlpha(snapshot.beamPower[i]!) * BEAM_GLOW_ALPHA * BEAM_GLOW_BOOST * flooredFade(halo, MIN_BEAM_GLOW_PX, camera.scale),
            false,
            false,
            false,
            // From a turret, at its height.
            THICK_SHADOW_M,
        );
    }
}

/**
 * Beams' cores, each lit across as a rod is, and a small glow where it leaves
 * its emitter. Drawn after their glows, so that light does not wash out their
 * colour.
 */
function drawBeams(ctx: CanvasRenderingContext2D, snapshot: Snapshot, camera: Camera, teamShots: boolean) {
    ctx.lineCap = "butt";
    const team = (i: number): number => (teamShots ? snapshot.beamTeam[i]! : -1);
    const base = ctx.getTransform();
    // A pass per beam, because each carries its own width and its own opacity.
    // Cheap at the beam counts a battle reaches; if that ever stops being true,
    // bucket by width rather than reaching for a single average.
    for (let i = 0; i < snapshot.beamCount; i++) {
        if (!nearShown(snapshot.beamStartX[i]!, snapshot.beamStartY[i]!, snapshot.beamEndX[i]!, snapshot.beamEndY[i]!)) continue;
        const colour = team(i) < 0 ? BEAM : markerOf(shipColours(team(i))).trim;
        const calibre = snapshot.beamWidth[i]!;
        const alpha = beamAlpha(snapshot.beamPower[i]!);
        ctx.globalAlpha = alpha * flooredFade(calibre, MIN_TRACER_PX, camera.scale);
        // The beam *is* its calibre wide. Twice the calibre is the barrel's outer
        // diameter — right for the tube, wrong for what comes out of it.
        const width = legibleWidth(calibre, MIN_TRACER_PX, camera.scale);
        const x0 = snapshot.beamStartX[i]!;
        const y0 = snapshot.beamStartY[i]!;
        const dx = snapshot.beamEndX[i]! - x0;
        const dy = snapshot.beamEndY[i]! - y0;
        const span = length(dx, dy);
        const flame = snapshot.beamPlasma[i] === 1 && span > 0 ? flameSprite(PULSE, PULSE_CORE) : null;
        const rod = flame === null && width * camera.scale >= MIN_ROD_PX && span > 0 ? sprite("rod", colour) : null;
        if (flame !== null) {
            // Hot gas rather than light: brightest at the prongs, gone at its reach,
            // and cut off where it lands, as a flame is, rather than drawn whole into
            // the shorter length.
            const reach = snapshot.beamReach[i]! > span ? snapshot.beamReach[i]! : span;
            const shown = span / reach;
            ctx.save();
            ctx.transform(dx / span, dy / span, -dy / span, dx / span, x0, y0);
            ctx.scale(-1, 1);
            ctx.drawImage(flame, flame.width * (1 - shown), 0, flame.width * shown, flame.height, -span, -width / 2, span, width);
            ctx.restore();
        } else if (rod !== null) {
            ctx.save();
            ctx.transform(dx / span, dy / span, -dy / span, dx / span, x0, y0);
            ctx.drawImage(rod, 0, -width / 2, span, width);
            ctx.restore();
        } else {
            // Too thin to be seen as round: a line.
            ctx.strokeStyle = colour;
            ctx.lineWidth = width;
            ctx.beginPath();
            ctx.moveTo(x0, y0);
            ctx.lineTo(x0 + dx, y0 + dy);
            ctx.stroke();
        }
        // A pulse of hot gas lights what is round it as a flame does, not as an emitter.
        if (flame !== null) continue;
        const halo = BEAM_GLOW_WIDTHS * calibre;
        lights.point(
            base,
            x0,
            y0,
            legibleWidth(halo, MIN_BEAM_GLOW_PX, camera.scale) * BEAM_EMITTER_REACH,
            team(i) < 0 ? BEAM_FLASH_GLOW : markerOf(shipColours(team(i))).hull,
            alpha * BEAM_EMITTER_BRIGHTNESS * flooredFade(halo, MIN_BEAM_GLOW_PX, camera.scale),
            THICK_SHADOW_M,
        );
    }

    // Beams are drawn last, and nothing restores the context between frames:
    // leaving the final beam's opacity set would tint the next frame's grid and
    // wells before anything else had a chance to set it.
    ctx.globalAlpha = 1;
}

/**
 * Gravity wells, as rings at the radii where their pull reaches round values.
 *
 * A well has no body to draw — it is a point mass — so what is drawn is its
 * *effect*: the distance at which it pulls at 1 m/s², and at a tenth of that.
 * Without this, ships and rounds curve for no visible reason, which reads as a
 * bug in the physics rather than the physics working.
 */
function drawWells(ctx: CanvasRenderingContext2D, snapshot: Snapshot, camera: Camera): void {
    ctx.strokeStyle = WELL;
    ctx.lineWidth = 1 / camera.scale;
    for (let i = 0; i < snapshot.wells.length; i++) {
        const well = snapshot.wells[i]!;
        for (const pull of WELL_PULLS) {
            // r where gm/r² is `pull`.
            const r = sqrt(well.gm / pull);
            ctx.beginPath();
            ctx.arc(well.x, well.y, r, 0, TAU);
            ctx.stroke();
        }
        // A cross at the centre, sized in pixels so it stays visible at any zoom.
        const arm = WELL_ARM_PX / camera.scale;
        ctx.beginPath();
        ctx.moveTo(well.x - arm, well.y);
        ctx.lineTo(well.x + arm, well.y);
        ctx.moveTo(well.x, well.y - arm);
        ctx.lineTo(well.x, well.y + arm);
        ctx.stroke();
    }
}

/**
 * A grid at a round spacing, chosen so the lines stay a comfortable distance
 * apart on screen however far the camera has zoomed out. Without it there is
 * nothing to judge scale or motion against — two ships closing on a black
 * field look like two ships sitting still.
 */
function drawGrid(ctx: CanvasRenderingContext2D, camera: Camera, widthPx: number, heightPx: number): void {
    const step = gridStep(camera.scale);

    const halfW = widthPx / 2 / camera.scale;
    const halfH = heightPx / 2 / camera.scale;
    const x0 = Math.floor((camera.x - halfW) / step) * step;
    const x1 = camera.x + halfW;
    const y0 = Math.floor((camera.y - halfH) / step) * step;
    const y1 = camera.y + halfH;

    ctx.strokeStyle = GRID;
    ctx.lineWidth = 1 / camera.scale;
    ctx.beginPath();
    for (let x = x0; x <= x1; x += step) {
        ctx.moveTo(x, y0);
        ctx.lineTo(x, y1);
    }
    for (let y = y0; y <= y1; y += step) {
        ctx.moveTo(x0, y);
        ctx.lineTo(x1, y);
    }
    ctx.stroke();
}
