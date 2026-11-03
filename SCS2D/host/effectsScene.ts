import {
    compileBlueprint,
    engineGeometry,
    IMPACT_BEAM,
    IMPACT_BURST,
    IMPACT_COLLISION,
    IMPACT_MUZZLE,
    IMPACT_ROUND,
    landedIndex,
    landedLength,
    nozzleReach,
    OWN_LAYERS,
    plumeLayers,
    Snapshot,
    HULL_LAYER,
    WEAPONS_LAYER,
    type ShipDesign,
    type ShipView,
} from "../sim/index.js";
import { CORVETTE, TORCH } from "../scenarios/blueprints.js";
import { Flashes, flashRadius } from "../render/flashes.js";

/**
 * Small scenes of the battle's effects, for looking at them on their own: each
 * fills a snapshot and its flashes for a moment `t` into a loop, so the same
 * moment is the same picture, and can be scrubbed to and stepped through.
 *
 * Drawn by the battle's own renderer, so it shows the effects as they are
 * now, not a copy of them. Nothing is simulated: hulls stand still, rounds
 * fly straight, and each flash goes off at a set moment of the loop.
 */

export interface EffectsScene {
    readonly name: string;
    /** What it shows, and what to look for. */
    readonly about: string;
    /** Seconds before it starts again. */
    readonly loop: number;
    /** Fill `snapshot` and `flashes` for `t` seconds into the loop. */
    build(t: number, snapshot: Snapshot, flashes: Flashes): void;
}

/** A step of the battle, which a flash or a streak is exposed for. */
const STEP = 1 / 60;

let corvette: ShipDesign | null = null;
let torch: ShipDesign | null = null;
const corvetteDesign = (): ShipDesign => (corvette ??= compileBlueprint(CORVETTE));
const torchDesign = (): ShipDesign => (torch ??= compileBlueprint(TORCH));

/** Start a picture: nothing in it, framed on the box given. */
function begin(snapshot: Snapshot, flashes: Flashes, t: number, minX: number, minY: number, maxX: number, maxY: number): void {
    snapshot.tick = Math.round(t / STEP);
    snapshot.time = t;
    snapshot.dt = STEP;
    snapshot.wells = [];
    snapshot.shipCount = 0;
    snapshot.projectileCount = 0;
    snapshot.beamCount = 0;
    snapshot.impactCount = 0;
    snapshot.minX = minX;
    snapshot.minY = minY;
    snapshot.maxX = maxX;
    snapshot.maxY = maxY;
    flashes.clear();
}

/** A hull standing still at `(x, y)`, turned `angle`, engines cold and undamaged. */
function place(snapshot: Snapshot, design: ShipDesign, x: number, y: number, angle: number): ShipView {
    const k = snapshot.shipCount++;
    const view: ShipView = (snapshot.ships[k] ??= {
        currentStructure: design,
        body: -1,
        team: 0,
        serial: 0,
        x: 0,
        y: 0,
        angle: 0,
        vx: 0,
        vy: 0,
        turretBearings: [],
        turretReady: [],
        throttles: [],
        landed: [],
        integrity: [],
        hasControl: true,
        isDerelict: false,
        isMissionKilled: false,
        turretDisabled: [],
    });
    view.currentStructure = design;
    view.body = -1;
    view.team = 0;
    view.serial = k;
    view.x = x;
    view.y = y;
    view.angle = angle;
    view.vx = 0;
    view.vy = 0;
    view.throttles.length = design.engines.length;
    view.throttles.fill(0);
    view.landed.length = landedLength(design);
    view.landed.fill(0);
    view.integrity.length = design.modules.length;
    view.integrity.fill(1);
    view.turretBearings.length = design.turrets.length;
    view.turretBearings.fill(0);
    view.turretReady.length = design.turrets.length;
    view.turretReady.fill(true);
    view.turretDisabled.length = design.turrets.length;
    view.turretDisabled.fill(false);
    view.leakX = [];
    view.leakY = [];
    view.leakDirX = [];
    view.leakDirY = [];
    view.leakWidth = [];
    view.leakRate = [];
    return view;
}

/**
 * A flash of `kind` gone off at `at` seconds into the loop, if it is still
 * showing at `t`. One aimed `dirX, dirY` points that way, as a muzzle flash does.
 */
function flash(
    flashes: Flashes,
    t: number,
    at: number,
    x: number,
    y: number,
    energy: number,
    kind: number,
    growth = 0,
    dirX = 0,
    dirY = 0,
): void {
    if (t < at) return;
    const before = flashes.count;
    flashes.add(x, y, energy, kind, -1, 0, 0, 0, 0, growth, dirX, dirY);
    if (flashes.count === before) return;
    flashes.age[before] = t - at;
    if (flashes.age[before]! >= flashes.lifetime[before]!) flashes.count = before;
}

