import { describe, expect, it } from 'vitest';
import {
  BASE_WALL_THICKNESS,
  CORE_COMPUTING_VOLUME,
  DECK_HEIGHT,
  FUEL_DENSITY,
  Fuel,
  Ships,
  World,
  blueprintProblem,
  compileBlueprint,
  joints,
  moduleStats,
  parseBlueprint,
  serialiseBlueprint,
  specificImpulse,
  type Blueprint,
  type ShipDesign,
  weldDesigns,
} from '../sim/index.js';
import { designStats, envelopes, moduleReadout } from '../editor/stats.js';
import { BLUEPRINTS } from '../scenarios/blueprints.js';

/** A core, a big tank ahead of it, a small one behind, and an engine on the back. */
const TANKER: Blueprint = {
  name: 'Tanker',
  modules: [
    { kind: 'core', x: 0, y: 0, length: 4, width: 4 },
    { kind: 'tank', x: 6, y: 0, length: 8, width: 4 },
    { kind: 'tank', x: -4, y: 0, length: 4, width: 4 },
    { kind: 'engine', x: -6, y: 0, angle: Math.PI, length: 4, width: 4 },
  ],
};
const BIG = 1;
const SMALL = 2;
const ENGINE = 3;

/** Best a chemical engine manages, seconds. Every engine here has to beat it. */
const MODERN_ISP = 465;

const tanker = compileBlueprint(TANKER);

function interior(length: number, width: number, depth: number): number {
  const t = BASE_WALL_THICKNESS;
  return (length - 2 * t) * (width - 2 * t) * (depth - 2 * t);
}

describe('a tank', () => {
  it('holds its interior full of fuel, and weighs it', () => {
    const tank = moduleStats({ kind: 'tank', x: 0, y: 0, length: 6, width: 4 });
    const plate = moduleStats({ kind: 'structure', x: 0, y: 0, length: 6, width: 4 });
    expect(tank.fuel).toBeCloseTo(interior(6, 4, DECK_HEIGHT) * FUEL_DENSITY, 6);
    expect(tank.mass).toBeCloseTo(plate.mass + tank.fuel, 6);
    // Fuel is not armour: the walls are what a shell has to get through.
    expect(tank.hitPoints).toBe(plate.hitPoints);
  });

  it('is the only kind but a core that carries any', () => {
    const core = moduleStats({ kind: 'core', x: 0, y: 0, length: 4, width: 4 });
    expect(core.fuel).toBeCloseTo((interior(4, 4, DECK_HEIGHT) - CORE_COMPUTING_VOLUME) * FUEL_DENSITY, 6);
    // No fuel in a core with no room past its computing, and nothing else lost for it.
    const small = { kind: 'core' as const, x: 0, y: 0, length: 1, width: 1 };
    expect(interior(1, 1, 1)).toBeLessThan(CORE_COMPUTING_VOLUME);
    expect(moduleStats(small).fuel).toBe(0);
    expect(moduleStats(small).hitPoints).toBeGreaterThan(0);
    for (const kind of ['structure', 'engine', 'turret', 'hullGun'] as const) {
      expect(moduleStats({ kind, x: 0, y: 0, angle: 0, length: 6, width: 4 }).fuel).toBe(0);
    }
  });
});

describe('what an engine burns', () => {
  const isp = (length: number, width: number, nozzle?: number): number =>
    specificImpulse(
      moduleStats({ kind: 'engine', x: 0, y: 0, angle: Math.PI, length, width, ...(nozzle === undefined ? {} : { nozzle }) })
        .exhaustVelocity,
    );

  it('beats any engine flying today, even the worst one that can be drawn', () => {
    // No bell at all, and a throat a few centimetres across.
    expect(isp(0.3, 0.1, 0)).toBeGreaterThan(MODERN_ISP);
    for (const blueprint of Object.values(BLUEPRINTS)) {
      for (const module of compileBlueprint(blueprint).modules) {
        if (module.spec.kind !== 'engine') continue;
        expect(specificImpulse(module.stats.exhaustVelocity)).toBeGreaterThan(MODERN_ISP);
      }
    }
  });

  it('gets more out of its fuel with a longer bell, and with a bigger throat', () => {
    expect(isp(6, 3, 0.7)).toBeGreaterThan(isp(6, 3, 0.2));
    expect(isp(6, 3)).toBeGreaterThan(isp(1, 0.5));
  });
});

