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
    casingMass,
    nozzleReach,
    OWN_LAYERS,
    parseBlueprint,
    plumeLayers,
    Rng,
    Snapshot,
    HULL_LAYER,
    WEAPONS_LAYER,
    type ShipDesign,
    type ShipView,
} from "../sim/index.js";
import { DEFAULT_BURST_SPEED, DEFAULT_FRAGMENTS, EXPLOSIVE_YIELD } from "../sim/modules.js";
import { CORVETTE, TORCH, TORPEDO } from "../scenarios/blueprints.js";
import { barrelLines } from "../render/barrels.js";
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

/** A step of the battle, which a flash or a streak is exposed for, and what `,` and `.` step by. */
export const STEP = 1 / 60;

const designs = new Map<string, ShipDesign>();
/** A design compiled once and kept. */
function kept(name: string, make: () => ShipDesign): ShipDesign {
    let design = designs.get(name);
    if (design === undefined) {
        design = make();
        designs.set(name, design);
    }
    return design;
}
const corvetteDesign = (): ShipDesign => kept("corvette", () => compileBlueprint(CORVETTE));
const torchDesign = (): ShipDesign => kept("torch", () => compileBlueprint(TORCH));
const torpedoDesign = (): ShipDesign => kept("torpedo", () => compileBlueprint(TORPEDO));

/** A blueprint of these modules, compiled and kept under `name`. */
function built(name: string, modules: Record<string, unknown>[]): ShipDesign {
    return kept(name, () => compileBlueprint(parseBlueprint({ formatVersion: 2, name, modules })));
}

/** A slab of hull plate 3 m thick, with a core under it to make it a ship. */
const slabDesign = (length: number): ShipDesign =>
    built(`slab ${length}`, [
        { id: 1, kind: "structure", x: 0, y: 0, length, width: 3 },
        { id: 2, kind: "core", x: 0, y: -2.5, length: 2, width: 2 },
    ]);

/** A long tank, and a core at one end to make it a ship. */
const tankDesign = (): ShipDesign =>
    built("tank", [
        { id: 1, kind: "core", x: 0, y: 0, length: 2, width: 3 },
        { id: 2, kind: "tank", x: 13, y: 0, length: 24, width: 3 },
    ]);

/** How wide each gun's mount is, the smallest first: calibres of 2 cm to 40 cm. */
const GUN_MOUNTS = [0.2, 0.5, 1, 2, 4];

/** A gun on a core, firing shells, and what one of its rounds does. */
interface Gun {
    readonly design: ShipDesign;
    /** Its muzzle, ahead of its centre of mass. */
    readonly muzzle: number;
    readonly calibre: number;
    readonly speed: number;
    /** Its round's energy at the muzzle, and its shell's burst's. */
    readonly energy: number;
    readonly burst: number;
    readonly fragments: number;
    /** How fast its fragments leave the shell, at most. */
    readonly spread: number;
    readonly fragmentWidth: number;
}

const guns = new Map<number, Gun>();
function gun(width: number): Gun {
    let made = guns.get(width);
    if (made !== undefined) return made;
    const core = Math.max(1, width);
    const design = built(`gun ${width}`, [
        { id: 1, kind: "core", x: 0, y: 0, length: core, width: core },
        {
            id: 2,
            kind: "hullGun",
            x: core / 2 + width * 0.4,
            y: 0,
            angle: 0,
            length: width * 0.8,
            width,
            barrels: 1,
            barrelCalibres: 40,
            fuse: 0.05,
        },
    ]);
    const turret = design.turrets[0]!;
    const spec = design.modules[turret.module]!.spec;
    const stats = turret.gun;
    let muzzle = 0;
    barrelLines({ currentStructure: design, x: 0, y: 0, angle: 0, turretBearings: [0] } as unknown as ShipView, 0, (_x0, _y0, x1) => {
        muzzle = x1;
    });
    const casing = casingMass(spec, stats.roundMass);
    const fragments = spec.fragments ?? DEFAULT_FRAGMENTS;
    made = {
        design,
        muzzle,
        calibre: stats.calibre,
        speed: stats.muzzleSpeed,
        energy: stats.muzzleEnergy,
        burst: (stats.roundMass - casing) * EXPLOSIVE_YIELD,
        fragments,
        spread: spec.burstSpeed ?? DEFAULT_BURST_SPEED,
        // Their areas summing to the casing's share of the bore, as the sim's do.
        fragmentWidth: stats.calibre * Math.sqrt(casing / stats.roundMass / fragments),
    };
    guns.set(width, made);
    return made;
}

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
    vx = 0,
): void {
    if (t < at) return;
    const before = flashes.count;
    flashes.add(x + vx * (t - at), y, energy, kind, -1, 0, 0, vx, 0, growth, dirX, dirY);
    if (flashes.count === before) return;
    flashes.age[before] = t - at;
    if (flashes.age[before]! >= flashes.lifetime[before]!) flashes.count = before;
}

/** A round in flight, `width` across, at `(x, y)` going `(vx, vy)`, fired or burst from `(fromX, fromY)`. */
function round(snapshot: Snapshot, x: number, y: number, vx: number, vy: number, fromX: number, fromY: number, width: number): void {
    const i = snapshot.projectileCount++;
    snapshot.projectileX[i] = x;
    snapshot.projectileY[i] = y;
    snapshot.projectileStartX[i] = fromX;
    snapshot.projectileStartY[i] = fromY;
    snapshot.projectileVx[i] = vx;
    snapshot.projectileVy[i] = vy;
    snapshot.projectileWidth[i] = width;
    snapshot.projectileInside[i] = 0;
    snapshot.projectileTeam[i] = 0;
}