/** A beam's flashes where it lands: one a step for as long as it is burning. */
function beamFlashes(flashes: Flashes, t: number, x: number, y: number, power: number): void {
    for (let at = Math.floor(t / STEP) * STEP; at > t - 0.2; at -= STEP) flash(flashes, t, at, x, y, power * STEP, IMPACT_BEAM);
}

/** How far up a design's hull reaches at `x`, along its body's frame, where its modules lie square. */
function topAt(design: ShipDesign, x: number): number {
    let top = 0;
    for (const m of design.modules) {
        const across = Math.abs(Math.sin(m.angle)) > 0.5;
        const halfX = (across ? m.spec.width : m.spec.length) / 2;
        const halfY = (across ? m.spec.length : m.spec.width) / 2;
        if (Math.abs(x - m.x) <= halfX) top = Math.max(top, m.y + halfY);
    }
    return top;
}

/** Room for `n` beams and `n` rounds, kept once made. */
function room(snapshot: Snapshot, n: number): void {
    if (snapshot.beamStartX.length < n) {
        snapshot.beamStartX = new Float64Array(n);
        snapshot.beamStartY = new Float64Array(n);
        snapshot.beamEndX = new Float64Array(n);
        snapshot.beamEndY = new Float64Array(n);
        snapshot.beamWidth = new Float64Array(n);
        snapshot.beamPower = new Float64Array(n);
        snapshot.beamTeam = new Int16Array(n);
    }
    if (snapshot.projectileX.length < n) {
        snapshot.projectileX = new Float64Array(n);
        snapshot.projectileY = new Float64Array(n);
        snapshot.projectileStartX = new Float64Array(n);
        snapshot.projectileStartY = new Float64Array(n);
        snapshot.projectileVx = new Float64Array(n);
        snapshot.projectileVy = new Float64Array(n);
        snapshot.projectileWidth = new Float64Array(n);
        snapshot.projectileInside = new Uint8Array(n);
        snapshot.projectileTeam = new Int16Array(n);
    }
}

/** Energies a row of flashes spans, from a light gun's round to a heavy shell's. */
const ENERGIES = [1e4, 1e5, 1e6, 1e7, 1e8];

/**
 * Where along a row to put flashes of these energies, centred on 0, so that
 * none overlaps the next: each `reach` of its radius plus `extra` metres out.
 */
function spaced(energies: readonly number[], reach: number, extra: number): number[] {
    const half = energies.map((energy) => flashRadius(energy) * reach + extra);
    const xs: number[] = [];
    let x = 0;
    half.forEach((h, k) => {
        x += k === 0 ? 0 : half[k - 1]! + h;
        xs.push(x);
    });
    const middle = (xs[0]! - half[0]! + xs[xs.length - 1]! + half[half.length - 1]!) / 2;
    return xs.map((each) => each - middle);
}

/** Half the span of a row `spaced` lays out. */
function spanOf(energies: readonly number[], reach: number, extra: number): number {
    return energies.reduce((sum, energy) => sum + flashRadius(energy) * reach + extra, 0);
}

