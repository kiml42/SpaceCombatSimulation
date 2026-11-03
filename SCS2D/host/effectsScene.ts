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
import { leakRate, leakSpeed } from "../sim/fuel.js";
import { DECK_HEIGHT, DEFAULT_BURST_SPEED, DEFAULT_FRAGMENTS, EXPLOSIVE_YIELD } from "../sim/modules.js";
import { CORVETTE, TORCH, TORPEDO } from "../scenarios/blueprints.js";
import { barrelLines } from "../render/barrels.js";
import { burstLifetime, Flashes, flashRadius } from "../render/flashes.js";

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

/**
 * A slab of hull plate with a core under it to make it a ship: thin, in the
 * hull layer alone, or thick, standing up through the weapons layer too,
 * where a fighter flies.
 */
const slabDesign = (length: number, thick = false): ShipDesign => {
    // Thick plate stands no deeper than it is across, so past a deck only if it is wider than one.
    const across = thick ? DECK_HEIGHT + 1 : DECK_HEIGHT;
    return built(`slab ${length}${thick ? " thick" : ""}`, [
        { id: 1, kind: "structure", x: 0, y: 0, length, width: across, thick },
        { id: 2, kind: "core", x: 0, y: -across / 2 - 1, length: 2, width: 2 },
    ]);
};

/** Where a slab's face is, above its blueprint's origin. */
const faceOf = (slab: ShipDesign): number => slab.modules[0]!.spec.width / 2;

/** A long tank, and a core at one end to make it a ship. */
const tankDesign = (length: number): ShipDesign =>
    built(`tank ${length}`, [
        { id: 1, kind: "core", x: 0, y: 0, length: 2, width: 3 },
        { id: 2, kind: "tank", x: 1 + length / 2, y: 0, length, width: 3 },
    ]);

/** How wide each beam's emitter is, and how long: lenses of 10 cm to 80 cm. */
const BEAM_MOUNTS = [
    [1, 1],
    [2.5, 2.5],
    [5, 4.75],
    [8, 10.8],
];

/** A hull beam on a core, and where its beam leaves its lens, ahead of its centre of mass. */
function beamGun(width: number, length: number): { design: ShipDesign; lens: number; width: number; power: number } {
    const core = Math.max(1, width);
    const design = built(`beam ${width}`, [
        { id: 1, kind: "core", x: 0, y: 0, length: core, width: core },
        { id: 2, kind: "hullBeam", x: core / 2 + length / 2, y: 0, angle: 0, length, width, barrels: 1 },
    ]);
    let lens = 0;
    barrelLines({ currentStructure: design, x: 0, y: 0, angle: 0, turretBearings: [0] } as unknown as ShipView, 0, (_x0, _y0, x1) => {
        lens = x1;
    });
    const stats = design.turrets[0]!.gun;
    return { design, lens, width: stats.calibre, power: stats.beamPower };
}

/** How fast the guns' fragments leave their shells, at most, m/s: the Corvette gun's, slow enough that each burst keeps to its own row. */
const GUN_BURST_SPEED = 200;

/** Steps a shell flies before it bursts: far enough that its burst is well clear of its muzzle flash. */
export const GUN_FUSE_STEPS = 20;

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
            burstSpeed: GUN_BURST_SPEED,
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
    view.leakAge = [];
    view.leakSpeed = [];
    return view;
}

