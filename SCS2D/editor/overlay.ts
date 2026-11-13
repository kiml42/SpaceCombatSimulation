import { blockCentre, bodySpec, math, moduleCentre, shapeOf, type ModuleSpec, type ShipDesign } from "../sim/index.js";
import { describeStep, snapStep, type Camera } from "../render/camera.js";
import { pointedThrust, type Envelopes } from "./stats.js";
import type { AssemblyOutline } from "./document.js";
import { HANDLE_RADIUS_PX, type Handle } from "./handles.js";

const { cos, sin, max, TAU } = math;

/**
 * What the editor draws that a battle does not: the selection, the centre of
 * mass, and the shape of the manoeuvring envelope.
 *
 * Everything here goes *on top of* `render/canvas2d.ts` rather than replacing
 * any of it. The ship, its turrets and their firing arcs are drawn by the same
 * code the battle uses, so what the editor shows is what the player will see
 * flying — and the only things added are the ones that exist because somebody
 * is editing.
 *
 * **These marks are measured in pixels, not metres.** None of them is a thing
 * in the world: an outline says *this one is selected*, and that statement is
 * the same statement on a three-metre drone as on a Star Destroyer. A width
 * held in metres says it differently at every zoom — a hairline nobody can see
 * on the big ship, a stripe wider than the module on the small one — so every
 * line width and standoff below is divided by `camera.scale` on the way out
 * and none of them has a floor in world units. The one thing that must stay in
 * metres is which module a mark is *on*, and that comes from the layout.
 */

const SELECTION = "#e9c05f";
/** How far a core reaches, and what is beyond every core's reach. */
const CONTROL_REACH_LINE = "#5fb3e9aa";
const CONTROL_DASH_PX = 6;
const OUT_OF_REACH = "#b48cff";
const OUT_OF_REACH_FILL = "#b48cff40";
const SELECTION_LINKED = "#e9c05fcc";
/**
 * An assembly is outlined in a different colour from a module, and once around
 * everything it holds rather than separately around each part.
 *
 * Both cues say the same thing, deliberately. The colour says *what kind of
 * thing* is selected, which is what decides what an edit will do — dragging a
 * assembly moves the assembly. The single box says *how many things* are selected,
 * which a selection of several modules and a selection of one assembly could
 * otherwise look identical about: five outlines either way, and a drag that
 * behaves quite differently.
 */
const GROUP_SELECTION = "#7fd4ff";
/** The assembly's other copies, which a drag of the selected one leaves where they are. */
const GROUP_LINKED = "#7fd4ffcc";
/** The assembly a selected module sits in: context rather than selection, so it is faint. */
const GROUP_CONTEXT = "#7fd4ff66";
/** How far the assembly's box stands off what it contains, pixels. */
const GROUP_BOX_MARGIN_PX = 7;
/**
 * A module some problem names, tinted red over its own shape.
 *
 * The problems list already says what is wrong; what it cannot say is *which*
 * module, on a ship of forty where "module 23" is a number nobody can count
 * to. The two halves are deliberately different kinds of statement — the list
 * explains, the canvas points.
 *
 * A tint rather than a ring, because a tint is the one mark that has no size
 * to get wrong: it covers the module whatever the zoom, and being a fill
 * rather than an outline it cannot be painted over by the selection outline
 * that sits on the very same box — which is what a ring had to be pushed
 * outside the module to survive, at a standoff that was itself a distance in
 * metres and so wrong at every zoom but one.
 */
const FAULT_FILL = "rgba(255, 107, 94, 0.32)";
/**
 * A refit from the design as it was opened (`refitPlan`): what would be built
 * tinted green over its own shape, and what would be taken down drawn where
 * it stood, a dashed outline with no module of the new design under it.
 */
const REFIT_BUILT_FILL = "rgba(127, 214, 160, 0.28)";
const REFIT_DOWN = "#e9915f";
const REFIT_DOWN_FILL = "rgba(233, 145, 95, 0.14)";
/** Dash and gap of the outline of a module a refit takes down, pixels. */
const REFIT_DASH_PX = 5;
/** The grab points on the selected module, in the selection's own colour. */
const HANDLE_FILL = "#e9c05f";
const HANDLE_EDGE = "#1b1f27";
const CENTRE_OF_MASS = "#7fd6a0";
/** How thick the editor's own lines are drawn, pixels. */
const SELECTION_WIDTH_PX = 1.5;
const HANDLE_EDGE_WIDTH_PX = 1;
/** Radius of the centre-of-mass ring, pixels; its arms reach 1.6 times that. */
const CENTRE_OF_MASS_RADIUS_PX = 6;
const ENVELOPE = "#5b8dd6";
const ENVELOPE_FILL = "rgba(91, 141, 214, 0.22)";
/** The outer curve is a reference rather than a capability, so it is drawn as one. */
const ENVELOPE_FREE = "rgba(91, 141, 214, 0.55)";
const ENVELOPE_LABEL = "#7f93aa";

