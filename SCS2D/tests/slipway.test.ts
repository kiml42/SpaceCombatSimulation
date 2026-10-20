import { describe, expect, it } from 'vitest';
import {
  blueprintProblems,
  compileBlueprint,
  padFighterNames,
  parseBlueprint,
  serialiseBlueprint,
  type Blueprint,
  type ModuleSpec,
} from '../sim/index.js';
import { CORVETTE, DINKY, SCAVENGER } from '../scenarios/blueprints.js';
import { addShip, emptyFleet } from '../editor/fleetEdit.js';
import { dockFighter } from '../editor/edit.js';

/** Slipways: a hull module that builds ships alongside (ROADMAP.md §8 step 12, slice 3). */

const SLIPWAY = 2;

/** A core, a hold, and a slipway facing forward that keeps `keep` of `craft`. */
function yard(craft: Blueprint = SCAVENGER, keep = 1, slipway: Partial<ModuleSpec> = {}, more: ModuleSpec[] = []): Blueprint {
  return {
    name: 'Yard',
    modules: [
      { kind: 'core', x: 0, y: 0, length: 4, width: 4 },
      { kind: 'hold', x: -4, y: 0, length: 4, width: 6 },
      { kind: 'slipway', x: 4, y: 0, angle: 0, length: 4, width: 6, craft: craft.name, keep, ...slipway },
      ...more,
    ],
    hangar: { [craft.name]: craft },
  };
}

describe('a slipway', () => {
  it('builds a ship no wider than it, out into clear space', () => {
    expect(blueprintProblems(yard())).toEqual([]);
    const design = compileBlueprint(yard(SCAVENGER, 2));
    expect(design.yards?.map((y) => [y.slipway, y.design.name, y.keep])).toEqual([[SLIPWAY, SCAVENGER.name, 2]]);
    expect(design.builds).toBeUndefined();
  });

  it('builds nothing that keeps none, and is a plain module that names nothing', () => {
    expect(compileBlueprint(yard(SCAVENGER, 0)).yards).toBeUndefined();
    const bare = yard();
    const { craft: _, keep: __, ...slipway } = bare.modules[SLIPWAY] as ModuleSpec;
    expect(blueprintProblems({ ...bare, modules: [...bare.modules.slice(0, 2), slipway], hangar: {} })).toEqual([]);
  });

  it('refuses a fighter, a ship wider than it, and one that stands higher than it', () => {
    expect(blueprintProblems(yard(DINKY)).join()).toMatch(/Dinky is a fighter, which a pad builds/);
    expect(blueprintProblems(yard(SCAVENGER, 1, { width: 4 })).join()).toMatch(
      /5\.0 m across the beam, wider than this slipway \(4\.0 m\)/,
    );
    const corvette = yard(CORVETTE, 1, { width: 16, x: 6, length: 8 });
    expect(blueprintProblems(corvette).join()).toMatch(/stands in the weapons layer, so this slipway must be thick/);
    const thick = yard(CORVETTE, 1, { width: 16, x: 6, length: 8, thick: true });
    expect(blueprintProblems(thick)).toEqual([]);
  });

  it('refuses to build into its own ship', () => {
    const blocked = yard(SCAVENGER, 1, {}, [{ kind: 'structure', x: 14, y: 0, length: 2, width: 2 }]);
    expect(blueprintProblems(blocked).join()).toMatch(/11\.0 m it builds Scavenger out into is not clear of this ship's hull/);
    // A rail along the strip, beside it, is clear of it.
    const beside = yard(SCAVENGER, 1, {}, [{ kind: 'structure', x: 9, y: 4, length: 10, width: 2 }]);
    expect(blueprintProblems(beside)).toEqual([]);
  });

  it('names one that is in its hangar', () => {
    expect(blueprintProblems({ ...yard(), hangar: {} }).join()).toMatch(/no ship named Scavenger in the hangar/);
  });

  it('keeps its craft and count in a file, and never sets out with one docked', () => {
    const raw = serialiseBlueprint({
      ...yard(SCAVENGER, 2),
      modules: yard(SCAVENGER, 2).modules.map((m, i) => (i === SLIPWAY ? { ...m, docked: true } : m)),
    });
    const written = (raw as { modules: Record<string, unknown>[] }).modules[SLIPWAY]!;
    expect(written).toMatchObject({ craft: SCAVENGER.name, keep: 2 });
    expect(written['docked']).toBeUndefined();
    expect(parseBlueprint(JSON.parse(JSON.stringify(raw))).modules[SLIPWAY]).toMatchObject({ craft: SCAVENGER.name, keep: 2 });
  });

  it('is given its craft by the editor without being docked', () => {
    const bare = yard();
    const { craft: _, keep: __, ...slipway } = bare.modules[SLIPWAY] as ModuleSpec;
    const given = dockFighter(
      { ...bare, modules: [...bare.modules.slice(0, 2), slipway], hangar: {} },
      [{ index: SLIPWAY, copy: 0 }],
      SCAVENGER,
    )!;
    expect(given.modules[SLIPWAY]).toMatchObject({ craft: SCAVENGER.name });
    expect((given.modules[SLIPWAY] as ModuleSpec).docked).toBeUndefined();
    expect(Object.keys(given.hangar ?? {})).toEqual([SCAVENGER.name]);
  });

  it('in a fleet builds the fleet’s design of its craft', () => {
    expect(padFighterNames(yard())).toEqual([SCAVENGER.name]);
    const fleet = addShip(emptyFleet('F'), yard(), 0, 0);
    expect(Object.keys(fleet.designs).sort()).toEqual([SCAVENGER.name, 'Yard']);
    expect(fleet.designs['Yard']!.hangar).toBeUndefined();
  });
});