/** A hull lying square with its blueprint's origin at the world's, so its modules are where its blueprint has them. */
function atOrigin(snapshot: Snapshot, design: ShipDesign): ShipView {
    return place(snapshot, design, design.centreOfMassX, design.centreOfMassY, 0);
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

/** How long a leak's plume is drawn per √(kg/s), and how far it spreads by its end: `render/canvas2d.ts`'s, for laying the holes out. */
const LEAK_PLUME_LENGTH = 1.5;
const LEAK_PLUME_SPREAD = 0.3;

/** How fast each torpedo meets the slab, m/s. */
const COLLISION_SPEEDS = [10, 30, 100, 300, 1000];

/** How far a design reaches ahead of its centre of mass, where its modules lie square. */
function aheadOf(design: ShipDesign): number {
    let ahead = 0;
    for (const m of design.modules) {
        const across = Math.abs(Math.sin(m.angle)) > 0.5;
        ahead = Math.max(ahead, m.x + (across ? m.spec.width : m.spec.length) / 2);
    }
    return ahead;
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
        about: "Rounds from the five guns of the Guns scene, 2 cm to 40 cm, coming in from the top left onto a slab of hull.",
        loop: 1,
        build(t, snapshot, flashes) {
            const each = GUN_MOUNTS.map(gun);
            const energies = each.map((g) => g.energy);
            const half = spanOf(energies, 2.2, 2);
            const slab = slabDesign(Math.ceil(2 * half + 20));
            const top = faceOf(slab);
            begin(snapshot, flashes, t, -half - 15, -10, half + 15, 45);
            // The slab's face at y = top.
            atOrigin(snapshot, slab);
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
        },
    },
    {
        name: "Collisions",
        about: "Torpedoes flying nose first onto a thick slab of hull, standing up into the layer they fly in, at 10, 30, 100, 300 and 1000 m/s: each stopping where it meets the slab, its whole energy flashing there.",
        loop: 1,
        build(t, snapshot, flashes) {
            const torpedo = torpedoDesign();
            const energies = COLLISION_SPEEDS.map((speed) => 0.5 * torpedo.mass * speed * speed);
            const half = spanOf(energies, 2.2, 2);
            const slab = slabDesign(Math.ceil(2 * half + 20), true);
            const top = faceOf(slab);
            begin(snapshot, flashes, t, -half - 10, -10, half + 10, 40);
            atOrigin(snapshot, slab);
            const hit = 0.4;
            const nose = aheadOf(torpedo);
            spaced(energies, 2.2, 2).forEach((x, k) => {
                const speed = COLLISION_SPEEDS[k]!;
                // Nose down, coming straight in, and stopped dead where it meets the slab.
                const ship = place(snapshot, torpedo, x, top + nose + speed * Math.max(0, hit - t), -Math.PI / 2);
                if (t < hit) {
                    ship.vy = -speed;
                    ship.throttles.fill(1);
                }
                flash(flashes, t, hit, x, top, energies[k]!, IMPACT_COLLISION);
            });
        },
    },
    {
        name: "Guns",
        about: "Five guns, 2 cm to 40 cm, each firing a shell that bursts twenty steps later, about 230 m on, into fragments: the muzzle flash, the round in flight, the burst and its fragments.",
        loop: 1,
        build(t, snapshot, flashes) {
            const fire = 0.1;
            const burst = fire + GUN_FUSE_STEPS * STEP;
            const each = GUN_MOUNTS.map(gun);
            // Each row as tall as its burst's glow gets before it goes out, the smallest at the top.
            const reach = each.map((g) => Math.max(g.design.radius, flashRadius(g.burst) * 2.2 + g.spread * burstLifetime(g.burst)) + 4);
            const ys: number[] = [];
            let y = 0;
            reach.forEach((r, k) => {
                y -= k === 0 ? 0 : reach[k - 1]! + r;
                ys.push(y);
            });
            const far = Math.max(...each.map((g) => g.speed)) * (burst - fire);
            begin(snapshot, flashes, t, -2 * each[4]!.design.radius, y - reach[4]!, far + reach[4]!, reach[0]!);
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
        about: "Four hull beams, their lenses 10 cm to 80 cm and 1.6 MW to 100 MW, burning into a slab of hull 60 m off: the glow at each lens, along each beam and where it lands.",
        loop: 1,
        build(t, snapshot, flashes) {
            const each = BEAM_MOUNTS.map(([width, length]) => beamGun(width!, length!));
            const range = 60;
            const reach = each.map((b) => b.design.radius + 3);
            const ys: number[] = [];
            let y = 0;
            reach.forEach((r, k) => {
                y -= k === 0 ? 0 : reach[k - 1]! + r;
                ys.push(y);
            });
            begin(snapshot, flashes, t, -2 * each[3]!.design.radius, y - reach[3]!, range + 10, reach[0]!);
            const slab = slabDesign(Math.ceil(reach[0]! - y + reach[3]!));
            // Upright, its face towards the beams and level with them, its core behind it.
            place(
                snapshot,
                slab,
                range + faceOf(slab) - slab.centreOfMassY,
                (reach[0]! + y - reach[3]!) / 2 + slab.centreOfMassX,
                Math.PI / 2,
            );
            room(snapshot, each.length);
            each.forEach((b, k) => {
                const row = ys[k]!;
                place(snapshot, b.design, -b.lens, row, 0);
                const i = snapshot.beamCount++;
                snapshot.beamStartX[i] = 0;
                snapshot.beamStartY[i] = row;
                snapshot.beamEndX[i] = range;
                snapshot.beamEndY[i] = row;
                snapshot.beamWidth[i] = b.width;
                snapshot.beamPower[i] = b.power;
                snapshot.beamTeam[i] = 0;
                beamFlashes(flashes, t, range, row, b.power);
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
        about: "Rounds from the five guns of the Guns scene punching holes together in a full tank, each hole its round's calibre: each leak growing out of its hole at the 49 m/s its fuel leaves, then flowing at what the hole lets out, 4 kg/s to 1.5 t/s.",
        loop: 2.5,
        build(t, snapshot, flashes) {
            const each = GUN_MOUNTS.map(gun);
            const holes = each.map((g) => {
                const rate = leakRate((Math.PI * g.calibre * g.calibre) / 4, 1);
                const length = Math.max(g.calibre * 4, LEAK_PLUME_LENGTH * Math.sqrt(rate));
                return { rate, length, spread: g.calibre / 2 + length * LEAK_PLUME_SPREAD + 2 };
            });
            let along = 4;
            const xs = holes.map((h, k) => {
                along += k === 0 ? h.spread : holes[k - 1]!.spread + h.spread;
                return along;
            });
            const length = Math.ceil(along + holes[4]!.spread + 4);
            const design = tankDesign(length);
            const tank = design.modules[1]!;
            const top = tank.y + tank.spec.width / 2;
            begin(snapshot, flashes, t, -10, -10, length + 10, top + holes[4]!.length + 10);
            const ship = atOrigin(snapshot, design);
            room(snapshot, each.length);
            const down = Math.SQRT1_2;
            each.forEach((g, k) => {
                const hit = 0.3;
                const x = xs[k]!;
                const vx = g.speed * down;
                const vy = -g.speed * down;
                const y = top;
                if (t < hit) {
                    round(snapshot, x - vx * (hit - t), y - vy * (hit - t), vx, vy, x - vx * hit, y - vy * hit, g.calibre);
                    return;
                }
                flash(flashes, t, hit, x, y, g.energy, IMPACT_ROUND);
                ship.leakX!.push(x - design.centreOfMassX);
                ship.leakY!.push(top - design.centreOfMassY);
                ship.leakDirX!.push(0);
                ship.leakDirY!.push(1);
                ship.leakWidth!.push(g.calibre);
                ship.leakRate!.push(holes[k]!.rate);
                ship.leakAge!.push(t - hit);
                ship.leakSpeed!.push(leakSpeed(1));
            });
        },
    },
];