/** Radius of the envelope rosette on screen, pixels, and while the pointer is over it. */
const ENVELOPE_RADIUS_PX = 54;
const ENVELOPE_EXPANDED_PX = 160;
const ENVELOPE_MARGIN_PX = 16;
/** Room kept below each rosette for its caption, pixels. */
const ENVELOPE_CAPTION_PX = 18;

/**
 * The bearings that bring the most main guns to bear. A deep crimson rather
 * than the orange-red of a trigger mask or a fault, which mean "would hit own
 * ship" and "something is wrong".
 */
const ATTACK = "#e0305a";
/** A sector's fill, as `rgba(…, alpha)`: fuller the more of the most main guns that bear in it. */
const ATTACK_RGB = "224, 48, 90";
const ATTACK_ALPHA_MOST = 0.42;
const ATTACK_ALPHA_LEAST = 0.08;
/** The bearing pointed at, light so it shows over the wedges. */
const ATTACK_POINTED = "#f0f4f8";
/** The gap between the attack rosette and the thrust rosette, pixels. */
const ROSETTE_GAP_PX = 16;
/** The share of a rosette's radius the ship is drawn across. */
const SILHOUETTE_SHARE = 0.35;
const SILHOUETTE = "rgba(160, 176, 196, 0.55)";
/** The narrowest a sector is drawn, radians, so a gun that does not train still shows. */
const ATTACK_MIN_WEDGE = 0.06;

/** A stretch of bearings, body frame, and how many main guns bear in it. */
export interface AttackSector {
    from: number;
    width: number;
    guns: number;
}

/** What the attack rosette shows: where the most main guns bear, where any do, and how many it has. */
export interface AttackRosette {
    sectors: readonly AttackSector[];
    coverage: readonly AttackSector[];
    total: number;
}

export interface OverlayView {
    design: ShipDesign | null;
    modules: readonly ModuleSpec[];
    /**
     * Indices of the drawn modules picked individually; the first is the one
     * grabbed. Assemblies are not among them — they come through `assemblies`.
     */
    selected: readonly number[];
    /** One box per drawn copy of a selected assembly, and of the assembly a selected module is in. */
    assemblies: readonly AssemblyOutline[];
    /** Indices of the drawn modules a problem names: overlapping, adrift, or unbuildable. */
    faulty: readonly number[];
    /** Indices of the drawn modules a refit from the design as opened would build. */
    refitBuilt?: readonly number[];
    /** The modules of the design as opened a refit would take down, where they stood. */
    refitDown?: readonly ModuleSpec[];
    /**
     * The grab points on the selected module — corners that size it and a knob
     * that turns it — or empty when the selection is not one module.
     *
     * Worked out by the caller rather than here, because the pointer has to hit
     * exactly what is drawn: one set of handles, used twice.
     */
    handles: readonly Handle[];
    /**
     * The manoeuvring envelopes, or null when there is no design to have any.
     *
     * Passed in rather than derived here, because the holding curve costs
     * thousands of allocations and depends only on the layout. Panning and
     * zooming redraw; they do not re-measure the ship.
     */
    envelope: Envelopes | null;
    /** A bearing on the envelope being pointed at, radians from the bow, or null. */
    envelopeBearing?: number | null;
    /** Whether the pointer is over the rosette, which is drawn larger while it is. */
    envelopeExpanded?: boolean;
    /** How far out the pointer is on the envelope, over its radius (`envelopeReachAt`). */
    envelopeReach?: number;
    /** What the burn shown for the bearing pointed at costs (`burnFigures`), or null. */
    envelopeBurn?: { isp: number; endurance: number } | null;
    /** The attack rosette, or null when there is no design. */
    attack?: AttackRosette | null;
    /** A bearing on the attack rosette being pointed at, radians from the bow, or null. */
    attackBearing?: number | null;
    /** Whether the pointer is over the attack rosette. */
    attackExpanded?: boolean;
    /** How many main guns bear on `attackBearing`, as are shown firing. */
    attackBearingGuns?: number;
}

/** Room above a grown rosette for the value at the bearing pointed at, pixels. */
const POINTED_LABEL_PX = 32;
/** Between the lines of what is pointed at, pixels. */
const POINTED_LINE_PX = 14;
/** How far a grown rosette's window stands off what it holds, pixels. */
const WINDOW_PAD_PX = 8;
const WINDOW_FILL = "rgba(14, 17, 23, 0.82)";
const WINDOW_EDGE = "rgba(127, 147, 170, 0.45)";

/** A rosette as drawn: its centre and radius, device pixels. */
interface Disc {
    x: number;
    y: number;
    radius: number;
}

