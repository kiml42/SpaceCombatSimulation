import { describe, expect, it } from 'vitest';
import {
  CLAW_GRIP_CHANCE,
  CLAW_SPEED_HIGH,
  CLAW_SPEED_LOW,
  CLAW_SPEED_MAX,
  clawChance,
  compileBlueprint,
  DAMAGE_ENERGY_PER_KG,
  DOCK_HOLD,
  joints,
  JOINT_IMPULSE_PER_AREA,
  moduleStats,
  CLAW_PUMP_PER_METRE,
  type Blueprint,
  type Ships,
} from '../sim/index.js';
import { makeBattle } from '../scenarios/battle.js';
import { CORVETTE } from '../scenarios/blueprints.js';
import type { World } from '../sim/world.js';

/** A core, a tank behind it and a claw on its bow: something that drinks from wrecks. */
const LEECH: Blueprint = {
  name: 'Leech',
  modules: [
    { kind: 'core', x: 0, y: 0, length: 3, width: 3 },
    { kind: 'tank', x: -3.5, y: 0, length: 4, width: 3 },
    { kind: 'claw', x: 2.5, y: 0, angle: 0, length: 2, width: 2 },
  ],
};
const TANK = 1;
const CLAW = 2;
/** What the leech's tanks have room for, kg. */
const ROOM = 500;

const leech = compileBlueprint(LEECH);
const corvette = compileBlueprint(CORVETTE);

/** Bring a module down to this integrity, 1 whole and 0 spent. */
function wear(ships: Ships, world: World, ship: number, module: number, integrity: number): void {
  const body = world.bodies.indexOf(ships.body(ship));
  const capacity = ships.design(ship).modules[module]!.stats.hitPoints * DAMAGE_ENERGY_PER_KG;
  ships.damage.absorb(body, module, capacity * (1 - integrity) - ships.damage.absorbedAt(body, module));
}

/** Knock out every core and spend everything else, so whatever the claw meets it takes. */
function wreck(ships: Ships, world: World, ship: number, cores = 0.3): void {
  const design = ships.design(ship);
  for (let m = 0; m < design.modules.length; m++) wear(ships, world, ship, m, design.modules[m]!.spec.kind === 'core' ? cores : 0);
}

interface Setup {
  /** Turn the leech round, so its stern meets the other hull. */
  astern?: boolean;
  /** The other hull is a live ship on the leech's side. */
  friend?: boolean;
  /** The other hull is a live enemy, its cores sound. */
  live?: boolean;
}

/** A dry leech drifting bow first into a corvette at `closing` m/s. */
function approach(closing: number, setup: Setup = {}): ReturnType<typeof makeBattle<{ a: number; b: number }>> {
  return makeBattle({ seed: 1, pilots: false }, (ships, world) => {
    const gap = leech.radius + corvette.radius + 1;
    const a = ships.spawn(world, { design: leech, x: -gap / 2, y: 0, angle: setup.astern === true ? Math.PI : 0, vx: closing / 2 });
    const b = ships.spawn(world, { design: corvette, x: gap / 2, y: 0, angle: Math.PI, vx: -closing / 2, team: setup.friend === true ? 0 : 1 });
    // Room for a few seconds' pumping.
    const body = world.bodies.indexOf(ships.body(a));
    ships.fuel.vent(body, TANK, ROOM);
    if (setup.friend !== true) wreck(ships, world, b, setup.live === true ? 1 : 0.3);
    return { a, b };
  });
}

function runUntil(run: ReturnType<typeof approach>, done: () => boolean, seconds = 30): void {
  for (let s = 0; s < seconds * 60 && !done(); s++) run.step();
}

describe('a claw', () => {
  it('is a box with jaws and a pump, pumping more the wider it is', () => {
    const narrow = moduleStats({ kind: 'claw', x: 0, y: 0, angle: 0, length: 2, width: 2 });
    const wide = moduleStats({ kind: 'claw', x: 0, y: 0, angle: 0, length: 2, width: 4 });
    expect(narrow.pumpRate).toBeCloseTo(2 * CLAW_PUMP_PER_METRE, 9);
    expect(wide.pumpRate).toBeCloseTo(2 * narrow.pumpRate, 9);
    expect(narrow.fuel).toBe(0);
    expect(narrow.fittingMass).toBeGreaterThan(0);
  });

  it('takes best within its band of closing speed, and likelier on torn metal', () => {
    const middle = (CLAW_SPEED_LOW + CLAW_SPEED_HIGH) / 2;
    expect(clawChance(middle, 1)).toBeCloseTo(CLAW_GRIP_CHANCE, 9);
    expect(clawChance(middle, 0)).toBe(1);
    expect(clawChance(CLAW_SPEED_LOW / 2, 1)).toBeLessThan(clawChance(middle, 1));
    expect(clawChance((CLAW_SPEED_HIGH + CLAW_SPEED_MAX) / 2, 1)).toBeLessThan(clawChance(middle, 1));
    expect(clawChance(CLAW_SPEED_MAX + 1, 0)).toBe(0);
    expect(clawChance(0, 0)).toBe(0);
  });
});

