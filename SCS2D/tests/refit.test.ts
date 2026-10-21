import { describe, expect, it } from 'vitest';
import { compileBlueprint, expandBlueprint, refitPlan, settleIds, subDesign, type Blueprint } from '../sim/index.js';
import { EditorDocument } from '../editor/document.js';
import { makeBattle } from '../scenarios/battle.js';
import { MENDER, REBUILDER, REFITTED, refitting } from '../scenarios/mending.js';

/** Refitting a ship from one design to another (ROADMAP.md §8 step 12, slice 2). */

const FROM: Blueprint = settleIds(REBUILDER);

function alone(): ReturnType<typeof makeBattle> & { a: number } {
  return makeBattle({ seed: 1, pilots: false }, (ships, world) => {
    const a = ships.spawn(world, { design: compileBlueprint(FROM), x: 0, y: 0 });
    return { a };
  });
}

const kinds = (list: readonly { spec: { kind: string } }[]): string[] => list.map((m) => m.spec.kind).sort();

describe('a refit', () => {
  it('moves its core: the new one goes up first, the old comes down last, and it is flown throughout', () => {
    const run = alone();
    const top = Math.max(...FROM.modules.map((m) => m.id ?? 0));
    // The core moved from the bow to beside the spine.
    const moved: Blueprint = {
      ...FROM,
      name: 'Moved core',
      modules: FROM.modules.map((m) => ('kind' in m && m.kind === 'core' ? { ...m, id: top + 1, x: 9, y: 3 } : m)),
    };
    expect(run.ships.refit(run.world, run.a, compileBlueprint(moved))).toBeNull();
    const cores = (): number =>
      run.ships.currentStructure(run.a).modules.filter((m) => m.spec.kind === 'core' && m.shell === undefined).length;
    let most = 0;
    for (let s = 0; s < 600 * 60 && run.ships.isRefitting(run.a); s++) {
      run.step();
      if (s % 30 === 0) {
        expect(run.ships.isAlive(run.a)).toBe(true);
        expect(run.ships.hasControl(run.a)).toBe(true);
        most = Math.max(most, cores());
      }
    }
    expect(run.ships.isRefitting(run.a)).toBe(false);
    // Both at once, for a while: the new built before the old came down.
    expect(most).toBe(2);
    expect(cores()).toBe(1);
    const core = run.ships.currentStructure(run.a).modules.find((m) => m.spec.kind === 'core')!;
    expect(core.y).toBeGreaterThan(1);
  });

  it('moves its robot bay: the new one up first, the old one emptied and its robots taken apart before it comes down', () => {
    const from: Blueprint = settleIds({
      name: 'Bay astern',
      modules: [
        { kind: 'core', x: 0, y: 0, length: 3, width: 3 },
        { kind: 'structure', x: 4, y: 0, length: 5, width: 3 },
        { kind: 'structure', x: 9, y: 0, length: 5, width: 3 },
        { kind: 'structure', x: 14, y: 0, length: 5, width: 3 },
        { kind: 'robotBay', x: 18.5, y: 0, length: 4, width: 4 },
        { kind: 'hold', x: 9, y: 3, length: 5, width: 3 },
        { kind: 'battery', x: 9, y: -3, length: 5, width: 3 },
      ],
    });
    const top = Math.max(...from.modules.map((m) => m.id ?? 0));
    const to: Blueprint = {
      ...from,
      name: 'Bay forward',
      modules: from.modules.map((m) => ('kind' in m && m.kind === 'robotBay' ? { ...m, id: top + 1, x: 4, y: 3.5 } : m)),
    };
    const run = makeBattle({ seed: 1, pilots: false }, (ships, world) => ({
      a: ships.spawn(world, { design: compileBlueprint(from), x: 0, y: 0 }),
    }));
    expect(run.ships.refit(run.world, run.a, compileBlueprint(to))).toBeNull();
    const b = (): number => run.world.bodies.indexOf(run.ships.body(run.a));
    const bays = (): number =>
      run.ships.currentStructure(run.a).modules.filter((m) => m.spec.kind === 'robotBay' && m.shell === undefined).length;
    let most = 0;
    for (let s = 0; s < 900 * 60 && run.ships.isRefitting(run.a); s++) {
      run.step();
      if (s % 30 === 0) {
        expect(run.ships.robots.on(b())?.length ?? 0).toBeGreaterThan(0);
        most = Math.max(most, bays());
      }
    }
    expect(run.ships.isRefitting(run.a)).toBe(false);
    expect(most).toBe(2);
    expect(bays()).toBe(1);
    const design = run.ships.currentStructure(run.a);
    const bay = design.modules.findIndex((m) => m.spec.kind === 'robotBay');
    expect(design.modules[bay]!.y).toBeGreaterThan(1);
    // Every robot left is the new bay's.
    for (const robot of run.ships.robots.on(b()) ?? []) expect(robot.bay).toBe(bay);
  });

  it('is refused to a design not compiled from a blueprint, which has no keys to match by', () => {
    const run = alone();
    const piece = subDesign(compileBlueprint(FROM), [0, 1]);
    expect(run.ships.refit(run.world, run.a, piece)).toMatch(/not compiled from a blueprint/);
  });

  it('builds what is new before it takes down what is gone, and ends as the design it was refitted to', () => {
    const run = refitting();
    const to = compileBlueprint(REFITTED);
    const engines = (): number => run.ships.currentStructure(0).modules.filter((m) => m.spec.kind === 'engine').length;
    expect(run.ships.isRefitting(0)).toBe(true);
    // The new fin first, the engine still aboard.
    for (let s = 0; s < 120 * 60 && run.ships.currentStructure(0).modules.length < 11; s++) run.step();
    expect(run.ships.currentStructure(0).modules.length).toBe(11);
    expect(engines()).toBe(1);
    for (let s = 0; s < 600 * 60 && run.ships.isRefitting(0); s++) run.step();
    expect(run.ships.isRefitting(0)).toBe(false);
    expect(kinds(run.ships.currentStructure(0).modules)).toEqual(kinds(to.modules));
    expect(engines()).toBe(0);
  });

  it('keeps what it shares with the design it is refitted to, as it was', () => {
    const run = alone();
    const before = run.ships.currentStructure(run.a);
    expect(run.ships.refit(run.world, run.a, compileBlueprint({ ...FROM, name: 'Same' }))).toBeNull();
    expect(run.ships.isRefitting(run.a)).toBe(false);
    expect(run.ships.currentStructure(run.a).modules.map((m) => m.spec)).toEqual(before.modules.map((m) => m.spec));
  });
});