/** A rosette's radius: larger while pointed at, though never past `right` or the canvas. */
function rosetteRadius(right: number, heightPx: number, expanded: boolean): number {
    if (!expanded) return ENVELOPE_RADIUS_PX;
    const room = Math.min(right - ENVELOPE_MARGIN_PX, heightPx - 2 * ENVELOPE_MARGIN_PX - ENVELOPE_CAPTION_PX - POINTED_LABEL_PX) / 2;
    return Math.max(ENVELOPE_RADIUS_PX, Math.min(ENVELOPE_EXPANDED_PX, room));
}

/** A rosette whose bottom-right corner stays put at `right` as it grows. */
function rosette(right: number, heightPx: number, expanded: boolean): Disc {
    const radius = rosetteRadius(right, heightPx, expanded);
    return { x: right - radius, y: heightPx - radius - ENVELOPE_MARGIN_PX - ENVELOPE_CAPTION_PX, radius };
}

/** Where the attack rosette's room ends on the right, device pixels: left of the thrust rosette at rest. */
function attackRight(widthPx: number): number {
    return widthPx - ENVELOPE_MARGIN_PX - 2 * ENVELOPE_RADIUS_PX - ROSETTE_GAP_PX;
}

function envelopeDisc(widthPx: number, heightPx: number, expanded: boolean): Disc {
    return rosette(widthPx - ENVELOPE_MARGIN_PX, heightPx, expanded);
}

function attackDisc(widthPx: number, heightPx: number, expanded: boolean): Disc {
    return rosette(attackRight(widthPx), heightPx, expanded);
}

/** The window round a grown rosette: its disc, the value pointed at above it and its caption below. */
function windowOf(disc: Disc): { left: number; top: number; right: number; bottom: number } {
    return {
        left: disc.x - disc.radius - WINDOW_PAD_PX,
        top: disc.y - disc.radius - POINTED_LABEL_PX - WINDOW_PAD_PX,
        right: disc.x + disc.radius + WINDOW_PAD_PX,
        bottom: disc.y + disc.radius + ENVELOPE_CAPTION_PX + WINDOW_PAD_PX,
    };
}

/**
 * Whether a point is on a rosette: on its disc at rest, or anywhere in its
 * window once grown, which holds the disc it grew from, so it cannot shrink
 * back from under a pointer that has not moved.
 */
function over(disc: Disc, expanded: boolean, x: number, y: number): boolean {
    if (!expanded) return Math.sqrt((x - disc.x) ** 2 + (disc.y - y) ** 2) <= disc.radius;
    const box = windowOf(disc);
    return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
}

/** The bearing from a rosette's centre to a point on it, radians from the bow anticlockwise, or null. */
function bearingOn(disc: Disc, expanded: boolean, x: number, y: number): number | null {
    if (!over(disc, expanded, x, y)) return null;
    const dx = x - disc.x;
    const dy = disc.y - y;
    if (Math.sqrt(dx * dx + dy * dy) < 2) return null;
    return Math.atan2(dy, dx);
}

/** Whether a point is on the attack rosette, as drawn at that size. */
export function overAttack(widthPx: number, heightPx: number, x: number, y: number, expanded = false): boolean {
    return over(attackDisc(widthPx, heightPx, expanded), expanded, x, y);
}

/** The bearing on the attack rosette under a point, radians from the bow, or null when off it. */
export function attackBearingAt(widthPx: number, heightPx: number, x: number, y: number, expanded = false): number | null {
    return bearingOn(attackDisc(widthPx, heightPx, expanded), expanded, x, y);
}

/** Whether a point is on the thrust rosette, as drawn at that size. */
export function overEnvelope(widthPx: number, heightPx: number, x: number, y: number, expanded = false): boolean {
    return over(envelopeDisc(widthPx, heightPx, expanded), expanded, x, y);
}

/**
 * The bearing on the thrust rosette under a point, radians from the bow
 * anticlockwise in the ship's frame, or null when the point is off it.
 */
export function envelopeBearingAt(widthPx: number, heightPx: number, x: number, y: number, expanded = false): number | null {
    return bearingOn(envelopeDisc(widthPx, heightPx, expanded), expanded, x, y);
}

/** How far from the thrust rosette's centre a point is, over its radius: 1 at its rim, more past it. */
export function envelopeReachAt(widthPx: number, heightPx: number, x: number, y: number, expanded = false): number {
    const disc = envelopeDisc(widthPx, heightPx, expanded);
    return Math.sqrt((x - disc.x) ** 2 + (disc.y - y) ** 2) / disc.radius;
}

/** The window a grown rosette is drawn in, over the ship. */
function drawWindow(ctx: CanvasRenderingContext2D, disc: Disc): void {
    const box = windowOf(disc);
    ctx.fillStyle = WINDOW_FILL;
    ctx.strokeStyle = WINDOW_EDGE;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(box.left, box.top, box.right - box.left, box.bottom - box.top, 6);
    ctx.fill();
    ctx.stroke();
}