describe('gripping a wreck', () => {
  it('closes on it faster than torn metal hooks, with a seam that holds harder', () => {
    const run = approach(3);
    runUntil(run, () => run.totalWelded > 0);
    expect(run.totalWelded).toBe(1);
    expect(run.ships.body(run.a)).toBe(run.ships.body(run.b));
    const design = run.ships.design(run.a);
    const seam = design.seams!.find((s) => s.dock === 'claw')!;
    expect(design.modules[seam.a]!.spec.kind).toBe('claw');
    const joint = joints(design).find((j) => j.dock === true)!;
    const thickness = Math.min(design.modules[joint.a]!.stats.wallThickness, design.modules[joint.b]!.stats.wallThickness);
    // Across the whole jaw.
    expect(joint.width).toBe(leech.modules[CLAW]!.spec.width);
    expect(joint.strength).toBeCloseTo(joint.width * thickness * JOINT_IMPULSE_PER_AREA * DOCK_HOLD, 3);
  });

  it('pumps the wreck dry into its own tanks, the hull weighing the same, and lets go when full', () => {
    const run = approach(3);
    runUntil(run, () => run.totalWelded > 0);
    const body = (): number => run.world.bodies.indexOf(run.ships.body(run.a));
    const own = (): number => run.ships.fuel.pieceHeld(body(), CLAW);
    const mass = run.world.bodies.mass[body()]!;
    const held = own();
    run.step();
    run.step();
    expect(own()).toBeGreaterThan(held);
    expect(run.world.bodies.mass[body()]!).toBeCloseTo(mass, 3);
    runUntil(run, () => run.ships.body(run.a) !== run.ships.body(run.b));
    expect(run.ships.body(run.a)).not.toBe(run.ships.body(run.b));
    // Let go full.
    expect(run.ships.fuel.left(body())).toBeCloseTo(leech.modules.reduce((sum, m) => sum + m.stats.fuel, 0), 3);
  });

  it('bites what it closes on', () => {
    const sound = approach(3);
    const before = new Map<number, number>();
    const wreckBody = sound.world.bodies.indexOf(sound.ships.body(sound.b));
    for (let m = 0; m < corvette.modules.length; m++) before.set(m, sound.ships.damage.absorbedAt(wreckBody, m));
    runUntil(sound, () => sound.totalWelded > 0);
    const merged = sound.world.bodies.indexOf(sound.ships.body(sound.a));
    const seam = sound.ships.design(sound.a).seams!.find((s) => s.dock === 'claw')!;
    const offset = leech.modules.length;
    expect(sound.ships.damage.absorbedAt(merged, seam.b)).toBeGreaterThan(before.get(seam.b - offset)!);
  });
});

/** Whether the leech's claw holds anything: torn metal may still hook on a slow bounce. */
function holding(run: ReturnType<typeof approach>): boolean {
  return run.ships.design(run.a).seams?.some((seam) => seam.dock === 'claw') === true;
}

describe('gripping a live enemy', () => {
  it('drinks from it while both ride the one body', () => {
    const run = approach(3, { live: true });
    runUntil(run, () => run.totalWelded > 0);
    expect(run.ships.body(run.a)).toBe(run.ships.body(run.b));
    expect(run.ships.isAlive(run.b)).toBe(true);
    const body = run.world.bodies.indexOf(run.ships.body(run.a));
    const held = run.ships.fuel.pieceHeld(body, CLAW);
    run.step();
    expect(run.ships.fuel.pieceHeld(body, CLAW)).toBeGreaterThan(held);
  });
});

describe('what a claw will not take', () => {
  it('a ram', () => {
    const run = approach(CLAW_SPEED_MAX + 2);
    runUntil(run, () => run.totalWelded > 0, 10);
    expect(run.totalWelded).toBe(0);
    expect(run.totalContacts).toBeGreaterThan(0);
  });

  it('anything its bow does not meet', () => {
    const run = approach(3, { astern: true });
    runUntil(run, () => holding(run), 10);
    expect(holding(run)).toBe(false);
    expect(run.totalContacts).toBeGreaterThan(0);
  });

  it('a friend', () => {
    const run = approach(3, { friend: true });
    runUntil(run, () => holding(run), 10);
    expect(holding(run)).toBe(false);
    expect(run.totalContacts).toBeGreaterThan(0);
  });
});