describe('draining tanks', () => {
  function registered(): { fuel: Fuel; full: number } {
    const fuel = new Fuel();
    fuel.register(0, tanker);
    return { fuel, full: fuel.left(0) };
  }
  const fraction = (fuel: Fuel, m: number): number => fuel.held(0, m) / tanker.modules[m]!.stats.fuel;

  it('takes from every tank in proportion to its size, so they run dry together', () => {
    const { fuel, full } = registered();
    expect(fuel.drain(0, ENGINE, full / 3)).toBeCloseTo(full / 3, 6);
    const share = fraction(fuel, BIG);
    expect(share).toBeCloseTo(2 / 3, 9);
    expect(fraction(fuel, SMALL)).toBeCloseTo(share, 9);
    // The core's own tank too.
    expect(fraction(fuel, 0)).toBeCloseTo(share, 9);
  });

  it('gives what is left when asked for more, and nothing once empty', () => {
    const { fuel, full } = registered();
    expect(fuel.drain(0, ENGINE, full * 2)).toBeCloseTo(full, 6);
    expect(fuel.left(0)).toBe(0);
    expect(fuel.drain(0, ENGINE, 1)).toBe(0);
    expect(fuel.burntMass(0)).toBeCloseTo(full, 6);
  });

  it('spreads a tank that runs dry first across the rest', () => {
    const { fuel } = registered();
    const carried = tanker.modules.map((m) => m.stats.fuel);
    carried[SMALL] = 1;
    fuel.register(0, tanker, carried);
    const asked = tanker.modules[BIG]!.stats.fuel / 2;
    expect(fuel.drain(0, ENGINE, asked)).toBeCloseTo(asked, 6);
    expect(fuel.held(0, SMALL)).toBe(0);
  });

  it('empties the tanks with the highest drain priority first', () => {
    const modules = TANKER.modules!.map((m, i) => (i === SMALL ? { ...m, drainPriority: 1 } : i === 0 ? { ...m, drainPriority: -1 } : m));
    const design = compileBlueprint({ ...TANKER, modules });
    const fuel = new Fuel();
    fuel.register(0, design);
    const small = design.modules[SMALL]!.stats.fuel;
    const big = design.modules[BIG]!.stats.fuel;
    // The small tank alone, until it is dry.
    fuel.drain(0, ENGINE, small / 2);
    expect(fuel.held(0, SMALL)).toBeCloseTo(small / 2, 6);
    expect(fuel.held(0, BIG)).toBe(big);
    // Then the big one, leaving the core's reserve until last.
    fuel.drain(0, ENGINE, small / 2 + big / 2);
    expect(fuel.held(0, SMALL)).toBe(0);
    expect(fuel.held(0, BIG)).toBeCloseTo(big / 2, 6);
    expect(fuel.held(0, 0)).toBe(design.modules[0]!.stats.fuel);
  });

  it('keeps a drain priority in the file format on what holds fuel, and nowhere else', () => {
    const file = serialiseBlueprint({
      name: 'Primed',
      modules: [
        { kind: 'core', x: 0, y: 0, length: 4, width: 4 },
        { kind: 'tank', x: 6, y: 0, length: 8, width: 4, drainPriority: 2 },
        { kind: 'structure', x: -3, y: 0, length: 2, width: 4, drainPriority: 2 },
      ],
    }) as { modules: Record<string, unknown>[] };
    expect(file.modules[1]!['drainPriority']).toBe(2);
    expect(file.modules[2]!['drainPriority']).toBeUndefined();
    const back = parseBlueprint(JSON.parse(JSON.stringify(file)));
    expect((back.modules[1] as { drainPriority?: number }).drainPriority).toBe(2);
  });

  it('refuses a drain priority that is not a whole number', () => {
    const modules = TANKER.modules!.map((m, i) => (i === SMALL ? { ...m, drainPriority: 0.5 } : m));
    expect(blueprintProblem({ ...TANKER, modules })).toMatch(/drain priority/);
  });
});