/**
 * Draw the editor's own marks. Call it straight after `draw`, which leaves the
 * world-to-screen transform in place.
 */
export function drawOverlay(ctx: CanvasRenderingContext2D, view: OverlayView, camera: Camera, widthPx: number, heightPx: number): void {
    drawRefit(ctx, view, camera);
    drawFaults(ctx, view);
    if (view.design !== null) drawControl(ctx, view.design, camera);
    drawSelection(ctx, view, camera);
    drawHandles(ctx, view, camera);
    if (view.design !== null) drawCentreOfMass(ctx, view.design, camera);

    // The rosette is a screen-space widget, so the world transform has to go
    // before it is drawn — and with it the y flip, which would otherwise draw
    // every label upside down.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    drawGridCaption(ctx, camera, heightPx);
    const thrust = (): void => {
        if (view.envelope !== null) {
            drawEnvelope(ctx, view, view.envelope, widthPx, heightPx, view.envelopeBearing ?? null, view.envelopeExpanded === true);
        }
    };
    const attack = (): void => {
        if (view.attack != null && view.design !== null) {
            drawAttack(ctx, view, view.design, view.attack, widthPx, heightPx);
        }
    };
    thrust();
    // The thrust rosette grows over this one, so it gives way while it does.
    if (view.envelopeExpanded !== true) attack();
}

/** A bearing in whole degrees, positive to port, as the report gives them. */
function degrees(bearing: number): string {
    return `${Math.round((bearing * 180) / Math.PI)}°`;
}

/** The value at the bearing pointed at, above the rosette's right edge, in the pointer's colour. */
function pointedLabel(ctx: CanvasRenderingContext2D, lines: readonly string[], right: number, top: number): void {
    const y = Math.max(11 + POINTED_LINE_PX * (lines.length - 1), top - 6);
    ctx.font = "11px ui-monospace, monospace";
    ctx.textAlign = "right";
    ctx.fillStyle = ATTACK_POINTED;
    lines.forEach((line, i) => ctx.fillText(line, right, y - POINTED_LINE_PX * (lines.length - 1 - i)));
}

/** Seconds as a duration in its largest units, so it does not read as another figure in seconds. */
function duration(seconds: number): string {
    const s = Math.round(seconds);
    if (s < 60) return `${s} s`;
    if (s < 3600) return `${Math.floor(s / 60)} min ${s % 60} s`;
    return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;
}

/** The ship from above in a rosette, about its centre of mass, which the rosette's bearings are measured from. */
function silhouette(ctx: CanvasRenderingContext2D, view: OverlayView, design: ShipDesign, cx: number, cy: number, radius: number): void {
    const scale = (radius * SILHOUETTE_SHARE) / Math.max(design.radius, 1e-6);
    ctx.save();
    ctx.setTransform(scale, 0, 0, -scale, cx - scale * design.centreOfMassX, cy + scale * design.centreOfMassY);
    ctx.fillStyle = SILHOUETTE;
    for (const placed of view.modules) {
        const spec = bodySpec(placed);
        if (!(spec.length > 0) || !(spec.width > 0)) continue;
        const mid = moduleCentre(spec);
        ctx.save();
        ctx.translate(mid.x, mid.y);
        ctx.rotate(spec.angle ?? 0);
        outline(ctx, spec);
        ctx.fill();
        ctx.restore();
    }
    ctx.restore();
}

/**
 * Which way round the ship fights, as red wedges round it seen from above:
 * the sectors that bring the most main guns to bear (`bestAttackBearings`).
 * In a corner rather than as lines across the ship, which a ship with several
 * tied sectors covered.
 */