describe('a refit planned in the editor', () => {
  it('says what would be built and what taken down, matched as a refit matches', () => {
    const plan = refitPlan(FROM, REFITTED)!;
    const now = expandBlueprint(REFITTED);
    expect(plan.built.map((k) => now[k]!.kind).sort()).toEqual(['structure', 'tank']);
    expect(plan.takenDown.map((m) => m.kind).sort()).toEqual(['engine', 'structure']);
    expect(plan.refused).toBeNull();
    expect(plan.bay).toBe(true);
  });

  it('is nothing between a design and itself, says when it could not be done, and when it could not be finished', () => {
    expect(refitPlan(FROM, FROM)).toMatchObject({ built: [], takenDown: [], refused: null, bay: true });
    const coreless: Blueprint = { ...FROM, modules: FROM.modules.filter((m) => !('kind' in m) || m.kind !== 'core') };
    expect(refitPlan(FROM, coreless)!.refused).toMatch(/no core/);
    const bayless: Blueprint = { ...FROM, modules: FROM.modules.filter((m) => !('kind' in m) || m.kind !== 'robotBay') };
    expect(refitPlan(FROM, bayless)!.bay).toBe(false);
  });

  it('is shown against the design as it was opened, once it differs', () => {
    const doc = new EditorDocument(FROM);
    expect(doc.refit).toBeNull();
    doc.apply(REFITTED);
    expect(doc.refit?.built.length).toBe(2);
    expect(doc.refit?.takenDown.length).toBe(2);
    doc.undo();
    expect(doc.refit).toBeNull();
  });
});

describe('a refit taking a tank down', () => {
  it('pours what it holds into the rest of the ship first', () => {
    // A Mender with an empty tank and a full one beside it, refitted without the full one.
    const tanked: Blueprint = settleIds({
      ...MENDER,
      name: 'Tanked',
      modules: [
        ...MENDER.modules,
        { kind: 'tank', x: 9, y: 3.5, length: 5, width: 4, fill: 0 },
        { kind: 'tank', x: 14, y: 3.5, length: 5, width: 4 },
      ],
    });
    const lighter: Blueprint = { ...tanked, name: 'Lighter', modules: tanked.modules.slice(0, -1) };
    const run = makeBattle({ seed: 1, pilots: false }, (ships, world) => {
      const a = ships.spawn(world, { design: compileBlueprint(tanked), x: 0, y: 0 });
      return { a };
    });
    const b = (): number => run.world.bodies.indexOf(run.ships.body(run.a));
    const before = run.ships.fuel.left(b());
    expect(before).toBeGreaterThan(0);
    expect(run.ships.refit(run.world, run.a, compileBlueprint(lighter))).toBeNull();
    for (let s = 0; s < 600 * 60 && run.ships.isRefitting(run.a); s++) run.step();
    expect(run.ships.isRefitting(run.a)).toBe(false);
    expect(run.ships.currentStructure(run.a).modules.filter((m) => m.spec.kind === 'tank').length).toBe(1);
    expect(run.ships.fuel.left(b())).toBeCloseTo(before, 6);
  });
});