export const EFFECTS_SCENES: readonly EffectsScene[] = [
    {
        name: "Hits",
        about: "Rounds landing on a hull at 10 kJ, 100 kJ and 1 MJ; in open space from 10 kJ to 100 MJ; then two hulls meeting.",
        loop: 1,
        build(t, snapshot, flashes) {
            const half = spanOf(ENERGIES, 2.2, 1);
            const below = -flashRadius(ENERGIES[4]!) * 2.2 - 25;
            begin(snapshot, flashes, t, -half, below - 10, half, 25);
            place(snapshot, corvetteDesign(), 0, 15, 0);
            [-6, 0, 6].forEach((x, k) => flash(flashes, t, 0.1, x, 15, ENERGIES[k]!, IMPACT_ROUND));
            spaced(ENERGIES, 2.2, 1).forEach((x, k) => flash(flashes, t, 0.1, x, below, ENERGIES[k]!, IMPACT_ROUND));
            flash(flashes, t, 0.5, -half + 10, 15, 1e6, IMPACT_COLLISION);
        },
    },
    {
        name: "Bursts and muzzle flashes",
        about: "Shells bursting, their fragments spreading at 250 m/s, and guns firing to the right, from 10 kJ to 100 MJ.",
        loop: 0.6,
        build(t, snapshot, flashes) {
            // A burst's glow spreads with its fragments for as long as it lasts, a tenth of a second at most.
            const spread = 250 * 0.1;
            const half = spanOf(ENERGIES, 2.2, spread);
            const high = flashRadius(ENERGIES[4]!) * 2.2 + spread;
            begin(snapshot, flashes, t, -half, -20, half, 2 * high);
            spaced(ENERGIES, 2.2, spread).forEach((x, k) => {
                flash(flashes, t, 0.1, x, high, ENERGIES[k]!, IMPACT_BURST, 250);
                flash(flashes, t, 0.1, x - 4, -8, ENERGIES[k]!, IMPACT_MUZZLE, 0, 1, 0);
            });
        },
    },
    {
        name: "Beams",
        about: "Beams of 10 cm, 30 cm and 60 cm burning into a hull, from a megawatt to a gigawatt, with their flashes where they land.",
        loop: 1,
        build(t, snapshot, flashes) {
            begin(snapshot, flashes, t, -60, -25, 30, 25);
            place(snapshot, corvetteDesign(), 10, 0, Math.PI / 2);
            room(snapshot, 4);
            [
                [0.1, 1e6],
                [0.3, 1e8],
                [0.6, 1e9],
            ].forEach(([width, power], k) => {
                const y = -6 + 6 * k;
                const i = snapshot.beamCount++;
                snapshot.beamStartX[i] = -60;
                snapshot.beamStartY[i] = y;
                snapshot.beamEndX[i] = 7;
                snapshot.beamEndY[i] = y;
                snapshot.beamWidth[i] = width!;
                snapshot.beamPower[i] = power!;
                snapshot.beamTeam[i] = 0;
                beamFlashes(flashes, t, 7, y, power!);
            });
        },
    },
    {
        name: "Engines",
        about: "A corvette with every engine at full: each plume, and the glow round its nozzle.",
        loop: 1,
        build(t, snapshot, flashes) {
            begin(snapshot, flashes, t, -70, -40, 30, 40);
            const ship = place(snapshot, corvetteDesign(), 0, 0, 0);
            ship.throttles.fill(1);
        },
    },
    {
        name: "Burns",
        about: "A torch's main flame landing on a corvette's flank: the burn glow spread along the hull where it lands.",
        loop: 1,
        build(t, snapshot, flashes) {
            const design = torchDesign();
            const engine = 0;
            const module = design.modules[design.engines[engine]!.module!]!;
            const reach = nozzleReach(engineGeometry(module.spec), design.engines[engine]!.maxThrust);
            // Where the flame lands, ahead of its nozzle.
            const landsAt = 30;
            const tail = module.x - module.spec.length / 2;
            begin(snapshot, flashes, t, tail - landsAt - 25, -30, module.x + module.spec.length / 2 + 5, 30);
            const ship = place(snapshot, design, 0, 0, 0);
            ship.throttles[engine] = 1;
            const layers = plumeLayers(design, engine, OWN_LAYERS);
            for (let layer = HULL_LAYER; layer <= WEAPONS_LAYER; layer <<= 1) {
                if ((layers & layer) === 0) continue;
                // A side ray reaches a third as far as the core.
                for (let ray = 0; ray < 3; ray++) {
                    ship.landed[landedIndex(design, engine, ray, layer)] = 1 - landsAt / (ray === 1 ? reach : reach / 3);
                }
            }
            place(snapshot, corvetteDesign(), tail - landsAt - 3, 0, Math.PI / 2);
        },
    },
    {
        name: "Leaks",
        about: "Fuel leaking from holes in a corvette, from a pinhole's wisp at 0.1 kg/s to a gash at 30 kg/s.",
        loop: 1,
        build(t, snapshot, flashes) {
            begin(snapshot, flashes, t, -15, -10, 15, 20);
            const design = corvetteDesign();
            const ship = place(snapshot, design, 0, 0, 0);
            [
                [-6, 0.05, 0.1],
                [0, 0.15, 3],
                [6, 0.4, 30],
            ].forEach(([x, width, rate]) => {
                ship.leakX!.push(x!);
                ship.leakY!.push(topAt(design, x!));
                ship.leakDirX!.push(0);
                ship.leakDirY!.push(1);
                ship.leakWidth!.push(width!);
                ship.leakRate!.push(rate!);
            });
        },
    },
    {
        name: "Tracers",
        about: "Rounds of 2 cm, 10 cm and 30 cm crossing at 800 m/s, each drawn as the streak a step's exposure makes of it.",
        loop: 0.5,
        build(t, snapshot, flashes) {
            begin(snapshot, flashes, t, -40, -25, 40, 25);
            room(snapshot, 4);
            [0.02, 0.1, 0.3].forEach((width, k) => {
                const i = snapshot.projectileCount++;
                const y = -15 + 15 * k;
                snapshot.projectileStartX[i] = -200;
                snapshot.projectileStartY[i] = y;
                snapshot.projectileX[i] = -200 + 800 * t;
                snapshot.projectileY[i] = y;
                snapshot.projectileVx[i] = 800;
                snapshot.projectileVy[i] = 0;
                snapshot.projectileWidth[i] = width;
                snapshot.projectileInside[i] = 0;
                snapshot.projectileTeam[i] = 0;
            });
        },
    },
];