function drawAttack(
    ctx: CanvasRenderingContext2D,
    view: OverlayView,
    design: ShipDesign,
    attack: AttackRosette,
    widthPx: number,
    heightPx: number,
): void {
    const expanded = view.attackExpanded === true;
    const disc = attackDisc(widthPx, heightPx, expanded);
    const { x: cx, y: cy, radius } = disc;

    ctx.save();
    if (expanded) drawWindow(ctx, disc);
    ctx.strokeStyle = ENVELOPE_FREE;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);

    // Bearings run anticlockwise from the bow in the ship's frame; screen y is
    // flipped, so a bearing a is drawn at -a.
    const wedge = (sector: AttackSector): void => {
        const pad = Math.max(0, ATTACK_MIN_WEDGE - sector.width) / 2;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        if (sector.width >= TAU) ctx.arc(cx, cy, radius, 0, TAU);
        else ctx.arc(cx, cy, radius, -(sector.from - pad), -(sector.from + sector.width + pad), true);
        ctx.closePath();
    };
    const most = attack.sectors.reduce((m, s) => max(m, s.guns), 0);
    // Shaded by how many guns bear. A gun that does not train bears on one
    // bearing alone, so it is drawn a narrow wedge, outlined to show at all.
    for (const sector of attack.coverage) {
        if (!(sector.guns > 0) || !(most > 0)) continue;
        const share = Math.min(1, sector.guns / most);
        wedge(sector);
        ctx.fillStyle = `rgba(${ATTACK_RGB}, ${ATTACK_ALPHA_LEAST + (ATTACK_ALPHA_MOST - ATTACK_ALPHA_LEAST) * share})`;
        ctx.fill();
        if (sector.width > 0) continue;
        ctx.strokeStyle = ATTACK;
        ctx.lineWidth = 1;
        ctx.stroke();
    }

    silhouette(ctx, view, design, cx, cy, radius);
    crosshair(ctx, cx, cy, 2.5, 1);

    const bearing = view.attackBearing ?? null;
    if (bearing !== null) {
        ctx.strokeStyle = ATTACK_POINTED;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + cos(bearing) * radius, cy - sin(bearing) * radius);
        ctx.stroke();
    }

    ctx.fillStyle = ENVELOPE_LABEL;
    ctx.font = "11px ui-monospace, monospace";
    ctx.textAlign = "right";
    ctx.fillText(attack.total > 0 ? `max ${most}/${attack.total} main guns` : "no main guns", cx + radius, cy + radius + 14);
    if (bearing !== null)
        pointedLabel(ctx, [`${degrees(bearing)}: ${view.attackBearingGuns ?? 0}/${attack.total}`], cx + radius, cy - radius);
    ctx.textAlign = "left";
    ctx.restore();
}

/**
 * What the snap grid is currently worth, in the corner.
 *
 * The step follows the zoom, so it is the one number on the page that the
 * player changes without meaning to — and a drag that moves in five-metre
 * jumps when they expected centimetres is baffling until they know why. The
 * footer cannot hold it: text that changes length there rewraps and resizes
 * the canvas under the ship.
 */
function drawGridCaption(ctx: CanvasRenderingContext2D, camera: Camera, heightPx: number): void {
    ctx.fillStyle = ENVELOPE_LABEL;
    ctx.font = "11px ui-monospace, monospace";
    ctx.textAlign = "left";
    ctx.fillText(`snaps to ${describeStep(snapStep(camera.scale))}`, ENVELOPE_MARGIN_PX, heightPx - ENVELOPE_MARGIN_PX);
}

/** What a refit from the design as opened would build, tinted, and what it would take down, outlined. */
function drawRefit(ctx: CanvasRenderingContext2D, view: OverlayView, camera: Camera): void {
    const shape = (placed: ModuleSpec, paint: () => void): void => {
        const spec = bodySpec(placed);
        if (!(spec.length > 0) || !(spec.width > 0)) return;
        const mid = moduleCentre(spec);
        ctx.save();
        ctx.translate(mid.x, mid.y);
        ctx.rotate(spec.angle ?? 0);
        outline(ctx, spec);
        paint();
        ctx.restore();
    };
    for (const index of view.refitBuilt ?? []) {
        const placed = view.modules[index];
        if (placed === undefined) continue;
        shape(placed, () => {
            ctx.fillStyle = REFIT_BUILT_FILL;
            ctx.fill();
        });
    }
    for (const placed of view.refitDown ?? []) {
        shape(placed, () => {
            ctx.fillStyle = REFIT_DOWN_FILL;
            ctx.fill();
            ctx.strokeStyle = REFIT_DOWN;
            ctx.lineWidth = SELECTION_WIDTH_PX / camera.scale;
            ctx.setLineDash([REFIT_DASH_PX / camera.scale, REFIT_DASH_PX / camera.scale]);
            ctx.stroke();
        });
    }
}

/** Tint every module a problem names, over the module's own shape. */
function drawFaults(ctx: CanvasRenderingContext2D, view: OverlayView): void {
    for (const index of view.faulty) {
        const placed = view.modules[index];
        if (placed === undefined) continue;
        // The whole body, barrel and bell included, as it is in the way.
        const spec = bodySpec(placed);
        // A module with no interior is one of the things complained about, and it
        // has no box to tint. It is named in the list instead.
        if (!(spec.length > 0) || !(spec.width > 0)) continue;
        const mid = moduleCentre(spec);
        ctx.save();
        ctx.translate(mid.x, mid.y);
        ctx.rotate(spec.angle ?? 0);
        ctx.fillStyle = FAULT_FILL;
        outline(ctx, spec);
        ctx.fill();
        ctx.restore();
    }
}

/**
 * How far each core reaches, as a dashed circle, and every module that needs
 * a core and is out of reach of all of them, tinted and outlined: it will not
 * work in a battle (`ShipDesign.coveredBy`).
 */
