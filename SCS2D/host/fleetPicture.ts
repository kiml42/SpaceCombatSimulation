import { compileBlueprint, expandFleet, shipFleet, Snapshot, type Blueprint, type Fleet, type ShipDesign } from "../sim/index.js";
import { draw } from "../render/canvas2d.js";
import type { Camera } from "../render/camera.js";
import { pixiView, type PixiView } from "../render/pixiView.js";
import { loadRenderer } from "./viewSettings.js";
import { NO_TEAM } from "../editor/preview.js";
import { fleetSnapshot } from "../editor/fleetPreview.js";
import type { FleetView } from "../editor/fleetDocument.js";
import { fleetBlueprint } from "../sim/fleetHangar.js";

/**
 * A fleet drawn small, two ways, as the Evolution route and the skirmish's
 * timeline both show one: each kind of ship once, with how many there are,
 * and the whole fleet as it is arranged.
 */

/** One kind of ship in a fleet, and how many of that kind it has. */
export interface ShipKind {
    readonly name: string;
    readonly design: ShipDesign;
    readonly count: number;
}

/** A fleet laid out to draw, what it weighs, and what kinds of ship it is made of. */
export interface Picture {
    readonly view: Pick<FleetView, "ships" | "designs">;
    readonly mass: number;
    /** Largest first: a fleet is read by its heaviest ship before its escorts. */
    readonly kinds: readonly ShipKind[];
}

export function pictureOf(entrant: Fleet | Blueprint): Picture {
    const fleet = "designs" in entrant ? entrant : shipFleet(entrant);
    const compiled = new Map<string, ShipDesign>();
    const ships = expandFleet(fleet);
    const designs = ships.map((ship) => {
        let design = compiled.get(ship.design);
        if (design === undefined) {
            design = compileBlueprint(fleetBlueprint(fleet, ship.design));
            compiled.set(ship.design, design);
        }
        return design;
    });
    // One entry per kind of ship, heaviest first: what a fleet is made of, which
    // is the thing a picture of the whole fleet cannot show at the size a row gives it.
    const counted = new Map<string, { design: ShipDesign; count: number }>();
    ships.forEach((ship, i) => {
        const held = counted.get(ship.design);
        if (held === undefined) counted.set(ship.design, { design: designs[i]!, count: 1 });
        else held.count += 1;
    });
    const kinds: ShipKind[] = [...counted]
        .map(([name, { design, count }]) => ({ name, design, count }))
        .sort((a, b) => b.design.mass - a.design.mass || a.name.localeCompare(b.name));
    return { view: { ships, designs }, mass: designs.reduce((sum, d) => sum + d.mass, 0), kinds };
}

/**
 * One kind of ship alone at the origin, to draw or to measure; `turned`
 * half round, as the second side of a battle sets out.
 */
export function kindSnapshot(kind: ShipKind, into: Snapshot, turned = false): Snapshot {
    return fleetSnapshot(
        {
            ships: [{ design: kind.name, x: 0, y: 0, angle: turned ? Math.PI : 0, path: kind.name, entry: 0, trail: [] }],
            designs: [kind.design],
        },
        into,
        NO_TEAM,
    );
}

/** The whole fleet as it stands, to draw or to measure; `turned` half round, as for `kindSnapshot`. */
export function formationSnapshot(picture: Picture, into: Snapshot, turned = false): Snapshot {
    if (!turned) return fleetSnapshot(picture.view, into, NO_TEAM);
    const ships = picture.view.ships.map((ship) => ({ ...ship, x: -ship.x, y: -ship.y, angle: ship.angle + Math.PI }));
    return fleetSnapshot({ ...picture.view, ships }, into, NO_TEAM);
}

/**
 * Draw a snapshot centred on a canvas at a scale, pixels a metre: what `make`
 * fills a snapshot with, so it can be made again once Pixi has started.
 */
export function drawCentred(canvas: HTMLCanvasElement, make: (into: Snapshot) => Snapshot, scale: number): void {
    const shot = make(scratch);
    const view = sharedView();
    if (view?.ready === true && drawnWith(view, canvas, shot, scale)) {
        waiting.delete(canvas);
        return;
    }
    drawIn2D(canvas, shot, scale);
    if (view === null) return;
    if (waiting.size === 0) {
        void view.started.then((started) => {
            const all = [...waiting];
            waiting.clear();
            if (!started) return;
            for (const [each, drawing] of all) if (each.isConnected) drawnWith(view, each, drawing.make(scratch), drawing.scale);
        });
    }
    waiting.set(canvas, { make, scale });
}

const scratch = new Snapshot();

/**
 * One renderer for every picture, drawn on a canvas of its own and copied out,
 * since a page may hold only about sixteen WebGL contexts.
 */
let shared: PixiView | null = null;
/** Pictures drawn in 2D while it starts, to draw again once it has. */
const waiting = new Map<HTMLCanvasElement, { make: (into: Snapshot) => Snapshot; scale: number }>();

function sharedView(): PixiView | null {
    if (loadRenderer() === "canvas2d") return null;
    shared ??= pixiView(document.createElement("canvas"));
    return shared.failed ? null : shared;
}

function eyeOn(shot: Snapshot, scale: number): Camera {
    return { x: (shot.minX + shot.maxX) / 2, y: (shot.minY + shot.maxY) / 2, scale };
}

function drawIn2D(canvas: HTMLCanvasElement, shot: Snapshot, scale: number): void {
    const ctx = canvas.getContext("2d");
    if (ctx === null) return;
    draw(ctx, shot, eyeOn(shot, scale), canvas.width, canvas.height);
}

function drawnWith(view: PixiView, canvas: HTMLCanvasElement, shot: Snapshot, scale: number): boolean {
    const ctx = canvas.getContext("2d");
    if (ctx === null) return true;
    const { width, height } = canvas;
    const eye = eyeOn(shot, scale);
    const pixi = view.begin(shot, eye, width, height);
    if (pixi === null) return false;
    draw(pixi as unknown as CanvasRenderingContext2D, shot, eye, width, height, undefined, "none", false, -1, [], null, true);
    view.end();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    // Copied straight after rendering, while the drawing buffer still holds the frame.
    ctx.drawImage(view.canvas, 0, 0);
    return true;
}