/** A beam's flashes where it lands: one a step for as long as it is burning. */
function beamFlashes(flashes: Flashes, t: number, x: number, y: number, power: number): void {
    for (let at = Math.floor(t / STEP) * STEP; at > t - 0.2; at -= STEP) flash(flashes, t, at, x, y, power * STEP, IMPACT_BEAM);
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
        about: "Rounds from the five guns of the Guns scene, 2 cm to 40 cm, coming in from the top left onto a slab of hull, then a torpedo crashing into its end.",
        loop: 1,
        build(t, snapshot, flashes) {
            const each = GUN_MOUNTS.map(gun);
            const energies = each.map((g) => g.energy);
            const half = spanOf(energies, 2.2, 2);
            const slab = slabDesign(Math.ceil(2 * half + 20));
            const top = 1.5;
            begin(snapshot, flashes, t, -half - 15, -10, half + 15, 45);
            // The slab's face at y = top, its centre of mass a little under the plate's middle.
            place(snapshot, slab, 0, -slab.centreOfMassY, 0);
            room(snapshot, each.length);
            const hit = 0.3;
            const down = Math.SQRT1_2;
            spaced(energies, 2.2, 2).forEach((x, k) => {
                const g = each[k]!;
                const vx = g.speed * down;
                const vy = -g.speed * down;
                // In from the top left until it lands, so which way it was going shows.
                if (t < hit) round(snapshot, x - vx * (hit - t), top - vy * (hit - t), vx, vy, x - vx * hit, top - vy * hit, g.calibre);
                flash(flashes, t, hit, x, top, g.energy, IMPACT_ROUND);
            });
            const torpedo = torpedoDesign();
            place(snapshot, torpedo, half + 10 + torpedo.radius, top + 1, Math.PI);
            flash(flashes, t, 0.6, half + 10, top + 1, 1e6, IMPACT_COLLISION);
        },
    },
    {
        name: "Guns",
        about: "Five guns, 2 cm to 40 cm, each firing a shell that bursts three steps later into fragments: the muzzle flash, the round in flight, the burst and its fragments.",
        loop: 0.6,
        build(t, snapshot, flashes) {
            const fire = 0.1;
            const burst = fire + 3 * STEP;
            const each = GUN_MOUNTS.map(gun);
            // Each row as tall as its ship or its burst's glow at birth, the smallest at the top.
            const reach = each.map((g) => Math.max(g.design.radius, flashRadius(g.burst) * 1.5) + 2);
            const ys: number[] = [];
            let y = 0;
            reach.forEach((r, k) => {
                y -= k === 0 ? 0 : reach[k - 1]! + r;
                ys.push(y);
            });
            const far = Math.max(...each.map((g) => g.speed)) * (burst - fire);
            begin(snapshot, flashes, t, -2 * each[4]!.design.radius, y - reach[4]!, far + 20, reach[0]!);
            room(
                snapshot,
                each.reduce((sum, g) => sum + g.fragments + 1, 0),
            );
            each.forEach((g, k) => {
                const row = ys[k]!;
                const ship = place(snapshot, g.design, -g.muzzle, row, 0);
                ship.turretBearings[0] = 0;
                flash(flashes, t, fire, 0, row, g.energy, IMPACT_MUZZLE, 0, 1, 0);
                const at = g.speed * (burst - fire);
                if (t >= fire && t < burst) round(snapshot, g.speed * (t - fire), row, g.speed, 0, 0, row, g.calibre);
                flash(flashes, t, burst, at, row, g.burst, IMPACT_BURST, g.spread, 0, 0, g.speed);
                if (t < burst) return;
                // Spread over a disc in twins, as the sim bursts a shell, from a seed of the row's own.
                const rng = new Rng(k + 1);
                const since = t - burst;
                for (let f = 0; f + 1 < g.fragments; f += 2) {
                    const angle = rng.nextFloat() * 2 * Math.PI;
                    const speed = g.spread * Math.sqrt(rng.nextFloat());
                    for (const side of [1, -1]) {
                        const vx = g.speed + side * Math.cos(angle) * speed;
                        const vy = side * Math.sin(angle) * speed;
                        round(snapshot, at + vx * since, row + vy * since, vx, vy, at, row, g.fragmentWidth);
                    }
                }
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
        about: "A corvette with every engine at full, its main engine pumped, and above it a torpedo, whose small engines are pressure-fed: each plume, and the glow round its nozzle.",
        loop: 1,
        build(t, snapshot, flashes) {
            begin(snapshot, flashes, t, -70, -40, 30, 50);
            place(snapshot, corvetteDesign(), 0, 0, 0).throttles.fill(1);
            place(snapshot, torpedoDesign(), 0, 35, 0).throttles.fill(1);
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
        about: "Fuel leaking from holes in a row along a tank's edge, from a pinhole's wisp at 0.1 kg/s to a gash at 30 kg/s.",
        loop: 1,
        build(t, snapshot, flashes) {
            const design = tankDesign();
            const tank = design.modules[1]!;
            begin(snapshot, flashes, t, tank.x - 14, -6, tank.x + 14, 14);
            const ship = place(snapshot, design, 0, 0, 0);
            [
                [0.05, 0.1],
                [0.1, 1],
                [0.15, 3],
                [0.25, 10],
                [0.4, 30],
            ].forEach(([width, rate], k) => {
                ship.leakX!.push(tank.x - 10 + 5 * k);
                ship.leakY!.push(tank.y + tank.spec.width / 2);
                ship.leakDirX!.push(0);
                ship.leakDirY!.push(1);
                ship.leakWidth!.push(width!);
                ship.leakRate!.push(rate!);
            });
        },
    },
];