function drawControl(ctx: CanvasRenderingContext2D, design: ShipDesign, camera: Camera): void {
    const lineWidth = SELECTION_WIDTH_PX / camera.scale;
    ctx.save();
    ctx.strokeStyle = CONTROL_REACH_LINE;
    ctx.lineWidth = lineWidth;
    ctx.setLineDash([CONTROL_DASH_PX / camera.scale, CONTROL_DASH_PX / camera.scale]);
    for (const core of design.cores) {
        const module = design.modules[core]!;
        const at = blockCentre(module.spec);
        ctx.beginPath();
        ctx.arc(at.x, at.y, module.stats.controlRadius, 0, TAU);
        ctx.stroke();
    }
    ctx.restore();
    design.coveredBy?.forEach((cores, m) => {
        if (cores === null || cores.length > 0) return;
        const spec = design.modules[m]!.spec;
        const mid = moduleCentre(spec);
        ctx.save();
        ctx.translate(mid.x, mid.y);
        ctx.rotate(spec.angle ?? 0);
        outline(ctx, spec);
        ctx.fillStyle = OUT_OF_REACH_FILL;
        ctx.fill();
        ctx.strokeStyle = OUT_OF_REACH;
        ctx.lineWidth = lineWidth;
        ctx.stroke();
        ctx.restore();
    });
}

/**
 * Outline every copy the selection draws, the grabbed one brightest.
 *
 * Showing the others is the whole point rather than a courtesy: an engine
 * placed eight times moves eight times when it is dragged once, and an editor
 * that let that come as a surprise would be worse than one with no assemblies
 * at all.
 */
function drawSelection(ctx: CanvasRenderingContext2D, view: OverlayView, camera: Camera): void {
    const lineWidth = SELECTION_WIDTH_PX / camera.scale;
    for (let i = 0; i < view.selected.length; i++) {
        const placed = view.modules[view.selected[i]!];
        if (placed === undefined) continue;
        const spec = bodySpec(placed);
        const mid = moduleCentre(spec);
        ctx.save();
        ctx.translate(mid.x, mid.y);
        ctx.rotate(spec.angle ?? 0);
        ctx.strokeStyle = i === 0 ? SELECTION : SELECTION_LINKED;
        ctx.lineWidth = lineWidth;
        if (i > 0) ctx.setLineDash([lineWidth * 4, lineWidth * 3]);
        outline(ctx, spec);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
    }

    drawAssemblies(ctx, view, lineWidth, GROUP_BOX_MARGIN_PX / camera.scale);
}

/**
 * A path round the module, in its own frame: the box it declares, or the
 * corners it is drawn by. Left on the context to be filled or stroked.
 */
export function outline(ctx: CanvasRenderingContext2D, spec: ModuleSpec): void {
    const triangle = shapeOf(spec);
    ctx.beginPath();
    if (triangle === null) {
        ctx.rect(-spec.length / 2, -spec.width / 2, spec.length, spec.width);
        return;
    }
    ctx.moveTo(triangle[0]!, triangle[1]!);
    for (let i = 2; i < triangle.length; i += 2) ctx.lineTo(triangle[i]!, triangle[i + 1]!);
    ctx.closePath();
}

/**
 * The handles on the selection: on one module a dot at each corner, a square
 * on each edge, and the knob that turns it on a short arm beyond the bow; on
 * two touching modules, a bar on the face they share.
 *
 * The arm is drawn, not implied. A knob floating off the module says nothing
 * about which module it belongs to on a busy layout, and the line also shows
 * the facing it is about to change — it points the way the module points.
 */
function drawHandles(ctx: CanvasRenderingContext2D, view: OverlayView, camera: Camera): void {
    if (view.handles.length === 0) return;
    const radius = HANDLE_RADIUS_PX / camera.scale;
    const lineWidth = HANDLE_EDGE_WIDTH_PX / camera.scale;
    const spec = view.modules[view.selected[0] ?? -1];

    for (const knob of view.handles) {
        if (knob.kind !== "rotate") continue;
        const from =
            knob.fromX !== undefined && knob.fromY !== undefined
                ? { x: knob.fromX, y: knob.fromY }
                : spec === undefined
                  ? null
                  : blockCentre(spec);
        if (from === null) continue;
        ctx.save();
        ctx.strokeStyle = SELECTION;
        ctx.lineWidth = lineWidth;
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(knob.x, knob.y);
        ctx.stroke();
        ctx.restore();
    }

    for (const handle of view.handles) {
        ctx.save();
        ctx.beginPath();
        // A seam is a bar along the face it moves; an edge changes one dimension,
        // so it is a square rather than a corner's dot.
        if (handle.kind === "seam" || handle.kind === "tip") {
            ctx.translate(handle.x, handle.y);
            ctx.rotate(handle.angle ?? 0);
            ctx.rect(-radius * 2, -radius * 0.7, radius * 4, radius * 1.4);
        } else if (handle.kind === "step") {
            ctx.translate(handle.x, handle.y);
            ctx.rotate(handle.angle ?? 0);
            ctx.rect(-radius * 1.2, -radius * 1.2, radius * 2.4, radius * 2.4);
        } else if (handle.kind === "size" && (handle.along === 0 || handle.across === 0)) {
            const half = radius * 0.8;
            ctx.translate(handle.x, handle.y);
            ctx.rotate(spec?.angle ?? 0);
            ctx.rect(-half, -half, half * 2, half * 2);
        } else {
            ctx.arc(handle.x, handle.y, radius, 0, TAU);
        }
        ctx.fillStyle = HANDLE_FILL;
        ctx.fill();
        // Outlined in the background's own colour so a handle stays visible over
        // the hull it sits on, which is the same value as the selection outline.
        ctx.strokeStyle = HANDLE_EDGE;
        ctx.lineWidth = lineWidth;
        ctx.stroke();
        ctx.restore();
    }
}