describe('pumping fuel between pieces', () => {
  /** Two tankers hooked bow to bow: the second's modules follow the first's. */
  function hooked(design = tanker): { fuel: Fuel; design: ShipDesign; n: number } {
    const welded = weldDesigns(design, design, 0, 20, 0, BIG, BIG, 0.5);
    const fuel = new Fuel();
    const carried = welded.modules.map((m) => m.stats.fuel);
    const n = design.modules.length;
    // The second piece arrives dry.
    for (let m = n; m < carried.length; m++) carried[m] = 0;
    fuel.register(0, welded, carried);
    return { fuel, design: welded, n };
  }

  it('moves what it is asked across, and the hull weighs the same', () => {
    const { fuel, n } = hooked();
    const left = fuel.left(0);
    const burnt = fuel.burntMass(0);
    expect(fuel.transfer(0, ENGINE, n + ENGINE, 100)).toBeCloseTo(100, 6);
    expect(fuel.left(0)).toBeCloseTo(left, 6);
    expect(fuel.burntMass(0)).toBeCloseTo(burnt, 6);
    let other = 0;
    for (let m = n; m < 2 * n; m++) other += fuel.held(0, m);
    expect(other).toBeCloseTo(100, 6);
  });

  it('keeps the inertia a hull holding that fuel would have', () => {
    const { fuel, design, n } = hooked();
    fuel.transfer(0, 0, n, 500);
    const fresh = new Fuel();
    fresh.register(0, design, Array.from(fuel.contentsOf(0)!));
    expect(fuel.burntInertia(0)).toBeCloseTo(fresh.burntInertia(0), 3);
  });

  it('goes no further than the receiver has room for, or the source has', () => {
    const { fuel, n } = hooked();
    const full = tanker.modules.reduce((sum, m) => sum + m.stats.fuel, 0);
    expect(fuel.transfer(0, 0, n, full * 3)).toBeCloseTo(full, 6);
    expect(fuel.transfer(0, 0, n, 1)).toBe(0);
    expect(fuel.transfer(0, n, 0, full * 3)).toBeCloseTo(full, 6);
  });

  it('moves nothing within a piece', () => {
    const { fuel } = hooked();
    expect(fuel.transfer(0, 0, ENGINE, 100)).toBe(0);
  });

  it('fills the tanks burnt last first, and draws as an engine would', () => {
    const modules = TANKER.modules!.map((m, i) => (i === SMALL ? { ...m, drainPriority: 1 } : m));
    const { fuel, design, n } = hooked(compileBlueprint({ ...TANKER, modules }));
    const small = design.modules[SMALL]!.stats.fuel;
    // Out of the small tank first, into everything but the small tank first.
    fuel.transfer(0, 0, n, small / 2);
    expect(fuel.held(0, SMALL)).toBeCloseTo(small / 2, 6);
    expect(fuel.held(0, n + SMALL)).toBe(0);
    expect(fuel.held(0, n + BIG)).toBeGreaterThan(0);
  });
});