/**
 * One box around each drawn copy of a selected assembly, about everything it
 * holds — and a faint one around the assembly a selected module sits in.
 *
 * Corners rather than centres, and every module's own corners after its own
 * rotation, so an assembly of turned parts is boxed by what it actually covers
 * rather than by a rectangle its contents stick out of.
 */
function drawAssemblies(ctx: CanvasRenderingContext2D, view: OverlayView, lineWidth: number, margin: number): void {
    for (const assembly of view.assemblies) {
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (const index of assembly.modules) {
            const placed = view.modules[index];
            if (placed === undefined) continue;
            const spec = bodySpec(placed);
            const angle = spec.angle ?? 0;
            const c = Math.cos(angle);
            const s = Math.sin(angle);
            const halfL = spec.length / 2;
            const halfW = spec.width / 2;
            const triangle = shapeOf(spec);
            const mid = moduleCentre(spec);
            const points: (readonly [number, number])[] = [];
            if (triangle === null) {
                points.push([halfL, halfW], [halfL, -halfW], [-halfL, halfW], [-halfL, -halfW]);
            } else {
                for (let v = 0; v < triangle.length; v += 2) points.push([triangle[v]!, triangle[v + 1]!]);
            }
            for (const [ox, oy] of points) {
                const x = mid.x + ox * c - oy * s;
                const y = mid.y + ox * s + oy * c;
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
            }
        }
        if (!(maxX > minX) && !(maxY > minY)) continue;

        ctx.save();
        ctx.strokeStyle = assembly.context ? GROUP_CONTEXT : assembly.primary ? GROUP_SELECTION : GROUP_LINKED;
        ctx.lineWidth = lineWidth;
        // Dashed for everything that is not the copy being edited, so the one a
        // drag would move reads as solid the way a grabbed module does.
        if (!assembly.primary) ctx.setLineDash([lineWidth * 4, lineWidth * 3]);
        ctx.strokeRect(minX - margin, minY - margin, maxX - minX + margin * 2, maxY - minY + margin * 2);
        ctx.setLineDash([]);
        ctx.restore();
    }
}

/**
 * The centre-of-mass mark: a ringed crosshair.
 *
 * Drawn by whatever needs it rather than by one caller, because the same glyph
 * has to appear on the hull and at the centre of the envelope. The envelope's
 * zero *is* the centre of mass — it is the point the accelerations act on —
 * and drawing the identification rather than asserting it in a caption is the
 * cheapest way to say so. Symmetric about both axes, so it reads the same
 * through the renderer's y flip as it does in screen space.
 */
function crosshair(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, lineWidth: number): void {
    ctx.strokeStyle = CENTRE_OF_MASS;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.moveTo(x - r * 1.6, y);
    ctx.lineTo(x + r * 1.6, y);
    ctx.moveTo(x, y - r * 1.6);
    ctx.lineTo(x, y + r * 1.6);
    ctx.stroke();
}

/**
 * Where the ship balances, in the blueprint's own frame.
 *
 * Worth a mark of its own because it is the one derived quantity with a
 * *place*: thrust off the centre of mass turns the ship, so a layout's
 * handling is largely a statement about where this mark sits relative to the
 * engines, and nothing else on the canvas says where it is.
 */
function drawCentreOfMass(ctx: CanvasRenderingContext2D, design: ShipDesign, camera: Camera): void {
    crosshair(ctx, design.centreOfMassX, design.centreOfMassY, CENTRE_OF_MASS_RADIUS_PX / camera.scale, SELECTION_WIDTH_PX / camera.scale);
}

/**
 * The acceleration available in every direction, as two closed curves.
 *
 * Four numbers on a panel say a ship accelerates hard forwards and poorly
 * sideways; only the curve shows which diagonal it is worst in, and whether a
 * layout is merely weak abeam or has a direction it cannot push at all — the
 * dent that says an engine is missing.
 *
 * **The filled curve is what the ship can use; the dashed one is what it could
 * have if it did not mind spinning.** The gap between them is what KSP shows
 * as a centre of thrust offset from the centre of mass, in the units that
 * matter here. It has to be drawn as a gap rather than as a second marker,
 * because the misalignment never becomes a spin: allocation is asked for zero
 * torque and trims the imbalance away, so what a badly balanced layout loses
 * is acceleration. Two curves make that a dent, and a dent is something the
 * eye reads at a glance; two markers to mentally subtract is not.
 *
 * Drawn at a fixed size in the corner rather than over the ship, because it is
 * an acceleration and not a distance, and overlaying it on metres would invite
 * reading it as reach.
 *
 * **In the ship's own orientation**: +x to the right and +y up, exactly as the
 * deck plan beside it is drawn. The curve is read by comparing it against the
 * ship, so any other convention makes it a puzzle — a layout that accelerates
 * hard fore and aft draws a curve long across the same axis its hull is long
 * on, and turning the widget by a right angle turns that agreement into an
 * apparent contradiction.
 *
 * Both curves are *thrust*. A propellant model would make the third curve
 * possible — how much delta-v a direction costs, on which a diagonal does
 * worse than either axis it splits, since thrust adds vectorially and
 * propellant adds scalar — and drawing it before that model exists would be
 * inventing an efficiency the simulation does not have.
 */
function drawEnvelope(
    ctx: CanvasRenderingContext2D,
    view: OverlayView,
    envelope: Envelopes,
    widthPx: number,
    heightPx: number,
    bearing: number | null,
    expanded: boolean,
): void {
    let peak = 0;
    let held = 0;
    for (let i = 0; i < envelope.samples; i++) {
        peak = max(peak, envelope.free[i]!);
        held = max(held, envelope.holding[i]!);
    }
    if (!(peak > 0)) return;

    const disc = envelopeDisc(widthPx, heightPx, expanded);
    const { x: cx, y: cy, radius } = disc;
    if (expanded) drawWindow(ctx, disc);

    if (view.design !== null) silhouette(ctx, view, view.design, cx, cy, radius);

    /** Trace one curve, scaled against the larger of the two so the gap is to scale. */
    const trace = (values: Float64Array): void => {
        ctx.beginPath();
        for (let i = 0; i < envelope.samples; i++) {
            // Samples run anticlockwise from the bow in the ship's frame. Screen y
            // grows downward where the world's grows up, so only y is negated —
            // which is the same flip `draw` applies to the deck plan.
            const angle = (TAU * i) / envelope.samples;
            const r = (values[i]! / peak) * radius;
            const x = cx + cos(angle) * r;
            const y = cy - sin(angle) * r;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.closePath();
    };

    // The unconstrained curve first and dashed, so the filled one sits inside it
    // and reads as the real figure rather than as a shortfall from it.
    trace(envelope.free);
    ctx.strokeStyle = ENVELOPE_FREE;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.stroke();
    ctx.setLineDash([]);

    trace(envelope.holding);
    ctx.fillStyle = ENVELOPE_FILL;
    ctx.fill();
    ctx.strokeStyle = ENVELOPE;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // The origin, marked as what it is: the ship's centre of mass, with every
    // radius an acceleration of it. Without it the curve has no zero, and a
    // lobed shape with no centre cannot be read as a magnitude at all.
    crosshair(ctx, cx, cy, 3.5, 1.5);

    // The direction being pointed at, out to the edge of the widget, while the
    // ship above burns its engines the way it would to push that way.
    // The acceleration the pointer asks for, as far as the holding curve allows.
    const pointed = bearing === null ? null : pointedThrust(envelope, bearing, view.envelopeReach ?? 1);
    if (bearing !== null && pointed !== null) {
        ctx.strokeStyle = ENVELOPE;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + cos(bearing) * radius, cy - sin(bearing) * radius);
        ctx.stroke();
        const r = (pointed.acceleration / peak) * radius;
        ctx.fillStyle = ATTACK_POINTED;
        ctx.beginPath();
        ctx.arc(cx + cos(bearing) * r, cy - sin(bearing) * r, 3, 0, TAU);
        ctx.fill();
    }

    // The most it can use, holding its heading; the heading cost is in the report.
    ctx.fillStyle = ENVELOPE_LABEL;
    ctx.font = "11px ui-monospace, monospace";
    ctx.textAlign = "right";
    ctx.fillText(`max ${held.toFixed(1)} m/s²`, widthPx - ENVELOPE_MARGIN_PX, cy + radius + 14);
    if (bearing !== null && pointed !== null) {
        const text = `${degrees(bearing)}: ${pointed.acceleration.toFixed(1)}/${pointed.holding.toFixed(1)} m/s²`;
        const burn = view.envelopeBurn;
        const lines =
            burn != null && burn.isp > 0 && Number.isFinite(burn.endurance)
                ? [text, `Isp ${burn.isp.toFixed(0)} s, burns ${duration(burn.endurance)}`]
                : [text];
        pointedLabel(ctx, lines, widthPx - ENVELOPE_MARGIN_PX, cy - radius);
    }
    ctx.textAlign = "left";
}