describe('a ship burning fuel', () => {
  function flying(design: ShipDesign = tanker): { world: World; ships: Ships; ship: number; body: number } {
    const world = new World({ dt: 1 / 60, seed: 3 });
    const ships = new Ships();
    world.addForceProvider(ships.forceProvider());
    const ship = ships.spawn(world, { design, x: 0, y: 0, angle: Math.PI, team: 0 });
    const mark = ships.spawn(world, { design: tanker, x: -50_000, y: 0, team: 1 });
    ships.clearOrder(ship);
    ships.pushOrder(ship, mark, 0, 0, 5000);
    return { world, ships, ship, body: world.bodies.indexOf(ships.body(ship)) };
  }
  const step = (s: { world: World; ships: Ships }): void => {
    s.ships.command(1 / 60, s.world);
    s.world.step();
  };

  it('gets lighter by exactly what it burns', () => {
    const s = flying();
    for (let i = 0; i < 120; i++) step(s);
    const burnt = s.ships.fuel.burntMass(s.body);
    expect(burnt).toBeGreaterThan(0);
    expect(s.world.bodies.mass[s.body]).toBeCloseTo(tanker.mass - burnt, 6);
    expect(s.world.bodies.inertia[s.body]).toBeLessThan(tanker.inertia);
  });

  it('stops pushing when it runs dry', () => {
    // Nothing but what a small core carries.
    const layout: Blueprint = {
      name: 'Thirsty',
      modules: [
        { kind: 'core', x: 0, y: 0, length: 1.2, width: 1.2 },
        { kind: 'engine', x: -0.6, y: 0, angle: Math.PI, length: 4, width: 4 },
      ],
    };
    expect(blueprintProblem(layout)).toBeNull();
    const s = flying(compileBlueprint(layout));
    let steps = 0;
    while (s.ships.fuel.left(s.body) > 0 && steps < 60 * 60) {
      step(s);
      steps++;
    }
    expect(s.ships.fuel.left(s.body)).toBe(0);
    // The integrator spends half of a step's force on the step after it.
    step(s);
    const vx = s.world.bodies.vx[s.body]!;
    expect(vx).toBeLessThan(0);
    for (let i = 0; i < 60; i++) step(s);
    expect(s.ships.throttleOf(s.ship, 0)).toBe(0);
    expect(s.world.bodies.vx[s.body]).toBeCloseTo(vx, 9);
  });

  it('keeps what is in a tank with the piece that tank goes with', () => {
    const world = new World({ dt: 1 / 60, seed: 3 });
    const ships = new Ships();
    const ship = ships.spawn(world, { design: tanker, x: 0, y: 0, team: 0 });
    const body = world.bodies.indexOf(ships.body(ship));
    const taken = ships.fuel.drain(body, ENGINE, tanker.modules[BIG]!.stats.fuel / 2);
    const big = ships.fuel.held(body, BIG);

    // Cut the big tank off the bow.
    const all = joints(tanker);
    all.forEach((joint, k) => {
      if (joint.a === BIG || joint.b === BIG) ships.damage.cutWeld(body, k, joint.width);
    });
    expect(ships.sever(world)).toBe(1);

    const piece = world.bodies.indexOf(ships.body(ship + 1));
    expect(ships.fuel.left(piece)).toBeCloseTo(big, 6);
    // Matter is still where it was: the two weigh what the ship did, less what burnt.
    const bodies = world.bodies;
    expect(bodies.mass[body]! + bodies.mass[piece]!).toBeCloseTo(tanker.mass - taken, 6);
  });
});

describe('what the editor shows', () => {
  it('reads a tank its fuel and an engine its efficiency', () => {
    const tank = moduleReadout(TANKER.modules[BIG] as never);
    expect(tank.rows.find(([k]) => k === 'Fuel')?.[1]).toMatch(/t, counted in its mass/);
    const engine = moduleReadout(TANKER.modules[ENGINE] as never);
    expect(engine.rows.find(([k]) => k === 'Efficiency')?.[1]).toMatch(/s Isp, .* kg\/s flat out/);
  });

  it('gives a ship its fuel, how long it lasts and what it buys', () => {
    const stats = designStats(tanker, envelopes(tanker, 8));
    let fuel = 0;
    for (const module of tanker.modules) fuel += module.stats.fuel;
    expect(stats.fuel).toBeCloseTo(fuel, 6);
    const engine = tanker.modules[ENGINE]!.stats;
    expect(stats.endurance).toBeCloseTo(fuel / (engine.thrust / engine.exhaustVelocity), 6);
    expect(stats.deltaV).toBeGreaterThan(0);
    // The rocket equation, at this engine's exhaust velocity.
    expect(stats.deltaV).toBeCloseTo(engine.exhaustVelocity * Math.log(tanker.mass / (tanker.mass - fuel)), 3);
  });
});
